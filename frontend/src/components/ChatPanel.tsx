import { useEffect, useRef, useState } from 'react';
import type { Message } from '../types';
import { useT } from '../i18n';

export interface TurnSignals {
  pasteSize?: number;
  typingMs?: number;
  deletes?: number;
}

interface Props {
  topic: string;
  messages: Message[];
  busy: boolean;
  onSend: (text: string, signals?: TurnSignals) => void;
  onFinish: () => void;
}

export default function ChatPanel({ topic, messages, busy, onSend, onFinish }: Props) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Anti-fraud signal capture, reset on each send.
  const focusTsRef = useRef<number | null>(null);
  const pasteSizeRef = useRef<number>(0);
  const deletesRef = useRef<number>(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const resetSignals = () => {
    focusTsRef.current = null;
    pasteSizeRef.current = 0;
    deletesRef.current = 0;
  };

  const send = () => {
    const txt = draft.trim();
    if (!txt || busy) return;
    const startedAt = focusTsRef.current;
    const signals: TurnSignals = {
      pasteSize: pasteSizeRef.current || undefined,
      typingMs: startedAt ? Date.now() - startedAt : undefined,
      deletes: deletesRef.current || undefined,
    };
    onSend(txt, signals);
    setDraft('');
    resetSignals();
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">{t.topic}</div>
          <div className="font-semibold text-ink">{topic}</div>
        </div>
        <button
          onClick={onFinish}
          disabled={messages.filter((m) => m.role === 'user').length < 1 || busy}
          title={t.finishDisabledHint}
          className="text-sm px-3 py-1.5 rounded-lg bg-slate-900 text-white disabled:opacity-30 hover:bg-slate-700 transition"
        >
          {t.finish}
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-slate-400 text-sm italic">{t.studentFirstQuestion}</div>
        )}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.content} expertLabel={t.expertLabel} studentLabel={t.studentLabel} />
        ))}
        {busy && (
          <div className="text-slate-400 text-sm flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-slate-400 rounded-full animate-pulse" />
            {t.studentThinking}
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 p-3 flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            if (focusTsRef.current == null) focusTsRef.current = Date.now();
          }}
          onPaste={(e) => {
            const text = e.clipboardData?.getData('text') || '';
            if (text.length > 0) pasteSizeRef.current += text.length;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
              deletesRef.current += 1;
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          rows={2}
          placeholder={t.composerPlaceholder}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          onClick={send}
          disabled={busy || !draft.trim()}
          className="px-4 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 hover:bg-indigo-500 transition"
        >
          {t.send}
        </button>
      </div>
    </div>
  );
}

function Bubble({
  role,
  text,
  expertLabel,
  studentLabel,
}: {
  role: 'user' | 'assistant';
  text: string;
  expertLabel: string;
  studentLabel: string;
}) {
  const isExpert = role === 'user';
  return (
    <div className={`flex ${isExpert ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          'max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap leading-relaxed ' +
          (isExpert
            ? 'bg-accent text-white rounded-br-sm'
            : 'bg-slate-100 text-ink rounded-bl-sm')
        }
      >
        <div className="text-[10px] uppercase tracking-wider opacity-70 mb-0.5">
          {isExpert ? expertLabel : studentLabel}
        </div>
        {text}
      </div>
    </div>
  );
}
