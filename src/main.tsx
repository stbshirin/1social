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
