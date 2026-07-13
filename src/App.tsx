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
import { calculateLocalPdfSha256, getLocalPdf, hasLocalPdf, putLocalPdf } from './local-pdf-store';
import type { Paper, ResearchMessage } from './model';
import { useResearchStore } from './store';
import { useResearchSync } from './useResearchSync';
import type { EvidenceRef, ReaderContext, UiMessage, WorkspaceTab } from './lib/ui-types';

interface ToastState {
  message: string;
  tone?: 'default' | 'success' | 'warning';
}

interface AnalysisJob {
  paperId: string;
  progress: number;
  stage: string;
  error?: string;
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
  const [activePdf, setActivePdf] = useState<Blob>();
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
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string>();
  const [sessionMessages, setSessionMessages] = useState<UiMessage[]>([]);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

  const domainPapers = useMemo(() => state?.papers.filter((paper) => !paper.deleted && !paper.archived) ?? [], [state?.papers]);

  useEffect(() => {
    let active = true;
    void Promise.all(domainPapers.map(async (paper) => [paper.id, await hasLocalPdf(paper.file.storageKey)] as const))
      .then((entries) => { if (active) setLocalAvailability(Object.fromEntries(entries)); });
    return () => { active = false; };
  }, [domainPapers.map((paper) => `${paper.id}:${paper.file.storageKey}`).join('|')]);

  const papers = useMemo(() => domainPapers.map((paper) => paperToUi(paper, localAvailability[paper.id] ?? false)), [domainPapers, localAvailability]);
  const activeDomainPaper = domainPapers.find((paper) => paper.id === activePaperId);
  const activePaper = papers.find((paper) => paper.id === activePaperId);

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
    if (!activeDomainPaper || !localAvailability[activeDomainPaper.id]) { setActivePdf(undefined); return; }
    let current = true;
    void getLocalPdf(activeDomainPaper.file.storageKey).then((pdf) => {
      if (!current) return;
      setActivePdf(pdf);
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
      setActivePdf(file);
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
      setActivePdf(file);
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

  async function analyzePaper(forceFreshUpload = false) {
    if (!activeDomainPaper || !activePdf) {
      setReattachOpen(true);
      return;
    }
    if (!sync.user) {
      setSettingsOpen(true);
      setToast({ message: 'Sign in with the owner account before sending a paper for analysis.', tone: 'warning' });
      return;
    }
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisJob({ paperId: activeDomainPaper.id, progress: 1, stage: 'Preparing the secure upload…' });
    setChatError(undefined);
    store.updatePaper(activeDomainPaper.id, { analysisStatus: 'queued', analysisProgress: 1, analysisError: undefined });
    try {
      const client = apiClient();
      let fileId = forceFreshUpload ? undefined : activeDomainPaper.openaiFileId;
      if (!fileId) {
        store.updatePaper(activeDomainPaper.id, { analysisStatus: 'uploading', analysisProgress: 3 });
        const source = new File([activePdf], activeDomainPaper.file.name, { type: 'application/pdf' });
        const uploaded = await client.uploadPdf(source, (progress: UploadProgress) => {
          const fraction = progress.totalBytes ? progress.uploadedBytes / progress.totalBytes : 0;
          const mapped = progress.stage === 'finishing' ? 58 : Math.max(3, Math.round(3 + fraction * 52));
          const stage = progress.stage === 'finishing' ? 'Verifying the complete paper…' : `Uploading part ${Math.max(1, progress.completedParts)} of ${progress.totalParts}…`;
          setAnalysisJob({ paperId: activeDomainPaper.id, progress: mapped, stage });
          store.updatePaper(activeDomainPaper.id, { analysisStatus: 'uploading', analysisProgress: mapped });
        }, controller.signal);
        fileId = uploaded.fileId;
        store.updatePaper(activeDomainPaper.id, { openaiFileId: fileId, analysisStatus: 'analyzing', analysisProgress: 62 });
      } else {
        store.updatePaper(activeDomainPaper.id, { analysisStatus: 'analyzing', analysisProgress: 62 });
      }
      setAnalysisJob({ paperId: activeDomainPaper.id, progress: 64, stage: 'Reading every page, figure, and equation…' });
      const response = await client.analyze(fileId, {
        title: activeDomainPaper.title,
        authors: activeDomainPaper.authors,
        pageCount: activeDomainPaper.pageCount,
      }, controller.signal);
      const analysis = response.analysis;
      store.updatePaper(activeDomainPaper.id, {
        title: analysis.title || activeDomainPaper.title,
        authors: analysis.authors.length ? analysis.authors : activeDomainPaper.authors,
        year: analysis.publication.year ?? activeDomainPaper.year,
        doi: analysis.publication.doi ?? activeDomainPaper.doi,
        sourceUrl: analysis.publication.url ?? activeDomainPaper.sourceUrl,
        openaiFileId: fileId,
        summary: analysis,
        analysisStatus: 'ready',
        analysisProgress: 100,
        analysisModel: response.model,
        analysisCompletedAt: new Date().toISOString(),
        analysisError: undefined,
      });
      setAnalysisJob(undefined);
      setActiveTab('brief');
      setMobileView('context');
      setToast({ message: 'Brief ready. Every major claim includes a page receipt.', tone: 'success' });
    } catch (error) {
      const message = readableError(error);
      if (error instanceof DOMException && error.name === 'AbortError') {
        store.updatePaper(activeDomainPaper.id, { analysisStatus: activeDomainPaper.summary ? 'ready' : 'local', analysisProgress: undefined, analysisError: undefined });
        setAnalysisJob(undefined);
      } else if (error instanceof ApiError && error.code === 'ai_file_unavailable' && !forceFreshUpload) {
        store.updatePaper(activeDomainPaper.id, {
          openaiFileId: undefined,
          analysisStatus: 'uploading',
          analysisProgress: 2,
          analysisError: undefined,
        });
        setAnalysisJob({ paperId: activeDomainPaper.id, progress: 2, stage: 'Refreshing the private PDF copy…' });
        await analyzePaper(true);
      } else {
        store.updatePaper(activeDomainPaper.id, { analysisStatus: 'error', analysisProgress: undefined, analysisError: message });
        setAnalysisJob({ paperId: activeDomainPaper.id, progress: 0, stage: 'Analysis paused', error: message });
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
    const context = { ...readerContext };
    saveMessage({ paperId: activeDomainPaper.id, role: 'user', content: question, context, citations: [] });
    setChatBusy(true);
    setChatError(undefined);
    try {
      const answer = await apiClient().ask({
        fileId: activeDomainPaper.openaiFileId,
        paperId: activeDomainPaper.id,
        question,
        context,
        recentMessages: chatMessages.slice(-10).map(({ role, content }) => ({ role, content })),
      });
      saveMessage({ paperId: activeDomainPaper.id, role: 'assistant', content: answer.answer, context, citations: answer.citations }, {
        grounded: answer.grounded,
        uncertainty: answer.uncertainty,
        responseId: answer.requestId,
        model: answer.model,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ai_file_unavailable') {
        store.updatePaper(activeDomainPaper.id, { openaiFileId: undefined });
        setChatError('The private PDF copy expired. Re-analyze this paper once, then ask again. Your existing brief and notes are unchanged.');
      } else {
        setChatError(readableError(error));
      }
    } finally {
      setChatBusy(false);
    }
  }

  async function deleteActivePaper() {
    if (!activeDomainPaper) return;
    if (!window.confirm(`Delete “${activeDomainPaper.title}” from Sift? This removes its local PDF, synced brief, notes, and chat.`)) return;
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
    setActivePdf(undefined);
    setMobileView('library');
    setToast({ message: 'Paper and its private records were removed.', tone: 'success' });
  }

  function openEvidence(evidence: EvidenceRef) {
    setPage(Math.max(1, Math.min(activePaper?.pageCount ?? evidence.page, evidence.page)));
    setMobileView('reader');
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
  const activeAnalysisJob = analysisJob?.paperId === activePaper?.id ? analysisJob : undefined;
  const analysis: AnalysisControl = {
    busy: Boolean(activeAnalysisJob && !activeAnalysisJob.error),
    progress: activeAnalysisJob?.progress ?? activePaper?.analysisProgress,
    stage: activeAnalysisJob?.stage,
    error: activeAnalysisJob?.error ?? activePaper?.analysisError,
    onAnalyze: () => void analyzePaper(),
    onCancel: () => analysisAbortRef.current?.abort(),
  };

  return <div className={`sift-app mobile-view--${mobileView}`} data-reader-width={state.settings.readerWidth}>
    <LibraryPane papers={papers} activePaperId={activePaperId} syncStatus={sync.status} syncMessage={sync.message} onSelect={selectPaper} onUpload={() => setUploadOpen(true)} onSettings={() => setSettingsOpen(true)} onSync={() => setSettingsOpen(true)} />
    {activePaper && activeDomainPaper ? <main className="workspace-shell">
      <WorkspaceHeader paper={activePaper} onLibrary={() => setMobileView('library')} onAnalyze={() => void analyzePaper()} onReattach={() => setReattachOpen(true)} onMenu={() => setPaperDialogOpen(true)} />
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

    <MobileNav view={mobileView} hasPaper={Boolean(activePaper)} onView={setMobileView} onNotes={() => { setActiveTab('notes'); setMobileView('context'); }} />
    <ChatDrawer open={chatOpen} paper={activePaper} context={readerContext} messages={chatMessages} busy={chatBusy} error={chatError} onOpen={() => setChatOpen(true)} onClose={() => setChatOpen(false)} onAsk={askSift} onEvidence={openEvidence} onClearSelection={() => setSelectedText('')} />

    <UploadDialog open={uploadOpen} busy={uploadBusy} onClose={() => setUploadOpen(false)} onFile={importPaper} />
    {activePaper && <UploadDialog open={reattachOpen} mode="reattach" paperTitle={activePaper.title} busy={uploadBusy} onClose={() => setReattachOpen(false)} onFile={reattachPdf} />}
    {activePaper && <PaperDialog open={paperDialogOpen} paper={activePaper} onClose={() => setPaperDialogOpen(false)} onSave={(patch: PaperDetailsPatch) => store.updatePaper(activePaper.id, patch)} onReanalyze={() => void analyzePaper()} onDelete={() => void deleteActivePaper()} />}
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
      onSignIn={() => void sync.signIn()}
      onSignOut={() => void sync.signOut()}
      onExport={() => { downloadJson(`sift-workspace-${new Date().toISOString().slice(0, 10)}.json`, state); setToast({ message: 'Workspace metadata exported. PDFs remain on this device.', tone: 'success' }); }}
      onClear={() => {
        if (!window.confirm('Clear Sift’s local cache and PDFs from this device? Synced metadata can return after reload.')) return;
        void store.clearLocalData().then(() => window.location.reload());
      }}
    />
    {sync.signingOut && <div className="blocking-scrim"><LockKeyhole /><strong>Finishing sync before clearing this device…</strong></div>}
    {toast && <div className="toast-region"><Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(undefined)} /></div>}
  </div>;
}
