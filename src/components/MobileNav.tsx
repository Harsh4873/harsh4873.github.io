import { BookOpenText, FolderOpen, NotebookPen, Sparkles } from 'lucide-react';

export type MobileView = 'library' | 'reader' | 'context';

export function MobileNav({ view, hasPaper, onView, onNotes }: {
  view: MobileView;
  hasPaper: boolean;
  onView: (view: MobileView) => void;
  onNotes: () => void;
}) {
  return <nav className="mobile-nav" aria-label="Sift workspace">
    <button type="button" className={view === 'library' ? 'is-active' : ''} onClick={() => onView('library')}><FolderOpen /><span>Library</span></button>
    <button type="button" disabled={!hasPaper} className={view === 'reader' ? 'is-active' : ''} onClick={() => onView('reader')}><BookOpenText /><span>Paper</span></button>
    <button type="button" disabled={!hasPaper} className={view === 'context' ? 'is-active' : ''} onClick={() => onView('context')}><Sparkles /><span>Brief</span></button>
    <button type="button" disabled={!hasPaper} onClick={onNotes}><NotebookPen /><span>Notes</span></button>
  </nav>;
}
