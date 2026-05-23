import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';
import type { Assessment, Competency, SessionMode, SourceRef } from '../types';
import { useT } from '../i18n';
import LangSwitcher from './LangSwitcher';

interface Props {
  topic: string;
  assessment: Assessment | null;
  onRestart: () => void;
  mode?: SessionMode;
  onConvert?: () => void; // practice → assessment
  onAppeal?: () => void; // learner appeal (assessment mode only)
}

export default function ReportScreen({
  topic,
  assessment,
  onRestart,
  mode,
  onConvert,
  onAppeal,
}: Props) {
  const t = useT();
  const comps = assessment?.competencies ?? [];
  const gaps = comps.filter((c) => c.gap);
  const strong = comps.filter((c) => c.score >= 70).sort((a, b) => b.score - a.score);
  const data = comps.map((c) => ({ subject: c.name, score: c.score }));

  // Prefer assessor-supplied recommendations; fall back to derived gap-name list.
  const recs =
    (assessment?.recommendations && assessment.recommendations.length > 0
      ? assessment.recommendations
      : gaps.length === 0
        ? [t.recAllGood]
        : gaps.slice(0, 5).map((g) => t.recGap(g.name)));

  const growth = assessment?.growth_zones ?? [];
  const strengthsList = assessment?.strengths ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <span>{t.reportTitle}</span>
            {mode && (
              <span
                className={
                  'px-1.5 py-0.5 rounded text-[10px] border ' +
                  (mode === 'assessment'
                    ? 'bg-amber-50 text-amber-700 border-amber-100'
                    : 'bg-slate-50 text-slate-600 border-slate-200')
                }
              >
                {mode}
              </span>
            )}
          </div>
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
          <Section title={growth.length ? 'Growth zones' : t.gaps}>
            {gaps.length === 0 && growth.length === 0 ? (
              <p className="text-sm text-slate-500">{t.noGaps}</p>
            ) : (
              <ul className="space-y-3">
                {gaps.map((c) => (
                  <CompetencyDetail key={c.name} c={c} />
                ))}
                {growth.length > 0 && (
                  <li className="pt-1 border-t border-slate-100">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">
                      Assessor notes
                    </div>
                    <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5">
                      {growth.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </li>
                )}
              </ul>
            )}
          </Section>

          <Section title={t.strengths}>
            {strong.length === 0 && strengthsList.length === 0 ? (
              <p className="text-sm text-slate-500">—</p>
            ) : (
              <>
                {strong.length > 0 && (
                  <ul className="space-y-1.5">
                    {strong.map((c) => (
                      <li key={c.name} className="text-sm flex items-center justify-between">
                        <span>{c.name}</span>
                        <span className="text-emerald-600 font-mono text-xs">{c.score}/100</span>
                      </li>
                    ))}
                  </ul>
                )}
                {strengthsList.length > 0 && (
                  <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5 mt-2">
                    {strengthsList.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Section>

          <Section title={t.toImprove}>
            <ul className="list-disc list-inside text-sm space-y-1 text-slate-700">
              {recs.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Section>

          {(onConvert || onAppeal) && (
            <Section title="Actions">
              <div className="flex flex-col gap-2">
                {onConvert && (
                  <button
                    onClick={onConvert}
                    className="text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-2 px-3"
                  >
                    Convert to Assessment (send for review)
                  </button>
                )}
                {onAppeal && (
                  <button
                    onClick={onAppeal}
                    className="text-sm border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg py-2 px-3"
                  >
                    Disagree? Appeal this score
                  </button>
                )}
                <p className="text-[11px] text-slate-400 leading-snug">
                  Practice sessions stay private. Assessment sessions are
                  locked pending Assessor review and may be appealed.
                </p>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function CompetencyDetail({ c }: { c: Competency }) {
  return (
    <li className="text-sm border border-rose-100 bg-rose-50/40 rounded-lg p-2">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {c.name}
          {c.overridden && (
            <span className="ml-1 text-[10px] uppercase text-amber-700 bg-amber-100 px-1 rounded">
              overridden
            </span>
          )}
        </span>
        <span className="text-rose-600 font-mono text-xs">{c.score}/100</span>
      </div>
      {c.criterion && (
        <div className="text-[11px] text-slate-500 mt-1">
          <span className="text-slate-400">criterion:</span> {c.criterion}
        </div>
      )}
      {c.evidence && (
        <div className="text-slate-600 text-xs mt-0.5">{c.evidence}</div>
      )}
      {c.source_refs && c.source_refs.length > 0 && (
        <div className="text-[10px] text-slate-500 mt-1">
          <span className="text-slate-400">refs: </span>
          {c.source_refs.map((r: SourceRef, i: number) => (
            <span key={i} className="mr-1">
              {r.documentName}
              {r.page ? `, p.${r.page}` : ''}
              {i < (c.source_refs!.length - 1) ? ' · ' : ''}
            </span>
          ))}
        </div>
      )}
    </li>
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
