import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { ThemeModeProvider } from './context/ThemeModeContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        {/* Theme lives inside auth so it can adopt each user's stored choice. */}
        <ThemeModeProvider>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </ThemeModeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
