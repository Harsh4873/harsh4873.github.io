import { ExternalLink, HardDrive, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isLocalAnalysis } from '../lib/analysis-result';
import type { UiPaper } from '../lib/ui-types';
import { Modal, formatBytes } from './Primitives';

export interface PaperDetailsPatch {
  title?: string;
  authors?: string[];
  year?: number;
  doi?: string;
  sourceUrl?: string;
}

type PaperDetailsField = keyof PaperDetailsPatch;
type DirtyPaperDetails = Partial<Record<PaperDetailsField, true>>;

export function PaperDialog({ open, paper, analysisBusy, analysisStartBlocked = false, onClose, onSave, onAnalyzeLocal, onAnalyzeAi, onDelete }: {
  open: boolean;
  paper: UiPaper;
  analysisBusy: boolean;
  analysisStartBlocked?: boolean;
  onClose: () => void;
  onSave: (patch: PaperDetailsPatch) => void;
  onAnalyzeLocal: () => void;
  onAnalyzeAi: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors.join(', '));
  const [year, setYear] = useState(paper.year?.toString() ?? '');
  const [doi, setDoi] = useState(paper.doi ?? '');
  const [sourceUrl, setSourceUrl] = useState(paper.sourceUrl ?? '');
  const [error, setError] = useState<string>();
  const [dirty, setDirty] = useState<DirtyPaperDetails>({});

  useEffect(() => {
    if (!open) return;
    setTitle(paper.title);
    setAuthors(paper.authors.join(', '));
    setYear(paper.year?.toString() ?? '');
    setDoi(paper.doi ?? '');
    setSourceUrl(paper.sourceUrl ?? '');
    setError(undefined);
    setDirty({});
  }, [open, paper.id]);

  const markDirty = (field: PaperDetailsField) => {
    setDirty((current) => ({ ...current, [field]: true }));
  };

  let verifiedSourceUrl: string | undefined;
  try {
    const candidate = new URL(sourceUrl);
    if (candidate.protocol === 'https:') verifiedSourceUrl = candidate.href;
  } catch {
    // Keep the open-link affordance hidden until the field is a valid HTTPS URL.
  }

  const hasUnsavedChanges = Object.keys(dirty).length > 0;
  const analysisActionsDisabled = analysisBusy || analysisStartBlocked || hasUnsavedChanges;
  const analysisActionHint = hasUnsavedChanges
    ? 'Save or cancel your detail edits before starting analysis.'
    : analysisStartBlocked
      ? 'Another paper is being analyzed in this session. Finish or cancel it first.'
      : undefined;

  return <Modal open={open} onClose={onClose} title="Paper details" description="Keep the source identifiers useful across devices." width="medium" footer={<>
    <button type="button" className="button button--ghost" onClick={onClose}>Cancel</button>
    <button type="button" className="button button--primary" disabled={!title.trim()} onClick={() => {
      const parsedYear = year ? Number(year) : undefined;
      if (parsedYear !== undefined && (!Number.isInteger(parsedYear) || parsedYear < 1000 || parsedYear > 3000)) {
        setError('Enter a four-digit publication year between 1000 and 3000.');
        return;
      }
      const nextUrl = sourceUrl.trim() || undefined;
      if (nextUrl) {
        try {
          if (new URL(nextUrl).protocol !== 'https:') throw new Error();
        } catch {
          setError('Source URL must be a complete HTTPS address.');
          return;
        }
      }
      try {
        const patch: PaperDetailsPatch = {};
        if (dirty.title) patch.title = title.trim();
        if (dirty.authors) patch.authors = authors.split(',').map((author) => author.trim()).filter(Boolean);
        if (dirty.year) patch.year = parsedYear;
        if (dirty.doi) patch.doi = doi.trim() || undefined;
        if (dirty.sourceUrl) patch.sourceUrl = nextUrl;
        if (Object.keys(patch).length) onSave(patch);
        setError(undefined);
        onClose();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Those paper details could not be saved.');
      }
    }}><Save /> Save details</button>
  </>}>
    <div className="paper-form">
      <label className="field field--full"><span>Paper title</span><input value={title} onChange={(event) => { setTitle(event.target.value); markDirty('title'); }} /></label>
      <label className="field field--full"><span>Authors <small>separate with commas</small></span><input value={authors} onChange={(event) => { setAuthors(event.target.value); markDirty('authors'); }} placeholder="First Author, Second Author" /></label>
      <label className="field"><span>Year</span><input type="number" min="1000" max="3000" value={year} onChange={(event) => { setYear(event.target.value); markDirty('year'); }} placeholder="2026" /></label>
      <label className="field"><span>DOI</span><input value={doi} onChange={(event) => { setDoi(event.target.value); markDirty('doi'); }} placeholder="10.1000/example" /></label>
      <label className="field field--full"><span>Source URL</span><div className="field-with-icon"><input type="url" value={sourceUrl} onChange={(event) => { setSourceUrl(event.target.value); markDirty('sourceUrl'); }} placeholder="https://…" />{verifiedSourceUrl && <a href={verifiedSourceUrl} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink /></a>}</div></label>
      <div className="file-facts field--full"><span><strong>{paper.fileName}</strong><small>{formatBytes(paper.fileSize)}{paper.pageCount ? ` · ${paper.pageCount} pages` : ''}</small></span><em>{paper.availableLocal ? 'Available on this device' : 'PDF not on this device'}</em></div>
      {error && <div className="field-error field--full" role="alert">{error}</div>}
      <div className="paper-danger field--full">
        {paper.availableLocal && <div className="paper-analysis-actions">
          {analysisActionHint && <small className="paper-analysis-hint" role="status">{analysisActionHint}</small>}
          <button type="button" className="button button--secondary" disabled={analysisActionsDisabled} onClick={() => { onClose(); onAnalyzeLocal(); }}><HardDrive />{paper.summary ? 'Run local again' : 'Local Analysis'}</button>
          <button type="button" className="button button--secondary" disabled={analysisActionsDisabled} onClick={() => { onClose(); onAnalyzeAi(); }}><Sparkles />{isLocalAnalysis(paper.analysisModel) ? 'Upgrade with AI' : paper.summary ? 'Run AI again' : 'AI Analysis'}</button>
        </div>}
        <button type="button" className="button button--danger" disabled={analysisBusy} onClick={onDelete}><Trash2 /> Delete paper</button>
      </div>
    </div>
  </Modal>;
}
