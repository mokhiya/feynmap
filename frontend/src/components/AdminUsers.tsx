// Admin > Users tab.
//
// Lists users in the caller's org. Inline actions:
//   block / unblock, reset password, assign / revoke roles.
// Top "+ New user" button opens a small create form.
//
// All calls go through adminFetch() so the JWT auto-attaches.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch, useAuth, type AuthUser } from '../auth';

interface UserRow {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  locale: 'ru' | 'en' | 'uz';
  status: 'active' | 'blocked' | 'invited';
  lastLoginAt: string | null;
  createdAt: string;
  roles: { code: string; name: string }[];
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
}

export default function AdminUsers() {
  const { user: me, hasPerm } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [u, r] = await Promise.all([
        adminFetch<{ users: UserRow[] }>('/users'),
        adminFetch<{ roles: RoleRow[] }>('/roles'),
      ]);
      setUsers(u.users);
      setRoles(r.roles);
    } catch (e: any) {
      setErr(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const canAssignRoles = hasPerm('role.assign', 'org');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-xs text-slate-500">
            {users.length} user{users.length === 1 ? '' : 's'} in your organization
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="text-sm bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500"
        >
          {showCreate ? 'Cancel' : '+ New user'}
        </button>
      </div>

      {showCreate && (
        <CreateUserForm
          roles={roles}
          canAssignRoles={canAssignRoles}
          onCreated={() => {
            setShowCreate(false);
            reload();
          }}
        />
      )}

      {err && <div className="text-sm text-rose-600">{err}</div>}
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
              <tr>
                <th className="px-3 py-2">Email / name</th>
                <th className="px-3 py-2">Roles</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last login</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRowView
                  key={u.id}
                  u={u}
                  me={me}
                  roles={roles}
                  canAssignRoles={canAssignRoles}
                  onChanged={reload}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserRowView({
  u,
  me,
  roles,
  canAssignRoles,
  onChanged,
}: {
  u: UserRow;
  me: AuthUser | null;
  roles: RoleRow[];
  canAssignRoles: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [openRoles, setOpenRoles] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPw, setNewPw] = useState('');
  const isSelf = me?.id === u.id;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      alert(e?.message || 'failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleRole = (code: string, has: boolean) =>
    act(() =>
      adminFetch(`/users/${u.id}/roles${has ? `/${code}` : ''}`, {
        method: has ? 'DELETE' : 'POST',
        body: has ? undefined : JSON.stringify({ roleCode: code }),
      }),
    );

  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-3 py-2">
          <div className="font-medium">{u.fullName}</div>
          <div className="text-xs text-slate-500">{u.email}</div>
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {u.roles.length === 0 && (
              <span className="text-xs text-slate-400">no roles</span>
            )}
            {u.roles.map((r) => (
              <span
                key={r.code}
                className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100"
              >
                {r.code}
              </span>
            ))}
          </div>
        </td>
        <td className="px-3 py-2">
          <StatusBadge status={u.status} />
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">
          {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
        </td>
        <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
          {u.status === 'blocked' ? (
            <button
              disabled={busy || isSelf}
              className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
              onClick={() =>
                act(() => adminFetch(`/users/${u.id}/unblock`, { method: 'POST' }))
              }
            >
              Unblock
            </button>
          ) : (
            <button
              disabled={busy || isSelf}
              className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-40"
              onClick={() =>
                act(() => adminFetch(`/users/${u.id}/block`, { method: 'POST' }))
              }
              title={isSelf ? 'Cannot block yourself' : 'Block this user'}
            >
              Block
            </button>
          )}
          {canAssignRoles && (
            <button
              disabled={busy}
              className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
              onClick={() => setOpenRoles((v) => !v)}
            >
              Roles
            </button>
          )}
          <button
            disabled={busy}
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
            onClick={() => setResetting((v) => !v)}
          >
            Reset pw
          </button>
        </td>
      </tr>
      {openRoles && (
        <tr className="bg-slate-50 border-t border-slate-100">
          <td colSpan={5} className="px-3 py-3">
            <div className="text-xs text-slate-500 mb-2">
              Click a role to grant / revoke for <b>{u.email}</b>:
            </div>
            <div className="flex flex-wrap gap-2">
              {roles.map((r) => {
                const has = u.roles.some((ur) => ur.code === r.code);
                return (
                  <button
                    key={r.code}
                    disabled={busy}
                    onClick={() => toggleRole(r.code, has)}
                    className={
                      'text-xs px-2 py-1 rounded-full border ' +
                      (has
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100')
                    }
                  >
                    {has ? '✓ ' : '+ '}
                    {r.code}
                  </button>
                );
              })}
            </div>
          </td>
        </tr>
      )}
      {resetting && (
        <tr className="bg-amber-50 border-t border-slate-100">
          <td colSpan={5} className="px-3 py-3">
            <div className="text-xs text-amber-900 mb-2">
              Set a new password for <b>{u.email}</b> (≥ 8 chars). Tell the user
              to rotate it after login.
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="new password"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                disabled={busy || newPw.length < 8}
                onClick={() =>
                  act(async () => {
                    await adminFetch(`/users/${u.id}/password-reset`, {
                      method: 'POST',
                      body: JSON.stringify({ password: newPw }),
                    });
                    setNewPw('');
                    setResetting(false);
                  })
                }
                className="text-xs bg-amber-600 text-white px-3 py-1 rounded hover:bg-amber-700 disabled:opacity-40"
              >
                Save
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setNewPw('');
                  setResetting(false);
                }}
                className="text-xs bg-slate-200 text-slate-700 px-3 py-1 rounded"
              >
                Cancel
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: 'active' | 'blocked' | 'invited' }) {
  const map = {
    active: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blocked: 'bg-rose-50 text-rose-700 border-rose-100',
    invited: 'bg-amber-50 text-amber-700 border-amber-100',
  } as const;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${map[status]}`}>
      {status}
    </span>
  );
}

function CreateUserForm({
  roles,
  canAssignRoles,
  onCreated,
}: {
  roles: RoleRow[];
  canAssignRoles: boolean;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [locale, setLocale] = useState<'ru' | 'en' | 'uz'>('ru');
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (code: string) =>
    setSelectedRoles((curr) =>
      curr.includes(code) ? curr.filter((c) => c !== code) : [...curr, code],
    );

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      await adminFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          password,
          locale,
          roleCodes: canAssignRoles ? selectedRoles : [],
        }),
      });
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <h3 className="font-semibold text-sm">Create user</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Full name</label>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Password (≥ 8)</label>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Locale</label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as any)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="ru">ru</option>
            <option value="en">en</option>
            <option value="uz">uz</option>
          </select>
        </div>
      </div>
      {canAssignRoles && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Roles</label>
          <div className="flex flex-wrap gap-1">
            {roles.map((r) => {
              const on = selectedRoles.includes(r.code);
              return (
                <button
                  key={r.code}
                  onClick={() => toggle(r.code)}
                  className={
                    'text-xs px-2 py-0.5 rounded-full border ' +
                    (on
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100')
                  }
                >
                  {on ? '✓ ' : ''}
                  {r.code}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {err && <div className="text-sm text-rose-600">{err}</div>}
      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={busy || !email || !fullName || password.length < 8}
          className="text-sm bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}
