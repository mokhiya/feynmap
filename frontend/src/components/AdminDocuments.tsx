// Admin > Documents tab — upload KB files, see indexing status, reindex/delete.

import { useCallback, useEffect, useRef, useState } from 'react';
import { adminFetch } from '../auth';
import type { DocumentRow } from '../types';

export default function AdminDocuments() {
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const j = await adminFetch<{ documents: DocumentRow[] }>('/documents');
      setDocs(j.documents);
    } catch (e: any) {
      setErr(e?.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Poll while any doc is still parsing
  useEffect(() => {
    const anyParsing = docs.some((d) => d.status === 'uploaded' || d.status === 'parsing');
    if (!anyParsing) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [docs, reload]);

  const onUpload = async () => {
    const input = fileRef.current;
    if (!input || !input.files || input.files.length === 0) return;
    setErr(null);
    setBusyId('upload');
    try {
      for (const file of Array.from(input.files)) {
        const fd = new FormData();
        fd.append('file', file);
        // adminFetch sets content-type to JSON by default — bypass with raw fetch.
        const token = localStorage.getItem('feynmap.token.v1');
        const r = await fetch('/api/documents', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!r.ok) throw new Error((await r.json()).error || 'upload failed');
      }
      input.value = '';
      reload();
    } catch (e: any) {
      setErr(e?.message || 'upload failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (d: DocumentRow) => {
    if (!confirm(`Delete "${d.name}"? Chunks will be removed.`)) return;
    setBusyId(d.id);
    try {
      await adminFetch(`/documents/${d.id}`, { method: 'DELETE' });
      reload();
    } catch (e: any) {
      alert(e?.message || 'delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const reindex = async (d: DocumentRow) => {
    setBusyId(d.id);
    try {
      await adminFetch(`/documents/${d.id}/reindex`, { method: 'POST' });
      reload();
    } catch (e: any) {
      alert(e?.message || 'reindex failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Knowledge base documents</h2>
        <p className="text-xs text-slate-500">
          PDF / DOCX / MD / TXT (≤ 25 MB). Embeddings via local bge-m3 (Ollama).
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="text-sm font-semibold mb-2">Upload</div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain"
          className="text-sm"
        />
        <button
          onClick={onUpload}
          disabled={busyId === 'upload'}
          className="ml-3 text-sm bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-indigo-500 disabled:opacity-40"
        >
          {busyId === 'upload' ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}

      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500 bg-slate-50">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Chunks</th>
                <th className="px-3 py-2">v</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    No documents yet.
                  </td>
                </tr>
              )}
              {docs.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{d.mime.split('/').pop()}</td>
                  <td className="px-3 py-2">
                    <StatusPill status={d.status} error={d.error} />
                  </td>
                  <td className="px-3 py-2 text-xs">{d.chunkCount}</td>
                  <td className="px-3 py-2 text-xs">{d.version}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    <button
                      className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                      disabled={busyId === d.id}
                      onClick={() => reindex(d)}
                    >
                      Reindex
                    </button>
                    <button
                      className="text-xs px-2 py-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100"
                      disabled={busyId === d.id}
                      onClick={() => remove(d)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, error }: { status: string; error: string | null }) {
  const cls =
    status === 'indexed'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : status === 'failed'
        ? 'bg-rose-50 text-rose-700 border-rose-100'
        : 'bg-amber-50 text-amber-700 border-amber-100';
  return (
    <span
      title={error || undefined}
      className={'text-xs px-2 py-0.5 rounded-full border ' + cls}
    >
      {status}
    </span>
  );
}
