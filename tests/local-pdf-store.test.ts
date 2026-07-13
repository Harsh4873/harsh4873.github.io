import { describe, expect, it } from 'vitest';
import {
  MAX_LOCAL_PDF_BYTES,
  calculateLocalPdfSha256,
  validateLocalPdfBlob,
} from '../src/local-pdf-store';

describe('local PDF validation', () => {
  it('accepts PDF signatures even when iOS omits the MIME type', async () => {
    await expect(validateLocalPdfBlob(new Blob(['%PDF-1.7\ncontent']))).resolves.toBeUndefined();
    await expect(validateLocalPdfBlob(new Blob(['%PDF-1.7\ncontent'], { type: 'application/pdf' })))
      .resolves.toBeUndefined();
  });

  it('rejects misleading MIME types and non-PDF bytes before IndexedDB sees them', async () => {
    await expect(validateLocalPdfBlob(new Blob(['%PDF-1.7'], { type: 'text/plain' }))).rejects.toThrow('Only PDF');
    await expect(validateLocalPdfBlob(new Blob(['not a pdf'], { type: 'application/pdf' }))).rejects.toThrow('signature');
  });

  it('uses the same explicit 50 MiB limit as the synced model and backend', () => {
    expect(MAX_LOCAL_PDF_BYTES).toBe(50 * 1024 * 1024);
  });

  it('creates a stable content identity for safe cross-device reattachment', async () => {
    const pdf = new Blob(['%PDF-1.7\ncontent'], { type: 'application/pdf' });
    const first = await calculateLocalPdfSha256(pdf);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    await expect(calculateLocalPdfSha256(pdf)).resolves.toBe(first);
  });
});
