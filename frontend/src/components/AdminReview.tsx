// Admin > Review tab — HITL queue for assessment-mode sessions.
//
// Lists sessions waiting on Assessor sign-off. Clicking one opens the
// transcript + auto-score side-by-side; the Assessor can override scores
// + comment, audit-logged.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../auth';

interface QueueRow {
  sessionId: string;
  topicLabel: string;
  userId: string;
  finalizedAt: string | null;
  resultId: string;
}

interface SessionDetail {
  session: {
    id: string;
    topicLabel: string;
    userId: string;
    transcript: { role: string; content: string }[];
    locale: string;
    mode: string;
  };
  result: {
    id: string;
    competencies: Array<{
      name: string;
      score: number;
      criterion?: string;
      evidence: string;
      gap: boolean;
      source_refs?: Array<{ documentName: string; chunkIndex: number; page?: number | null }>;
    }>;
    status: string;
  } | null;
}

export default function AdminReview() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const j = await adminFetch<{ queue: QueueRow[] }>('/sessions/_review/queue');
      setQueue(j.queue);
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
        const j = await adminFetch<SessionDetail>(`/sessions/${openId}`);
        setDetail(j);
      } catch (e: any) {
        setErr(e?.message || 'load detail failed');
      }
    })();
  }, [openId]);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Assessment review queue</h2>
      <p className="text-xs text-slate-500">
        Sessions in <code className="font-mono">assessment</code> mode wait here
        until you approve or override the auto-score.
      </p>
      {err && <div className="text-sm text-rose-600">{err}</div>}
      {loading ? (
        <div className="text-sm text-slate-500">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-4">
          The queue is empty. Nothing pending review.
        </div>
      ) : (
        <ul className="space-y-2">
          {queue.map((q) => (
            <li
              key={q.sessionId}
              className={
                'bg-white border rounded-xl ' +
                (openId === q.sessionId ? 'border-accent' : 'border-slate-200')
              }
            >
              <button
                className="w-full px-4 py-3 text-left flex items-center justify-between"
                onClick={() =>
                  setOpenId(openId === q.sessionId ? null : q.sessionId)
                }
              >
                <div>
                  <div className="font-medium">{q.topicLabel}</div>
                  <div className="text-xs text-slate-500">
                    user {q.userId.slice(0, 8)} ·{' '}
                    {q.finalizedAt
                      ? new Date(q.finalizedAt).toLocaleString()
                      : 'in progress'}
                  </div>
                </div>
                <div className="text-xs text-accent">
                  {openId === q.sessionId ? '▾' : '▸'}
                </div>
              </button>
              {openId === q.sessionId && detail && (
                <ReviewPane detail={detail} onResolved={reload} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewPane({
  detail,
  onResolved,
}: {
  detail: SessionDetail;
  onResolved: () => void;
}) {
  const [comps, setComps] = useState(detail.result?.competencies || []);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (!detail.result) {
    return (
      <div className="px-4 py-3 text-sm text-slate-500 border-t border-slate-100">
        No auto-score for this session.
      </div>
    );
  }

  const setScore = (i: number, n: number) => {
    setComps(
      comps.map((c, idx) =>
        idx === i ? { ...c, score: Math.max(0, Math.min(100, n)) } : c,
      ),
    );
  };

  const submit = async () => {
    if (comment.trim().length < 8) {
      alert('Override comment must explain the decision (min 8 chars).');
      return;
    }
    setBusy(true);
    try {
      await adminFetch(`/sessions/${detail.session.id}/override`, {
        method: 'POST',
        body: JSON.stringify({ competencies: comps, comment }),
      });
      onResolved();
    } catch (e: any) {
      alert(e?.message || 'override failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-slate-100 grid grid-cols-1 md:grid-cols-2">
      <div className="p-4 border-r border-slate-100 max-h-96 overflow-y-auto">
        <div className="text-xs font-semibold mb-2 text-slate-500">Transcript</div>
        <div className="space-y-2 text-sm">
          {detail.session.transcript.map((m, i) => (
            <div
              key={i}
              className={
                'p-2 rounded ' +
                (m.role === 'user'
                  ? 'bg-indigo-50 text-indigo-900'
                  : 'bg-slate-50 text-slate-800')
              }
            >
              <div className="text-[10px] uppercase text-slate-400">
                {m.role === 'user' ? 'Expert' : 'Student'}
              </div>
              {m.content}
            </div>
          ))}
        </div>
      </div>
      <div className="p-4">
        <div className="text-xs font-semibold mb-2 text-slate-500">
          Auto-score · adjust + comment
        </div>
        <ul className="space-y-2 mb-3 max-h-72 overflow-y-auto">
          {comps.map((c, i) => (
            <li key={i} className="border border-slate-200 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{c.name}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={c.score}
                  onChange={(e) => setScore(i, Number(e.target.value) || 0)}
                  className="w-16 text-sm rounded border border-slate-300 px-1 py-0.5 text-right"
                />
              </div>
              {c.criterion && (
                <div className="text-[11px] text-slate-500 mt-1">criterion: {c.criterion}</div>
              )}
              <div className="text-[11px] text-slate-500">evidence: {c.evidence}</div>
              {c.source_refs && c.source_refs.length > 0 && (
                <div className="text-[10px] text-slate-400 mt-1">
                  refs:{' '}
                  {c.source_refs
                    .map((r) => `${r.documentName}${r.page ? `, p.${r.page}` : ''}`)
                    .join(' · ')}
                </div>
              )}
            </li>
          ))}
        </ul>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Required: why these scores?"
          className="w-full text-sm rounded border border-slate-300 p-2"
          rows={3}
        />
        <button
          onClick={submit}
          disabled={busy}
          className="mt-2 w-full text-sm bg-accent text-white py-2 rounded-lg hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Approve & lock'}
        </button>
      </div>
    </div>
  );
}
