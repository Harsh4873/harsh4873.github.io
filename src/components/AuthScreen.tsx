import { BookOpenCheck, FileSearch, Link2, LockKeyhole, LogIn, Sparkles } from 'lucide-react';
import { BrandLockup, BrandMark } from './Brand';

export function AuthScreen({ busy, error, onSignIn, onLocal }: { busy: boolean; error?: string; onSignIn: () => void; onLocal: () => void }) {
  return <main className="auth-screen">
    <div className="auth-noise" aria-hidden="true" />
    <header><BrandLockup /><span>harsh.bet / research</span></header>
    <section className="auth-card">
      <div className="auth-card__visual" aria-hidden="true">
        <span className="paper-stack paper-stack--back" />
        <span className="paper-stack paper-stack--middle" />
        <div className="paper-stack paper-stack--front"><i /><i /><i /><span><FileSearch /><em>p. 12</em></span></div>
        <span className="auth-orbit"><Sparkles /></span>
      </div>
      <div className="auth-card__copy">
        <BrandMark size={58} decorative />
        <span className="eyebrow">Private research workspace</span>
        <h1>Read the paper.<br /><em>Keep the receipts.</em></h1>
        <p>Sift turns dense research into a page-grounded brief—without flattening the figures, equations, methods, or caveats.</p>
        <div className="auth-features"><span><BookOpenCheck /><small>Structured brief</small></span><span><Link2 /><small>Claim ledger</small></span><span><LockKeyhole /><small>Owner only</small></span></div>
        <button type="button" className="button button--primary button--large" onClick={onSignIn} disabled={busy}>{busy ? <span className="button-spinner" /> : <LogIn />} {busy ? 'Opening Google…' : 'Continue with Google'}</button>
        <button type="button" className="button button--ghost auth-local-button" onClick={onLocal} disabled={busy}>Use this device without sync</button>
        {error && <div className="auth-error" role="alert">{error}</div>}
        <small className="auth-owner-note">Google sync and AI are restricted to the configured owner account. Local reading and notes work without sign-in.</small>
      </div>
    </section>
    <footer><span><LockKeyhole /> PDFs open locally by default</span><span>Research, with receipts.</span></footer>
  </main>;
}
