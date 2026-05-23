// Login screen. Email + password → POST /auth/login. On success the
// AuthProvider stores the token and the parent re-renders into the
// admin panel.

import { useState } from 'react';
import { useAuth } from '../auth';

interface Props {
  onCancel?: () => void;
}

export default function LoginScreen({ onCancel }: Props) {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@feynmap.local');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (e: any) {
      setErr(e?.message || 'login failed');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !busy) submit();
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-50">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8">
        <div className="text-xs uppercase tracking-wider text-accent font-semibold">FeynMap</div>
        <h1 className="text-2xl font-bold mt-1">Sign in</h1>
        <p className="text-slate-500 text-sm mt-1">Admin / staff access</p>

        <label className="block text-xs text-slate-500 mt-5 mb-1">Email</label>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={onKey}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        />

        <label className="block text-xs text-slate-500 mt-3 mb-1">Password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={onKey}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent"
        />

        <button
          onClick={submit}
          disabled={!email || !password || busy}
          className="mt-5 w-full bg-accent text-white rounded-lg py-2.5 font-medium hover:bg-indigo-500 transition disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        {onCancel && (
          <button
            onClick={onCancel}
            className="mt-2 w-full text-sm text-slate-500 hover:text-slate-800 py-1"
          >
            ← Back to learning
          </button>
        )}

        {err && (
          <div className="mt-3 text-sm text-rose-600 break-words">{err}</div>
        )}

        <div className="mt-6 text-[11px] text-slate-400 leading-relaxed">
          Dev admin: <code className="font-mono">admin@feynmap.local</code>
        </div>
      </div>
    </div>
  );
}
