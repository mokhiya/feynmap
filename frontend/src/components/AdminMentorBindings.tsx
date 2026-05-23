// Admin > Mentor bindings tab.
//
// Lists active mentor→learner pairs, lets admin/HR create new ones
// and deactivate existing ones. Both sides must be in the caller's org;
// the mentor side must hold the "mentor" role (backend enforces).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../auth';

interface Binding {
  id: string;
  orgId: string;
  mentorId: string;
  learnerId: string;
  active: boolean;
  createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  roles: { code: string }[];
}

export default function AdminMentorBindings() {
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [b, u] = await Promise.all([
        adminFetch<{ bindings: Binding[] }>('/mentor-bindings'),
        adminFetch<{ users: UserRow[] }>('/users'),
      ]);
      setBindings(b.bindings);
      setUsers(u.users);
    } catch (e: any) {
      setErr(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const mentors = useMemo(
    () => users.filter((u) => u.roles.some((r) => r.code === 'mentor')),
    [users],
  );
  // potential learners = anyone not super_admin/admin
  const learners = useMemo(
    () =>
      users.filter(
        (u) =>
          !u.roles.some((r) => r.code === 'admin' || r.code === 'super_admin'),
      ),
    [users],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Mentor bindings</h2>
        <p className="text-xs text-slate-500">
          Wire each learner to a mentor. The mentor must already hold the{' '}
          <code className="font-mono">mentor</code> role.
        </p>
      </div>

      <NewBindingForm
        mentors={mentors}
        learners={learners}
        onCreated={reload}
      />

      {err && <div className="text-sm text-rose-600">{err}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
              <tr>
                <th className="px-3 py-2">Mentor</th>
                <th className="px-3 py-2">Learner</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Since</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bindings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    No bindings yet.
                  </td>
                </tr>
              )}
              {bindings.map((b) => {
                const m = userById.get(b.mentorId);
                const l = userById.get(b.learnerId);
                return (
                  <tr key={b.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <div className="font-medium">{m?.fullName ?? b.mentorId}</div>
                      <div className="text-xs text-slate-500">{m?.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{l?.fullName ?? b.learnerId}</div>
                      <div className="text-xs text-slate-500">{l?.email}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          'text-xs px-2 py-0.5 rounded-full border ' +
                          (b.active
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-slate-100 text-slate-600 border-slate-200')
                        }
                      >
                        {b.active ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {b.active && (
                        <button
                          className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100"
                          onClick={async () => {
                            try {
                              await adminFetch(`/mentor-bindings/${b.id}`, {
                                method: 'DELETE',
                              });
                              reload();
                            } catch (e: any) {
                              alert(e?.message || 'unbind failed');
                            }
                          }}
                        >
                          Unbind
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewBindingForm({
  mentors,
  learners,
  onCreated,
}: {
  mentors: UserRow[];
  learners: UserRow[];
  onCreated: () => void;
}) {
  const [mentorId, setMentorId] = useState('');
  const [learnerId, setLearnerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!mentorId || !learnerId) return;
    setErr(null);
    setBusy(true);
    try {
      await adminFetch('/mentor-bindings', {
        method: 'POST',
        body: JSON.stringify({ mentorId, learnerId }),
      });
      setMentorId('');
      setLearnerId('');
      onCreated();
    } catch (e: any) {
      setErr(e?.message || 'failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-semibold mb-2">Bind a learner</div>
      {mentors.length === 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-3 py-2 rounded mb-3">
          No users hold the <code className="font-mono">mentor</code> role yet.
          Assign it in the Users tab first.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Mentor</label>
          <select
            value={mentorId}
            onChange={(e) => setMentorId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— pick mentor —</option>
            {mentors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} ({m.email})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Learner</label>
          <select
            value={learnerId}
            onChange={(e) => setLearnerId(e.target.value)}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">— pick learner —</option>
            {learners.map((l) => (
              <option key={l.id} value={l.id} disabled={l.id === mentorId}>
                {l.fullName} ({l.email})
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={submit}
          disabled={busy || !mentorId || !learnerId}
          className="text-sm bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? 'Binding…' : 'Bind'}
        </button>
      </div>
      {err && <div className="mt-2 text-sm text-rose-600">{err}</div>}
    </div>
  );
}
