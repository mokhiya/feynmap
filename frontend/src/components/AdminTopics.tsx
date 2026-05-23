// Admin > Topics tab — curators (admin/HR/Assessor) carve KB into learnable units.
//
// Each topic is published (visible to learners) or draft (hidden). A topic
// links to one or more KB documents — the RAG pipeline retrieves chunks
// from THESE docs for the session.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../auth';
import type { DocumentRow } from '../types';

interface Topic {
  id: string;
  name: string;
  description: string;
  locale: 'ru' | 'en' | 'uz';
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
}

interface TopicDetail {
  topic: Topic;
  documents: { id: string; name: string; status: string; mime: string }[];
}

export default function AdminTopics() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [t, d] = await Promise.all([
        adminFetch<{ topics: Topic[] }>('/topics'),
        adminFetch<{ documents: DocumentRow[] }>('/documents'),
      ]);
      setTopics(t.topics);
      setDocs(d.documents);
    } catch (e: any) {
      setErr(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    (async () => {
      try {
        const d = await adminFetch<TopicDetail>(`/topics/${openId}`);
        setDetail(d);
      } catch (e: any) {
        setErr(e?.message || 'load detail failed');
      }
    })();
  }, [openId]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Topics</h2>
        <p className="text-xs text-slate-500">
          Curated learning units. Each topic is grounded in selected KB documents.
        </p>
      </div>

      <NewTopicForm docs={docs} onCreated={reload} />
      <AISuggestForm docs={docs} onMaterialize={reload} />

      {err && <div className="text-sm text-rose-600">{err}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
              <tr>
                <th className="px-3 py-2">Topic</th>
                <th className="px-3 py-2">Locale</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {topics.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    No topics yet.
                  </td>
                </tr>
              )}
              {topics.map((t) => (
                <TopicRowR
                  key={t.id}
                  t={t}
                  open={openId === t.id}
                  detail={openId === t.id ? detail : null}
                  docs={docs}
                  onToggle={() => setOpenId(openId === t.id ? null : t.id)}
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

function TopicRowR({
  t,
  open,
  detail,
  docs,
  onToggle,
  onChanged,
}: {
  t: Topic;
  open: boolean;
  detail: TopicDetail | null;
  docs: DocumentRow[];
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [pendingStatus, setPendingStatus] = useState(t.status);

  const setStatus = async (status: Topic['status']) => {
    setPendingStatus(status);
    try {
      await adminFetch(`/topics/${t.id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      onChanged();
    } catch (e: any) {
      alert(e?.message || 'patch failed');
      setPendingStatus(t.status);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete topic "${t.name}"?`)) return;
    await adminFetch(`/topics/${t.id}`, { method: 'DELETE' });
    onChanged();
  };

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-3 py-2">
          <button onClick={onToggle} className="font-medium text-left hover:text-accent">
            {t.name}
          </button>
          <div className="text-xs text-slate-500 line-clamp-1">{t.description}</div>
        </td>
        <td className="px-3 py-2 text-xs text-slate-500 uppercase">{t.locale}</td>
        <td className="px-3 py-2">
          <select
            value={pendingStatus}
            onChange={(e) => setStatus(e.target.value as Topic['status'])}
            className="text-xs rounded border border-slate-300 px-1.5 py-0.5"
          >
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </td>
        <td className="px-3 py-2 text-right space-x-2">
          <button
            className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
            onClick={onToggle}
          >
            {open ? 'Close' : 'Docs'}
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100"
            onClick={remove}
          >
            Delete
          </button>
        </td>
      </tr>
      {open && detail && (
        <tr className="bg-slate-50/50">
          <td colSpan={4} className="px-3 py-3">
            <div className="text-xs font-semibold mb-2">Linked documents</div>
            {detail.documents.length === 0 && (
              <div className="text-xs text-slate-500 mb-2">No documents linked.</div>
            )}
            <ul className="space-y-1 mb-3">
              {detail.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between text-xs">
                  <span>
                    {d.name}{' '}
                    <span className="text-slate-400">({d.status})</span>
                  </span>
                  <button
                    className="text-rose-600 hover:underline"
                    onClick={async () => {
                      await adminFetch(`/topics/${t.id}/documents/${d.id}`, {
                        method: 'DELETE',
                      });
                      onChanged();
                    }}
                  >
                    detach
                  </button>
                </li>
              ))}
            </ul>
            <AddDocPicker
              topicId={t.id}
              docs={docs.filter(
                (d) =>
                  d.status === 'indexed' &&
                  !detail.documents.some((dd) => dd.id === d.id),
              )}
              onAdded={onChanged}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function NewTopicForm({ docs, onCreated }: { docs: DocumentRow[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [locale, setLocale] = useState<'ru' | 'en' | 'uz'>('ru');
  const [docId, setDocId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await adminFetch('/topics', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          description: desc.trim(),
          locale,
          status: 'published',
          documentIds: docId ? [docId] : [],
        }),
      });
      setName('');
      setDesc('');
      setDocId('');
      onCreated();
    } catch (e: any) {
      alert(e?.message || 'create failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-semibold mb-2">New topic</div>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto_auto] gap-2 items-end">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Short description"
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as any)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="ru">RU</option>
          <option value="en">EN</option>
          <option value="uz">UZ</option>
        </select>
        <select
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">— no doc —</option>
          {docs
            .filter((d) => d.status === 'indexed')
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <button
          onClick={submit}
          disabled={!name.trim() || busy}
          className="text-sm bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  );
}

function AddDocPicker({
  topicId,
  docs,
  onAdded,
}: {
  topicId: string;
  docs: DocumentRow[];
  onAdded: () => void;
}) {
  const [pick, setPick] = useState('');
  if (docs.length === 0)
    return <div className="text-xs text-slate-400">All indexed docs are linked.</div>;
  return (
    <div className="flex items-center gap-2">
      <select
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        className="text-xs rounded border border-slate-300 px-2 py-1"
      >
        <option value="">— pick doc —</option>
        {docs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <button
        disabled={!pick}
        className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-indigo-500 disabled:opacity-40"
        onClick={async () => {
          await adminFetch(`/topics/${topicId}/documents`, {
            method: 'POST',
            body: JSON.stringify({ documentId: pick }),
          });
          setPick('');
          onAdded();
        }}
      >
        Link
      </button>
    </div>
  );
}

function AISuggestForm({
  docs,
  onMaterialize,
}: {
  docs: DocumentRow[];
  onMaterialize: () => void;
}) {
  const [docId, setDocId] = useState('');
  const [locale, setLocale] = useState<'ru' | 'en' | 'uz'>('ru');
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { name: string; description: string; competencies: string[] }[]
  >([]);

  const suggest = async () => {
    if (!docId) return;
    setBusy(true);
    setSuggestions([]);
    try {
      const j = await adminFetch<{ suggestions: typeof suggestions }>('/topics/suggest', {
        method: 'POST',
        body: JSON.stringify({ documentId: docId, locale }),
      });
      setSuggestions(j.suggestions);
    } catch (e: any) {
      alert(e?.message || 'suggest failed');
    } finally {
      setBusy(false);
    }
  };

  const materialize = async (s: { name: string; description: string }) => {
    await adminFetch('/topics', {
      method: 'POST',
      body: JSON.stringify({
        name: s.name,
        description: s.description,
        locale,
        status: 'published',
        documentIds: [docId],
      }),
    });
    onMaterialize();
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-sm font-semibold mb-2">AI suggest topics from a document</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={docId}
          onChange={(e) => setDocId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">— pick indexed doc —</option>
          {docs
            .filter((d) => d.status === 'indexed')
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as any)}
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="ru">RU</option>
          <option value="en">EN</option>
          <option value="uz">UZ</option>
        </select>
        <button
          disabled={!docId || busy}
          onClick={suggest}
          className="text-sm bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? 'Thinking…' : 'Suggest'}
        </button>
      </div>
      {suggestions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 border border-slate-200 rounded p-2"
            >
              <div className="text-xs">
                <div className="font-medium text-sm">{s.name}</div>
                <div className="text-slate-500">{s.description}</div>
                {s.competencies?.length > 0 && (
                  <div className="text-[11px] text-slate-400 mt-1">
                    {s.competencies.join(' · ')}
                  </div>
                )}
              </div>
              <button
                className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-indigo-500"
                onClick={() => materialize(s)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
