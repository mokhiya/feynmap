import { useEffect, useState } from 'react';
import ChatPanel from './components/ChatPanel';
import RadarPanel from './components/RadarPanel';
import ReportScreen from './components/ReportScreen';
import LangSwitcher from './components/LangSwitcher';
import LoginScreen from './components/LoginScreen';
import AdminPanel from './components/AdminPanel';
import {
  listPublishedTopics,
  startSession,
  sessionTurn,
  sessionFinalize,
  sessionConvert,
  sessionAppeal,
} from './api';
import type { Assessment, Message, SessionMode, SessionRow, TopicRow } from './types';
import { useLang, useT } from './i18n';
import { useAuth } from './auth';

type View = 'setup' | 'session' | 'report';

const LS_KEY = 'feynmap.session.v1';

interface Persisted {
  view: View;
  sessionId: string | null;
  topicLabel: string;
  topicId: string | null;
  mode: SessionMode;
  messages: Message[];
  assessment: Assessment | null;
}

export default function App() {
  const t = useT();
  const { lang } = useLang();
  const { user, loading: authLoading, logout, hasPerm } = useAuth();

  const [appMode, setAppMode] = useState<'learn' | 'admin'>('learn');

  // Session state
  const [view, setView] = useState<View>('setup');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [topicLabel, setTopicLabel] = useState('');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>('practice');
  const [messages, setMessages] = useState<Message[]>([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [chatBusy, setChatBusy] = useState(false);
  const [assessBusy, setAssessBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalog of published topics from KB
  const [topics, setTopics] = useState<TopicRow[] | null>(null);
  const [pickedTopicId, setPickedTopicId] = useState<string>('');

  // Restore — only restore if session still in_progress and matches user.
  // For simplicity here we just restore the view + assessment; new session
  // is required if topicId is missing.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p: Persisted = JSON.parse(raw);
        if (p.sessionId) {
          setSessionId(p.sessionId);
          setView(p.view);
          setTopicLabel(p.topicLabel);
          setTopicId(p.topicId);
          setMode(p.mode);
          setMessages(p.messages);
          setAssessment(p.assessment);
        }
      }
    } catch {}
  }, []);

  // Persist
  useEffect(() => {
    const p: Persisted = {
      view,
      sessionId,
      topicLabel,
      topicId,
      mode,
      messages,
      assessment,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  }, [view, sessionId, topicLabel, topicId, mode, messages, assessment]);

  // Load topic catalog when entering learn mode
  useEffect(() => {
    if (!user || appMode !== 'learn' || view !== 'setup') return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listPublishedTopics();
        if (!cancelled) setTopics(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'failed to load topics');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, appMode, view]);

  const beginSession = async () => {
    if (!pickedTopicId) return;
    const picked = (topics || []).find((tt) => tt.id === pickedTopicId);
    if (!picked) return;
    setError(null);
    setChatBusy(true);
    try {
      const { session, firstQuestion } = await startSession({
        topicId: picked.id,
        mode,
        locale: lang,
      });
      setSessionId(session.id);
      setTopicLabel(picked.name);
      setTopicId(picked.id);
      setMessages([{ role: 'assistant', content: firstQuestion }]);
      setAssessment(null);
      setView('session');
    } catch (e: any) {
      setError(e?.message || 'failed to start session');
    } finally {
      setChatBusy(false);
    }
  };

  const sendExpertTurn = async (text: string, signals?: { pasteSize?: number; typingMs?: number; deletes?: number }) => {
    if (!sessionId) return;
    const newHistory: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(newHistory);
    setError(null);
    setChatBusy(true);
    setAssessBusy(true);
    try {
      const r = await sessionTurn(sessionId, text, signals || {});
      if (r.assessment) setAssessment(r.assessment as Assessment);
      setMessages([...newHistory, { role: 'assistant', content: r.question }]);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setChatBusy(false);
      setAssessBusy(false);
    }
  };

  const finish = async () => {
    if (!sessionId) return;
    setError(null);
    setAssessBusy(true);
    try {
      const r = await sessionFinalize(sessionId);
      if (r.result) {
        const a: Assessment = {
          competencies: r.result.competencies || [],
          next_focus: r.result.nextFocus || '',
          overall: 0,
          strengths: r.result.strengths || [],
          growth_zones: r.result.gaps || [],
          recommendations: r.result.recommendations || [],
        };
        a.overall = Math.round(
          (a.competencies.reduce((s, c) => s + c.score, 0) || 0) /
            Math.max(1, a.competencies.length),
        );
        setAssessment(a);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setAssessBusy(false);
    }
    if (!assessment || !assessment.competencies?.length) {
      setError(t.errAssessor);
      return;
    }
    setView('report');
  };

  const convertToAssessment = async () => {
    if (!sessionId) return;
    try {
      await sessionConvert(sessionId);
      setMode('assessment');
      alert('Сессия конвертирована в режим Assessment — ждёт ревью.');
    } catch (e: any) {
      alert(e?.message || 'convert failed');
    }
  };

  const submitAppeal = async () => {
    if (!sessionId) return;
    const reason = prompt(
      'Опишите, почему вы не согласны с оценкой (мин 8 символов):',
    );
    if (!reason || reason.length < 8) return;
    try {
      await sessionAppeal(sessionId, reason);
      alert('Апелляция отправлена. Assessor получит уведомление.');
    } catch (e: any) {
      alert(e?.message || 'appeal failed');
    }
  };

  const signOut = async () => {
    setView('setup');
    setSessionId(null);
    setTopicLabel('');
    setTopicId(null);
    setMessages([]);
    setAssessment(null);
    setError(null);
    setAppMode('learn');
    setPickedTopicId('');
    localStorage.removeItem(LS_KEY);
    await logout();
  };

  const reset = () => {
    setView('setup');
    setSessionId(null);
    setTopicLabel('');
    setTopicId(null);
    setMessages([]);
    setAssessment(null);
    setError(null);
    setPickedTopicId('');
    localStorage.removeItem(LS_KEY);
  };

  // ----- top-level routing -----
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">
        Loading session…
      </div>
    );
  }
  if (!user) return <LoginScreen />;
  if (appMode === 'admin')
    return <AdminPanel onExit={() => setAppMode('learn')} />;

  if (view === 'report') {
    return (
      <ReportScreen
        topic={topicLabel}
        assessment={assessment}
        onRestart={reset}
        mode={mode}
        onConvert={mode === 'practice' ? convertToAssessment : undefined}
        onAppeal={mode === 'assessment' ? submitAppeal : undefined}
      />
    );
  }

  if (view === 'setup') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-xl w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-accent font-semibold">
              FeynMap
            </div>
            <div className="flex items-center gap-2">
              {(hasPerm('user.manage', 'org') ||
                hasPerm('kb.manage', 'org') ||
                hasPerm('topic.manage', 'org') ||
                hasPerm('assessment.override', 'org')) && (
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
          <p className="text-slate-600 text-sm mt-2 leading-relaxed">
            {t.appTagline}
          </p>

          {/* Topic selector — from KB catalog only. No free-text. */}
          <label className="block text-xs text-slate-500 mt-5 mb-1">Topic</label>
          {topics === null ? (
            <div className="text-sm text-slate-500">Loading topics…</div>
          ) : topics.length === 0 ? (
            <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              No topics published yet. Ask an admin to upload documents and
              publish topics in <em>Admin → Topics</em>.
            </div>
          ) : (
            <select
              value={pickedTopicId}
              onChange={(e) => setPickedTopicId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">— pick topic —</option>
              {topics.map((tt) => (
                <option key={tt.id} value={tt.id}>
                  {tt.name}
                </option>
              ))}
            </select>
          )}

          {/* Session mode toggle (M2.5.1) */}
          <div className="mt-4">
            <div className="text-xs text-slate-500 mb-1">Session mode</div>
            <div className="grid grid-cols-2 gap-2">
              <ModeBtn
                active={mode === 'practice'}
                onClick={() => setMode('practice')}
                title="Practice"
                sub="Private. Auto-score. Not visible to HR."
              />
              <ModeBtn
                active={mode === 'assessment'}
                onClick={() => setMode('assessment')}
                title="Assessment"
                sub="Counted. Locked until Assessor signs off."
              />
            </div>
          </div>

          <button
            onClick={beginSession}
            disabled={!pickedTopicId || chatBusy}
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
          <button
            onClick={reset}
            className="text-xs text-slate-500 hover:text-slate-800"
          >
            {t.reset}
          </button>
          <span
            className={
              'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ' +
              (mode === 'assessment'
                ? 'bg-amber-50 text-amber-700 border-amber-100'
                : 'bg-slate-50 text-slate-600 border-slate-200')
            }
          >
            {mode}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {error && (
            <div className="text-xs text-rose-600 max-w-md truncate" title={error}>
              {error}
            </div>
          )}
          <span className="text-xs text-slate-400 hidden md:inline">
            {user.email}
          </span>
          {(hasPerm('user.manage', 'org') ||
            hasPerm('kb.manage', 'org') ||
            hasPerm('topic.manage', 'org') ||
            hasPerm('assessment.override', 'org')) && (
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
          topic={topicLabel}
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

function ModeBtn({
  active,
  onClick,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'text-left rounded-lg border px-3 py-2 transition ' +
        (active
          ? 'border-accent bg-indigo-50/40'
          : 'border-slate-200 hover:border-slate-300')
      }
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-[11px] text-slate-500">{sub}</div>
    </button>
  );
}
