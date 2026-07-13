import { ExternalLink, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UiPaper } from '../lib/ui-types';
import { Modal, formatBytes } from './Primitives';

export interface PaperDetailsPatch {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  sourceUrl?: string;
}

export function PaperDialog({ open, paper, onClose, onSave, onReanalyze, onDelete }: {
  open: boolean;
  paper: UiPaper;
  onClose: () => void;
  onSave: (patch: PaperDetailsPatch) => void;
  onReanalyze: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(paper.title);
  const [authors, setAuthors] = useState(paper.authors.join(', '));
  const [year, setYear] = useState(paper.year?.toString() ?? '');
  const [doi, setDoi] = useState(paper.doi ?? '');
  const [sourceUrl, setSourceUrl] = useState(paper.sourceUrl ?? '');
  const [error, setError] = useState<string>();

  useEffect(() => {
    setTitle(paper.title);
    setAuthors(paper.authors.join(', '));
    setYear(paper.year?.toString() ?? '');
    setDoi(paper.doi ?? '');
    setSourceUrl(paper.sourceUrl ?? '');
    setError(undefined);
  }, [paper]);

  let verifiedSourceUrl: string | undefined;
  try {
    const candidate = new URL(sourceUrl);
    if (candidate.protocol === 'https:') verifiedSourceUrl = candidate.href;
  } catch {
    // Keep the open-link affordance hidden until the field is a valid HTTPS URL.
  }

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
        onSave({
          title: title.trim(),
          authors: authors.split(',').map((author) => author.trim()).filter(Boolean),
          year: parsedYear,
          doi: doi.trim() || undefined,
          sourceUrl: nextUrl,
        });
        setError(undefined);
        onClose();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Those paper details could not be saved.');
      }
    }}><Save /> Save details</button>
  </>}>
    <div className="paper-form">
      <label className="field field--full"><span>Paper title</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="field field--full"><span>Authors <small>separate with commas</small></span><input value={authors} onChange={(event) => setAuthors(event.target.value)} placeholder="First Author, Second Author" /></label>
      <label className="field"><span>Year</span><input type="number" min="1000" max="3000" value={year} onChange={(event) => setYear(event.target.value)} placeholder="2026" /></label>
      <label className="field"><span>DOI</span><input value={doi} onChange={(event) => setDoi(event.target.value)} placeholder="10.1000/example" /></label>
      <label className="field field--full"><span>Source URL</span><div className="field-with-icon"><input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" />{verifiedSourceUrl && <a href={verifiedSourceUrl} target="_blank" rel="noreferrer" aria-label="Open source"><ExternalLink /></a>}</div></label>
      <div className="file-facts field--full"><span><strong>{paper.fileName}</strong><small>{formatBytes(paper.fileSize)}{paper.pageCount ? ` · ${paper.pageCount} pages` : ''}</small></span><em>{paper.availableLocal ? 'Available on this device' : 'PDF not on this device'}</em></div>
      {error && <div className="field-error field--full" role="alert">{error}</div>}
      <div className="paper-danger field--full">
        {paper.availableLocal && <button type="button" className="button button--secondary" onClick={() => { onClose(); onReanalyze(); }}><RefreshCw /> Re-analyze paper</button>}
        <button type="button" className="button button--danger" onClick={onDelete}><Trash2 /> Delete paper</button>
      </div>
    </div>
  </Modal>;
}
