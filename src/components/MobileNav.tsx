import { BookOpenText, FolderOpen, NotebookPen, Sparkles } from 'lucide-react';
import type { WorkspaceTab } from '../lib/ui-types';

export type MobileView = 'library' | 'reader' | 'context';

export function MobileNav({ view, activeTab, hasPaper, onLibrary, onReader, onBrief, onNotes }: {
  view: MobileView;
  activeTab: WorkspaceTab;
  hasPaper: boolean;
  onLibrary: () => void;
  onReader: () => void;
  onBrief: () => void;
  onNotes: () => void;
}) {
  const briefActive = view === 'context' && activeTab !== 'notes';
  const notesActive = view === 'context' && activeTab === 'notes';

  return <nav className="mobile-nav" aria-label="Sift workspace">
    <button type="button" className={view === 'library' ? 'is-active' : ''} aria-current={view === 'library' ? 'page' : undefined} onClick={onLibrary}><FolderOpen /><span>Library</span></button>
    <button type="button" disabled={!hasPaper} className={view === 'reader' ? 'is-active' : ''} aria-current={view === 'reader' ? 'page' : undefined} onClick={onReader}><BookOpenText /><span>Paper</span></button>
    <button type="button" disabled={!hasPaper} className={briefActive ? 'is-active' : ''} aria-current={briefActive ? 'page' : undefined} onClick={onBrief}><Sparkles /><span>Brief</span></button>
    <button type="button" disabled={!hasPaper} className={notesActive ? 'is-active' : ''} aria-current={notesActive ? 'page' : undefined} onClick={onNotes}><NotebookPen /><span>Notes</span></button>
  </nav>;
}
