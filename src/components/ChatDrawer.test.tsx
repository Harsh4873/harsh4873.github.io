import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_ANALYSIS_MODEL } from '../lib/analysis-result';
import { EMPTY_SUMMARY, type UiPaper } from '../lib/ui-types';
import { ChatDrawer } from './ChatDrawer';

describe('ChatDrawer local-analysis boundary', () => {
  it('states that local analysis does not unlock chat and offers AI Analysis', () => {
    const paper: UiPaper = {
      id: 'paper-1',
      title: 'Local paper',
      authors: [],
      fileName: 'paper.pdf',
      fileSize: 100,
      storageKey: 'paper-1',
      availableLocal: true,
      createdAt: '2026-07-13T10:00:00.000Z',
      updatedAt: '2026-07-13T10:00:00.000Z',
      analysisStatus: 'ready',
      analysisModel: LOCAL_ANALYSIS_MODEL,
      summary: { ...EMPTY_SUMMARY, overview: 'Local overview.' },
    };

    const markup = renderToStaticMarkup(<ChatDrawer
      open
      paper={paper}
      context={{ tab: 'brief', page: 1, selectedText: '' }}
      messages={[]}
      busy={false}
      signedIn
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onSignIn={vi.fn()}
      onAnalyzeAi={vi.fn()}
      onAsk={vi.fn()}
      onEvidence={vi.fn()}
      onClearSelection={vi.fn()}
    />);

    expect(markup).toContain('AI Analysis unlocks chat');
    expect(markup).toContain('Local Analysis never uploads the PDF');
    expect(markup).toContain('Run AI Analysis');
  });

  it('gates paper chat behind sign-in even when a prior AI upload exists', () => {
    const markup = renderToStaticMarkup(<ChatDrawer
      open
      paper={{
        id: 'paper-2',
        title: 'Uploaded paper',
        authors: [],
        fileName: 'uploaded.pdf',
        fileSize: 100,
        storageKey: 'paper-2',
        availableLocal: true,
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:00.000Z',
        analysisStatus: 'ready',
        openaiFileId: 'file-private',
      }}
      context={{ tab: 'brief', page: 1, selectedText: '' }}
      messages={[]}
      busy={false}
      signedIn={false}
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onSignIn={vi.fn()}
      onAnalyzeAi={vi.fn()}
      onAsk={vi.fn()}
      onEvidence={vi.fn()}
      onClearSelection={vi.fn()}
    />);

    expect(markup).toContain('Sign in to use Ask Sift');
    expect(markup).toContain('Local Analysis');
    expect(markup).toContain('disabled');
  });

  it('locks the AI Analysis action while another analysis is active', () => {
    const markup = renderToStaticMarkup(<ChatDrawer
      open
      paper={{
        id: 'paper-3',
        title: 'Working paper',
        authors: [],
        fileName: 'working.pdf',
        fileSize: 100,
        storageKey: 'paper-3',
        availableLocal: true,
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:00.000Z',
        analysisStatus: 'analyzing',
      }}
      context={{ tab: 'brief', page: 1, selectedText: '' }}
      messages={[]}
      busy={false}
      signedIn
      analysisBusy
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onSignIn={vi.fn()}
      onAnalyzeAi={vi.fn()}
      onAsk={vi.fn()}
      onEvidence={vi.fn()}
      onClearSelection={vi.fn()}
    />);

    expect(markup).toContain('Analysis in progress');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Analysis in progress/s);
  });

  it('pauses questions while an existing AI paper is being reanalyzed', () => {
    const markup = renderToStaticMarkup(<ChatDrawer
      open
      paper={{
        id: 'paper-4',
        title: 'Reanalyzing paper',
        authors: [],
        fileName: 'working.pdf',
        fileSize: 100,
        storageKey: 'paper-4',
        availableLocal: true,
        createdAt: '2026-07-13T10:00:00.000Z',
        updatedAt: '2026-07-13T10:00:00.000Z',
        analysisStatus: 'analyzing',
        openaiFileId: 'file-previous',
      }}
      context={{ tab: 'brief', page: 1, selectedText: '' }}
      messages={[]}
      busy={false}
      signedIn
      analysisBusy
      onOpen={vi.fn()}
      onClose={vi.fn()}
      onSignIn={vi.fn()}
      onAnalyzeAi={vi.fn()}
      onAsk={vi.fn()}
      onEvidence={vi.fn()}
      onClearSelection={vi.fn()}
    />);

    expect(markup).toContain('placeholder="Finish analysis before asking a question"');
    expect(markup).toMatch(/<textarea[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Send question"/);
  });
});
