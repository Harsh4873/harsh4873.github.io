import {
  AlertCircle,
  ArrowUp,
  Bot,
  ChevronDown,
  FileSearch,
  MessageCircleMore,
  PanelRightClose,
  Quote,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isLocalAnalysis } from '../lib/analysis-result';
import type { EvidenceRef, ReaderContext, UiMessage, UiPaper } from '../lib/ui-types';
import { BrandMark } from './Brand';
import { EvidenceLink, IconButton } from './Primitives';

const SUGGESTIONS = [
  'What is the strongest evidence?',
  'Explain the method simply',
  'What should I be skeptical of?',
];

const CHAT_FOCUSABLE = 'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ChatDrawer({
  open,
  paper,
  context,
  messages,
  busy,
  error,
  signedIn,
  analysisBusy = false,
  onOpen,
  onClose,
  onSignIn,
  onAnalyzeAi,
  onAsk,
  onEvidence,
  onClearSelection,
}: {
  open: boolean;
  paper?: UiPaper;
  context: ReaderContext;
  messages: UiMessage[];
  busy: boolean;
  error?: string;
  signedIn: boolean;
  analysisBusy?: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSignIn: () => void;
  onAnalyzeAi: () => void;
  onAsk: (question: string) => Promise<void> | void;
  onEvidence: (evidence: EvidenceRef) => void;
  onClearSelection: () => void;
}) {
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement>();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const localBrief = Boolean(paper?.summary && isLocalAnalysis(paper.analysisModel));

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusTimer = window.setTimeout(() => {
      const drawer = drawerRef.current;
      const preferred = signedIn && paper?.openaiFileId && textareaRef.current && !textareaRef.current.disabled
        ? textareaRef.current
        : undefined;
      (preferred ?? drawer?.querySelector<HTMLElement>(CHAT_FOCUSABLE) ?? drawer)?.focus();
    }, 180);
    const onKeyDown = (event: KeyboardEvent) => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(CHAT_FOCUSABLE)];
      if (!focusable.length) {
        event.preventDefault();
        drawer.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const current = document.activeElement;
      if (!drawer.contains(current)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      const previous = previousFocusRef.current;
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
      else if (previous?.isConnected && previous !== document.body) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages.length, busy, open]);

  function submit(question = draft) {
    const value = question.replace(/\s+/g, ' ').trim();
    if (!value || busy || analysisBusy || !signedIn || !paper?.openaiFileId) return;
    setDraft('');
    void onAsk(value);
  }

  return <>
    {!open && <button ref={openerRef} type="button" className="chat-fab" onClick={onOpen} aria-label="Ask Sift about this paper">
      <span><Sparkles /></span><strong>Ask Sift</strong>{context.selectedText && <small>1</small>}
    </button>}
    <aside ref={drawerRef} className={`chat-drawer${open ? ' is-open' : ''}`} role="dialog" aria-modal={open ? true : undefined} aria-hidden={!open} aria-label="Contextual paper assistant" tabIndex={-1} {...(!open ? { inert: '' } : {})}>
      <header className="chat-header">
        <div className="chat-header__brand"><BrandMark size={38} decorative /><span><strong>Ask Sift</strong><small>Paper-context assistant</small></span></div>
        <div className="chat-header__actions"><span className="private-pill"><ShieldCheck /> Private</span><IconButton label="Close chat" onClick={onClose}><PanelRightClose /></IconButton></div>
      </header>

      <div className="chat-context-bar">
        {paper ? <><span title={paper.title}><FileSearch />{paper.title}</span><span>{context.tab}</span><span>p. {context.page}</span></> : <span><FileSearch />No paper open</span>}
      </div>

      <div className="chat-scroll">
        {!paper ? <div className="chat-empty"><MessageCircleMore /><strong>Open a paper to ask questions</strong><p>Sift carries the active tab, page, and selected passage into each question.</p></div>
          : !signedIn ? <div className="chat-empty"><UserRound /><strong>Sign in to use Ask Sift</strong><p>Paper chat uses the protected AI service. Local reading, Local Analysis, notes, and saved briefs still work without an account or API credits.</p><button type="button" className="button button--primary button--small" onClick={onSignIn}><UserRound /> Sign in</button></div>
            : !paper.openaiFileId ? <div className="chat-empty"><Bot /><strong>{localBrief ? 'AI Analysis unlocks chat' : 'AI Analysis is required for chat'}</strong><p>{localBrief ? 'Your private local brief is ready, but Ask Sift needs this paper’s secure AI upload. Local Analysis never uploads the PDF.' : 'Ask Sift needs the paper’s secure AI upload before it can answer. Reading locally and Local Analysis do not upload it.'}</p><button type="button" className="button button--primary button--small" disabled={!paper.availableLocal || analysisBusy} onClick={() => { if (!analysisBusy) onAnalyzeAi(); }}><Sparkles /> {analysisBusy ? 'Analysis in progress' : 'Run AI Analysis'}</button>{!paper.availableLocal && <small>Reattach the PDF first.</small>}</div>
            : !messages.length ? <div className="chat-welcome"><span className="chat-welcome__icon"><Sparkles /></span><span className="eyebrow">Ask from where you are</span><h2>I can see the paper context—not your whole screen.</h2><p>Questions include the active tab, page {context.page}, and any passage you explicitly select.</p><div className="suggestion-list">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => submit(suggestion)}>{suggestion}<ArrowUp /></button>)}</div></div>
              : <div className="message-list">{messages.map((message) => <article key={message.id} className={`message message--${message.role}`}>
                <span className="message__avatar">{message.role === 'assistant' ? <Sparkles /> : <UserRound />}</span>
                <div className="message__body">
                  <div className="message__meta">
                    <strong>{message.role === 'assistant' ? 'Sift' : 'You'}</strong>
                    {message.context?.page && <span>p. {message.context.page}</span>}
                    {message.role === 'assistant' && message.grounded !== undefined && <span className={`message-grounding message-grounding--${message.grounded ? 'grounded' : 'limited'}`}>
                      {message.grounded ? <ShieldCheck /> : <AlertCircle />}{message.grounded ? 'Grounded to paper' : 'Not fully grounded'}
                    </span>}
                  </div>
                  <p>{message.content}</p>
                  {message.role === 'assistant' && message.uncertainty && <div className="message-uncertainty"><AlertCircle /><span><strong>Uncertainty</strong>{message.uncertainty}</span></div>}
                  {message.context?.selectedText && <blockquote><Quote />{message.context.selectedText}</blockquote>}
                  {message.citations.length > 0 && <div className="message__citations">{message.citations.map((citation, index) => <EvidenceLink key={`${citation.page}-${index}`} evidence={citation} onOpen={onEvidence} compact />)}</div>}
                </div>
              </article>)}{busy && <article className="message message--assistant"><span className="message__avatar"><Sparkles /></span><div className="message__body"><div className="thinking-dots" aria-label="Sift is reading"><i /><i /><i /></div><small>Checking the paper before answering…</small></div></article>}<div ref={endRef} /></div>}
        {error && <div className="chat-error" role="alert"><AlertCircle /><span>{error}<small>{error.includes('billing') || error.includes('credits') ? 'Local reading and notes still work.' : 'Your question was not saved as an answer.'}</small></span></div>}
      </div>

      <footer className="chat-composer-wrap">
        {context.selectedText && <div className="selection-chip"><Quote /><span><strong>Selected passage</strong>{context.selectedText}</span><button type="button" onClick={onClearSelection} aria-label="Remove selected passage"><X /></button></div>}
        <div className={`chat-composer${!signedIn || !paper?.openaiFileId || analysisBusy ? ' is-disabled' : ''}`}>
          <textarea
            ref={textareaRef}
            value={draft}
            disabled={!signedIn || !paper?.openaiFileId || busy || analysisBusy}
            onChange={(event) => setDraft(event.target.value.slice(0, 4_000))}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
            placeholder={!signedIn ? 'Sign in to use Ask Sift' : analysisBusy ? 'Finish analysis before asking a question' : paper?.openaiFileId ? 'Ask about the method, a figure, a claim…' : 'Run AI Analysis to unlock chat'}
            rows={1}
          />
          <button type="button" onClick={() => submit()} disabled={!draft.trim() || busy || analysisBusy || !signedIn || !paper?.openaiFileId} aria-label="Send question"><ArrowUp /></button>
        </div>
        <p>Answers can be wrong. Follow the page receipts.</p>
      </footer>
    </aside>
    {open && <button type="button" className="chat-scrim" onClick={onClose} aria-label="Close chat"><ChevronDown /></button>}
  </>;
}
