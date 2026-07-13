import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UiPaper } from '../lib/ui-types';
import { PaperDialog } from './PaperDialog';

const paper: UiPaper = {
  id: 'paper-details',
  title: 'Paper details',
  authors: [],
  fileName: 'paper.pdf',
  fileSize: 100,
  storageKey: 'paper-details',
  availableLocal: true,
  createdAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
  analysisStatus: 'local',
};

describe('PaperDialog analysis guards', () => {
  it('keeps analysis actions disabled when this session is analyzing another paper', () => {
    const markup = renderToStaticMarkup(<PaperDialog
      open
      paper={paper}
      analysisBusy={false}
      analysisStartBlocked
      onClose={vi.fn()}
      onSave={vi.fn()}
      onAnalyzeLocal={vi.fn()}
      onAnalyzeAi={vi.fn()}
      onDelete={vi.fn()}
    />);
    const analysisButtons = (markup.match(/<button[^>]*disabled=""[^>]*>[\s\S]*?<\/button>/g) ?? [])
      .filter((button) => button.includes('Local Analysis') || button.includes('AI Analysis'));

    expect(markup).toContain('Another paper is being analyzed in this session');
    expect(analysisButtons).toHaveLength(2);
  });
});
