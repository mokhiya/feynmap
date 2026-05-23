import type { Lang } from './i18n';
import type { Assessment, Message } from './types';

export async function postChat(
  topic: string,
  history: Message[],
  lang: Lang,
  nextFocus?: string
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
  previous?: Assessment | null
): Promise<Assessment> {
  const r = await fetch('/api/assess', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, history, previous, lang }),
  });
  if (!r.ok) throw new Error(`/assess failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as Assessment;
}
