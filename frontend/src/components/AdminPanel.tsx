// Admin panel shell. Header strip + tab nav + page content.
// Tab visibility follows the caller's permissions. Today: Users +
// Mentor bindings. Phase 2+ adds Documents, Topics, Assignments, etc.

import { useState } from 'react';
import { useAuth } from '../auth';
import AdminUsers from './AdminUsers';
import AdminMentorBindings from './AdminMentorBindings';

type Tab = 'users' | 'bindings';

interface Props {
  onExit: () => void;
}

export default function AdminPanel({ onExit }: Props) {
  const { user, logout, hasPerm } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  const canManageUsers = hasPerm('user.manage', 'org');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="text-accent font-bold">FeynMap · Admin</div>
          <span className="text-xs text-slate-400">{user?.email}</span>
          {user?.roles.map((r) => (
            <span
              key={r.code}
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100"
            >
              {r.code}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onExit}
            className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
          >
            ← Learning view
          </button>
          <button
            onClick={async () => {
              await logout();
              onExit();
            }}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded"
          >
            Sign out
          </button>
        </div>
      </header>

      <nav className="bg-white border-b border-slate-200 px-5 flex gap-1">
        {canManageUsers && (
          <TabBtn active={tab === 'users'} onClick={() => setTab('users')}>
            Users
          </TabBtn>
        )}
        {canManageUsers && (
          <TabBtn active={tab === 'bindings'} onClick={() => setTab('bindings')}>
            Mentor bindings
          </TabBtn>
        )}
      </nav>

      <main className="max-w-6xl mx-auto px-5 py-6">
        {!canManageUsers ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            Your account has no admin permissions. Ask an admin to grant you
            <code className="font-mono mx-1">user.manage</code>or a role like
            <code className="font-mono mx-1">admin</code>/<code className="font-mono">hr</code>.
          </div>
        ) : tab === 'users' ? (
          <AdminUsers />
        ) : (
          <AdminMentorBindings />
        )}
      </main>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-2.5 text-sm border-b-2 transition ' +
        (active
          ? 'border-accent text-accent font-medium'
          : 'border-transparent text-slate-600 hover:text-slate-900')
      }
    >
      {children}
    </button>
  );
}
