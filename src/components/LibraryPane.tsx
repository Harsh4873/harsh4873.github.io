import {
  ArrowDownAZ,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileQuestion,
  FileText,
  FolderOpen,
  HardDrive,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { isLocalAnalysis } from '../lib/analysis-result';
import type { UiPaper } from '../lib/ui-types';
import { BrandLockup } from './Brand';
import { IconButton, SyncBadge, type SyncTone, formatRelativeDate } from './Primitives';

type LibraryFilter = 'all' | 'ready' | 'local-missing';
type LibrarySort = 'recent' | 'title';

function analysisLabel(paper: UiPaper) {
  if (!paper.availableLocal) return { label: 'Reattach PDF', tone: 'missing' };
  if (paper.analysisStatus === 'ready') return isLocalAnalysis(paper.analysisModel)
    ? { label: 'Local brief', tone: 'local-ready' }
    : { label: 'AI brief', tone: 'ready' };
  if (paper.analysisStatus === 'analyzing') return { label: 'Reading paper', tone: 'working' };
  if (paper.analysisStatus === 'uploading' || paper.analysisStatus === 'queued') return { label: 'Uploading', tone: 'working' };
  if (paper.analysisStatus === 'error') return { label: 'Needs attention', tone: 'error' };
  return { label: 'Local only', tone: 'local' };
}

export function LibraryPane({
  papers,
  activePaperId,
  syncStatus,
  syncMessage,
  onSelect,
  onUpload,
  onSettings,
  onSync,
}: {
  papers: UiPaper[];
  activePaperId?: string;
  syncStatus: SyncTone;
  syncMessage?: string;
  onSelect: (paper: UiPaper) => void;
  onUpload: () => void;
  onSettings: () => void;
  onSync: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const filteredPapers = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return papers
      .filter((paper) => !needle || `${paper.title} ${paper.authors.join(' ')}`.toLocaleLowerCase().includes(needle))
      .filter((paper) => filter === 'all' || (filter === 'ready' ? paper.analysisStatus === 'ready' : !paper.availableLocal))
      .sort((left, right) => sort === 'title'
        ? left.title.localeCompare(right.title)
        : (right.lastOpenedAt ?? right.updatedAt).localeCompare(left.lastOpenedAt ?? left.updatedAt));
  }, [filter, papers, query, sort]);

  return (
    <aside className="library-pane" aria-label="Paper library">
      <header className="library-pane__header">
        <a className="library-brand" href="#library" aria-label="Sift library"><BrandLockup /></a>
        <IconButton label="Settings" onClick={onSettings}><Settings /></IconButton>
      </header>

      <button className="button button--primary button--full library-upload" type="button" onClick={onUpload}>
        <Plus /> Add research paper
      </button>

      <div className="library-search">
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library" aria-label="Search paper library" />
        {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">Clear</button>}
      </div>

      <div className="library-tools">
        <div className="select-control">
          <SlidersHorizontal aria-hidden="true" />
          <select value={filter} onChange={(event) => setFilter(event.target.value as LibraryFilter)} aria-label="Filter papers">
            <option value="all">All papers</option>
            <option value="ready">Brief ready</option>
            <option value="local-missing">Needs PDF</option>
          </select>
          <ChevronDown aria-hidden="true" />
        </div>
        <IconButton label={sort === 'recent' ? 'Sort by title' : 'Sort by recent'} onClick={() => setSort(sort === 'recent' ? 'title' : 'recent')}>
          <ArrowDownAZ />
        </IconButton>
      </div>

      <div className="library-section-heading">
        <span>Your papers</span>
        <span>{filteredPapers.length}</span>
      </div>

      <div className="paper-list" role="list">
        {filteredPapers.map((paper) => {
          const status = analysisLabel(paper);
          return (
            <button
              type="button"
              role="listitem"
              key={paper.id}
              className={`paper-card${activePaperId === paper.id ? ' is-active' : ''}`}
              onClick={() => onSelect(paper)}
              aria-current={activePaperId === paper.id ? 'true' : undefined}
            >
              <span className="paper-card__icon">
                {paper.analysisStatus === 'ready' ? isLocalAnalysis(paper.analysisModel) ? <HardDrive /> : <CheckCircle2 /> : !paper.availableLocal ? <FileQuestion /> : <FileText />}
              </span>
              <span className="paper-card__copy">
                <strong>{paper.title}</strong>
                <span>{paper.authors[0] || 'Unknown author'}{paper.authors.length > 1 ? ` +${paper.authors.length - 1}` : ''}{paper.year ? ` · ${paper.year}` : ''}</span>
                <span className="paper-card__meta">
                  <span className={`paper-status paper-status--${status.tone}`}>{status.label}</span>
                  <span>{formatRelativeDate(paper.lastOpenedAt ?? paper.updatedAt)}</span>
                </span>
              </span>
            </button>
          );
        })}
        {!filteredPapers.length && (
          <div className="library-empty">
            {papers.length ? <Search /> : <FolderOpen />}
            <strong>{papers.length ? 'No papers match' : 'Your research shelf is open'}</strong>
            <p>{papers.length ? 'Try another title, author, or filter.' : 'Add a PDF to start a local, source-grounded workspace.'}</p>
            {!papers.length && <button type="button" className="button button--secondary button--small" onClick={onUpload}><Plus /> Add your first PDF</button>}
          </div>
        )}
      </div>

      <footer className="library-pane__footer">
        <SyncBadge status={syncStatus} message={syncMessage} onClick={onSync} />
        <div className="library-privacy">
          <BookOpen aria-hidden="true" />
          <span><strong>Local by default</strong><small>AI runs only when you ask.</small></span>
          <Sparkles aria-hidden="true" />
        </div>
      </footer>
    </aside>
  );
}
