import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { LangContext, type Lang } from './i18n';
import { AuthProvider } from './auth';

const LS_LANG = 'feynmap.lang.v1';

function detectLang(): Lang {
  const saved = (localStorage.getItem(LS_LANG) || '').toLowerCase();
  if (saved === 'ru' || saved === 'en' || saved === 'uz') return saved;
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('ru')) return 'ru';
  if (nav.startsWith('uz')) return 'uz';
  return 'en';
}

function Root() {
  const [lang, setLangState] = useState<Lang>(detectLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem(LS_LANG, l);
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </LangContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
