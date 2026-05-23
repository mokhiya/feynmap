import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { Assessment } from '../types';
import { useT } from '../i18n';

interface Props {
  assessment: Assessment | null;
  assessing: boolean;
}

export default function RadarPanel({ assessment, assessing }: Props) {
  const t = useT();
  const data = (assessment?.competencies ?? []).map((c) => ({
    subject: c.name,
    score: c.score,
    gap: c.gap,
  }));

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl shadow-sm border border-slate-200">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">{t.competencyMap}</div>
          <div className="font-semibold text-ink">
            {t.overall}: {assessment?.overall ?? 0}
            <span className="text-slate-400 font-normal text-sm"> / 100</span>
          </div>
        </div>
        {assessing && (
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
            {t.assessing}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 p-2">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm italic text-center px-6">
            {t.emptyAssessment}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="75%">
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fill: '#475569' }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Radar
                name={t.levelLabel}
                dataKey="score"
                stroke="#6366f1"
                fill="#6366f1"
                fillOpacity={0.35}
                isAnimationActive
                animationDuration={600}
              />
              <Tooltip
                formatter={(v: number) => [`${v} / 100`, t.levelLabel]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </div>

      {assessment?.next_focus && (
        <div className="px-5 py-3 border-t border-slate-200 text-sm">
          <span className="text-slate-500">{t.nextFocus}: </span>
          <span className="font-medium text-accent">{assessment.next_focus}</span>
        </div>
      )}
    </div>
  );
}
