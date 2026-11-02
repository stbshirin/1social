import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Capture beforeinstallprompt immediately at root window execution
declare global {
  interface Window {
    __deferredPrompt?: any;
  }
}

if (typeof window !== 'undefined') {
  // Gracefully downgrade Firebase Token Service propagation & backend connection notices to console.warn
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    try {
      const msg = args
        .map((a) => (typeof a === 'string' ? a : a?.message || (typeof a === 'object' ? JSON.stringify(a) : String(a))))
        .join(' ');
      if (
        msg.includes('token-service-api-has-not-been-used') ||
        msg.includes('Could not reach Cloud Firestore backend') ||
        msg.includes('auth/network-request-failed')
      ) {
        console.warn(...args);
        return;
      }
    } catch {}
    originalConsoleError.apply(console, args);
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    window.__deferredPrompt = e;
    window.dispatchEvent(new CustomEvent('pwa-prompt-available'));
  });

  window.addEventListener('appinstalled', () => {
    window.__deferredPrompt = null;
    window.dispatchEvent(new CustomEvent('pwa-installed'));
  });
}

createRoot(document.getElementById('root')!).render(<App />);
