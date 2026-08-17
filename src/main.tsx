import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { SettingsProvider } from './components/SettingsContext';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { recordDiagnostic } from './lib/storageUtils';

window.addEventListener('error', event => void recordDiagnostic('window-error', event.error || event.message));
window.addEventListener('unhandledrejection', event => void recordDiagnostic('unhandled-rejection', event.reason));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider defaultTheme="dark" attribute="class">
        <SettingsProvider>
          <TooltipProvider>
            <App />
            <Toaster />
          </TooltipProvider>
        </SettingsProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
