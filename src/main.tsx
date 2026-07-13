import { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { BrandMark } from './components/Brand';
import { registerSiftServiceWorker } from './pwa';
import './styles.css';

class AppBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <main className="fatal-screen"><BrandMark size={64} /><span className="eyebrow">Your local data is unchanged</span><h1>Sift could not open this view.</h1><p>{this.state.error.message || 'Reload the app to try again.'}</p><button type="button" className="button button--primary" onClick={() => window.location.reload()}>Reload Sift</button></main>;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(<AppBoundary><App /></AppBoundary>);
registerSiftServiceWorker();
