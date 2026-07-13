import {
  ArrowLeft,
  CheckCircle2,
  CloudUpload,
  FileQuestion,
  FileText,
  HardDrive,
  Link2,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { isLocalAnalysis } from '../lib/analysis-result';
import type { UiPaper } from '../lib/ui-types';
import { IconButton, ProgressBar, formatBytes } from './Primitives';

function statusCopy(paper: UiPaper) {
  if (!paper.availableLocal) return { icon: FileQuestion, label: 'PDF needed on this device', tone: 'missing' };
  switch (paper.analysisStatus) {
    case 'ready': return isLocalAnalysis(paper.analysisModel)
      ? { icon: HardDrive, label: 'Local brief ready', tone: 'local-ready' }
      : { icon: CheckCircle2, label: 'AI brief ready', tone: 'ready' };
    case 'uploading': return { icon: CloudUpload, label: 'Securely uploading', tone: 'working' };
    case 'analyzing': return { icon: LoaderCircle, label: 'Reading the paper', tone: 'working' };
    case 'queued': return { icon: LoaderCircle, label: 'Preparing analysis', tone: 'working' };
    case 'error': return { icon: FileQuestion, label: 'Analysis needs attention', tone: 'error' };
    default: return { icon: FileText, label: 'Local PDF · not analyzed', tone: 'local' };
  }
}

export function WorkspaceHeader({ paper, onLibrary, onAnalyzeLocal, onAnalyzeAi, onReattach, onMenu }: {
  paper: UiPaper;
  onLibrary: () => void;
  onAnalyzeLocal: () => void;
  onAnalyzeAi: () => void;
  onReattach: () => void;
  onMenu: () => void;
}) {
  const status = statusCopy(paper);
  const StatusIcon = status.icon;
  const working = paper.analysisStatus === 'uploading' || paper.analysisStatus === 'analyzing' || paper.analysisStatus === 'queued';
  return <header className="workspace-header">
    <div className="workspace-header__mobile"><IconButton label="Open paper library" onClick={onLibrary}><Menu /></IconButton></div>
    <div className="workspace-header__copy">
      <button type="button" className="workspace-back" onClick={onLibrary}><ArrowLeft /><span>Library</span></button>
      <div className="workspace-title-row"><h1>{paper.title}</h1>{paper.sourceUrl && <a href={paper.sourceUrl} target="_blank" rel="noreferrer" aria-label="Open original source"><Link2 /></a>}</div>
      <div className="workspace-meta"><span className="workspace-meta__authors">{paper.authors.length ? paper.authors.join(', ') : 'Unknown author'}</span>{paper.year && <span className="workspace-meta__year">{paper.year}</span>}<span className="workspace-meta__pages">{paper.pageCount ? `${paper.pageCount} pages` : formatBytes(paper.fileSize)}</span><span className={`workspace-status workspace-status--${status.tone}`}><StatusIcon className={working ? 'spin' : ''} />{status.label}</span></div>
      {working && <ProgressBar value={paper.analysisProgress ?? 0} label="Analysis progress" />}
    </div>
    <div className="workspace-header__actions">
      {!paper.availableLocal ? <button type="button" className="button button--secondary" onClick={onReattach}><RotateCcw /> Reattach PDF</button>
        : !paper.summary && !working ? <><button type="button" className="button button--secondary" onClick={onAnalyzeLocal}><HardDrive /> Local</button><button type="button" className="button button--primary" onClick={onAnalyzeAi}><Sparkles /> AI</button></>
          : isLocalAnalysis(paper.analysisModel) && !working ? <button type="button" className="button button--primary" onClick={onAnalyzeAi}><Sparkles /> Upgrade with AI</button> : null}
      <IconButton label="Paper options" onClick={onMenu}><MoreHorizontal /></IconButton>
    </div>
  </header>;
}
