import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_RECENT_MESSAGE_MAX_LENGTH,
  ASK_SELECTED_TEXT_MAX_LENGTH,
  PDF_UPLOAD_CHUNK_BYTES,
  SiftApiClient,
  uploadPartCount,
} from './api';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('SiftApiClient', () => {
  it('keeps raw upload parts below the serverless body ceiling and preserves order', async () => {
    const bytes = PDF_UPLOAD_CHUNK_BYTES * 2 + 17;
    const bodies: number[] = [];
    let part = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/upload/start')) return json({ upload: { id: 'upload-1' } });
      if (url.includes('/api/upload/part')) {
        bodies.push((init?.body as Blob).size);
        part += 1;
        return json({ part: { id: `part-${part}` } });
      }
      if (url.endsWith('/api/upload/complete')) return json({ file: { id: 'file-1' } });
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new SiftApiClient({ getIdToken: async () => 'firebase-token' });
    const file = new File([new Uint8Array(bytes)], 'paper.pdf', { type: 'application/pdf' });
    const result = await client.uploadPdf(file);

    expect(result.fileId).toBe('file-1');
    expect(bodies).toEqual([PDF_UPLOAD_CHUNK_BYTES, PDF_UPLOAD_CHUNK_BYTES, 17]);
    expect(Math.max(...bodies)).toBeLessThan(3 * 1024 * 1024);
    expect(uploadPartCount(bytes)).toBe(3);
  });

  it('refreshes the Firebase token once after a 401', async () => {
    const tokens: boolean[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 'expired', message: 'Expired' } }, 401))
      .mockResolvedValueOnce(json({ deleted: true, id: 'file-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SiftApiClient({ getIdToken: async (force) => { tokens.push(Boolean(force)); return force ? 'fresh' : 'old'; } });
    await client.deleteFile('file-1');
    expect(tokens).toEqual([false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer fresh');
  });

  it('refuses to report deletion unless the backend confirms it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ deleted: false, id: 'file-1' })));
    const client = new SiftApiClient({ getIdToken: async () => 'token' });
    await expect(client.deleteFile('file-1')).rejects.toMatchObject({
      code: 'file_delete_failed',
      status: 502,
    });
  });

  it('normalizes answer evidence before it reaches synced messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      answer: {
        answer: 'The result is concentrated on page 7.',
        grounded: true,
        uncertainty: 'Low uncertainty.',
        evidence: [
          { page: 7, label: null, quote: '  reported result  ' },
          { page: 0, label: 'invalid' },
          { page: 8.5, label: 'invalid' },
          'invalid',
        ],
      },
    })));
    const client = new SiftApiClient({ getIdToken: async () => 'token' });
    const result = await client.ask({
      fileId: 'file-1',
      paperId: 'paper-1',
      question: 'What happened?',
      context: { tab: 'brief', page: 7, selectedText: '' },
      recentMessages: [],
    });
    expect(result.grounded).toBe(true);
    expect(result.uncertainty).toBe('Low uncertainty.');
    expect(result.citations).toEqual([{ page: 7, quote: 'reported result' }]);
  });

  it('bounds selected passages and each recent message to the backend contract', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ answer: { answer: 'Bounded answer.', grounded: false, evidence: [], uncertainty: 'The paper does not resolve this.' } });
    }));
    const selectedText = 's'.repeat(ASK_SELECTED_TEXT_MAX_LENGTH + 51);
    const recentUser = 'u'.repeat(ASK_RECENT_MESSAGE_MAX_LENGTH + 27);
    const recentAssistant = 'a'.repeat(ASK_RECENT_MESSAGE_MAX_LENGTH + 83);
    const client = new SiftApiClient({ getIdToken: async () => 'token' });

    const result = await client.ask({
      fileId: 'file-1',
      paperId: 'paper-1',
      question: 'What is supported?',
      context: { tab: 'ledger', page: 9, selectedText },
      recentMessages: [
        { role: 'user', content: recentUser },
        { role: 'assistant', content: recentAssistant },
      ],
    });

    const context = requestBody?.context as Record<string, unknown>;
    const messages = requestBody?.recentMessages as Array<{ role: string; content: string }>;
    expect(context.selectedText).toBe('s'.repeat(ASK_SELECTED_TEXT_MAX_LENGTH));
    expect(messages).toEqual([
      { role: 'user', content: 'u'.repeat(ASK_RECENT_MESSAGE_MAX_LENGTH) },
      { role: 'assistant', content: 'a'.repeat(ASK_RECENT_MESSAGE_MAX_LENGTH) },
    ]);
    expect(result.grounded).toBe(false);
    expect(result.uncertainty).toBe('The paper does not resolve this.');
    expect(selectedText).toHaveLength(ASK_SELECTED_TEXT_MAX_LENGTH + 51);
  });
});
