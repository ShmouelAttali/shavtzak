import { useMemo } from 'react';
import type { Soldier } from '../types';
import { EXIT_STATUS_STYLE, getStatusStyle, isExitStatus } from '../types';

export interface LegendItem {
  key: string;
  bg: string;
  text: string;
  label: string;
}

const EXIT_KEY = '__exit__';
const EXIT_LABEL = 'יציאה';

/**
 * The distinct status colors actually present across `soldiers` × `dates` —
 * every יציאה variant collapses into one "יציאה" entry (same color, generic
 * label; the exact wording still shows on the cell itself), everything else
 * gets one entry per exact status text.
 */
export function buildLegendItems(soldiers: Pick<Soldier, 'schedule'>[], dates: string[]): LegendItem[] {
  const seen = new Map<string, LegendItem>();
  let sawExit = false;

  for (const soldier of soldiers) {
    for (const date of dates) {
      const status = soldier.schedule[date];
      if (!status) continue;
      if (isExitStatus(status)) { sawExit = true; continue; }
      if (!seen.has(status)) {
        const style = getStatusStyle(status);
        seen.set(status, { key: status, bg: style.bg, text: style.text, label: status });
      }
    }
  }

  const items = Array.from(seen.values());
  if (sawExit) {
    items.push({ key: EXIT_KEY, ...EXIT_STATUS_STYLE, label: EXIT_LABEL });
  }
  return items.sort((a, b) => a.label.localeCompare(b.label, 'he'));
}

interface Props {
  soldiers: Pick<Soldier, 'schedule'>[];
  dates: string[];
}

export function ScheduleLegend({ soldiers, dates }: Props) {
  const items = useMemo(() => buildLegendItems(soldiers, dates), [soldiers, dates]);
  if (!items.length) return null;

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map((i) => (
        <span key={i.key} className={`rounded px-2 py-0.5 font-medium ${i.bg} ${i.text}`}>
          {i.label}
        </span>
      ))}
    </div>
  );
}
