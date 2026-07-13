import {
  AlertCircle,
  BookMarked,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CloudUpload,
  ExternalLink,
  FileChartColumn,
  FileSearch,
  HardDrive,
  Highlighter,
  Lightbulb,
  Link2,
  LoaderCircle,
  MessageSquareQuote,
  NotebookPen,
  Plus,
  Quote,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { type LucideIcon } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useMemo, useState } from 'react';
import { isLocalAnalysis, type AnalysisMode } from '../lib/analysis-result';
import type { EvidenceRef, UiFinding, UiNote, UiPaper, UiSummary, WorkspaceTab } from '../lib/ui-types';
import { ConfidenceBadge, EmptyState, EvidenceLink, ExternalAnchor, IconButton, ProgressBar, formatRelativeDate } from './Primitives';

const TABS: Array<{ id: WorkspaceTab; label: string; shortLabel: string; icon: LucideIcon }> = [
  { id: 'brief', label: 'Brief', shortLabel: 'Brief', icon: BookOpenCheck },
  { id: 'sections', label: 'Sections', shortLabel: 'Sections', icon: ClipboardList },
  { id: 'visuals', label: 'Figures & tables', shortLabel: 'Visuals', icon: FileChartColumn },
  { id: 'equations', label: 'Equations', shortLabel: 'Equations', icon: Calculator },
  { id: 'ledger', label: 'Claim ledger', shortLabel: 'Ledger', icon: MessageSquareQuote },
  { id: 'notes', label: 'Notes', shortLabel: 'Notes', icon: NotebookPen },
  { id: 'sources', label: 'Sources', shortLabel: 'Sources', icon: Link2 },
];

export interface AnalysisControl {
  busy: boolean;
  external?: boolean;
  externalStale?: boolean;
  canCancel?: boolean;
  mode?: AnalysisMode;
  progress?: number;
  stage?: string;
  error?: string;
  onAnalyzeLocal: () => void;
  onAnalyzeAi: () => void;
  onCancel: () => void;
  onTakeOver?: () => void;
}

function EvidenceRow({ items, onOpen }: { items: EvidenceRef[]; onOpen: (item: EvidenceRef) => void }) {
  if (!items.length) return <span className="missing-evidence"><AlertCircle /> No page receipt</span>;
  return <div className="evidence-row">{items.map((item, index) => <EvidenceLink key={`${item.page}-${item.label}-${index}`} evidence={item} onOpen={onOpen} />)}</div>;
}

function FindingCard({ finding, index, onEvidence }: { finding: UiFinding; index: number; onEvidence: (evidence: EvidenceRef) => void }) {
  return (
    <article className="finding-card">
      <span className="finding-card__number">{String(index + 1).padStart(2, '0')}</span>
      <div className="finding-card__body">
        <div className="finding-card__heading"><h3>{finding.title}</h3>{finding.confidence && <ConfidenceBadge value={finding.confidence} />}</div>
        <p>{finding.detail}</p>
        <EvidenceRow items={finding.evidence} onOpen={onEvidence} />
      </div>
    </article>
  );
}

function AnalyzeCard({ paper, control }: { paper: UiPaper; control: AnalysisControl }) {
  const errorText = (control.error ?? paper.analysisError ?? '').toLocaleLowerCase();
  const quota = errorText.includes('billing') || errorText.includes('credits');
  if (control.busy) {
    const local = control.mode === 'local';
    const external = control.external === true;
    const staleExternal = external && control.externalStale === true;
    return (
      <section className="analysis-progress-card">
        <div className="analysis-progress-card__top"><span className={`analysis-orbit analysis-orbit--${external ? 'external' : local ? 'local' : 'ai'}`}>{staleExternal ? <AlertCircle /> : external ? <LoaderCircle /> : local ? <HardDrive /> : <Sparkles />}<i /></span><div><span className="eyebrow">{staleExternal ? 'External analysis paused' : external ? 'Analysis in another session' : local ? 'Private local analysis' : 'Source-grounded AI analysis'}</span><h2>{staleExternal ? 'Analysis stopped updating' : control.stage || 'Reading every page…'}</h2></div>{staleExternal ? <button type="button" className="analysis-session-pill analysis-session-pill--action" disabled={!control.onTakeOver} onClick={control.onTakeOver}>Unlock analysis</button> : control.canCancel !== false ? <button type="button" className="button button--ghost button--small" onClick={control.onCancel}><X /> Cancel</button> : <span className="analysis-session-pill">Syncing</span>}</div>
        <ProgressBar value={control.progress ?? 0} label="Paper analysis progress" />
        <div className="analysis-progress-card__meta"><span>{Math.round(control.progress ?? 0)}%</span><span>{staleExternal ? 'No heartbeat arrived from the other session. Unlock only if it is no longer running.' : external ? 'This view will update from private sync while the other session is active.' : local ? 'Running entirely in this browser · no API credits' : 'Figures, equations, methods, and limitations included'}</span></div>
      </section>
    );
  }
  return (
    <section className="analyze-card">
      <header className="analyze-card__intro"><span className="analyze-card__icon"><Sparkles /></span><div><span className="eyebrow">Choose how Sift reads</span><h2>Turn this paper into a traceable brief</h2><p>Both paths keep findings tied to paper pages. Choose private on-device speed or the deeper AI pass.</p></div></header>
      {control.error && <div className="analysis-warning analysis-warning--retry" role="alert"><AlertCircle /><div><strong>The last analysis attempt paused</strong><p>{control.error}</p><p>Choose either path below to try again. Existing notes and saved briefs are unchanged.</p></div></div>}
      <div className="analysis-choice-grid">
        <article className="analysis-choice analysis-choice--local">
          <span className="analysis-choice__icon"><HardDrive /></span>
          <div><span className="eyebrow">No upload · no credits</span><h3>Local Analysis</h3><p>Build a fast structured brief entirely in this browser. It works without signing in and never sends the PDF to an API.</p></div>
          <ul><li>Abstract, sections, findings, and references</li><li>Page receipts from extracted PDF text</li><li>Private, cancellable, and available offline</li></ul>
          <button type="button" className="button button--secondary button--full" disabled={!paper.availableLocal} onClick={control.onAnalyzeLocal}><HardDrive /> Run Local Analysis</button>
        </article>
        <article className="analysis-choice analysis-choice--ai">
          <span className="analysis-choice__icon"><CloudUpload /></span>
          <div><span className="eyebrow">Secure AI upload</span><h3>AI Analysis</h3><p>Use the connected AI service for deeper figure, table, and equation coverage—and unlock Ask Sift for this paper.</p></div>
          <ul><li>High-detail visual and technical interpretation</li><li>Richer synthesis across the complete paper</li><li>Required for contextual paper chat</li></ul>
          <button type="button" className="button button--primary button--full" disabled={!paper.availableLocal} onClick={control.onAnalyzeAi}><Sparkles /> Run AI Analysis</button>
          {quota && <div className="analysis-choice__notice"><ShieldAlert /><span><strong>API credits need attention</strong>Local Analysis on the left still works now.</span></div>}
        </article>
      </div>
      {!paper.availableLocal && <small>Reattach the PDF before starting a new analysis.</small>}
    </section>
  );
}

function LocalAnalysisBanner({ paper, control }: { paper: UiPaper; control: AnalysisControl }) {
  return <section className="local-analysis-banner">
    <span className="local-analysis-banner__icon"><HardDrive /></span>
    <div><span className="eyebrow">Local brief · no PDF upload</span><h2>Analyzed privately on this device</h2><p>Upgrade with AI for deeper visual and equation interpretation. Ask Sift also requires the paper’s secure AI upload.</p></div>
    <button type="button" className="button button--primary button--small" disabled={!paper.availableLocal} onClick={control.onAnalyzeAi}><Sparkles />{paper.openaiFileId ? 'Refresh with AI' : 'Upgrade with AI'}</button>
  </section>;
}

function AnalysisIssueBanner({ paper, control }: { paper: UiPaper; control: AnalysisControl }) {
  if (!control.error) return null;
  return <section className="analysis-warning analysis-warning--saved-brief" role="alert">
    <AlertCircle />
    <div><strong>The latest analysis attempt paused</strong><p>{control.error}</p><p>Your existing brief remains available below.</p></div>
    <span className="analysis-warning__actions">
      <button type="button" className="button button--secondary button--small" disabled={!paper.availableLocal} onClick={control.onAnalyzeLocal}><HardDrive /> Retry locally</button>
      <button type="button" className="button button--primary button--small" disabled={!paper.availableLocal} onClick={control.onAnalyzeAi}><Sparkles /> Retry with AI</button>
    </span>
  </section>;
}

function BriefView({ summary, onEvidence }: { summary: UiSummary; onEvidence: (evidence: EvidenceRef) => void }) {
  return <div className="context-stack">
    <section className="brief-hero">
      <span className="eyebrow"><Quote /> The paper in one line</span>
      <h2>{summary.oneLine || 'A source-grounded overview is ready.'}</h2>
    </section>
    {summary.warnings?.length ? <section className="analysis-warning"><AlertCircle /><div><strong>Read with context</strong>{summary.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></section> : null}
    <section className="brief-grid">
      <article><span className="card-kicker"><BookMarked /> Overview</span><p>{summary.overview}</p></article>
      {summary.researchQuestion && <article className="brief-question"><span className="card-kicker"><Lightbulb /> Research question</span><p>{summary.researchQuestion}</p></article>}
    </section>
    {summary.abstractSummary && <section className="prose-card"><div className="section-title"><div><span className="eyebrow">Abstract decoded</span><h2>What the authors set out to show</h2></div></div><p>{summary.abstractSummary}</p></section>}
    {summary.methodItems?.length ? <section><div className="section-title"><div><span className="eyebrow">Study design</span><h2>Methods, without the fog</h2></div><span>{summary.methodItems.length}</span></div><div className="finding-grid">{summary.methodItems.map((method, index) => <FindingCard key={method.id} finding={method} index={index} onEvidence={onEvidence} />)}</div></section> : null}
    <section><div className="section-title"><div><span className="eyebrow">Main results</span><h2>Key findings</h2></div><span>{summary.keyFindings.length}</span></div><div className="finding-grid">{summary.keyFindings.map((finding, index) => <FindingCard key={finding.id} finding={finding} index={index} onEvidence={onEvidence} />)}</div></section>
    {summary.synthesis && <section className="synthesis-card"><div><span className="eyebrow">So what?</span><h2>Contribution & implications</h2></div>{summary.synthesis.contribution && <p><strong>Contribution.</strong> {summary.synthesis.contribution}</p>}{summary.synthesis.novelty && <p><strong>What is new.</strong> {summary.synthesis.novelty}</p>}{summary.synthesis.implications.length > 0 && <ul>{summary.synthesis.implications.map((item) => <li key={item}>{item}</li>)}</ul>}</section>}
    {summary.limitations.length > 0 && <section><div className="section-title"><div><span className="eyebrow">Boundary conditions</span><h2>Limitations</h2></div><span>{summary.limitations.length}</span></div><div className="limitation-list">{summary.limitations.map((item) => <article key={item.id}><AlertCircle /><div><strong>{item.title}</strong><p>{item.detail}</p><EvidenceRow items={item.evidence} onOpen={onEvidence} /></div></article>)}</div></section>}
    {summary.synthesis?.openQuestions.length ? <section className="open-questions"><span className="eyebrow">Still unresolved</span><h2>Open questions</h2><ol>{summary.synthesis.openQuestions.map((item) => <li key={item}>{item}</li>)}</ol></section> : null}
  </div>;
}

function SectionsView({ summary, onEvidence }: { summary: UiSummary; onEvidence: (evidence: EvidenceRef) => void }) {
  return <div className="context-stack"><div className="view-intro"><span className="eyebrow">Paper map</span><h2>Section-by-section</h2><p>Move through the argument without losing what each section contributes.</p></div><div className="section-timeline">{summary.sections.map((section, index) => <article key={section.id}><span className="section-timeline__marker">{index + 1}</span><div><header><div><span>{section.startPage ? `pp. ${section.startPage}${section.endPage && section.endPage !== section.startPage ? `–${section.endPage}` : ''}` : 'Section'}</span><h3>{section.heading}</h3></div>{section.startPage && <button type="button" onClick={() => onEvidence({ page: section.startPage!, label: section.heading })}>Open <ChevronRight /></button>}</header><p>{section.summary}</p>{section.takeaway && <blockquote><strong>Takeaway</strong>{section.takeaway}</blockquote>}<EvidenceRow items={section.evidence} onOpen={onEvidence} /></div></article>)}</div></div>;
}

function VisualsView({ summary, onEvidence }: { summary: UiSummary; onEvidence: (evidence: EvidenceRef) => void }) {
  return <div className="context-stack"><div className="view-intro"><span className="eyebrow">Visual evidence</span><h2>Figures & tables, decoded</h2><p>Descriptions explain what is shown; takeaways explain why it matters.</p></div>{summary.visuals.length ? <div className="visual-list">{summary.visuals.map((visual) => <article key={visual.id}><header><span className={`visual-kind visual-kind--${visual.kind}`}>{visual.kind}</span><span>{visual.label}</span><EvidenceLink evidence={{ page: visual.page, label: visual.label }} onOpen={onEvidence} /></header><h3>{visual.title}</h3><p>{visual.explanation}</p>{visual.whyItMatters && <div className="visual-takeaway"><Lightbulb /><span><strong>Why it matters</strong>{visual.whyItMatters}</span></div>}<EvidenceRow items={visual.evidence} onOpen={onEvidence} /></article>)}</div> : <EmptyState compact icon={<FileChartColumn />} title="No figures or tables found" description="Sift did not identify a labeled visual in this paper. Check the PDF pages for unlabeled graphics." />}</div>;
}

function EquationsView({ summary, onEvidence }: { summary: UiSummary; onEvidence: (evidence: EvidenceRef) => void }) {
  return <div className="context-stack"><div className="view-intro"><span className="eyebrow">Mathematical context</span><h2>Equations in plain language</h2><p>The expression, its role, and the variables stay tied to the original page.</p></div>{summary.equations.length ? <div className="equation-list">{summary.equations.map((equation) => <article key={equation.id}><header><span><Calculator />{equation.label}</span><EvidenceLink evidence={{ page: equation.page, label: equation.label }} onOpen={onEvidence} /></header>{equation.expression && <code>{equation.expression}</code>}<p>{equation.explanation}</p>{equation.variables?.length ? <dl>{equation.variables.map((variable) => <div key={`${equation.id}-${variable.symbol}`}><dt>{variable.symbol}</dt><dd>{variable.meaning}</dd></div>)}</dl> : null}<EvidenceRow items={equation.evidence} onOpen={onEvidence} /></article>)}</div> : <EmptyState compact icon={<Calculator />} title="No equations identified" description="This paper may be conceptual or present calculations without labeled equations." />}</div>;
}

function LedgerView({ summary, onEvidence }: { summary: UiSummary; onEvidence: (evidence: EvidenceRef) => void }) {
  const [confidence, setConfidence] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const entries = summary.ledger.filter((entry) => confidence === 'all' || entry.confidence === confidence);
  return <div className="context-stack"><div className="view-intro view-intro--tools"><div><span className="eyebrow">Traceability</span><h2>Claim ledger</h2><p>What Sift says, where the paper says it, and how carefully to treat it.</p></div><label className="mini-select">Confidence<select value={confidence} onChange={(event) => setConfidence(event.target.value as typeof confidence)}><option value="all">All</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div><div className="ledger-table" role="table"><div className="ledger-table__header" role="row"><span role="columnheader">Claim</span><span role="columnheader">Receipt</span><span role="columnheader">Confidence</span></div>{entries.map((entry) => <article key={entry.id} role="row"><div role="cell"><strong>{entry.claim}</strong>{entry.interpretation && <p>{entry.interpretation}</p>}{entry.caveat && <details><summary>Context & caveat</summary><p>{entry.caveat}</p></details>}</div><div role="cell"><EvidenceRow items={entry.evidence} onOpen={onEvidence} /></div><div role="cell"><ConfidenceBadge value={entry.confidence} /></div></article>)}</div></div>;
}

function NotesView({ notes, page, onAdd, onDelete, onEvidence }: { notes: UiNote[]; page: number; onAdd: (body: string, page?: number) => void; onDelete: (id: string) => void; onEvidence: (evidence: EvidenceRef) => void }) {
  const [body, setBody] = useState('');
  const [attachPage, setAttachPage] = useState(true);
  return <div className="context-stack"><div className="view-intro"><span className="eyebrow">Your thinking</span><h2>Notes</h2><p>Synced to your private workspace. Add a page receipt when the note comes from the paper.</p></div><form className="note-composer" onSubmit={(event) => { event.preventDefault(); if (!body.trim()) return; onAdd(body.trim(), attachPage ? page : undefined); setBody(''); }}><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a note, question, or connection…" aria-label="New note" /><footer><label><input type="checkbox" checked={attachPage} onChange={(event) => setAttachPage(event.target.checked)} /><Highlighter /> Attach page {page}</label><button type="submit" className="button button--primary button--small" disabled={!body.trim()}><Plus /> Add note</button></footer></form>{notes.length ? <div className="notes-list">{notes.map((note) => <article key={note.id}><header>{note.page ? <EvidenceLink evidence={{ page: note.page, label: note.section || 'Note' }} onOpen={onEvidence} compact /> : <span className="note-free">Free note</span>}<span>{formatRelativeDate(note.updatedAt)}</span><IconButton label="Delete note" onClick={() => onDelete(note.id)}><Trash2 /></IconButton></header><p>{note.body}</p></article>)}</div> : <EmptyState compact icon={<NotebookPen />} title="No notes yet" description="Capture what surprised you, what you disagree with, or what to investigate next." />}</div>;
}

function SourcesView({ paper, summary, onEvidence }: { paper: UiPaper; summary: UiSummary; onEvidence: (evidence: EvidenceRef) => void }) {
  return <div className="context-stack"><div className="view-intro"><span className="eyebrow">Source material</span><h2>Paper & references</h2><p>Original identifiers first, then references detected in the paper.</p></div><section className="source-primary"><span><FileSearch /></span><div><small>Primary paper</small><h3>{paper.title}</h3><p>{paper.authors.join(', ') || 'Unknown author'}{paper.year ? ` · ${paper.year}` : ''}</p><div className="source-links">{paper.doi && <ExternalAnchor href={`https://doi.org/${paper.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')}`}>DOI</ExternalAnchor>}{paper.sourceUrl && <ExternalAnchor href={paper.sourceUrl}>Source page</ExternalAnchor>}</div></div><CheckCircle2 /></section>{summary.references.length ? <ol className="reference-list">{summary.references.map((reference) => <li key={reference.id}><div><strong>{reference.title}</strong>{reference.venue && <span>{reference.venue}{reference.year ? ` · ${reference.year}` : ''}</span>}<div className="source-links">{reference.citedPages?.map((sourcePage) => <button type="button" key={sourcePage} onClick={() => onEvidence({ page: sourcePage, label: 'Reference list' })}>Listed p. {sourcePage}</button>)}{reference.doi && <a href={`https://doi.org/${reference.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '')}`} target="_blank" rel="noreferrer">DOI <ExternalLink /></a>}{reference.url && <a href={reference.url} target="_blank" rel="noreferrer">Open <ExternalLink /></a>}</div></div></li>)}</ol> : <EmptyState compact icon={<Link2 />} title="No references extracted" description="Sift did not find a structured reference list in the analysis." />}{summary.glossary.length > 0 && <section><div className="section-title"><div><span className="eyebrow">Terminology</span><h2>Glossary</h2></div><span>{summary.glossary.length}</span></div><dl className="glossary">{summary.glossary.map((entry) => <div key={entry.term}><dt>{entry.term}</dt><dd>{entry.definition}{entry.evidence?.[0] && <EvidenceLink evidence={entry.evidence[0]} onOpen={onEvidence} compact />}</dd></div>)}</dl></section>}</div>;
}

export function ContextWorkspace({ paper, notes, activeTab, page, analysis, onTabChange, onEvidence, onAddNote, onDeleteNote }: {
  paper: UiPaper;
  notes: UiNote[];
  activeTab: WorkspaceTab;
  page: number;
  analysis: AnalysisControl;
  onTabChange: (tab: WorkspaceTab) => void;
  onEvidence: (evidence: EvidenceRef) => void;
  onAddNote: (body: string, page?: number) => void;
  onDeleteNote: (id: string) => void;
}) {
  const activeMeta = useMemo(() => TABS.find((tab) => tab.id === activeTab) ?? TABS[0], [activeTab]);
  const summary = paper.summary;
  const moveTab = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    onTabChange(TABS[next]!.id);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  return <section className="context-workspace" aria-label="Paper context workspace">
    <nav className="context-tabs" role="tablist" aria-label="Paper context tabs">
      {TABS.map(({ id, label, shortLabel, icon: Icon }, index) => <button type="button" role="tab" id={`context-tab-${id}`} aria-controls="context-panel" aria-selected={activeTab === id} tabIndex={activeTab === id ? 0 : -1} key={id} className={activeTab === id ? 'is-active' : ''} onKeyDown={(event) => moveTab(event, index)} onClick={() => onTabChange(id)}><Icon /><span className="tab-label-full">{label}</span><span className="tab-label-short">{shortLabel}</span>{id === 'ledger' && summary?.ledger.length ? <small>{summary.ledger.length}</small> : null}{id === 'notes' && notes.length ? <small>{notes.length}</small> : null}</button>)}
    </nav>
    <div className="context-mobile-heading"><activeMeta.icon /><span>{activeMeta.label}</span></div>
    <div className="context-scroll" role="tabpanel" id="context-panel" aria-labelledby={`context-tab-${activeTab}`} tabIndex={0}>
      {analysis.busy && <AnalyzeCard key="analysis-progress" paper={paper} control={analysis} />}
      {!analysis.busy && summary && <AnalysisIssueBanner paper={paper} control={analysis} />}
      {!analysis.busy && summary && isLocalAnalysis(paper.analysisModel) && <LocalAnalysisBanner paper={paper} control={analysis} />}
      {!analysis.busy && !summary && activeTab !== 'notes' ? <AnalyzeCard paper={paper} control={analysis} /> : null}
      {summary && activeTab === 'brief' && <BriefView summary={summary} onEvidence={onEvidence} />}
      {summary && activeTab === 'sections' && <SectionsView summary={summary} onEvidence={onEvidence} />}
      {summary && activeTab === 'visuals' && <VisualsView summary={summary} onEvidence={onEvidence} />}
      {summary && activeTab === 'equations' && <EquationsView summary={summary} onEvidence={onEvidence} />}
      {summary && activeTab === 'ledger' && <LedgerView summary={summary} onEvidence={onEvidence} />}
      {activeTab === 'notes' && <NotesView key="notes" notes={notes} page={page} onAdd={onAddNote} onDelete={onDeleteNote} onEvidence={onEvidence} />}
      {summary && activeTab === 'sources' && <SourcesView paper={paper} summary={summary} onEvidence={onEvidence} />}
    </div>
  </section>;
}
