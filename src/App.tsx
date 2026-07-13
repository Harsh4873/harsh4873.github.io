import {
  BookOpenText,
  FileCheck2,
  FileSearch,
  FolderOpen,
  LockKeyhole,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountDialog, type DisplaySettings } from './components/AccountDialog';
import { AuthScreen } from './components/AuthScreen';
import { BrandMark } from './components/Brand';
import { ChatDrawer } from './components/ChatDrawer';
import { ContextWorkspace, type AnalysisControl } from './components/ContextWorkspace';
import { LibraryPane } from './components/LibraryPane';
import { MobileNav, type MobileView } from './components/MobileNav';
import { PaperDialog, type PaperDetailsPatch } from './components/PaperDialog';
import { PdfReader } from './components/PdfReader';
import { EmptyState, LoadingState, Toast } from './components/Primitives';
import { UploadDialog } from './components/UploadDialog';
import { WorkspaceHeader } from './components/WorkspaceHeader';
import { SiftApiClient, ApiError, type UploadProgress } from './lib/api';
import { messageToUi, noteToUi, paperToUi } from './lib/adapters';
import {
  canFallBackToLocalAnalysis,
  type AnalysisCoordination,
} from './lib/analysis-job-coordination';
import { isAnalysisLeaseFresh } from './lib/analysis-lease';
import {
  ANALYSIS_PAPER_FIELDS,
  applyAnalysisPaperPatch,
  pickAnalysisPaperPatch,
  type AnalysisPaperPatch,
} from './lib/analysis-paper-coordinator';
import {
  LOCAL_ANALYSIS_MODEL,
  analysisMetadataPatchPreservingEdits,
  completedAnalysisPatch,
  type AnalysisMode,
} from './lib/analysis-result';
import { analyzePdfLocally } from './lib/local-analysis-browser';
import { calculateLocalPdfSha256, getLocalPdf, hasLocalPdf, putLocalPdf } from './local-pdf-store';
import type { Paper, PaperAnalysis, ResearchMessage } from './model';
import { useResearchStore, type PaperPatch } from './store';
import { useResearchSync } from './useResearchSync';
import type { EvidenceRef, ReaderContext, UiMessage, WorkspaceTab } from './lib/ui-types';

interface ToastState {
  message: string;
  tone?: 'default' | 'success' | 'warning';
}

interface AnalysisJob {
  paperId: string;
  runId: string;
  mode: AnalysisMode;
  coordination: AnalysisCoordination;
  claimPending: boolean;
  progress: number;
  stage: string;
  error?: string;
}

const ANALYSIS_HEARTBEAT_MS = 30_000;
const ANALYSIS_LEASE_TIMEOUT_MS = 3 * 60_000;

function paperAnalysisIsWorking(paper?: Pick<Paper, 'analysisStatus'>) {
  return paper?.analysisStatus === 'queued'
    || paper?.analysisStatus === 'uploading'
    || paper?.analysisStatus === 'analyzing';
}

function paperAnalysisStateMatches(left: Paper, right: Paper) {
  return ANALYSIS_PAPER_FIELDS.every((field) => (
    Object.prototype.hasOwnProperty.call(left, field) === Object.prototype.hasOwnProperty.call(right, field)
    && JSON.stringify(left[field]) === JSON.stringify(right[field])
  ));
}

function activePaperKey() {
  try { return localStorage.getItem('sift-active-paper') ?? undefined; } catch { return undefined; }
}

function saveActivePaper(id?: string) {
  try {
    if (id) localStorage.setItem('sift-active-paper', id);
    else localStorage.removeItem('sift-active-paper');
  } catch { /* browser storage can be unavailable in private mode */ }
}

function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ephemeralId(prefix: string) {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readableError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Cancelled. Your local PDF and existing brief are unchanged.';
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Sift could not complete that request.';
}

function WorkspaceEmpty({ onUpload }: { onUpload: () => void }) {
  return <main className="workspace-empty">
    <div className="workspace-empty__art" aria-hidden="true"><span /><span /><div><FileSearch /><i /></div></div>
    <EmptyState
      eyebrow="Your private research desk"
      title="Turn dense papers into traceable context"
      description="Add a PDF to read it locally. When you choose Analyze, Sift builds a complete brief with page receipts for claims, figures, tables, equations, methods, and limitations."
      action={<button type="button" className="button button--primary button--large" onClick={onUpload}><Plus /> Add your first paper</button>}
    />
    <div className="empty-feature-row"><span><BookOpenText /><strong>Read locally</strong><small>Fast PDF pages, search, outline, and selectable text.</small></span><span><Sparkles /><strong>Decode deeply</strong><small>Structure without skipping the technical parts.</small></span><span><FileCheck2 /><strong>Trace every claim</strong><small>Page links and quoted evidence keep the context honest.</small></span></div>
  </main>;
}

export default function App() {
  const store = useResearchStore();
  const sync = useResearchSync(store);
  const state = store.state;
  const [activePaperId, setActivePaperId] = useState<string | undefined>(activePaperKey);
  const [localAvailability, setLocalAvailability] = useState<Record<string, boolean>>({});
  const [activePdfSource, setActivePdfSource] = useState<{ paperId: string; blob: Blob }>();
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('brief');
  const [mobileView, setMobileView] = useState<MobileView>('library');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reattachOpen, setReattachOpen] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paperDialogOpen, setPaperDialogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [toast, setToast] = useState<ToastState>();
  const [authBusy, setAuthBusy] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<AnalysisJob>();
  const analysisAbortRef = useRef<AbortController>();
  const analysisJobRef = useRef<AnalysisJob>();
  const analysisOwnerRef = useRef(ephemeralId('analysis-owner'));
  const chatAbortRef = useRef<AbortController>();
  const activePaperIdRef = useRef(activePaperId);
  const papersRef = useRef<Paper[]>([]);
  const [, setRecoveryTick] = useState(0);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string>();
  const [sessionMessages, setSessionMessages] = useState<UiMessage[]>([]);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

  activePaperIdRef.current = activePaperId;
  papersRef.current = state?.papers ?? [];

  function updateAnalysisJob(job?: AnalysisJob) {
    analysisJobRef.current = job;
    setAnalysisJob(job);
  }

  const domainPapers = useMemo(() => state?.papers.filter((paper) => !paper.deleted && !paper.archived) ?? [], [state?.papers]);

  useEffect(() => {
    if (!domainPapers.some((paper) => paperAnalysisIsWorking(paper))) return;
    const interval = window.setInterval(() => setRecoveryTick((value) => value + 1), 15_000);
    return () => window.clearInterval(interval);
  }, [domainPapers.some((paper) => paperAnalysisIsWorking(paper))]);

  useEffect(() => {
    if (!analysisJob || analysisJob.error || analysisJob.claimPending) return;
    const { paperId, runId } = analysisJob;
    let heartbeatInFlight = false;
    let stopped = false;
    const heartbeat = async () => {
      const currentJob = analysisJobRef.current;
      if (heartbeatInFlight || stopped || currentJob?.runId !== runId || currentJob.error || currentJob.claimPending) return;
      const latest = papersRef.current.find((paper) => paper.id === paperId && !paper.deleted);
      if (!latest || latest.analysisLease?.runId !== runId) {
        analysisAbortRef.current?.abort();
        return;
      }
      heartbeatInFlight = true;
      const analysisLease = { ...latest.analysisLease, heartbeatAt: new Date().toISOString() };
      const applied = await persistOwnedAnalysisPatch(latest, currentJob, {
        analysisLease,
        analysisStatus: currentJob.mode === 'local' || currentJob.progress >= 60 ? 'analyzing' : 'uploading',
        analysisProgress: currentJob.progress,
      }, false);
      heartbeatInFlight = false;
      if (!stopped && analysisJobRef.current?.runId === runId && !applied) analysisAbortRef.current?.abort();
    };
    const interval = window.setInterval(() => void heartbeat(), ANALYSIS_HEARTBEAT_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [analysisJob?.runId, analysisJob?.error, analysisJob?.claimPending]);

  useEffect(() => {
    let active = true;
    void Promise.all(domainPapers.map(async (paper) => [paper.id, await hasLocalPdf(paper.file.storageKey)] as const))
      .then((entries) => { if (active) setLocalAvailability(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [domainPapers.map((paper) => `${paper.id}:${paper.file.storageKey}`).join('|')]);

  const papers = useMemo(() => domainPapers.map((paper) => paperToUi(paper, localAvailability[paper.id] ?? false)), [domainPapers, localAvailability]);
  const activeDomainPaper = domainPapers.find((paper) => paper.id === activePaperId);
  const activePaper = papers.find((paper) => paper.id === activePaperId);
  const activePdf = activePdfSource && activePdfSource.paperId === activePaperId ? activePdfSource.blob : undefined;

  useEffect(() => {
    if (!activePaper) setMobileView('library');
  }, [activePaper]);

  useEffect(() => {
    if (!domainPapers.length) {
      setActivePaperId(undefined);
      saveActivePaper(undefined);
      return;
    }
    if (!activePaperId || !domainPapers.some((paper) => paper.id === activePaperId)) {
      const next = [...domainPapers].sort((left, right) => (right.lastOpenedAt ?? right.updatedAt).localeCompare(left.lastOpenedAt ?? left.updatedAt))[0];
      setActivePaperId(next.id);
      saveActivePaper(next.id);
    }
  }, [activePaperId, domainPapers]);

  useEffect(() => {
    if (!activeDomainPaper || !localAvailability[activeDomainPaper.id]) { setActivePdfSource(undefined); return; }
    let current = true;
    void getLocalPdf(activeDomainPaper.file.storageKey).then((pdf) => {
      if (!current) return;
      setActivePdfSource(pdf ? { paperId: activeDomainPaper.id, blob: pdf } : undefined);
      if (!pdf) setLocalAvailability((value) => ({ ...value, [activeDomainPaper.id]: false }));
    });
    return () => { current = false; };
  }, [activeDomainPaper?.id, activeDomainPaper?.file.storageKey, localAvailability[activeDomainPaper?.id ?? '']]);

  useEffect(() => {
    if (!activePaperId) return;
    saveActivePaper(activePaperId);
    store.markPaperOpened(activePaperId);
    setPage(1);
    setSelectedText('');
    chatAbortRef.current?.abort();
    chatAbortRef.current = undefined;
    setChatBusy(false);
    setChatError(undefined);
  }, [activePaperId]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystemTheme(media.matches ? 'light' : 'dark');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const resolvedTheme = state?.settings.theme === 'system' || !state ? systemTheme : state.settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'light' ? '#F2F0E9' : '#0B1514');
  }, [resolvedTheme]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(undefined), 5200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const notes = useMemo(() => (state?.notes ?? []).filter((note) => !note.deleted && note.paperId === activePaperId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(noteToUi), [activePaperId, state?.notes]);
  const persistedMessages = useMemo(() => (state?.messages ?? []).filter((message) => !message.deleted && message.paperId === activePaperId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map(messageToUi), [activePaperId, state?.messages]);
  const chatMessages = state?.settings.rememberChat ? persistedMessages : sessionMessages.filter((message) => message.paperId === activePaperId);
  const readerContext: ReaderContext = { tab: activeTab, page, selectedText };

  function selectPaper(paper: typeof papers[number]) {
    setActivePaperId(paper.id);
    setMobileView(paper.availableLocal ? 'reader' : 'context');
  }

  async function importPaper(file: File) {
    setUploadBusy(true);
    try {
      const paper = await store.importPaper(file, { autoQueue: false });
      if (!paper) throw new Error('Sift could not add that PDF.');
      setLocalAvailability((value) => ({ ...value, [paper.id]: true }));
      setActivePaperId(paper.id);
      setActivePdfSource({ paperId: paper.id, blob: file });
      setUploadOpen(false);
      setMobileView('reader');
      setToast({ message: 'PDF saved on this device. Analyze it whenever you are ready.', tone: 'success' });
    } catch (error) {
      setToast({ message: readableError(error), tone: 'warning' });
    } finally {
      setUploadBusy(false);
    }
  }

  async function reattachPdf(file: File) {
    if (!activeDomainPaper) return;
    setUploadBusy(true);
    try {
      const sha256 = await calculateLocalPdfSha256(file);
      if (activeDomainPaper.file.sha256 && activeDomainPaper.file.sha256 !== sha256) {
        throw new Error('That is a different PDF. Choose the original file so the synced brief stays tied to the right paper.');
      }
      await putLocalPdf(activeDomainPaper.file.storageKey, file, file.name);
      store.updatePaper(activeDomainPaper.id, {
        file: { ...activeDomainPaper.file, name: file.name, sizeBytes: file.size, mimeType: 'application/pdf', sha256 },
      });
      setLocalAvailability((value) => ({ ...value, [activeDomainPaper.id]: true }));
      setActivePdfSource({ paperId: activeDomainPaper.id, blob: file });
      setReattachOpen(false);
      setMobileView('reader');
      setToast({ message: 'PDF reconnected on this device.', tone: 'success' });
    } catch (error) {
      setToast({ message: readableError(error), tone: 'warning' });
    } finally {
      setUploadBusy(false);
    }
  }

  function apiClient() {
    if (!sync.user) throw new ApiError('Sign in with the owner account before using AI analysis.', 401, 'sign_in_required');
    return new SiftApiClient(sync.user);
  }

  function analysisStartIsBlocked(paperId: string) {
    if (chatBusy || chatAbortRef.current) {
      setToast({ message: 'Wait for the current Ask Sift response before starting analysis.', tone: 'warning' });
      return true;
    }
    const localJob = analysisJobRef.current;
    if (localJob && !localJob.error) {
      const runningPaper = papersRef.current.find((paper) => paper.id === localJob.paperId && !paper.deleted);
      setToast({
        message: runningPaper
          ? `Finish or cancel the analysis of “${runningPaper.title}” before starting another.`
          : 'Finish or cancel the active analysis before starting another.',
        tone: 'warning',
      });
      return true;
    }
    const paper = papersRef.current.find((item) => item.id === paperId && !item.deleted);
    if (paperAnalysisIsWorking(paper)) {
      setToast({ message: 'This paper already has an analysis in progress. Wait for it to finish, or unlock it after its lease expires.', tone: 'warning' });
      return true;
    }
    return false;
  }

  function claimAnalysisRun(paper: Paper, mode: AnalysisMode, progress: number, stage: string) {
    const runId = ephemeralId('analysis-run');
    const analysisLease = {
      runId,
      ownerId: analysisOwnerRef.current,
      mode,
      heartbeatAt: new Date().toISOString(),
    } as const;
    const job: AnalysisJob = {
      paperId: paper.id,
      runId,
      mode,
      coordination: 'pending',
      claimPending: true,
      progress,
      stage,
    };
    updateAnalysisJob(job);
    return { job, analysisLease };
  }

  function ownsAnalysisRun(paperId: string, runId: string) {
    return papersRef.current.find((paper) => paper.id === paperId && !paper.deleted)?.analysisLease?.runId === runId;
  }

  function installCanonicalPaper(paper: Paper) {
    const installed = store.replacePaperLocal(paper);
    if (!installed) return undefined;
    papersRef.current = papersRef.current.map((item) => item.id === paper.id ? installed : item);
    return installed;
  }

  function enrichCompletedPaperMetadata(started: Paper, analysis: PaperAnalysis) {
    const latest = papersRef.current.find((paper) => paper.id === started.id && !paper.deleted);
    if (!latest) return;
    const patch = analysisMetadataPatchPreservingEdits(started, latest, analysis);
    if (!Object.keys(patch).length) return;
    const enriched = store.updatePaper(started.id, patch);
    if (enriched) papersRef.current = papersRef.current.map((paper) => paper.id === started.id ? enriched : paper);
  }

  function applyLocalAnalysisPatch(paperId: string, runId: string, patch: PaperPatch) {
    const current = papersRef.current.find((paper) => paper.id === paperId && !paper.deleted);
    if (!current || current.analysisLease?.runId !== runId) return false;
    const analysisPatch = pickAnalysisPaperPatch(patch as AnalysisPaperPatch);
    const stamped = applyAnalysisPaperPatch(current, analysisPatch);
    const stampedPatch: PaperPatch = {
      ...analysisPatch,
      analysisUpdatedAt: stamped.analysisUpdatedAt,
      analysisRunId: stamped.analysisRunId,
      analysisLease: stamped.analysisLease,
    };
    const applied = store.updatePaperIfAnalysisLease(paperId, runId, stampedPatch);
    if (applied) {
      papersRef.current = papersRef.current.map((paper) => paper.id === paperId ? { ...paper, ...stampedPatch } : paper);
    }
    return applied;
  }

  function applyLocalAnalysisClaim(paperId: string, patch: PaperPatch) {
    const current = papersRef.current.find((paper) => paper.id === paperId && !paper.deleted);
    if (!current) return false;
    const analysisPatch = pickAnalysisPaperPatch(patch as AnalysisPaperPatch);
    const stamped = applyAnalysisPaperPatch(current, analysisPatch);
    const stampedPatch: PaperPatch = {
      ...analysisPatch,
      analysisUpdatedAt: stamped.analysisUpdatedAt,
      analysisRunId: stamped.analysisRunId,
      analysisLease: stamped.analysisLease,
    };
    store.updatePaperLocal(paperId, stampedPatch);
    papersRef.current = papersRef.current.map((paper) => paper.id === paperId ? { ...paper, ...stampedPatch } : paper);
    return true;
  }

  async function persistOwnedAnalysisPatch(
    paper: Paper,
    job: AnalysisJob,
    patch: PaperPatch,
    notifyUnavailable = true,
  ) {
    const result = await sync.mutateAnalysisPaper(
      paper,
      patch as AnalysisPaperPatch,
      { type: 'owned', runId: job.runId },
    );
    if (result.status === 'applied') {
      const installed = installCanonicalPaper(result.paper);
      if (!installed || installed.deleted || !paperAnalysisStateMatches(installed, result.paper)) return false;
      if (job.coordination !== 'cloud') {
        job.coordination = 'cloud';
        const currentJob = analysisJobRef.current;
        if (currentJob?.runId === job.runId && currentJob.coordination !== 'cloud') {
          updateAnalysisJob({ ...currentJob, coordination: 'cloud' });
        }
      }
      return true;
    }
    if (result.status === 'conflict') {
      if (result.paper) installCanonicalPaper(result.paper);
      return false;
    }
    if (!canFallBackToLocalAnalysis(job.mode, job.coordination)) {
      if (notifyUnavailable) {
        setToast({
          message: result.status === 'unavailable'
            ? `${result.message} Analysis stopped because Sift could no longer confirm this run's cloud lock.`
            : 'Analysis stopped because Sift could no longer confirm this run\'s cloud lock.',
          tone: 'warning',
        });
      }
      return false;
    }
    if (result.status === 'local-only') return applyLocalAnalysisPatch(paper.id, job.runId, patch);
    const applied = applyLocalAnalysisPatch(paper.id, job.runId, patch);
    if (applied && notifyUnavailable) {
      setToast({ message: `${result.message} The latest analysis state remains saved on this device.`, tone: 'warning' });
    }
    return applied;
  }

  async function coordinateAnalysisClaim(
    paper: Paper,
    job: AnalysisJob,
    patch: PaperPatch,
    expectedPriorRunId?: string,
  ) {
    const result = await sync.mutateAnalysisPaper(
      paper,
      patch as AnalysisPaperPatch,
      expectedPriorRunId
        ? { type: 'owned', runId: expectedPriorRunId }
        : { type: 'claim', maximumAgeMs: ANALYSIS_LEASE_TIMEOUT_MS },
    );
    if (result.status === 'applied') {
      const installed = installCanonicalPaper(result.paper);
      if (!installed || installed.deleted || !paperAnalysisStateMatches(installed, result.paper)) {
        updateAnalysisJob(undefined);
        setToast({ message: 'A newer local analysis state was kept, so this duplicate run was stopped.', tone: 'warning' });
        return undefined;
      }
      const runningJob: AnalysisJob = { ...job, coordination: 'cloud', claimPending: false };
      updateAnalysisJob(runningJob);
      return runningJob;
    }
    if (result.status === 'conflict') {
      if (result.paper) installCanonicalPaper(result.paper);
      updateAnalysisJob(undefined);
      setToast({ message: 'Another session already owns this paper analysis. Sift kept that newer run.', tone: 'warning' });
      return undefined;
    }
    if ((result.status === 'unavailable' || result.status === 'local-only') && job.mode === 'ai') {
      updateAnalysisJob(undefined);
      setToast({
        message: result.status === 'unavailable'
          ? `${result.message} AI Analysis did not start, so no API work was used.`
          : 'Reconnect to private sync before starting AI Analysis. No API work was used.',
        tone: 'warning',
      });
      return undefined;
    }

    let localPatchApplied: boolean;
    if (expectedPriorRunId) localPatchApplied = applyLocalAnalysisPatch(paper.id, expectedPriorRunId, patch);
    else localPatchApplied = applyLocalAnalysisClaim(paper.id, patch);
    if (!localPatchApplied) {
      updateAnalysisJob(undefined);
      return undefined;
    }
    const runningJob: AnalysisJob = { ...job, coordination: 'local', claimPending: false };
    updateAnalysisJob(runningJob);
    if (result.status === 'unavailable') {
      setToast({ message: `${result.message} Local Analysis will continue only on this device.`, tone: 'warning' });
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 80));
    if (!ownsAnalysisRun(paper.id, job.runId)) {
      updateAnalysisJob(undefined);
      setToast({ message: 'Another local tab claimed this paper first, so this duplicate analysis was stopped.', tone: 'warning' });
      return undefined;
    }
    return runningJob;
  }

  async function clearUnavailableAiFile(paperId: string, expectedFileId: string) {
    const latest = papersRef.current.find((paper) => paper.id === paperId && !paper.deleted);
    if (!latest || latest.openaiFileId !== expectedFileId || paperAnalysisIsWorking(latest)) return 'changed' as const;
    const result = await sync.mutateAnalysisPaper(
      latest,
      { openaiFileId: undefined },
      { type: 'idle-file-clear', expectedFileId },
    );
    if (result.status === 'applied') {
      const installed = installCanonicalPaper(result.paper);
      return installed?.openaiFileId === undefined ? 'cleared' as const : 'changed' as const;
    }
    if (result.status === 'conflict') {
      const installed = result.paper ? installCanonicalPaper(result.paper) : undefined;
      return installed?.openaiFileId === undefined ? 'cleared' as const : 'changed' as const;
    }
    return 'unavailable' as const;
  }

  async function unlockStaleAnalysis() {
    if (!activeDomainPaper || !paperAnalysisIsWorking(activeDomainPaper)
      || isAnalysisLeaseFresh(activeDomainPaper.analysisLease, Date.now(), ANALYSIS_LEASE_TIMEOUT_MS)) return;
    const analysisLease = {
      runId: ephemeralId('analysis-release'),
      ownerId: analysisOwnerRef.current,
      mode: activeDomainPaper.analysisLease?.mode ?? 'local' as const,
      heartbeatAt: new Date().toISOString(),
    };
    const patch = {
      analysisStatus: activeDomainPaper.summary ? 'ready' as const : 'local' as const,
      analysisProgress: undefined,
      analysisError: undefined,
      analysisLease,
    };
    const currentRunId = activeDomainPaper.analysisLease?.runId;
    const result = await sync.mutateAnalysisPaper(
      activeDomainPaper,
      patch,
      currentRunId
        ? { type: 'owned', runId: currentRunId }
        : { type: 'claim', maximumAgeMs: 0 },
    );
    if (result.status === 'conflict') {
      if (result.paper) installCanonicalPaper(result.paper);
      setToast({ message: 'That analysis changed in another session. Sift kept the newer state.', tone: 'warning' });
      return;
    }
    if (result.status === 'unavailable') {
      setToast({ message: result.message, tone: 'warning' });
      return;
    }
    if (result.status === 'applied') {
      const installed = installCanonicalPaper(result.paper);
      if (!installed || installed.deleted || !paperAnalysisStateMatches(installed, result.paper)) {
        setToast({ message: 'That analysis changed while Sift was releasing it. The newer state was kept.', tone: 'warning' });
        return;
      }
    } else {
      const applied = currentRunId
        ? applyLocalAnalysisPatch(activeDomainPaper.id, currentRunId, patch)
        : applyLocalAnalysisClaim(activeDomainPaper.id, patch);
      if (!applied) {
        setToast({ message: 'That analysis changed in another local tab. The newer state was kept.', tone: 'warning' });
        return;
      }
    }
    setToast({ message: 'The stale analysis lock was released. You can start Local or AI Analysis now.', tone: 'success' });
  }

  async function analyzePaperLocally() {
    if (!activeDomainPaper) {
      setReattachOpen(true);
      return;
    }
    if (analysisStartIsBlocked(activeDomainPaper.id)) return;
    const startedPaper = activeDomainPaper;
    let sourcePdf = activePdf;
    if (!sourcePdf) {
      sourcePdf = await getLocalPdf(startedPaper.file.storageKey);
      if (activePaperIdRef.current !== startedPaper.id) return;
      if (sourcePdf) setActivePdfSource({ paperId: startedPaper.id, blob: sourcePdf });
    }
    if (!sourcePdf) {
      setLocalAvailability((value) => ({ ...value, [startedPaper.id]: false }));
      setReattachOpen(true);
      return;
    }
    if (analysisStartIsBlocked(startedPaper.id)) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const { job, analysisLease } = claimAnalysisRun(startedPaper, 'local', 2, 'Opening the PDF on this device…');
    const isControllerCurrent = () => analysisAbortRef.current === controller;
    const runningJob = await coordinateAnalysisClaim(startedPaper, job, {
      analysisStatus: 'analyzing',
      analysisProgress: 2,
      analysisError: undefined,
      analysisLease,
    });
    if (!runningJob) {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = undefined;
      return;
    }
    try {
      if (controller.signal.aborted) throw new DOMException('Local analysis cancelled.', 'AbortError');
      const analysis = await analyzePdfLocally({
        pdf: sourcePdf,
        title: startedPaper.title,
        fileName: startedPaper.file.name,
        signal: controller.signal,
        onProgress: ({ progress, stage }: { progress: number; stage: string }) => {
          if (controller.signal.aborted || !isControllerCurrent()) return;
          if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
            controller.abort();
            return;
          }
          const boundedProgress = Math.max(2, Math.min(99, Math.round(progress)));
          updateAnalysisJob({ ...runningJob, progress: boundedProgress, stage });
        },
      });
      if (!isControllerCurrent()) return;
      if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
        updateAnalysisJob(undefined);
        return;
      }
      if (controller.signal.aborted) throw new DOMException('Local analysis cancelled.', 'AbortError');
      const latestPaper = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
      if (!latestPaper) {
        updateAnalysisJob(undefined);
        return;
      }
      if (!await persistOwnedAnalysisPatch(
        latestPaper,
        runningJob,
        completedAnalysisPatch(latestPaper, analysis, LOCAL_ANALYSIS_MODEL),
      )) {
        updateAnalysisJob(undefined);
        return;
      }
      enrichCompletedPaperMetadata(startedPaper, analysis);
      updateAnalysisJob(undefined);
      if (activePaperIdRef.current === startedPaper.id) {
        setActiveTab('brief');
        setMobileView('context');
      }
      setToast({ message: 'Local brief ready. The PDF never left this device; AI Analysis remains available for a deeper pass.', tone: 'success' });
    } catch (error) {
      if (!isControllerCurrent()) return;
      if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
        updateAnalysisJob(undefined);
        return;
      }
      const message = readableError(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        const latestPaper = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
        if (latestPaper) await persistOwnedAnalysisPatch(latestPaper, runningJob, {
          analysisStatus: latestPaper.summary ? 'ready' : 'local',
          analysisProgress: undefined,
          analysisError: undefined,
          analysisLease: undefined,
        });
        updateAnalysisJob(undefined);
      } else {
        const latestPaper = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
        if (!latestPaper || !await persistOwnedAnalysisPatch(latestPaper, runningJob, {
          analysisStatus: 'error',
          analysisProgress: undefined,
          analysisError: message,
          analysisLease: undefined,
        })) {
          updateAnalysisJob(undefined);
          return;
        }
        updateAnalysisJob({ ...runningJob, progress: 0, stage: 'Local analysis paused', error: message });
        setToast({ message, tone: 'warning' });
      }
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = undefined;
    }
  }

  async function analyzePaperWithAi(forceFreshUpload = false, expectedPriorRunId?: string) {
    if (!activeDomainPaper) {
      setReattachOpen(true);
      return;
    }
    const startedPaper = activeDomainPaper;
    if (!sync.user) {
      setSettingsOpen(true);
      setToast({ message: 'Sign in with the owner account before sending a paper for analysis.', tone: 'warning' });
      return;
    }
    if (expectedPriorRunId) {
      if (!ownsAnalysisRun(startedPaper.id, expectedPriorRunId)) {
        updateAnalysisJob(undefined);
        return;
      }
    } else if (analysisStartIsBlocked(activeDomainPaper.id)) return;
    let sourcePdf = activePdf;
    if (!sourcePdf) {
      sourcePdf = await getLocalPdf(startedPaper.file.storageKey);
      if (activePaperIdRef.current !== startedPaper.id) return;
      if (sourcePdf) setActivePdfSource({ paperId: startedPaper.id, blob: sourcePdf });
    }
    if (!sourcePdf) {
      setLocalAvailability((value) => ({ ...value, [startedPaper.id]: false }));
      setReattachOpen(true);
      return;
    }
    if (expectedPriorRunId) {
      if (!ownsAnalysisRun(startedPaper.id, expectedPriorRunId)) {
        updateAnalysisJob(undefined);
        return;
      }
    } else if (analysisStartIsBlocked(startedPaper.id)) return;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    const { job, analysisLease } = claimAnalysisRun(startedPaper, 'ai', 1, 'Preparing the secure upload…');
    const isControllerCurrent = () => analysisAbortRef.current === controller;
    const client = apiClient();
    let fileId = forceFreshUpload ? undefined : startedPaper.openaiFileId;
    let uploadedFileId: string | undefined;
    const cleanupUploadedFileIfUnreferenced = async () => {
      if (!uploadedFileId) return;
      const uploadedId = uploadedFileId;
      const current = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
      if (current?.openaiFileId === uploadedId) return;
      uploadedFileId = undefined;
      await client.deleteFile(uploadedId).catch(() => undefined);
    };
    setChatError(undefined);
    const runningJob = await coordinateAnalysisClaim(startedPaper, job, {
      analysisStatus: 'queued',
      analysisProgress: 1,
      analysisError: undefined,
      analysisLease,
    }, expectedPriorRunId);
    if (!runningJob) {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = undefined;
      return;
    }
    try {
      if (controller.signal.aborted) throw new DOMException('AI analysis cancelled.', 'AbortError');
      if (!fileId) {
        updateAnalysisJob({ ...runningJob, progress: 3, stage: 'Starting the secure upload…' });
        const source = new File([sourcePdf], startedPaper.file.name, { type: 'application/pdf' });
        const uploaded = await client.uploadPdf(source, (progress: UploadProgress) => {
          if (controller.signal.aborted || !isControllerCurrent()) return;
          if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
            controller.abort();
            return;
          }
          const fraction = progress.totalBytes ? progress.uploadedBytes / progress.totalBytes : 0;
          const mapped = progress.stage === 'finishing' ? 58 : Math.max(3, Math.round(3 + fraction * 52));
          const stage = progress.stage === 'finishing' ? 'Verifying the complete paper…' : `Uploading part ${Math.max(1, progress.completedParts)} of ${progress.totalParts}…`;
          updateAnalysisJob({ ...runningJob, progress: mapped, stage });
        }, controller.signal);
        uploadedFileId = uploaded.fileId;
        if (!isControllerCurrent()) {
          await cleanupUploadedFileIfUnreferenced();
          return;
        }
        if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
          await cleanupUploadedFileIfUnreferenced();
          updateAnalysisJob(undefined);
          return;
        }
        if (controller.signal.aborted) throw new DOMException('AI analysis cancelled.', 'AbortError');
        fileId = uploaded.fileId;
      }
      const phasePaper = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
      if (!phasePaper || !await persistOwnedAnalysisPatch(phasePaper, runningJob, {
        openaiFileId: fileId,
        analysisStatus: 'analyzing',
        analysisProgress: 62,
      })) {
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob(undefined);
        return;
      }
      updateAnalysisJob({ ...runningJob, progress: 64, stage: 'Reading every page, figure, and equation…' });
      const response = await client.analyze(fileId, {
        title: startedPaper.title,
        authors: startedPaper.authors,
        pageCount: startedPaper.pageCount,
      }, controller.signal);
      if (!isControllerCurrent()) {
        await cleanupUploadedFileIfUnreferenced();
        return;
      }
      if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob(undefined);
        return;
      }
      if (controller.signal.aborted) throw new DOMException('AI analysis cancelled.', 'AbortError');
      const analysis = response.analysis;
      const latestPaper = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
      if (!latestPaper) {
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob(undefined);
        return;
      }
      if (!await persistOwnedAnalysisPatch(latestPaper, runningJob, {
        ...completedAnalysisPatch(latestPaper, analysis, response.model),
        openaiFileId: fileId,
      })) {
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob(undefined);
        return;
      }
      enrichCompletedPaperMetadata(startedPaper, analysis);
      updateAnalysisJob(undefined);
      if (activePaperIdRef.current === startedPaper.id) {
        setActiveTab('brief');
        setMobileView('context');
      }
      setToast({ message: 'Brief ready. Every major claim includes a page receipt.', tone: 'success' });
    } catch (error) {
      if (!isControllerCurrent()) {
        await cleanupUploadedFileIfUnreferenced();
        return;
      }
      if (!ownsAnalysisRun(startedPaper.id, job.runId)) {
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob(undefined);
        return;
      }
      const latestPaper = papersRef.current.find((paper) => paper.id === startedPaper.id && !paper.deleted);
      if (!latestPaper) {
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob(undefined);
        return;
      }
      const message = readableError(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        await persistOwnedAnalysisPatch(latestPaper, runningJob, {
          analysisStatus: latestPaper.summary ? 'ready' : 'local',
          analysisProgress: undefined,
          analysisError: undefined,
          analysisLease: undefined,
        });
        updateAnalysisJob(undefined);
      } else if (error instanceof ApiError && error.code === 'ai_file_unavailable' && !forceFreshUpload) {
        if (!await persistOwnedAnalysisPatch(latestPaper, runningJob, {
          openaiFileId: undefined,
          analysisStatus: 'uploading',
          analysisProgress: 2,
          analysisError: undefined,
        })) {
          await cleanupUploadedFileIfUnreferenced();
          updateAnalysisJob(undefined);
          return;
        }
        await cleanupUploadedFileIfUnreferenced();
        updateAnalysisJob({ ...runningJob, progress: 2, stage: 'Refreshing the private PDF copy…' });
        await analyzePaperWithAi(true, runningJob.runId);
      } else {
        if (!await persistOwnedAnalysisPatch(latestPaper, runningJob, {
          analysisStatus: 'error',
          analysisProgress: undefined,
          analysisError: message,
          analysisLease: undefined,
        })) {
          updateAnalysisJob(undefined);
          return;
        }
        updateAnalysisJob({ ...runningJob, progress: 0, stage: 'AI analysis paused', error: message });
        setToast({ message, tone: 'warning' });
      }
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = undefined;
    }
  }

  function saveMessage(message: Omit<UiMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: string }, raw?: Partial<ResearchMessage>) {
    const complete: UiMessage = {
      ...message,
      grounded: message.grounded ?? raw?.grounded,
      uncertainty: message.uncertainty ?? raw?.uncertainty,
      id: message.id ?? ephemeralId('message'),
      createdAt: message.createdAt ?? new Date().toISOString(),
    };
    if (state?.settings.rememberChat) {
      store.addMessage({
        paperId: complete.paperId,
        role: complete.role,
        content: complete.content,
        context: {
          tab: complete.context?.tab ?? activeTab,
          page: complete.context?.page,
          selectedText: complete.context?.selectedText || undefined,
        },
        citations: complete.citations,
        grounded: complete.grounded,
        uncertainty: complete.uncertainty,
        responseId: raw?.responseId,
        model: raw?.model,
      });
    } else {
      setSessionMessages((messages) => [...messages, complete]);
    }
  }

  async function askSift(question: string) {
    if (!activeDomainPaper?.openaiFileId || !sync.user) {
      setChatError('Analyze this paper and sign in before asking a paper-context question.');
      return;
    }
    const paper = activeDomainPaper;
    const context = { ...readerContext };
    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const isCurrent = () => chatAbortRef.current === controller;
    saveMessage({ paperId: paper.id, role: 'user', content: question, context, citations: [] });
    setChatBusy(true);
    setChatError(undefined);
    try {
      const answer = await apiClient().ask({
        fileId: paper.openaiFileId!,
        paperId: paper.id,
        question,
        context,
        recentMessages: chatMessages.slice(-10).map(({ role, content }) => ({ role, content })),
      }, controller.signal);
      if (!isCurrent() || controller.signal.aborted || activePaperIdRef.current !== paper.id) return;
      saveMessage({ paperId: paper.id, role: 'assistant', content: answer.answer, context, citations: answer.citations }, {
        grounded: answer.grounded,
        uncertainty: answer.uncertainty,
        responseId: answer.requestId,
        model: answer.model,
      });
    } catch (error) {
      if (!isCurrent() || controller.signal.aborted) return;
      if (error instanceof ApiError && error.code === 'ai_file_unavailable') {
        const disposition = await clearUnavailableAiFile(paper.id, paper.openaiFileId!);
        if (!isCurrent() || controller.signal.aborted) return;
        setChatError(disposition === 'cleared'
          ? 'The private PDF copy expired. Run AI Analysis again, then ask once more. Your existing brief and notes are unchanged.'
          : disposition === 'changed'
            ? 'The private PDF copy changed while that question was running. Wait for any active analysis to finish, then ask again.'
            : 'The private PDF copy expired, but Sift could not safely update sync. Reconnect, then run AI Analysis again.');
      } else {
        setChatError(readableError(error));
      }
    } finally {
      if (isCurrent()) {
        chatAbortRef.current = undefined;
        setChatBusy(false);
      }
    }
  }

  async function deleteActivePaper() {
    if (!activeDomainPaper) return;
    const paperWorking = activeDomainPaper.analysisStatus === 'queued'
      || activeDomainPaper.analysisStatus === 'uploading'
      || activeDomainPaper.analysisStatus === 'analyzing';
    if ((analysisJob?.paperId === activeDomainPaper.id && !analysisJob.error) || paperWorking) {
      setToast({ message: 'Cancel or finish the active analysis before deleting this paper.', tone: 'warning' });
      return;
    }
    if (!window.confirm(`Delete “${activeDomainPaper.title}” from Sift? This removes its local PDF, synced brief, notes, and chat.`)) return;
    chatAbortRef.current?.abort();
    chatAbortRef.current = undefined;
    setChatBusy(false);
    if (activeDomainPaper.openaiFileId) {
      try {
        await apiClient().deleteFile(activeDomainPaper.openaiFileId);
      } catch (error) {
        setToast({ message: `The AI copy could not be removed yet, so Sift kept the paper. ${readableError(error)}`, tone: 'warning' });
        return;
      }
    }
    store.deletePaper(activeDomainPaper.id);
    setPaperDialogOpen(false);
    setActivePaperId(undefined);
    setActivePdfSource(undefined);
    setMobileView('library');
    setToast({ message: 'Paper and its private records were removed.', tone: 'success' });
  }

  function openEvidence(evidence: EvidenceRef) {
    setPage(Math.max(1, Math.min(activePaper?.pageCount ?? evidence.page, evidence.page)));
    setMobileView('reader');
  }

  function activeAnalysisBlocksAccountChange(action: string) {
    if (!analysisJobRef.current || analysisJobRef.current.error) return false;
    setToast({ message: `Cancel or finish the active analysis before ${action}.`, tone: 'warning' });
    return true;
  }

  if (!state) return <div className="app-loading"><BrandMark size={64} /><LoadingState label="Opening your private research desk…" /></div>;

  if (!sync.user && !state.profile.onboardingComplete) return <AuthScreen
    busy={authBusy || sync.status === 'syncing'}
    error={sync.status === 'action-needed' ? sync.message : undefined}
    onSignIn={() => {
      setAuthBusy(true);
      void sync.signIn().finally(() => setAuthBusy(false));
    }}
    onLocal={() => store.updateProfile({ onboardingComplete: true })}
  />;

  const displaySettings: DisplaySettings = {
    theme: state.settings.theme,
    readerWidth: state.settings.readerWidth,
    defaultZoom: state.settings.defaultZoom,
    rememberChat: state.settings.rememberChat,
  };
  const persistedAnalysisWorking = paperAnalysisIsWorking(activeDomainPaper);
  const candidateAnalysisJob = analysisJob?.paperId === activePaper?.id ? analysisJob : undefined;
  const activeAnalysisJob = candidateAnalysisJob
    && (candidateAnalysisJob.error
      ? !persistedAnalysisWorking
      : candidateAnalysisJob.claimPending || activeDomainPaper?.analysisLease?.runId === candidateAnalysisJob.runId)
    ? candidateAnalysisJob
    : undefined;
  const externalAnalysisWorking = Boolean(persistedAnalysisWorking && !activeAnalysisJob);
  const externalAnalysisStale = Boolean(externalAnalysisWorking
    && !isAnalysisLeaseFresh(activeDomainPaper?.analysisLease, Date.now(), ANALYSIS_LEASE_TIMEOUT_MS));
  const analysis: AnalysisControl = {
    busy: Boolean((activeAnalysisJob && !activeAnalysisJob.error) || externalAnalysisWorking),
    external: externalAnalysisWorking,
    externalStale: externalAnalysisStale,
    canCancel: Boolean(activeAnalysisJob && !activeAnalysisJob.error),
    mode: activeAnalysisJob?.mode ?? activeDomainPaper?.analysisLease?.mode,
    progress: activeAnalysisJob?.progress ?? activePaper?.analysisProgress,
    stage: activeAnalysisJob?.stage ?? (externalAnalysisWorking ? 'Waiting for the active analysis to finish…' : undefined),
    error: activeAnalysisJob?.error ?? activePaper?.analysisError,
    onAnalyzeLocal: () => void analyzePaperLocally(),
    onAnalyzeAi: () => void analyzePaperWithAi(),
    onCancel: () => analysisAbortRef.current?.abort(),
    onTakeOver: unlockStaleAnalysis,
  };

  return <div className={`sift-app mobile-view--${mobileView}`} data-reader-width={state.settings.readerWidth}>
    <LibraryPane papers={papers} activePaperId={activePaperId} syncStatus={sync.status} syncMessage={sync.message} onSelect={selectPaper} onUpload={() => setUploadOpen(true)} onSettings={() => setSettingsOpen(true)} onSync={() => setSettingsOpen(true)} />
    {activePaper && activeDomainPaper ? <main className="workspace-shell">
      <WorkspaceHeader paper={activePaper} onLibrary={() => setMobileView('library')} onAnalyzeLocal={() => void analyzePaperLocally()} onAnalyzeAi={() => void analyzePaperWithAi()} onReattach={() => setReattachOpen(true)} onMenu={() => setPaperDialogOpen(true)} />
      <div className="workspace-panes">
        <PdfReader
          paper={activePaper}
          pdf={activePdf}
          page={page}
          defaultZoom={state.settings.defaultZoom}
          onPageChange={setPage}
          onReattach={() => setReattachOpen(true)}
          onSelectedText={(text) => { setSelectedText(text); setChatOpen(true); }}
          onReady={(metadata) => {
            if (activeDomainPaper.pageCount !== metadata.pageCount) store.updatePaper(activeDomainPaper.id, { pageCount: metadata.pageCount });
            if (metadata.title && activeDomainPaper.title === activeDomainPaper.file.name.replace(/\.pdf$/i, '')) store.updatePaper(activeDomainPaper.id, { title: metadata.title });
          }}
        />
        <ContextWorkspace paper={activePaper} notes={notes} activeTab={activeTab} page={page} analysis={analysis} onTabChange={setActiveTab} onEvidence={openEvidence} onAddNote={(body, notePage) => {
          store.addNote({ paperId: activePaper.id, page: notePage, body, color: 'amber' });
          setToast({ message: notePage ? `Note saved with a page ${notePage} receipt.` : 'Note saved.', tone: 'success' });
        }} onDeleteNote={store.deleteNote} />
      </div>
    </main> : <WorkspaceEmpty onUpload={() => setUploadOpen(true)} />}

    <MobileNav
      view={mobileView}
      activeTab={activeTab}
      hasPaper={Boolean(activePaper)}
      onLibrary={() => setMobileView('library')}
      onReader={() => setMobileView('reader')}
      onBrief={() => { setActiveTab('brief'); setMobileView('context'); }}
      onNotes={() => { setActiveTab('notes'); setMobileView('context'); }}
    />
    <ChatDrawer open={chatOpen} paper={activePaper} context={readerContext} messages={chatMessages} busy={chatBusy} error={chatError} signedIn={Boolean(sync.user)} analysisBusy={analysis.busy} onOpen={() => setChatOpen(true)} onClose={() => setChatOpen(false)} onSignIn={() => { setChatOpen(false); setSettingsOpen(true); }} onAnalyzeAi={() => { setChatOpen(false); void analyzePaperWithAi(); }} onAsk={askSift} onEvidence={(evidence) => { setChatOpen(false); openEvidence(evidence); }} onClearSelection={() => setSelectedText('')} />

    <UploadDialog open={uploadOpen} busy={uploadBusy} onClose={() => setUploadOpen(false)} onFile={importPaper} />
    {activePaper && <UploadDialog open={reattachOpen} mode="reattach" paperTitle={activePaper.title} busy={uploadBusy} onClose={() => setReattachOpen(false)} onFile={reattachPdf} />}
    {activePaper && <PaperDialog open={paperDialogOpen} paper={activePaper} analysisBusy={analysis.busy} analysisStartBlocked={Boolean(analysisJob && !analysisJob.error && analysisJob.paperId !== activePaper.id)} onClose={() => setPaperDialogOpen(false)} onSave={(patch: PaperDetailsPatch) => store.updatePaper(activePaper.id, patch)} onAnalyzeLocal={() => void analyzePaperLocally()} onAnalyzeAi={() => void analyzePaperWithAi()} onDelete={() => void deleteActivePaper()} />}
    <AccountDialog
      open={settingsOpen}
      email={sync.user?.email ?? undefined}
      displayName={sync.user?.displayName ?? state.profile.displayName}
      photoURL={sync.user?.photoURL ?? undefined}
      syncStatus={sync.status}
      storageMode={store.storageMode === 'indexeddb' ? 'IndexedDB' : 'Browser storage'}
      settings={displaySettings}
      signingOut={sync.signingOut}
      onClose={() => setSettingsOpen(false)}
      onSettings={(patch) => store.updateSettings(patch)}
      onSignIn={() => { if (!activeAnalysisBlocksAccountChange('signing in')) void sync.signIn(); }}
      onSignOut={() => { if (!activeAnalysisBlocksAccountChange('signing out')) void sync.signOut(); }}
      onExport={() => { downloadJson(`sift-workspace-${new Date().toISOString().slice(0, 10)}.json`, state); setToast({ message: 'Workspace metadata exported. PDFs remain on this device.', tone: 'success' }); }}
      onClear={() => {
        if (activeAnalysisBlocksAccountChange('clearing this device')) return;
        if (!window.confirm('Clear Sift’s local cache and PDFs from this device? Synced metadata can return after reload.')) return;
        void store.clearLocalData().then(() => window.location.reload());
      }}
    />
    {sync.signingOut && <div className="blocking-scrim"><LockKeyhole /><strong>Finishing sync before clearing this device…</strong></div>}
    {toast && <div className="toast-region"><Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(undefined)} /></div>}
  </div>;
}
