import { useEffect, useState } from 'react';
import ChatPanel from './components/ChatPanel';
import RadarPanel from './components/RadarPanel';
import ReportScreen from './components/ReportScreen';
import LangSwitcher from './components/LangSwitcher';
import LoginScreen from './components/LoginScreen';
import AdminPanel from './components/AdminPanel';
import { postAssess, postChat } from './api';
import type { Assessment, Message } from './types';
import { useLang, useT } from './i18n';
import { useAuth } from './auth';

type View = 'setup' | 'session' | 'report';

const LS_KEY = 'feynmap.session.v1';

interface Persisted {
  view: View;
  topic: string;
  messages: Message[];
  assessment: Assessment | null;
}

export default function App() {
  const t = useT();
  const { lang } = useLang();
  const { user, loading: authLoading, logout, hasPerm } = useAuth();
  // Top-level app mode. Auth is now MANDATORY — unauthenticated users
  // are walled off at the LoginScreen below. 'learn' is the post-login
  // default; 'admin' opens the admin panel.
  const [appMode, setAppMode] = useState<'learn' | 'admin'>('learn');
  const [view, setView] = useState<View>('setup');
  const [topic, setTopic] = useState('');
  const [topicDraft, setTopicDraft] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [assessBusy, setAssessBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // restore
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p: Persisted = JSON.parse(raw);
        setView(p.view);
        setTopic(p.topic);
        setMessages(p.messages);
        setAssessment(p.assessment);
      }
    } catch {}
  }, []);

  // persist
  useEffect(() => {
    const p: Persisted = { view, topic, messages, assessment };
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  }, [view, topic, messages, assessment]);

  const startSession = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    setTopic(trimmed);
    setMessages([]);
    setAssessment(null);
    setView('session');
    setError(null);
    setChatBusy(true);
    try {
      const first = await postChat(trimmed, [], lang);
      setMessages([{ role: 'assistant', content: first }]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setChatBusy(false);
    }
  };

  const sendExpertTurn = async (text: string) => {
    const newHistory: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newHistory);
    setError(null);
    setChatBusy(true);
    setAssessBusy(true);

    const assessP = postAssess(topic, newHistory, lang, assessment)
      .then((a) => {
        setAssessment(a);
        setAssessBusy(false);
        return a;
      })
      .catch((e) => {
        console.error(e);
        setAssessBusy(false);
        return null;
      });

    try {
      const a = await Promise.race([
        assessP,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      const question = await postChat(
        topic,
        newHistory,
        lang,
        a?.next_focus || assessment?.next_focus
      );
      setMessages([...newHistory, { role: 'assistant', content: question }]);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setChatBusy(false);
    }
  };

  const finish = async () => {
    setError(null);
    setAssessBusy(true);
    let latest = assessment;
    try {
      latest = await postAssess(topic, messages, lang, assessment);
      setAssessment(latest);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || String(e));
    } finally {
      setAssessBusy(false);
    }
    if (!latest || !latest.competencies?.length) {
      setError(t.errAssessor);
      return;
    }
    setView('report');
  };

  // Sign out wipes the in-progress learn session too — so the next
  // user landing on this device starts at a clean setup screen.
  const signOut = async () => {
    setView('setup');
    setTopic('');
    setTopicDraft('');
    setMessages([]);
    setAssessment(null);
    setError(null);
    setAppMode('learn');
    localStorage.removeItem(LS_KEY);
    await logout();
  };

  const reset = () => {
    setView('setup');
    setTopic('');
    setTopicDraft('');
    setMessages([]);
    setAssessment(null);
    setError(null);
    localStorage.removeItem(LS_KEY);
  };

  // ----- top-level routing -----
  // Auth gate: nothing renders until we know whether the user is
  // logged in. Hard requirement, not optional — no anonymous learn mode.
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Loading session…
      </div>
    );
  }
  if (!user) {
    return <LoginScreen />;
  }
  if (appMode === 'admin') {
    return <AdminPanel onExit={() => setAppMode('learn')} />;
  }

  // ----- learn view (authenticated) -----
  if (view === 'report') {
    return <ReportScreen topic={topic} assessment={assessment} onRestart={reset} />;
  }

  if (view === 'setup') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-accent font-semibold">FeynMap</div>
            <div className="flex items-center gap-2">
              {hasPerm('user.manage', 'org') && (
                <button
                  onClick={() => setAppMode('admin')}
                  className="text-xs text-accent hover:underline"
                >
                  Admin →
                </button>
              )}
              <button
                onClick={signOut}
                className="text-xs text-slate-500 hover:text-rose-600"
                title={user.email}
              >
                Sign out
              </button>
              <LangSwitcher compact />
            </div>
          </div>
          <div className="text-[11px] text-slate-400 mt-1">{user.email}</div>
          <h1 className="text-2xl font-bold mt-1">{t.appTitle}</h1>
          <p className="text-slate-600 text-sm mt-2 leading-relaxed">{t.appTagline}</p>

          <input
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startSession(topicDraft)}
            placeholder={t.topicPlaceholder}
            className="mt-5 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {t.sampleTopics.map((s) => (
              <button
                key={s}
                onClick={() => setTopicDraft(s)}
                className="text-xs px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 transition"
              >
                {s}
              </button>
            ))}
          </div>

          <button
            onClick={() => startSession(topicDraft)}
            disabled={!topicDraft.trim() || chatBusy}
            className="mt-5 w-full bg-accent text-white rounded-lg py-2.5 font-medium hover:bg-indigo-500 transition disabled:opacity-40"
          >
            {chatBusy ? t.startBtnBusy : t.startBtn}
          </button>

          {error && <div className="mt-3 text-sm text-rose-600">{error}</div>}
        </div>
      </div>
    );
  }

  // session
  return (
    <div className="h-screen flex flex-col">
      <header className="px-5 py-2 border-b border-slate-200 bg-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="text-accent font-bold">FeynMap</div>
          <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-800">
            {t.reset}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {error && <div className="text-xs text-rose-600 max-w-md truncate" title={error}>{error}</div>}
          <span className="text-xs text-slate-400 hidden md:inline">{user.email}</span>
          {hasPerm('user.manage', 'org') && (
            <button
              onClick={() => setAppMode('admin')}
              className="text-xs text-accent hover:underline"
            >
              Admin →
            </button>
          )}
          <button
            onClick={signOut}
            className="text-xs text-slate-500 hover:text-rose-600"
          >
            Sign out
          </button>
          <LangSwitcher compact />
        </div>
      </header>

      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 p-4 min-h-0">
        <ChatPanel
          topic={topic}
          messages={messages}
          busy={chatBusy}
          onSend={sendExpertTurn}
          onFinish={finish}
        />
        <RadarPanel assessment={assessment} assessing={assessBusy} />
      </main>
    </div>
  );
}
