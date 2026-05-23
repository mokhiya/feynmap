import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import type { Assessment } from '../types';
import { useT } from '../i18n';
import LangSwitcher from './LangSwitcher';

interface Props {
  topic: string;
  assessment: Assessment | null;
  onRestart: () => void;
}

export default function ReportScreen({ topic, assessment, onRestart }: Props) {
  const t = useT();
  const gaps = (assessment?.competencies ?? []).filter((c) => c.gap);
  const strong = (assessment?.competencies ?? [])
    .filter((c) => c.score >= 70)
    .sort((a, b) => b.score - a.score);
  const data = (assessment?.competencies ?? []).map((c) => ({
    subject: c.name,
    score: c.score,
  }));

  const recs =
    gaps.length === 0
      ? [t.recAllGood]
      : gaps.slice(0, 5).map((g) => t.recGap(g.name));

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">{t.reportTitle}</div>
          <h1 className="text-2xl font-bold text-ink">{topic}</h1>
        </div>
        <div className="flex items-center gap-3">
          <LangSwitcher compact />
          <button
            onClick={onRestart}
            className="text-sm px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 transition"
          >
            {t.newTopic}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 h-[420px]">
          <div className="text-sm font-medium mb-1 text-slate-600">{t.competencyMap}</div>
          <div className="text-3xl font-bold mb-2">
            {assessment?.overall ?? 0}
            <span className="text-slate-400 text-lg font-normal"> / 100</span>
          </div>
          <div className="h-[330px]">
            {data.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-sm text-slate-500 px-6">
                <div className="text-3xl mb-2">🫥</div>
                {t.notEnoughData}
                <br />
                {t.notEnoughDataHint}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={data} outerRadius="78%">
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#475569' }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <Section title={t.gaps}>
            {gaps.length === 0 ? (
              <p className="text-sm text-slate-500">{t.noGaps}</p>
            ) : (
              <ul className="space-y-2">
                {gaps.map((c) => (
                  <li key={c.name} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-rose-600 font-mono text-xs">{c.score}/100</span>
                    </div>
                    {c.evidence && <div className="text-slate-500 text-xs mt-0.5">{c.evidence}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t.strengths}>
            {strong.length === 0 ? (
              <p className="text-sm text-slate-500">—</p>
            ) : (
              <ul className="space-y-1.5">
                {strong.map((c) => (
                  <li key={c.name} className="text-sm flex items-center justify-between">
                    <span>{c.name}</span>
                    <span className="text-emerald-600 font-mono text-xs">{c.score}/100</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t.toImprove}>
            <ul className="list-disc list-inside text-sm space-y-1 text-slate-700">
              {recs.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-sm font-semibold text-ink mb-2">{title}</div>
      {children}
    </div>
  );
}
