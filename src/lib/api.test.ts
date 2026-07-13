import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_RECENT_MESSAGE_MAX_LENGTH,
  ASK_SELECTED_TEXT_MAX_LENGTH,
  type PaperPage,
  SiftApiClient,
} from './api';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

const pages: PaperPage[] = [{ page: 1, text: 'Grounded text on page one.' }];

function validAnalysis() {
  return {
    title: 'A grounded paper',
    authors: ['Researcher One'],
    paperType: 'Research article',
    publication: { venue: null, year: null, doi: null, url: null },
    overview: 'Overview',
    researchQuestion: 'Question',
    abstractSummary: 'Abstract',
    methods: [],
    keyFindings: [],
    sectionSummaries: [],
    figures: [],
    tables: [],
    equations: [],
    limitations: [],
    glossary: [],
    references: [],
    sourceLedger: [],
    synthesis: { contribution: 'Contribution', novelty: 'Novelty', implications: [], openQuestions: [] },
    warnings: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('SiftApiClient', () => {
  it('sends extracted pages and the truncation flag, then verifies the analysis', async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return json({ analysis: validAnalysis(), model: 'openai/gpt-oss-120b', requestId: 'req-1' });
    }));
    const client = new SiftApiClient({ getIdToken: async () => 'token' });

    const result = await client.analyze(pages, { title: 'Paper', pageCount: 1 }, true);

    expect(requestBody?.pages).toEqual(pages);
    expect(requestBody?.truncated).toBe(true);
    expect(requestBody?.metadata).toEqual({ title: 'Paper', pageCount: 1 });
    expect(result.analysis.title).toBe('A grounded paper');
    expect(result.model).toBe('openai/gpt-oss-120b');
  });

  it('refreshes the Firebase token once after a 401', async () => {
    const tokens: boolean[] = [];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 'expired', message: 'Expired' } }, 401))
      .mockResolvedValueOnce(json({ answer: { answer: 'Fresh answer.', grounded: true, evidence: [], uncertainty: '', followUps: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SiftApiClient({ getIdToken: async (force) => { tokens.push(Boolean(force)); return force ? 'fresh' : 'old'; } });

    await client.ask({
      pages,
      paperId: 'paper-1',
      question: 'What happened?',
      context: { tab: 'brief', page: 1, selectedText: '' },
      recentMessages: [],
      truncated: false,
    });

    expect(tokens).toEqual([false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('authorization')).toBe('Bearer fresh');
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
      pages,
      paperId: 'paper-1',
      question: 'What happened?',
      context: { tab: 'brief', page: 7, selectedText: '' },
      recentMessages: [],
      truncated: false,
    });
    expect(result.grounded).toBe(true);
    expect(result.uncertainty).toBe('Low uncertainty.');
    expect(result.citations).toEqual([{ page: 7, quote: 'reported result' }]);
  });

  it('bounds selected passages and each recent message, and forwards the paper pages', async () => {
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
      pages,
      paperId: 'paper-1',
      question: 'What is supported?',
      context: { tab: 'ledger', page: 9, selectedText },
      recentMessages: [
        { role: 'user', content: recentUser },
        { role: 'assistant', content: recentAssistant },
      ],
      truncated: false,
    });

    const context = requestBody?.context as Record<string, unknown>;
    const messages = requestBody?.recentMessages as Array<{ role: string; content: string }>;
    expect(requestBody?.pages).toEqual(pages);
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
