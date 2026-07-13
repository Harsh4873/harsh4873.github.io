import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UiPaper } from '../lib/ui-types';
import { WorkspaceHeader } from './WorkspaceHeader';

const paper: UiPaper = {
  id: 'paper-mobile-meta',
  title: 'Paper without a publication year',
  authors: ['Researcher'],
  fileName: 'paper.pdf',
  fileSize: 2_048,
  storageKey: 'paper-mobile-meta',
  availableLocal: true,
  createdAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
  analysisStatus: 'analyzing',
  analysisProgress: 42,
};

describe('WorkspaceHeader responsive metadata', () => {
  it('uses semantic classes so status does not depend on a conditional year position', () => {
    const markup = renderToStaticMarkup(<WorkspaceHeader
      paper={paper}
      onLibrary={vi.fn()}
      onAnalyzeLocal={vi.fn()}
      onAnalyzeAi={vi.fn()}
      onReattach={vi.fn()}
      onMenu={vi.fn()}
    />);

    expect(markup).toContain('class="workspace-meta__authors"');
    expect(markup).toContain('class="workspace-meta__pages"');
    expect(markup).not.toContain('workspace-meta__year');
    expect(markup).toContain('workspace-status workspace-status--working');
    expect(markup).toContain('Reading the paper');
  });
});
