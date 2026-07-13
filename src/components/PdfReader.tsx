import {
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  FileQuestion,
  ListTree,
  Minus,
  Plus,
  RotateCcw,
  Search,
  TextSelect,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PdfSession, type PdfMetadata } from '../lib/pdf';
import { pageLabel } from '../lib/pdf-utils';
import type { PdfOutlineItem, PdfSearchHit, UiPaper } from '../lib/ui-types';
import { EmptyState, IconButton, LoadingState } from './Primitives';

type ReaderSideMode = 'outline' | 'search' | null;

export function PdfReader({
  paper,
  pdf,
  page,
  defaultZoom = 1,
  onPageChange,
  onReady,
  onReattach,
  onSelectedText,
}: {
  paper: UiPaper;
  pdf?: Blob;
  page: number;
  defaultZoom?: number;
  onPageChange: (page: number) => void;
  onReady?: (metadata: PdfMetadata) => void;
  onReattach: () => void;
  onSelectedText: (text: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<PdfSession>();
  const [loading, setLoading] = useState(Boolean(pdf));
  const [error, setError] = useState<string>();
  const [rendering, setRendering] = useState(false);
  const [zoom, setZoom] = useState(defaultZoom);
  const [fitWidth, setFitWidth] = useState(true);
  const [sideMode, setSideMode] = useState<ReaderSideMode>(null);
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchHits, setSearchHits] = useState<PdfSearchHit[]>([]);
  const [pageText, setPageText] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setSession((current) => { current?.destroy(); return undefined; });
    setOutline([]);
    setPageText('');
    setError(undefined);
    if (!pdf) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void PdfSession.open(pdf, controller.signal).then(async (opened) => {
      if (!active) { opened.destroy(); return; }
      setSession(opened);
      const [metadata, nextOutline] = await Promise.all([opened.metadata(), opened.outline()]);
      if (!active) return;
      setOutline(nextOutline);
      onReady?.(metadata);
      if (page > metadata.pageCount) onPageChange(metadata.pageCount);
    }).catch((reason: unknown) => {
      if (!active || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      setError(reason instanceof Error ? reason.message : 'Sift could not open this PDF.');
    }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [pdf, paper.id]); // Paper identity intentionally owns the PDF session.

  useEffect(() => () => session?.destroy(), [session]);

  const pageCount = session?.pageCount ?? paper.pageCount ?? 1;
  const renderScale = fitWidth && viewportWidth
    ? Math.min(2, Math.max(0.55, (viewportWidth - (sideMode ? 250 : 48)) / 680))
    : zoom;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !session) return;
    const controller = new AbortController();
    setRendering(true);
    void session.renderPage({ canvas, page, scale: renderScale, signal: controller.signal })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'Sift could not draw this page.');
        }
      })
      .finally(() => { if (!controller.signal.aborted) setRendering(false); });
    return () => controller.abort();
  }, [page, renderScale, session]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void session.pageText(page).then((text) => { if (active) setPageText(text); });
    return () => { active = false; };
  }, [page, session]);

  const runSearch = useCallback(async () => {
    if (!session || query.trim().length < 2) { setSearchHits([]); return; }
    const controller = new AbortController();
    setSearching(true);
    try {
      setSearchHits(await session.search(query, controller.signal));
    } finally {
      setSearching(false);
    }
  }, [query, session]);

  function selectTranscript() {
    const selection = window.getSelection()?.toString().replace(/\s+/g, ' ').trim() ?? '';
    if (selection) onSelectedText(selection.slice(0, 15_000));
  }

  if (!pdf || !paper.availableLocal) {
    return (
      <div className="reader reader--missing">
        <EmptyState
          icon={<FileQuestion />}
          eyebrow="Analysis synced · PDF stays local"
          title="Reconnect the PDF on this device"
          description="Your brief, ledger, and notes are here. The original PDF never leaves the device where you added it, so reattach the same file to use the page reader."
          action={<button type="button" className="button button--primary" onClick={onReattach}><RotateCcw /> Reattach PDF</button>}
        />
      </div>
    );
  }

  if (loading) return <div className="reader"><LoadingState label="Opening the local PDF…" /></div>;
  if (error && !session) return <div className="reader"><EmptyState icon={<FileQuestion />} title="This PDF could not be opened" description={error} action={<button type="button" className="button button--secondary" onClick={onReattach}>Choose the file again</button>} /></div>;

  return (
    <section className="reader" aria-label="PDF reader">
      <header className="reader-toolbar">
        <div className="reader-toolbar__group">
          <IconButton label="Previous page" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}><ChevronLeft /></IconButton>
          <label className="page-control">
            <span className="sr-only">Current page</span>
            <input
              type="number"
              min={1}
              max={pageCount}
              value={page}
              onChange={(event) => onPageChange(Math.min(pageCount, Math.max(1, Number(event.target.value) || 1)))}
            />
            <span>/ {pageCount}</span>
          </label>
          <IconButton label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))}><ChevronRight /></IconButton>
        </div>
        <div className="reader-toolbar__group reader-toolbar__zoom">
          <IconButton label="Zoom out" onClick={() => { setFitWidth(false); setZoom((value) => Math.max(.5, value - .1)); }}><Minus /></IconButton>
          <button type="button" className={`reader-fit${fitWidth ? ' is-active' : ''}`} onClick={() => setFitWidth((value) => !value)}>{fitWidth ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
          <IconButton label="Zoom in" onClick={() => { setFitWidth(false); setZoom((value) => Math.min(3, value + .1)); }}><Plus /></IconButton>
        </div>
        <div className="reader-toolbar__group reader-toolbar__end">
          <IconButton label="Page text" className={showTranscript ? 'is-active' : ''} onClick={() => setShowTranscript((value) => !value)}><TextSelect /></IconButton>
          <IconButton label="Search this PDF" className={sideMode === 'search' ? 'is-active' : ''} onClick={() => setSideMode(sideMode === 'search' ? null : 'search')}><Search /></IconButton>
          <IconButton label="Paper outline" className={sideMode === 'outline' ? 'is-active' : ''} onClick={() => setSideMode(sideMode === 'outline' ? null : 'outline')}><ListTree /></IconButton>
        </div>
      </header>

      <div className="reader-body">
        {sideMode && (
          <aside className="reader-side" aria-label={sideMode === 'outline' ? 'Paper outline' : 'PDF search'}>
            <header><div><span className="eyebrow">This PDF</span><strong>{sideMode === 'outline' ? 'Outline' : 'Search'}</strong></div><IconButton label="Close panel" onClick={() => setSideMode(null)}><X /></IconButton></header>
            {sideMode === 'outline' ? (
              outline.length ? <div className="outline-list">{outline.map((item, index) => (
                <button type="button" key={`${item.title}-${index}`} style={{ paddingLeft: `${14 + item.depth * 14}px` }} onClick={() => item.page && onPageChange(item.page)} disabled={!item.page}>
                  <span>{item.title}</span>{item.page && <small>{item.page}</small>}
                </button>
              ))}</div> : <div className="reader-side__empty"><BookOpenText /><strong>No embedded outline</strong><p>Use search or the section brief to move through this paper.</p></div>
            ) : <>
              <form className="reader-search" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
                <Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Term or phrase" autoFocus /><button type="submit" disabled={searching || query.trim().length < 2}>{searching ? '…' : 'Find'}</button>
              </form>
              <div className="search-results" aria-live="polite">
                {searchHits.map((hit) => <button type="button" key={hit.page} onClick={() => onPageChange(hit.page)}><strong>Page {hit.page}<small>{hit.matches} match{hit.matches === 1 ? '' : 'es'}</small></strong><span>{hit.excerpt}</span></button>)}
                {!searching && query.trim().length >= 2 && !searchHits.length && <div className="reader-side__empty"><Search /><strong>No matches yet</strong><p>Try a shorter phrase or check the spelling.</p></div>}
              </div>
            </>}
          </aside>
        )}

        <div className="reader-viewport" ref={viewportRef} tabIndex={0} aria-label={pageLabel(page, pageCount)}>
          {rendering && <div className="reader-rendering" aria-hidden="true"><span /></div>}
          <canvas ref={canvasRef} aria-label={`Rendered page ${page}`} />
          {showTranscript && (
            <section className="page-transcript" onMouseUp={selectTranscript} onTouchEnd={selectTranscript}>
              <header><span>Selectable page text</span><small>Select a passage to add it to chat context.</small></header>
              <p>{pageText || 'No selectable text was found on this page. It may be a scanned image.'}</p>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
