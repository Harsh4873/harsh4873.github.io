import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DATABASE_NAME = 'sift-local-pdfs';
const DATABASE_VERSION = 1;
const STORE_NAME = 'pdfs';
export const MAX_LOCAL_PDF_BYTES = 50 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;

export interface LocalPdfRecord {
  storageKey: string;
  blob: Blob;
  name: string;
  mimeType: 'application/pdf';
  sizeBytes: number;
  sha256: string;
  savedAt: string;
}

export type LocalPdfMetadata = Omit<LocalPdfRecord, 'blob'>;

interface SiftPdfDatabase extends DBSchema {
  pdfs: {
    key: string;
    value: LocalPdfRecord;
  };
}

let databasePromise: Promise<IDBPDatabase<SiftPdfDatabase>> | undefined;

function validStorageKey(storageKey: string): string {
  if (!KEY_PATTERN.test(storageKey)) throw new Error('The PDF storage key is invalid.');
  return storageKey;
}

function safeFileName(name: string): string {
  const result = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!result || result.length > 1_000) throw new Error('The PDF filename is invalid.');
  return result;
}

function database(): Promise<IDBPDatabase<SiftPdfDatabase>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable, so this device cannot retain a PDF.'));
  }
  databasePromise ??= openDB<SiftPdfDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    },
    terminated() {
      databasePromise = undefined;
    },
  });
  return databasePromise;
}

export async function validateLocalPdfBlob(blob: Blob): Promise<void> {
  if (blob.size < 5 || blob.size > MAX_LOCAL_PDF_BYTES) {
    throw new Error('PDFs must be 50 MiB or smaller.');
  }
  if (blob.type && blob.type.toLowerCase() !== 'application/pdf') {
    throw new Error('Only PDF files can be stored in Sift.');
  }
  const signature = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...signature) !== '%PDF-') {
    throw new Error('This file does not have a valid PDF signature.');
  }
}

export async function calculateLocalPdfSha256(blob: Blob): Promise<string> {
  await validateLocalPdfBlob(blob);
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser cannot verify PDF identity securely.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Persist an original PDF only on this device. This database is intentionally
 * independent from the synced research state and Firestore cache.
 */
export async function putLocalPdf(
  storageKey: string,
  blob: Blob,
  name = blob instanceof File ? blob.name : `${storageKey}.pdf`,
): Promise<LocalPdfMetadata> {
  const key = validStorageKey(storageKey);
  const sha256 = await calculateLocalPdfSha256(blob);
  const record: LocalPdfRecord = {
    storageKey: key,
    blob: blob.slice(0, blob.size, 'application/pdf'),
    name: safeFileName(name),
    mimeType: 'application/pdf',
    sizeBytes: blob.size,
    sha256,
    savedAt: new Date().toISOString(),
  };
  const db = await database();
  await db.put(STORE_NAME, record, key);
  const { blob: _blob, ...metadata } = record;
  return metadata;
}

export async function getLocalPdfRecord(storageKey: string): Promise<LocalPdfRecord | undefined> {
  const key = validStorageKey(storageKey);
  const db = await database();
  const record = await db.get(STORE_NAME, key);
  if (!record) return undefined;
  // IndexedDB content is untrusted persisted input too. Reject a malformed
  // record instead of passing arbitrary bytes to the PDF renderer or backend.
  try {
    await validateLocalPdfBlob(record.blob);
    if (record.storageKey !== key || record.sizeBytes !== record.blob.size || record.mimeType !== 'application/pdf') {
      throw new Error('PDF metadata does not match its bytes.');
    }
    safeFileName(record.name);
    const sha256 = /^[a-f0-9]{64}$/i.test(record.sha256 ?? '')
      ? record.sha256.toLowerCase()
      : await calculateLocalPdfSha256(record.blob);
    const verified = { ...record, sha256 };
    if (record.sha256 !== sha256) await db.put(STORE_NAME, verified, key);
    return verified;
  } catch {
    await deleteLocalPdf(key);
    return undefined;
  }
}

export async function getLocalPdf(storageKey: string): Promise<Blob | undefined> {
  return (await getLocalPdfRecord(storageKey))?.blob;
}

export async function hasLocalPdf(storageKey: string): Promise<boolean> {
  return Boolean(await getLocalPdfRecord(storageKey));
}

export async function deleteLocalPdf(storageKey: string): Promise<void> {
  await (await database()).delete(STORE_NAME, validStorageKey(storageKey));
}

export async function listLocalPdfs(): Promise<LocalPdfMetadata[]> {
  const db = await database();
  const records = await db.getAll(STORE_NAME);
  return records
    .map(({ blob: _blob, ...metadata }) => metadata)
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

export async function clearLocalPdfs(): Promise<void> {
  await (await database()).clear(STORE_NAME);
}
