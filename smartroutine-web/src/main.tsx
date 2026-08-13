import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { ThemeProvider } from './context/ThemeContext';
import { DataProvider } from './context/DataContext';
import { AuthProvider } from './context/AuthContext';
import App from './App';
import './index.css';

/** Single SW registration (PWA precache + Web Push). */
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <DataProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </DataProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
