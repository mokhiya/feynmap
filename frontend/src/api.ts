// API surface for the learn flow.
//
// Phase 2+: /chat and /assess are now stateful /sessions endpoints.
// We keep `postChat` and `postAssess` as compat shims for unauthenticated
// dev callers, but the live UI uses sessionStart/sessionTurn/sessionFinalize.

import type { Lang } from './i18n';
import type {
  Assessment,
  Message,
  SessionMode,
  SessionRow,
  TopicRow,
} from './types';
import { adminFetch } from './auth';

// ---------- legacy single-shot (unused by main UI; left for tests) ----------

export async function postChat(
  topic: string,
  history: Message[],
  lang: Lang,
  nextFocus?: string,
): Promise<string> {
  const r = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, history, nextFocus, lang }),
  });
  if (!r.ok) throw new Error(`/chat failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.question as string;
}

export async function postAssess(
  topic: string,
  history: Message[],
  lang: Lang,
  previous?: Assessment | null,
): Promise<Assessment> {
  const r = await fetch('/api/assess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, history, previous, lang }),
  });
  if (!r.ok) throw new Error(`/assess failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as Assessment;
}

// ---------- Topics catalog (published) ----------

export async function listPublishedTopics(): Promise<TopicRow[]> {
  const j = await adminFetch<{ topics: TopicRow[] }>('/topics/published');
  return j.topics;
}

// ---------- Sessions (Phase 5) ----------

export interface StartSessionResp {
  session: SessionRow;
  firstQuestion: string;
}

export async function startSession(args: {
  topicId?: string;
  topicLabel?: string;
  mode: SessionMode;
  locale: Lang;
  assignmentId?: string;
}): Promise<StartSessionResp> {
  return await adminFetch<StartSessionResp>('/sessions', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

export interface TurnSignals {
  pasteSize?: number;
  typingMs?: number;
  deletes?: number;
  frustrated?: boolean;
}

export interface TurnResp {
  question: string;
  assessment: Assessment | null;
  flags: Record<string, number>;
}

export async function sessionTurn(
  sessionId: string,
  text: string,
  signals: TurnSignals = {},
): Promise<TurnResp> {
  return await adminFetch<TurnResp>(`/sessions/${sessionId}/turn`, {
    method: 'POST',
    body: JSON.stringify({ text, signals }),
  });
}

export async function sessionFinalize(sessionId: string): Promise<{
  session: SessionRow;
  result: any;
}> {
  return await adminFetch(`/sessions/${sessionId}/finalize`, { method: 'POST' });
}

export async function sessionConvert(sessionId: string): Promise<{ session: SessionRow }> {
  return await adminFetch(`/sessions/${sessionId}/convert`, { method: 'POST' });
}

export async function sessionAppeal(sessionId: string, reason: string) {
  return await adminFetch(`/sessions/${sessionId}/appeal`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
