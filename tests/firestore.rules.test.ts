import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFile } from 'node:fs/promises';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const PROJECT_ID = 'demo-research';
const OWNER_UID = 'research-owner';
const ALLOWED_EMAIL = 'hdav4873@gmail.com';
const STAMP = '2026-07-13T10:00:00.000Z';
const LATER = '2026-07-13T11:00:00.000Z';
const EMULATOR_ADDRESS = process.env.FIRESTORE_EMULATOR_HOST;

function authorizedContext(
  environment: RulesTestEnvironment,
  uid = OWNER_UID,
  overrides: Record<string, unknown> = {},
): RulesTestContext {
  return environment.authenticatedContext(uid, {
    email: ALLOWED_EMAIL,
    email_verified: true,
    firebase: { sign_in_provider: 'google.com' },
    ...overrides,
  });
}

function validProfile() {
  return {
    email: ALLOWED_EMAIL,
    displayName: 'Harsh',
    onboardingComplete: true,
    updatedAt: STAMP,
  };
}

function validSettings() {
  return {
    theme: 'system',
    readerWidth: 'comfortable',
    defaultZoom: 1,
    autoAnalyze: false,
    rememberChat: true,
    updatedAt: STAMP,
  };
}

function validPaper(overrides: Record<string, unknown> = {}) {
  return {
    id: 'paper-1',
    createdAt: STAMP,
    updatedAt: STAMP,
    title: 'Research paper',
    authors: [],
    file: {
      storageKey: 'paper-1',
      name: 'paper.pdf',
      sizeBytes: 1_024,
      mimeType: 'application/pdf',
    },
    tags: [],
    favorite: false,
    archived: false,
    analysisStatus: 'local',
    ...overrides,
  };
}

function validNote() {
  return {
    id: 'note-1',
    paperId: 'paper-1',
    body: 'A useful note.',
    color: 'amber',
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function validMessage() {
  return {
    id: 'message-1',
    paperId: 'paper-1',
    role: 'user',
    content: 'Explain figure one.',
    context: { tab: 'visuals', page: 4 },
    citations: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

describe.skipIf(!EMULATOR_ADDRESS)('combined Firestore security rules', () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    const [host, rawPort] = EMULATOR_ADDRESS!.split(':');
    const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { host, port: Number(rawPort), rules },
    });
  });

  afterEach(async () => environment.clearFirestore());
  afterAll(async () => environment.cleanup());

  it('allows the verified Google owner to use every Sift document family', async () => {
    const firestore = authorizedContext(environment).firestore();
    await assertSucceeds(setDoc(doc(firestore, 'research_users', OWNER_UID, 'profile', 'current'), validProfile()));
    await assertSucceeds(setDoc(doc(firestore, 'research_users', OWNER_UID, 'settings', 'current'), validSettings()));
    await assertSucceeds(setDoc(doc(firestore, 'research_users', OWNER_UID, 'papers', 'paper-1'), validPaper()));
    await assertSucceeds(setDoc(doc(firestore, 'research_users', OWNER_UID, 'notes', 'note-1'), validNote()));
    await assertSucceeds(setDoc(doc(firestore, 'research_users', OWNER_UID, 'messages', 'message-1'), validMessage()));
    for (const name of ['papers', 'notes', 'messages']) {
      await assertSucceeds(getDocs(collection(firestore, 'research_users', OWNER_UID, name)));
    }
  });

  it('permits only current singleton ids and strongly shaped singleton data', async () => {
    const firestore = authorizedContext(environment).firestore();
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'profile', 'extra'), validProfile()));
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'profile', 'current'), {
      ...validProfile(), email: 'someone@example.com',
    }));
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'settings', 'current'), {
      ...validSettings(), readerWidth: 'enormous',
    }));
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'settings', 'current'), {
      ...validSettings(), rawPdf: 'JVBERi0=',
    }));
    const profile = doc(firestore, 'research_users', OWNER_UID, 'profile', 'current');
    await assertSucceeds(setDoc(profile, { ...validProfile(), updatedAt: LATER }));
    await assertFails(setDoc(profile, validProfile()));
  });

  it('rejects mismatched ids, raw PDF bytes, oversize metadata, and unknown entity fields', async () => {
    const firestore = authorizedContext(environment).firestore();
    const reference = doc(firestore, 'research_users', OWNER_UID, 'papers', 'paper-1');
    await assertFails(setDoc(reference, validPaper({ id: 'different' })));
    await assertFails(setDoc(reference, validPaper({ pdfBytes: [37, 80, 68, 70] })));
    await assertFails(setDoc(reference, validPaper({
      file: { ...validPaper().file as object, sizeBytes: 50 * 1024 * 1024 + 1 },
    })));
    await assertFails(setDoc(reference, validPaper({
      file: { ...validPaper().file as object, sha256: 'not-a-content-hash' },
    })));
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'notes', 'note-1'), {
      ...validNote(), privateBlob: 'nope',
    }));
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'messages', 'message-1'), {
      ...validMessage(), context: { tab: 'reader' },
    }));
  });

  it('enforces durable tombstones, immutable creation times, monotonic updates, and no hard deletes', async () => {
    const firestore = authorizedContext(environment).firestore();
    const reference = doc(firestore, 'research_users', OWNER_UID, 'papers', 'paper-1');
    await assertSucceeds(setDoc(reference, validPaper()));
    await assertFails(setDoc(reference, validPaper({ updatedAt: '2026-07-13T09:00:00.000Z' })));
    await assertFails(setDoc(reference, validPaper({ createdAt: LATER, updatedAt: LATER })));
    await assertFails(setDoc(reference, validPaper({ updatedAt: LATER, deleted: true })));
    await assertSucceeds(setDoc(reference, validPaper({ updatedAt: LATER, deleted: true, deletedAt: LATER })));
    await assertFails(setDoc(reference, validPaper({ updatedAt: '2026-07-13T12:00:00.000Z' })));
    await assertFails(deleteDoc(reference));
  });

  it('rejects other accounts, wrong owners, unverified users, other providers, and anonymous access', async () => {
    const path = ['research_users', OWNER_UID, 'papers', 'paper-1'] as const;
    await assertFails(getDoc(doc(authorizedContext(environment, OWNER_UID, { email: 'other@example.com' }).firestore(), ...path)));
    await assertFails(getDoc(doc(authorizedContext(environment, 'other-owner').firestore(), ...path)));
    await assertFails(getDoc(doc(authorizedContext(environment, OWNER_UID, { email_verified: false }).firestore(), ...path)));
    await assertFails(getDoc(doc(authorizedContext(environment, OWNER_UID, {
      firebase: { sign_in_provider: 'password' },
    }).firestore(), ...path)));
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), ...path)));
  });

  it('exposes neither a Sift root document nor unknown subcollections', async () => {
    const firestore = authorizedContext(environment).firestore();
    await assertFails(getDoc(doc(firestore, 'research_users', OWNER_UID)));
    await assertFails(setDoc(doc(firestore, 'research_users', OWNER_UID, 'uploads', 'secret'), {
      openaiKey: 'forbidden',
    }));
  });

  it('preserves authorized Daymark, Slate, and Fare access in the shared ruleset', async () => {
    const firestore = authorizedContext(environment).firestore();
    await assertSucceeds(setDoc(doc(firestore, 'daymark_users', OWNER_UID), {
      generationId: 'generation-1', profileGenerationId: 'generation-1',
    }));
    await assertSucceeds(setDoc(doc(firestore, 'daymark_users', OWNER_UID, 'habits', 'read'), { name: 'Read' }));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID), { schemaVersion: 1 }));
    await assertSucceeds(setDoc(doc(firestore, 'slate_users', OWNER_UID, 'tasks', 'task-1'), { id: 'task-1' }));
    await assertSucceeds(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'profile', 'current'), { updatedAt: STAMP }));
    await assertSucceeds(setDoc(doc(firestore, 'fare_users', OWNER_UID, 'foods', 'food-1'), {
      id: 'food-1', updatedAt: STAMP,
    }));
  });
});
