// Admin panel shell. Header strip + tab nav + page content.
// Tab visibility follows the caller's permissions.

import { useState } from 'react';
import { useAuth } from '../auth';
import AdminUsers from './AdminUsers';
import AdminMentorBindings from './AdminMentorBindings';
import AdminDocuments from './AdminDocuments';
import AdminTopics from './AdminTopics';
import AdminReview from './AdminReview';

type Tab = 'users' | 'bindings' | 'documents' | 'topics' | 'review';

interface Props {
  onExit: () => void;
}

export default function AdminPanel({ onExit }: Props) {
  const { user, logout, hasPerm } = useAuth();
  const canManageUsers = hasPerm('user.manage', 'org');
  const canManageKB = hasPerm('kb.manage', 'org');
  const canManageTopics = hasPerm('topic.manage', 'org');
  const canReview = hasPerm('assessment.override', 'org');

  // Default tab = first allowed tab
  const defaultTab: Tab = canManageUsers
    ? 'users'
    : canManageKB
      ? 'documents'
      : canManageTopics
        ? 'topics'
        : canReview
          ? 'review'
          : 'users';
  const [tab, setTab] = useState<Tab>(defaultTab);

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

      <nav className="bg-white border-b border-slate-200 px-5 flex gap-1 flex-wrap">
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
        {canManageKB && (
          <TabBtn active={tab === 'documents'} onClick={() => setTab('documents')}>
            Documents
          </TabBtn>
        )}
        {canManageTopics && (
          <TabBtn active={tab === 'topics'} onClick={() => setTab('topics')}>
            Topics
          </TabBtn>
        )}
        {canReview && (
          <TabBtn active={tab === 'review'} onClick={() => setTab('review')}>
            Review queue
          </TabBtn>
        )}
      </nav>

      <main className="max-w-6xl mx-auto px-5 py-6">
        {!canManageUsers && !canManageKB && !canManageTopics && !canReview ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm">
            Your account has no admin permissions. Ask an admin to grant you
            one of <code className="font-mono mx-1">user.manage</code>,
            <code className="font-mono mx-1">kb.manage</code>,
            <code className="font-mono mx-1">topic.manage</code>, or
            <code className="font-mono mx-1">assessment.override</code>.
          </div>
        ) : tab === 'users' ? (
          <AdminUsers />
        ) : tab === 'bindings' ? (
          <AdminMentorBindings />
        ) : tab === 'documents' ? (
          <AdminDocuments />
        ) : tab === 'topics' ? (
          <AdminTopics />
        ) : (
          <AdminReview />
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
