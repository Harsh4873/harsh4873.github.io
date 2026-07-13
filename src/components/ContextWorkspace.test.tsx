import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_ANALYSIS_MODEL } from '../lib/analysis-result';
import { EMPTY_SUMMARY, type UiPaper } from '../lib/ui-types';
import { ContextWorkspace, type AnalysisControl } from './ContextWorkspace';

const paper: UiPaper = {
  id: 'paper-1',
  title: 'Research paper',
  authors: [],
  fileName: 'paper.pdf',
  fileSize: 100,
  storageKey: 'paper-1',
  availableLocal: true,
  createdAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
  analysisStatus: 'local',
};

function control(overrides: Partial<AnalysisControl> = {}): AnalysisControl {
  return {
    busy: false,
    onAnalyzeLocal: vi.fn(),
    onAnalyzeAi: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(activePaper = paper, analysis = control(), activeTab: 'brief' | 'notes' = 'brief') {
  return renderToStaticMarkup(<ContextWorkspace
    paper={activePaper}
    notes={[]}
    activeTab={activeTab}
    page={1}
    analysis={analysis}
    onTabChange={vi.fn()}
    onEvidence={vi.fn()}
    onAddNote={vi.fn()}
    onDeleteNote={vi.fn()}
  />);
}

describe('ContextWorkspace analysis choices', () => {
  it('places Local Analysis before AI Analysis and keeps API errors scoped to AI', () => {
    const markup = renderWorkspace(paper, control({ error: 'API credits need attention.' }));

    expect(markup.indexOf('Local Analysis')).toBeGreaterThan(-1);
    expect(markup.indexOf('Local Analysis')).toBeLessThan(markup.indexOf('AI Analysis'));
    expect(markup).toContain('No upload · no credits');
    expect(markup).toContain('Local Analysis on the left still works now.');
  });

  it('uses the shared cancellable progress card for local work', () => {
    const markup = renderWorkspace(paper, control({ busy: true, mode: 'local', progress: 41, stage: 'Mapping paper sections…' }));

    expect(markup).toContain('Private local analysis');
    expect(markup).toContain('Mapping paper sections…');
    expect(markup).toContain('no API credits');
    expect(markup).toContain('Cancel');
  });

  it('offers an explicit unlock only after an external analysis becomes stale', () => {
    const freshMarkup = renderWorkspace(paper, control({
      busy: true,
      external: true,
      canCancel: false,
      progress: 64,
      stage: 'Waiting for the active analysis to finish…',
    }));
    const staleMarkup = renderWorkspace(paper, control({
      busy: true,
      external: true,
      externalStale: true,
      canCancel: false,
      progress: 64,
      onTakeOver: vi.fn(),
    }));

    expect(freshMarkup).toContain('Analysis in another session');
    expect(freshMarkup).toContain('Syncing');
    expect(freshMarkup).not.toContain('Unlock analysis');
    expect(staleMarkup).toContain('Analysis stopped updating');
    expect(staleMarkup).toContain('Unlock analysis');
    expect(staleMarkup).not.toContain('>Syncing<');
  });

  it('labels local briefs and offers the AI upgrade without implying chat is already enabled', () => {
    const markup = renderWorkspace({
      ...paper,
      analysisStatus: 'ready',
      analysisModel: LOCAL_ANALYSIS_MODEL,
      summary: { ...EMPTY_SUMMARY, overview: 'Local overview.' },
    });

    expect(markup).toContain('Local brief · no PDF upload');
    expect(markup).toContain('Analyzed privately on this device');
    expect(markup).toContain('Ask Sift also requires');
    expect(markup).toContain('Upgrade with AI');
  });

  it('keeps an existing brief visible and exposes retry choices after reanalysis fails', () => {
    const markup = renderWorkspace({
      ...paper,
      analysisStatus: 'error',
      analysisModel: 'gpt-test',
      analysisError: 'The secure AI request failed.',
      summary: { ...EMPTY_SUMMARY, overview: 'The retained brief remains visible.' },
    }, control({ error: 'The secure AI request failed.' }));

    expect(markup).toContain('latest analysis attempt paused');
    expect(markup).toContain('The retained brief remains visible.');
    expect(markup).toContain('Retry locally');
    expect(markup).toContain('Retry with AI');
  });

  it('keeps the note composer mounted during analysis and exposes complete tab semantics', () => {
    const markup = renderWorkspace(paper, control({ busy: true, mode: 'local', progress: 22, stage: 'Reading page 2…' }), 'notes');

    expect(markup).toContain('Reading page 2…');
    expect(markup).toContain('Write a note, question, or connection…');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('aria-controls="context-panel"');
  });
});
