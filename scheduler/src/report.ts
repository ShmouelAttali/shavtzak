// Per-day + weekly HTML generation report (owner request 2026-07-19): a
// self-contained, RTL Hebrew page explaining what the generator decided at
// each step and why. PURE builders — no DB, no Gen access: cli.ts assembles
// the serializable inputs from GenerateResult (+ its ReportMeta side-channel)
// and the validation findings, and writes the files.
//
// Structure (owner refinements, 2026-07-19):
//   - the LEAD section follows the generation PROCESS in execution order
//     (LOGIC.he.md's שני שלבים + SPEC §7 Level-1 step order) — per step, the
//     affected soldiers and the specific decision;
//   - the outcome sections (שלב 1 / שלב 2 / שרשורים / חריגות) follow;
//   - soldier names use the שבצק tab's color scheme (platoon color + bold
//     commanders — mirrored from src/components/Shavtzak.tsx);
//   - data tables get clickable sort headers (inline vanilla JS).
//
// Rationale wording is NOT duplicated here — every "why picked" line renders
// through rationale.ts's TEMPLATES (renderRationale).

import type { GenerateResult } from './model.js';
import { RationaleEntry, RationaleCode, renderRationale, isCaveat } from './rationale.js';
import { normalizeName as nrm } from './text.js';
import { Minutes, fmtHM } from './time.js';

// ─── input structures (plain + serializable) ───────────────────────────────

export interface ReportFinding { severity: 'error' | 'warning'; rule: string; message: string }

export interface ReportSoldier {
  id: number;
  name: string;
  platoon: string;
  role: string;
  /** fairness snapshot as of generation (7-day rolling) — chip tooltips */
  nights7d: number;
  weightedHours7d: number;
  positionCounts: Record<string, number>;
  /** H6c whitelist, when the soldier is restricted */
  allowedPositions: string[] | null;
}

export interface ReportAssignment {
  soldierId: number;
  positionId: number;
  subName: string | null;
  start: Minutes;
  end: Minutes;
  seatIndex: number;
  isCommanderSeat: boolean;
  source: 'auto' | 'chain';
  violations: string[];
  rationale: RationaleEntry[];
}

export interface DayReportInput {
  day: string;
  generatedAt: string;
  dryRun: boolean;
  soldiers: ReportSoldier[];
  positions: {
    id: number; name: string; missionClass: string;
    daily: boolean; chainOverlay: boolean; staffAllRoles: boolean;
  }[];
  /** unavailability windows (minutes) intersecting the day, per soldier id */
  blocked: Record<string, [Minutes, Minutes][]>;
  /** H9 half-day exit windows, per soldier id */
  exits: Record<string, [Minutes, Minutes][]>;
  /** honored human locks */
  locks: { soldierId: number; positionName: string; kind: 'day' | 'shift' }[];
  /** closed-list positions: full member list + who was unavailable today */
  pools: { position: string; members: string[]; unavailable: string[] }[];
  /** soldier ids reserved to a seat-rule seat (H6b) — their rest is BY DESIGN */
  seatReserved: string[];
  /** Level-1 buckets: soldier id -> position id.
   *  NB: DB ids may be strings at runtime (pg returns bigint as string) —
   *  the builders normalize every id key through String(). */
  level1: Record<string, number>;
  /** soldier id -> Level-1 rationale entries */
  level1Rationale: Record<string, RationaleEntry[]>;
  /** position id -> distinct soldiers needed (post flex sizing) */
  demand: Record<string, number>;
  /** position id -> baseline demand BEFORE flex sizing (the raw balance) */
  demandBefore: Record<string, number>;
  flex: { positionId: number; before: number; after: number }[];
  magenCommander?: string;
  assignments: ReportAssignment[];
  issues: string[];
  findings: ReportFinding[];
  restPositionId?: number;
  homePositionId?: number;
}

export interface WeekDaySummary {
  day: string;
  /** day-page file name, relative to the week index (e.g. "2026-07-20.html") */
  file: string;
  errors: number;
  warnings: number;
  shortages: string[];
}

export interface WeekFairnessRow {
  name: string;
  platoon: string;
  role: string;
  /** hours overlapping the 00:00–06:00 windows of the range, counted rows
   *  only (non-readiness, non-night_exempt — soldier_fairness's night
   *  classification) */
  nightHours: number;
  /** raw hours on התקפי rows in the range (a standing day = 24h — measures
   *  on-call burden) */
  hatkafiHours: number;
  /** counted mission hours over the range (per-row cap at daily_cap_hours,
   *  readiness excluded — like soldier_fairness mission_hours) */
  totalHours: number;
}

export interface WeekReportInput {
  from: string;
  to: string;
  generatedAt: string;
  days: WeekDaySummary[];
  /** soldiers home the whole range are excluded by the caller (cli SQL) */
  fairness: WeekFairnessRow[];
}

/** Assemble a DayReportInput from a GenerateResult (requires res.report,
 *  which generate() always fills) + the day's validation findings. */
export function buildDayInput(
  res: GenerateResult, findings: ReportFinding[], dryRun: boolean, generatedAt?: string,
): DayReportInput {
  const m = res.report;
  if (!m) throw new Error('GenerateResult.report missing — was the result built by generate()?');
  return {
    day: res.day,
    generatedAt: generatedAt ?? new Date().toLocaleString('he-IL', { hour12: false }),
    dryRun,
    soldiers: m.soldiers,
    positions: m.positions,
    blocked: m.blocked,
    exits: m.exits,
    locks: m.locks,
    pools: m.pools,
    seatReserved: m.seatReserved,
    level1: Object.fromEntries(res.level1),
    level1Rationale: m.level1Rationale,
    demand: m.demand,
    demandBefore: m.demandBefore,
    flex: m.flex,
    magenCommander: m.magenCommander,
    assignments: res.assignments.map((a) => ({
      soldierId: a.soldierId,
      positionId: a.positionId,
      subName: a.subPositionId !== null ? (m.subNames[a.subPositionId] ?? null) : null,
      start: a.period[0], end: a.period[1],
      seatIndex: a.seatIndex, isCommanderSeat: a.isCommanderSeat,
      source: a.source, violations: a.violations, rationale: a.rationale,
    })),
    issues: res.issues,
    findings,
    restPositionId: m.restPositionId,
    homePositionId: m.homePositionId,
  };
}

/** Generation issues that signal a real structural gap (shown in the day
 *  narrative and on the weekly cards). */
export function keyShortages(issues: string[]): string[] {
  const re = /חסרים|לא אויש|אין מועמד|לא נמצא|יישאר ריק|נשאר ריק|נותר במנוחה|הצוות מעורב/;
  return issues.filter((i) => re.test(i));
}

// ─── shared rendering helpers ──────────────────────────────────────────────

const esc = (s: unknown): string => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape for a title="" tooltip — newlines become visible line breaks. */
const escTitle = (s: string): string => esc(s).replace(/\n/g, '&#10;');

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function dayTitle(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `יום ${wd} ${pad(d)}/${pad(m)}/${y}`;
}

// שבצק-tab color scheme — mirrored from the viewer app's
// src/components/Shavtzak.tsx (UNIT_COLOR + BOLD_ROLES). Source of truth is
// that file; keep the hex values in sync (tailwind text-red-500 etc.).
const PLATOON_CLASS: Record<string, string> = {
  '1': 'pl-1', '2': 'pl-2', '3': 'pl-3', 'מפלג': 'pl-m', 'חמל': 'pl-h',
};
const BOLD_ROLES = ['ממ', 'מפ', 'סמפ', 'סמל', 'מכ'];   // מ"מ, מ"פ, סמ"פ, סמל, מ"כ

/** Soldier name span: platoon color + bold for commander roles. */
function soldierNameHtml(s: { name: string; platoon: string; role: string } | undefined,
                         fallback: string): string {
  if (!s) return esc(fallback);
  const cls = PLATOON_CLASS[nrm(s.platoon)] ?? '';
  const bold = BOLD_ROLES.some((r) => nrm(s.role).includes(r));
  return `<span class="${cls}${bold ? ' cmd-name' : ''}">${esc(s.name)}</span>`;
}

/** Level-1 reason badge per rationale code; anything unmapped fell through
 *  the general ranked fill = הוגנות. */
const L1_BADGE: Partial<Record<RationaleCode, string>> = {
  continuity_crew: 'המשכיות',
  magen_commander: 'מפקד המגן',
  candidate_pool: 'רשימה סגורה',
  seat_rule: 'מושב שמור',
  role_crew: 'צוות תפקיד',
  commander_quota: 'מכסת מפקדים',
  driver_quota: 'מכסת נהגים',
  exit_shift_fill: 'יציאה קצרה',
  platoon_group: 'קבוצת מחלקה',
  no_rest_fill: 'כולם עובדים',
  // specific fairness keys (which consideration selected the soldier)
  fewest_nights: 'מעט לילות',
  low_load: 'עומס נמוך',
  position_balance: 'איזון עמדות',
  fairness_pick: 'הוגנות',
};

/** Level-2 fill order (SPEC §7) — report sections follow it. */
const FILL_ORDER = ['קצין מוצב', 'סיור', 'התקפי', 'מגן', 'עמדות הגנה', 'חפק', 'תורנים'];

const orderIndex = (name: string): number => {
  const i = FILL_ORDER.indexOf(name);
  return i < 0 ? FILL_ORDER.length : i;
};

/** Time window as an LTR-isolated span — a bare "14:00–22:00" is visually
 *  reordered by the surrounding RTL context. */
const winHtml = (start: Minutes, end: Minutes): string =>
  `<span class="win">${fmtHM(start)}–${fmtHM(end)}</span>`;

const winText = (w: [Minutes, Minutes]): string => `${fmtHM(w[0])}–${fmtHM(w[1])}`;

/** The 1-2 most informative rationale entries for a cell: the last
 *  comparative/rest fact, plus the first caveat (if any). */
function pickReasonEntries(rat: RationaleEntry[]): RationaleEntry[] {
  const infos = rat.filter((e) => !isCaveat(e));
  const caveats = rat.filter(isCaveat);
  const informative = new Set<RationaleCode>([
    'fewest_nights', 'low_load', 'position_balance', 'rest_ok', 'duty_rest',
    'no_prior', 'rotation_switch', 'rotation_break_static', 'pulled_from_rest',
  ]);
  const main = [...infos].reverse().find((e) => informative.has(e.code))
    ?? infos[infos.length - 1];
  const out: RationaleEntry[] = [];
  if (main) out.push(main);
  if (caveats[0]) out.push(caveats[0]);
  return out;
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; direction: rtl; color: #1c2733; background: #f4f6f8;
         font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
                      "Noto Sans Hebrew", sans-serif; font-size: 15px; line-height: 1.45; }
  h1 { font-size: 1.45rem; margin: 0 0 4px; }
  h2 { font-size: 1.12rem; margin: 0 0 12px; border-bottom: 2px solid #dfe4ea;
       padding-bottom: 6px; }
  h3 { font-size: 1rem; margin: 14px 0 6px; }
  .sub { color: #5b6875; font-size: .88rem; margin-bottom: 10px; }
  .card { background: #fff; border: 1px solid #e1e5ea; border-radius: 10px;
          padding: 16px 20px; margin: 0 0 18px; box-shadow: 0 1px 2px rgba(16,24,40,.05); }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 2px; }
  .chip { display: inline-block; padding: 3px 12px; border-radius: 999px; font-size: .85rem;
          background: #eef1f5; border: 1px solid #dde2e8; }
  .chip.err { background: #fdecea; border-color: #f5c6c2; color: #a12622; font-weight: 600; }
  .chip.warn { background: #fff6e0; border-color: #f2dfae; color: #8a6100; font-weight: 600; }
  .chip.ok { background: #e8f5ec; border-color: #c4e3cd; color: #1c6b34; }
  .tbl-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; }
  th { background: #eef1f5; text-align: right; padding: 6px 10px;
       border: 1px solid #dde2e8; font-weight: 600; white-space: nowrap; }
  td { padding: 6px 10px; border: 1px solid #e5e9ee; vertical-align: top; }
  tbody tr:nth-child(even) { background: #f8fafc; }
  tfoot td { background: #eef1f5; font-weight: 600; }
  .soldier { display: inline-flex; align-items: center; gap: 5px; margin: 2px 3px;
             padding: 2px 9px; border-radius: 7px; background: #f1f4f8;
             border: 1px solid #dfe4ea; white-space: nowrap; max-width: 100%; }
  .soldier .why { white-space: normal; }
  .badge { display: inline-block; padding: 0 7px; border-radius: 999px; font-size: .72rem;
           background: #e3ebf7; color: #2f5586; border: 1px solid #c9d8ee; }
  .badge.warn { background: #fff3d6; color: #8a6100; border-color: #ecd9a0; }
  .badge.cmd { background: #efe6f8; color: #5b3a86; border-color: #dcc9ef; }
  .who { font-weight: 700; }
  .why { color: #5b6875; font-size: .82rem; margin-top: 2px; }
  .viol { color: #a12622; font-size: .82rem; margin-top: 3px; }
  ul.narrative { margin: 12px 4px 2px; padding-inline-start: 20px; }
  ul.narrative li { margin: 3px 0; }
  ul.plain { margin: 4px; padding-inline-start: 20px; }
  ul.plain li { margin: 4px 0; }
  .rule-tag { display: inline-block; padding: 0 8px; border-radius: 6px; font-size: .78rem;
              font-family: ui-monospace, Menlo, monospace; background: #eef1f5;
              border: 1px solid #dde2e8; margin-inline-end: 6px; }
  .empty { color: #8a94a0; font-style: italic; }
  .win { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  table.sortable thead th { cursor: pointer; user-select: none; }
  .sort-arrow { font-size: .72em; color: #5b6875; }
  /* שבצק-tab name colors — source of truth: src/components/Shavtzak.tsx UNIT_COLOR */
  .pl-1 { color: #ef4444; }   /* מחלקה 1 — text-red-500 */
  .pl-2 { color: #16a34a; }   /* מחלקה 2 — text-green-600 */
  .pl-3 { color: #d97706; }   /* מחלקה 3 — text-amber-600 */
  .pl-m { color: #7e22ce; }   /* מפל"ג — text-purple-700 */
  .pl-h { color: #3b82f6; }   /* חמ"ל — text-blue-500 */
  .cmd-name { font-weight: 700; }
  details.step { margin: 10px 0; border: 1px solid #e5e9ee; border-radius: 8px;
                 padding: 8px 14px; background: #fbfcfd; }
  details.step[open] { background: #fff; }
  details.step > summary { cursor: pointer; font-weight: 600; }
  details.step.muted > summary { color: #8a94a0; font-weight: 500; }
  details.inner { margin: 6px 0; }
  details.inner > summary { cursor: pointer; color: #2f5586; font-size: .88rem; }
  a { color: #2f5586; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
           gap: 12px; }
  .day-card { border: 1px solid #dfe4ea; border-radius: 10px; padding: 12px 14px;
              background: #fbfcfd; }
  .day-card h3 { margin: 0 0 6px; font-size: 1rem; }
  .day-card ul { margin: 8px 0 0; padding-inline-start: 18px; font-size: .82rem;
                 color: #6b4d00; }
  footer { color: #8a94a0; font-size: .8rem; margin-top: 10px; }
  @media print {
    body { background: #fff; padding: 0; }
    .card { box-shadow: none; break-inside: avoid; border-color: #cfd6dd; }
  }
`;

// Column sorting for tables marked class="sortable": clickable headers with a
// ▲/▼ direction arrow; numeric columns sort numerically, text columns by the
// Hebrew locale. Only tbody rows move — the summary tfoot stays pinned.
// Inline vanilla JS: the report stays a single self-contained file://-able page.
const SORT_JS = `
document.querySelectorAll('table.sortable').forEach(function (tbl) {
  var tbody = tbl.tBodies[0];
  if (!tbody || !tbl.tHead || !tbl.tHead.rows.length) return;
  var ths = Array.prototype.slice.call(tbl.tHead.rows[0].cells);
  ths.forEach(function (th, i) {
    var arrow = document.createElement('span');
    arrow.className = 'sort-arrow';
    th.appendChild(arrow);
    th.addEventListener('click', function () {
      var dir = th.getAttribute('data-dir') === 'asc' ? 'desc' : 'asc';
      ths.forEach(function (h) {
        h.removeAttribute('data-dir');
        h.querySelector('.sort-arrow').textContent = '';
      });
      th.setAttribute('data-dir', dir);
      arrow.textContent = dir === 'asc' ? ' \\u25B2' : ' \\u25BC';
      var rows = Array.prototype.slice.call(tbody.rows);
      var cell = function (r) { return (r.cells[i] ? r.cells[i].textContent : '').trim(); };
      var numeric = rows.length > 0 && rows.every(function (r) {
        return /^-?\\d+(\\.\\d+)?$/.test(cell(r));
      });
      rows.sort(function (a, b) {
        var c = numeric ? parseFloat(cell(a)) - parseFloat(cell(b))
                        : cell(a).localeCompare(cell(b), 'he');
        return dir === 'asc' ? c : -c;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });
  });
});
`;

const htmlPage = (title: string, body: string): string =>
  `<!doctype html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
<script>${SORT_JS}</script>
</body>
</html>
`;

// ─── day report ────────────────────────────────────────────────────────────

export function buildDayReportHtml(input: DayReportInput): string {
  // pg returns bigint ids as strings — every id is normalized via String()
  const posById = new Map(input.positions.map((p) => [String(p.id), p]));
  const soldierById = new Map(input.soldiers.map((s) => [String(s.id), s]));
  const soldier = (sid: number | string) => soldierById.get(String(sid));
  const name = (sid: number | string) => soldier(sid)?.name ?? `#${sid}`;
  const nameHtml = (sid: number | string) => soldierNameHtml(soldier(sid), `#${sid}`);
  const posName = (pid: number | string) => posById.get(String(pid))?.name ?? `#${pid}`;
  const restId = input.restPositionId !== undefined ? String(input.restPositionId) : undefined;
  const homeId = input.homePositionId !== undefined ? String(input.homePositionId) : undefined;

  const errors = input.findings.filter((f) => f.severity === 'error');
  const warnings = input.findings.filter((f) => f.severity === 'warning');
  const l1Entries = Object.entries(input.level1)
    .map(([sid, pid]) => [sid, String(pid)] as const);
  const home = l1Entries.filter(([, pid]) => pid === homeId).length;
  const present = l1Entries.length - home;

  // ── header strip ──
  const header = `
<div class="card">
  <h1>שבצ"ק ל${esc(dayTitle(input.day))}, <span class="win">14:00→14:00</span></h1>
  <div class="sub">הופק ב-${esc(input.generatedAt)}${input.dryRun ? ' · טיוטה בלבד (dry-run — לא נשמר)' : ''}</div>
  <div class="chips">
    <span class="chip ok">נוכחים בבסיס: ${present}</span>
    <span class="chip">בבית: ${home}</span>
    <span class="chip ${errors.length ? 'err' : 'ok'}">שגיאות: ${errors.length}</span>
    <span class="chip ${warnings.length ? 'warn' : 'ok'}">אזהרות: ${warnings.length}</span>
  </div>
</div>`;

  // ── day balance: total demand vs available supply (owner request) ──
  // Demand figures: the Level-1 demand() numbers (post flex sizing); staff
  // crews (חמל/מפלג) staff "everyone present of the role" — their real figure
  // is the actual crew size. Chains reuse descending crews (no fresh demand).
  const assignedTo = (pid: string) => l1Entries.filter(([, p]) => p === pid).length;
  const balanceRows: { name: string; need: number; got: number }[] = [];
  for (const p of input.positions) {
    const pid = String(p.id);
    if (p.chainOverlay || pid === restId || pid === homeId) continue;
    const got = assignedTo(pid);
    // baseline (pre-flex) figures: the post-flex demand absorbs surplus into
    // מגן / shrinks סיור, which would mask the raw balance
    const needRaw = p.staffAllRoles ? got : (input.demandBefore[pid] ?? input.demand[pid]);
    if (needRaw === undefined && got === 0) continue;
    balanceRows.push({ name: p.name, need: Number(needRaw ?? got), got });
  }
  balanceRows.sort((a, b) => orderIndex(a.name) - orderIndex(b.name)
    || a.name.localeCompare(b.name, 'he'));
  const totalNeed = balanceRows.reduce((s, r) => s + r.need, 0);
  const surplus = present - totalNeed;
  const magenGrew = input.flex.some((f) =>
    posName(f.positionId) === 'מגן' && f.after > f.before);
  const shrunk = input.flex.filter((f) => f.after < f.before);
  const balanceSentence = surplus > 0
    ? `נדרשים ${totalNeed} חיילים · זמינים ${present} · <b>עודף ${surplus}</b>` +
      (magenGrew ? ' — נקלט בצוות המגן (כולם עובדים)' : '')
    : surplus < 0
      ? `נדרשים ${totalNeed} חיילים · זמינים ${present} · <b>חסרים ${-surplus}</b>` +
        (shrunk.length
          ? ` — ${shrunk.map((f) => `${esc(posName(f.positionId))} צומצם ל-${f.after}`).join(', ')}`
          : ' — מושבים עלולים להישאר ריקים')
      : `נדרשים ${totalNeed} חיילים · זמינים ${present} · <b>מאזן מדויק</b>`;
  const balance = `
<div class="card">
  <h2>מאזן היום — דרישה מול מצבה</h2>
  <div class="tbl-wrap"><table>
    <thead><tr><th>עמדה</th><th>דרישה</th><th>שובצו</th></tr></thead>
    <tbody>
${balanceRows.map((r) => `      <tr><td>${esc(r.name)}</td><td>${r.need}</td><td>${r.got}</td></tr>`).join('\n')}
    </tbody>
    <tfoot>
      <tr><td>סה"כ</td><td>${totalNeed}</td><td>${present}</td></tr>
    </tfoot>
  </table></div>
  <p style="font-size:1.02rem">${balanceSentence}</p>
  <div class="sub">שרשורים (כרמל חטיבה / כונן גשש) אינם צורכים חיילים נוספים — הם מאוישים בצוותים היורדים מהמשמרות המקבילות.</div>
</div>`;

  // ── the process section (execution order — LOGIC.he.md שלב א׳/ב׳) ──
  const process = buildProcessSection(input, { soldier, name, nameHtml, posName, restId });

  // ── stage 1: Level-1 partition table ──
  const byPos = new Map<string, string[]>();
  for (const [sid, pid] of l1Entries) byPos.set(pid, [...(byPos.get(pid) ?? []), sid]);
  const l1BadgeEntry = (sid: string): RationaleEntry | undefined => {
    for (const e of input.level1Rationale[sid] ?? []) {
      if (L1_BADGE[e.code]) return e;
    }
    return undefined;
  };
  const special = new Set([restId, homeId]);
  const l1Order = [...byPos.keys()].sort((a, b) => {
    const sa = special.has(a) ? 1 : 0, sb = special.has(b) ? 1 : 0;
    if (sa !== sb) return sa - sb;                    // מנוחה/בבית last
    if (a === homeId) return 1;
    if (b === homeId) return -1;
    return orderIndex(posName(a)) - orderIndex(posName(b))
      || posName(a).localeCompare(posName(b), 'he');
  });
  // chip tooltip: rendered rationale (or the priority cascade) + the
  // soldier's fairness numbers at pick time
  const chipTitle = (sid: string, pid: string): string => {
    const s = soldier(sid);
    const entries = input.level1Rationale[sid] ?? [];
    const why = entries.length
      ? entries.map(renderRationale).join('\n')
      : renderRationale({ code: 'fairness_pick' });
    const nums = s
      ? `לילות (7 ימים): ${s.nights7d} · שעות משוקללות: ${s.weightedHours7d.toFixed(1)}`
        + ` · פעמים בעמדה זו: ${s.positionCounts[posName(pid)] ?? 0}`
      : '';
    return nums ? `${why}\n${nums}` : why;
  };
  const l1Rows = l1Order.map((pid) => {
    const sids = byPos.get(pid)!;
    const isSpecial = special.has(pid);
    const chips = sids
      .map((sid) => ({ sid, nm: name(sid) }))
      .sort((a, b) => a.nm.localeCompare(b.nm, 'he'))
      .map(({ sid }) => {
        if (isSpecial) return `<span class="soldier">${nameHtml(sid)}</span>`;
        const e = l1BadgeEntry(sid);
        const badge = e ? L1_BADGE[e.code]! : 'הוגנות';
        return `<span class="soldier" title="${escTitle(chipTitle(sid, pid))}">` +
          `${nameHtml(sid)} <span class="badge">${esc(badge)}</span></span>`;
      })
      .join(' ');
    const need = input.demand[pid];
    return `<tr><td><b>${esc(posName(pid))}</b></td>` +
      `<td>${need !== undefined ? need : '—'}</td>` +
      `<td>${sids.length}</td><td>${chips}</td></tr>`;
  }).join('\n');

  // structural narrative bullets
  const narrative: string[] = [];
  for (const f of input.flex) {
    const nm = esc(posName(f.positionId));
    narrative.push(f.after > f.before
      ? `${nm}: הצוות הוגדל מ-${f.before} ל-${f.after} מושבים — קליטת עודף כוח אדם (כולם עובדים).`
      : `${nm}: המשמרות צומצמו מ-${f.before} ל-${f.after} מושבים בשל מחסור בכוח אדם.`);
  }
  const withCode = (code: RationaleCode) => Object.entries(input.level1Rationale)
    .filter(([, rat]) => rat.some((e) => e.code === code))
    .map(([sid]) => sid);
  const magenPlaced = withCode('magen_commander');
  if (input.magenCommander) {
    narrative.push(magenPlaced.length
      ? `מפקד המגן השבועי: <b>${esc(input.magenCommander)}</b> — שוריין למגן ומעגן את מחלקת הצוות.`
      : `מפקד המגן המוגדר (<b>${esc(input.magenCommander)}</b>) לא שובץ למגן היום — ראו חריגות.`);
  }
  const poolPicks = new Map<string, string[]>();
  for (const sid of withCode('candidate_pool')) {
    const e = (input.level1Rationale[sid] ?? []).find((x) => x.code === 'candidate_pool');
    const p = String(e?.params?.position ?? '');
    poolPicks.set(p, [...(poolPicks.get(p) ?? []), name(sid)]);
  }
  for (const [p, names] of poolPicks) {
    narrative.push(`רשימה סגורה — ${esc(p)}: ${esc(names.join(', '))} (רוטציה לפי הוגנות בין חברי הרשימה).`);
  }
  const exitSids = withCode('exit_shift_fill');
  if (exitSids.length) {
    narrative.push(`יציאות קצרות: ${esc(exitSids.map(name).join(', '))} — שובצו לעמדת משמרות בלבד, המשמרות נארזות סביב חלון היציאה.`);
  }
  for (const i of keyShortages(input.issues)) narrative.push(`⚠ ${esc(i)}`);

  const stage1 = `
<div class="card">
  <h2>שלב 1 — חלוקה יומית לעמדות</h2>
  <div class="tbl-wrap"><table class="sortable">
    <thead><tr><th>עמדה</th><th>דרישה</th><th>שובצו</th><th>חיילים</th></tr></thead>
    <tbody>
${l1Rows}
    </tbody>
  </table></div>
${narrative.length ? `  <ul class="narrative">\n${narrative.map((n) => `    <li>${n}</li>`).join('\n')}\n  </ul>` : ''}
</div>`;

  // ── stage 2: per-position shift grids ──
  type Cell =
    | { kind: 'single'; a: ReportAssignment }
    | { kind: 'pair'; out: ReportAssignment; in_: ReportAssignment };

  const autoByPos = new Map<string, ReportAssignment[]>();
  for (const a of input.assignments) {
    if (a.source !== 'auto') continue;
    const key = String(a.positionId);
    autoByPos.set(key, [...(autoByPos.get(key) ?? []), a]);
  }
  const posOrder = [...autoByPos.keys()].sort((a, b) =>
    orderIndex(posName(a)) - orderIndex(posName(b))
    || posName(a).localeCompare(posName(b), 'he'));

  const hasCode = (a: ReportAssignment, code: RationaleCode) =>
    a.rationale.some((e) => e.code === code);

  const cellHtml = (c: Cell): string => {
    if (c.kind === 'pair') {
      const handover = fmtHM(c.out.end);
      const viols = [...new Set([...c.out.violations, ...c.in_.violations])]
        .filter((v) => !v.startsWith('זוג מתחלף'));
      return `<div class="who">${nameHtml(c.out.soldierId)} → ${nameHtml(c.in_.soldierId)}</div>` +
        `<div class="why">זוג מתחלף — החלפה ב-${esc(handover)}</div>` +
        (viols.length ? `<div class="viol">⚠ ${esc(viols.join(' | '))}</div>` : '');
    }
    const a = c.a;
    const badges = a.isCommanderSeat ? ' <span class="badge cmd">מפקד</span>' : '';
    const why = pickReasonEntries(a.rationale).map((e) => esc(renderRationale(e))).join(' · ');
    return `<div class="who">${nameHtml(a.soldierId)}${badges}</div>` +
      (why ? `<div class="why">${why}</div>` : '') +
      (a.violations.length ? `<div class="viol">⚠ ${esc(a.violations.join(' | '))}</div>` : '');
  };

  const grids = posOrder.map((pid) => {
    const rows = [...autoByPos.get(pid)!].sort((a, b) => a.start - b.start || a.seatIndex - b.seatIndex);
    // merge H1 handover pairs into one cell spanning the full window
    const cells: Cell[] = [];
    const consumed = new Set<ReportAssignment>();
    for (const a of rows) {
      if (consumed.has(a)) continue;
      if (hasCode(a, 'handover_out')) {
        const partner = rows.find((b) => !consumed.has(b) && b !== a
          && hasCode(b, 'handover_in') && b.start === a.end && b.subName === a.subName);
        if (partner) {
          consumed.add(a); consumed.add(partner);
          cells.push({ kind: 'pair', out: a, in_: partner });
          continue;
        }
      }
      consumed.add(a);
      cells.push({ kind: 'single', a });
    }
    const windowOf = (c: Cell): [Minutes, Minutes] => c.kind === 'pair'
      ? [c.out.start, c.in_.end] : [c.a.start, c.a.end];
    const subOf = (c: Cell): string | null => c.kind === 'pair' ? c.out.subName : c.a.subName;
    // rows = distinct windows; a sub-position name distinguishes same-window rows
    const rowKeys = new Map<string, { win: [Minutes, Minutes]; sub: string | null; cells: Cell[] }>();
    for (const c of cells) {
      const win = windowOf(c);
      const sub = subOf(c);
      const key = `${win[0]}|${win[1]}|${sub ?? ''}`;
      const r = rowKeys.get(key) ?? { win, sub, cells: [] };
      r.cells.push(c);
      rowKeys.set(key, r);
    }
    const gridRows = [...rowKeys.values()].sort((a, b) =>
      a.win[0] - b.win[0] || (a.sub ?? '').localeCompare(b.sub ?? '', 'he'));
    const maxSeats = Math.max(...gridRows.map((r) => r.cells.length), 1);
    const head = ['משמרת', ...Array.from({ length: maxSeats }, (_, i) => `מושב ${i + 1}`)]
      .map((h) => `<th>${esc(h)}</th>`).join('');
    const body = gridRows.map((r) => {
      const label = `<b>${winHtml(r.win[0], r.win[1])}</b>` +
        (r.sub ? `<div class="why">${esc(r.sub)}</div>` : '');
      const tds = Array.from({ length: maxSeats }, (_, i) =>
        `<td>${r.cells[i] ? cellHtml(r.cells[i]) : '<span class="empty">—</span>'}</td>`).join('');
      return `<tr><td>${label}</td>${tds}</tr>`;
    }).join('\n');
    return `
  <h3>${esc(posName(pid))}</h3>
  <div class="tbl-wrap"><table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${body}
    </tbody>
  </table></div>`;
  }).join('\n');

  const stage2 = `
<div class="card">
  <h2>שלב 2 — איוש משמרות</h2>
${grids || '<p class="empty">לא נוצרו שיבוצי משמרות.</p>'}
</div>`;

  // ── chains (כרמל / כונן גשש) ──
  const chainRows = input.assignments.filter((a) => a.source === 'chain');
  const chainGroups = new Map<string, ReportAssignment[]>();
  for (const a of chainRows) {
    const key = `${a.positionId}|${a.start}|${a.end}`;
    chainGroups.set(key, [...(chainGroups.get(key) ?? []), a]);
  }
  const chainTable = [...chainGroups.values()]
    .sort((a, b) => posName(a[0].positionId).localeCompare(posName(b[0].positionId), 'he')
      || a[0].start - b[0].start)
    .map((group) => {
      const a0 = group[0];
      const chainEntry = group.flatMap((a) => a.rationale).find((e) => e.code === 'chain');
      const src = chainEntry
        ? `${esc(String(chainEntry.params?.source ?? ''))} של ${esc(String(chainEntry.params?.sourceStart ?? ''))}`
        : '—';
      const crew = [...group].sort((x, y) => x.seatIndex - y.seatIndex).map((a) => {
        const b: string[] = [];
        if (a.isCommanderSeat) b.push('<span class="badge cmd">מפקד</span>');
        if (hasCode(a, 'chain_completion')) b.push('<span class="badge warn">השלמה</span>');
        return `<span class="soldier">${nameHtml(a.soldierId)}${b.length ? ' ' + b.join(' ') : ''}</span>`;
      }).join(' ');
      return `<tr><td><b>${esc(posName(a0.positionId))}</b></td>` +
        `<td>${winHtml(a0.start, a0.end)}</td><td>${src}</td><td>${crew}</td></tr>`;
    }).join('\n');
  const chains = `
<div class="card">
  <h2>שרשורים (כרמל / כונן גשש)</h2>
${chainRows.length ? `  <div class="tbl-wrap"><table>
    <thead><tr><th>כוננות</th><th>חלון</th><th>משמרת מקור</th><th>צוות</th></tr></thead>
    <tbody>
${chainTable}
    </tbody>
  </table></div>` : '  <p class="empty">אין שיבוצים משורשרים ביום זה.</p>'}
</div>`;

  // ── exceptions: generation issues + validation findings ──
  const findingLi = (f: ReportFinding) =>
    `    <li><span class="rule-tag">${esc(f.rule)}</span>` +
    `<span class="badge ${f.severity === 'error' ? 'warn' : ''}" style="${f.severity === 'error' ? 'background:#fdecea;color:#a12622;border-color:#f5c6c2' : ''}">${f.severity === 'error' ? 'שגיאה' : 'אזהרה'}</span> ${esc(f.message)}</li>`;
  const exceptions = `
<div class="card">
  <h2>חריגות</h2>
${input.issues.length ? `  <h3>בעיות מהמחולל (${input.issues.length})</h3>
  <ul class="plain">
${input.issues.map((i) => `    <li>⚠ ${esc(i)}</li>`).join('\n')}
  </ul>` : ''}
${input.findings.length ? `  <h3>ממצאי ולידציה (${errors.length} שגיאות, ${warnings.length} אזהרות)</h3>
  <ul class="plain">
${[...errors, ...warnings].map(findingLi).join('\n')}
  </ul>` : ''}
${!input.issues.length && !input.findings.length ? '  <p class="empty">אין חריגות — היום נקי.</p>' : ''}
${input.dryRun && !input.findings.length ? '  <p class="empty">dry-run: הולידציה רצה רק לאחר שמירה.</p>' : ''}
</div>
<footer>הדוח הופק אוטומטית על ידי מחולל השבצ"ק.</footer>`;

  return htmlPage(`שבצ"ק ${input.day} — דוח חילול`,
    [header, balance, process, stage1, stage2, chains, exceptions].join('\n'));
}

// ─── the process section: execution order per LOGIC.he.md + SPEC §7 ────────

interface NameHelpers {
  soldier: (sid: number | string) => ReportSoldier | undefined;
  name: (sid: number | string) => string;
  nameHtml: (sid: number | string) => string;
  posName: (pid: number | string) => string;
  restId?: string;
}

function buildProcessSection(input: DayReportInput, h: NameHelpers): string {
  const { nameHtml, name, posName, restId } = h;

  // Level-1 rationale occurrences (the process decisions), per soldier.
  const l1Occ: { sid: string; entry: RationaleEntry }[] = [];
  for (const [sid, rat] of Object.entries(input.level1Rationale)) {
    for (const entry of rat) l1Occ.push({ sid, entry });
  }
  // Level-2/chain occurrences from the assignment rows — WITHOUT the Level-1
  // entries that buildRationale copies onto every row.
  const l2Occ: { sid: string; a: ReportAssignment; entry: RationaleEntry }[] = [];
  for (const a of input.assignments) {
    const sid = String(a.soldierId);
    const l1Codes = new Set((input.level1Rationale[sid] ?? []).map((e) => e.code));
    for (const entry of a.rationale) {
      if (!l1Codes.has(entry.code)) l2Occ.push({ sid, a, entry });
    }
  }

  /** one chip per soldier for a set of Level-1 codes, detail = rendered entry */
  const l1Chips = (codes: RationaleCode[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const { sid, entry } of l1Occ) {
      if (!codes.includes(entry.code) || seen.has(sid)) continue;
      seen.add(sid);
      const all = (input.level1Rationale[sid] ?? [])
        .filter((e) => codes.includes(e.code)).map(renderRationale).join('\n');
      out.push(`<span class="soldier" title="${escTitle(all)}">${nameHtml(sid)}` +
        ` <span class="why">${esc(renderRationale(entry))}</span></span>`);
    }
    return out;
  };
  /** chips for Level-2 occurrences: position+time context in the detail */
  const l2Chips = (codes: RationaleCode[]): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const { sid, a, entry } of l2Occ) {
      if (!codes.includes(entry.code)) continue;
      const key = `${sid}|${entry.code}|${a.start}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`<span class="soldier">${nameHtml(sid)} <span class="why">` +
        `${esc(posName(a.positionId))} ${winText([a.start, a.end])}: ${esc(renderRationale(entry))}</span></span>`);
    }
    return out;
  };
  const issuesMatching = (re: RegExp): string[] =>
    input.issues.filter((i) => re.test(i)).map((i) => `⚠ ${esc(i)}`);

  const wrapChips = (chips: string[]): string => {
    if (!chips.length) return '';
    if (chips.length > 10) {
      return `<details class="inner"><summary>${chips.length} חיילים — הצג</summary>` +
        `<div class="chips">${chips.join(' ')}</div></details>`;
    }
    return `<div class="chips">${chips.join(' ')}</div>`;
  };

  const step = (n: number, title: string, essence: string,
                chips: string[], lines: string[] = []): string => {
    const active = chips.length > 0 || lines.length > 0;
    const count = chips.length
      ? ` <span class="badge">${chips.length} חיילים</span>` : '';
    if (!active) {
      return `<details class="step muted"><summary>${n}. ${esc(title)}` +
        ` <span class="empty">— אף חייל לא הושפע היום</span></summary>` +
        `<div class="sub">${esc(essence)}</div></details>`;
    }
    return `<details class="step" open><summary>${n}. ${esc(title)}${count}</summary>` +
      `<div class="sub">${esc(essence)}</div>` +
      wrapChips(chips) +
      (lines.length ? `<ul class="plain">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>` : '') +
      `</details>`;
  };

  // 1. locks
  const lockChips = input.locks.map((l) =>
    `<span class="soldier">${nameHtml(l.soldierId)} <span class="why">` +
    `נעול ל${esc(l.positionName)}${l.kind === 'shift' ? ' (משמרת)' : ''}</span></span>`);

  // 2. seat rules (חפ"ק)
  const seatChips = l1Chips(['seat_rule']);
  const seatIssues = issuesMatching(/מושב/).filter((i) => !/לא אויש/.test(i));

  // 3. role crews (חמ"ל / מפלג)
  const roleChips = l1Chips(['role_crew']);

  // 4. closed lists (קצין מוצב) — the chips NAME the picked soldiers; the
  // context lines show the pool state and an explicit no-pick outcome
  const poolChips = l1Chips(['candidate_pool']);
  const pickedFromPool = (position: string): string[] => l1Occ
    .filter(({ entry }) => entry.code === 'candidate_pool'
      && nrm(String(entry.params?.position ?? '')) === nrm(position))
    .map(({ sid }) => name(sid));
  const poolLines = input.pools.map((p) => {
    const avail = p.members.length - p.unavailable.length;
    const picked = pickedFromPool(p.position);
    const outcome = picked.length
      ? `נבחר: <b>${esc(picked.join(', '))}</b>`
      : avail === 0
        ? '⚠ <b>לא אויש</b> — כל חברי הרשימה אינם זמינים היום (בבית)'
        : '⚠ <b>לא אויש</b> — אף חבר רשימה כשיר לא נמצא (ראו חריגות)';
    return `${esc(p.position)} — ${outcome} · רשימה של ${p.members.length} חברים,` +
      ` זמינים היום: ${avail}` +
      (p.unavailable.length ? ` (לא זמינים: ${esc(p.unavailable.join(', '))})` : '');
  });
  const poolIssues = issuesMatching(/נדרש מפקד מגן חלופי/);

  // 5. flex sizing (everyone works)
  const totalDemand = Object.values(input.demand).reduce((s, n) => s + Number(n), 0);
  const totalBase = Object.values(input.demandBefore).reduce((s, n) => s + Number(n), 0);
  const presentCount = Object.entries(input.level1)
    .filter(([, pid]) => String(pid) !== String(input.homePositionId ?? '')).length;
  const flexLines = [
    `נקודת המוצא (מאזן היום): דרישת בסיס ${totalBase} מול ${presentCount} זמינים` +
    ` → דרישה אחרי הגמישות: ${totalDemand}`,
    ...input.flex.map((f) => {
      const nm = esc(posName(f.positionId));
      return f.after > f.before
        ? `${nm}: הצוות הוגדל מ-${f.before} ל-${f.after} מושבים — קליטת עודף (כולם עובדים)`
        : `${nm}: צומצם מ-${f.before} ל-${f.after} מושבים למשמרת — מחסור בכוח אדם`;
    }),
    ...issuesMatching(/מגן: חסרים/),
  ];

  // 6. מגן commander
  const magenChips = l1Chips(['magen_commander']);
  const magenLines = [
    ...(input.magenCommander && !magenChips.length
      ? [`⚠ מפקד המגן המוגדר (${esc(input.magenCommander)}) לא שובץ למגן היום`] : []),
    ...issuesMatching(/המפקד המוגדר/),
  ];

  // 7. מגן continuity
  const contChips = l1Chips(['continuity_crew']);

  // 8. half-day exits
  const exitChips = Object.entries(input.exits).map(([sid, ws]) => {
    const e = (input.level1Rationale[sid] ?? []).find((x) => x.code === 'exit_shift_fill');
    const detail = [
      `חלון יציאה ${ws.map(winText).join(', ')}`,
      ...(e ? [renderRationale(e)] : []),
    ].join(' · ');
    return `<span class="soldier">${nameHtml(sid)} <span class="why">${esc(detail)}</span></span>`;
  });
  const exitIssues = issuesMatching(/יציאה קצרה/);

  // 9. demand fill — pass A hard quotas, pass B fairness
  const quotaChips = l1Chips(['commander_quota', 'driver_quota']);
  const fairKeyChips = (() => {
    const codes: RationaleCode[] = ['platoon_group', 'fewest_nights', 'low_load', 'position_balance', 'fairness_pick'];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const { sid, entry } of l1Occ) {
      if (!codes.includes(entry.code) || seen.has(sid)) continue;
      seen.add(sid);
      const pid = input.level1[sid];
      out.push(`<span class="soldier" title="${escTitle(renderRationale(entry))}">${nameHtml(sid)}` +
        ` <span class="why">${esc(posName(pid))}: ${esc(L1_BADGE[entry.code] ?? '')}</span></span>`);
    }
    return out;
  })();
  const fillIssues = issuesMatching(/חסרים \d+ (חיילים|מפקדים|נהגים)|הצוות מעורב/);

  // 10. chains
  const chainGroups = new Map<string, { a0: ReportAssignment; names: string[] }>();
  for (const a of input.assignments.filter((x) => x.source === 'chain')) {
    const key = `${a.positionId}|${a.start}`;
    const g = chainGroups.get(key) ?? { a0: a, names: [] };
    g.names.push(name(a.soldierId));
    chainGroups.set(key, g);
  }
  const chainLines = [...chainGroups.values()]
    .sort((a, b) => a.a0.start - b.a0.start)
    .map(({ a0, names }) => {
      const src = a0.rationale.find((e) => e.code === 'chain');
      return `${esc(posName(a0.positionId))} ${winText([a0.start, a0.end])}` +
        (src ? ` ← ${esc(String(src.params?.source ?? ''))} של ${esc(String(src.params?.sourceStart ?? ''))}` : '') +
        `: ${esc(names.join(', '))}`;
    });
  const completionChips = l2Chips(['chain_completion']);
  const chainIssues = issuesMatching(/שרשור|כרמל חטיבה .*מפקד/);

  // 11. Level-2 exceptional paths (routine picks are in שלב 2 below)
  const exceptionalChips = l2Chips([
    'pulled_from_rest', 'handover_out', 'handover_in', 'exit_packed',
    'caveat_short_rest', 'caveat_rest_lt8_long', 'caveat_rest_lt4',
    'caveat_third_night', 'caveat_no_alternative', 'caveat_exit_rest',
  ]);
  const seatEmptyIssues = issuesMatching(/לא אויש|חסום/);

  // 12. everyone works — absorb + leftovers
  const absorbChips = l1Chips(['no_rest_fill']);
  const leftoverIssues = issuesMatching(/נותר במנוחה/);
  const byDesignRest = restId
    ? input.seatReserved
      .filter((sid) => String(input.level1[sid]) === restId)
      .map((sid) => `<span class="soldier">${nameHtml(sid)}` +
        ` <span class="why">מנוחה מכוונת — שמור למושב ייעודי ללא תחליף</span></span>`)
    : [];

  const steps = [
    step(1, 'נעילות', 'שיבוצים נעולים בידי אדם נשמרים כמות שהם — המחולל מתכנן סביבם.',
      lockChips),
    step(2, 'מושבים שמורים (חפ"ק)',
      'כל מושב מאויש רק מרשימת המועמדים הייעודית שלו, לפי סדר העדיפות; אין תחליפים — מושב בלי מועמד נשאר ריק.',
      seatChips, seatIssues),
    step(3, 'צוותי תפקיד (חמ"ל / מפלג)',
      'כל בעלי התפקיד הנוכחים מאיישים את העמדה שלהם, והם מוגבלים אליה בלבד.',
      roleChips),
    step(4, 'רשימות סגורות (קצין מוצב)',
      'עמדה שמאוישת רק מרשימה קבועה מקבלת את האיוש שלה ראשונה, לפי ההוגנות בין חברי הרשימה; מפקד המגן נלקח ממנה רק באין ברירה.',
      poolChips, [...poolLines, ...poolIssues]),
    step(5, 'גמישות מושבים — כולם עובדים',
      'עודף חיילים מגדיל את צוות המגן עד 12; בחוסר — המגן נשאר במינימום (10) והסיור מצטמצם עד 3 למשמרת.',
      [], flexLines),
    step(6, 'מפקד המגן',
      'ההחלטה השבועית שנשמרה — המפקד משוריין למגן לפני כל עמדה אחרת (מלבד רשימה סגורה), והמחלקה שלו מעגנת את הצוות.',
      magenChips, magenLines),
    step(7, 'המשכיות צוות המגן',
      'צוות המגן החוזר מאתמול נשמר לעמדה לפני שכל עמדה אחרת יכולה לקחת אותו.',
      contChips),
    step(8, 'יציאות קצרות (חצי יום)',
      'יוצא ביום יציאה מקבל רק עמדת משמרות (בלי משימה יומית וכוננות), והמשמרות נארזות מחוץ לחלון היציאה.',
      exitChips, exitIssues),
    step(9, 'מילוי לפי דרישה — מכסות ואז הוגנות',
      'סבב א׳: המפקדים והנהגים הנדרשים לכל העמדות; סבב ב׳: השלמה לפי סדר העדיפויות (מנוחה → רצפים → לילות → עומס → איזון עמדות).',
      [...quotaChips, ...fairKeyChips], fillIssues),
    step(10, 'שרשורים (כרמל חטיבה / כונן גשש)',
      'הצוות היורד מהמשמרת המקבילה מאייש את הכוננות; חסר מושלם בחיילים אחרים (עדיפות למי שחזר לבסיס).',
      completionChips, [...chainLines, ...chainIssues]),
    step(11, 'איוש המשמרות — מסלולים חריגים',
      'האיוש השגרתי מוצג בשלב 2; כאן רק החריגים: משיכה ממנוחה, זוגות מתחלפים, שיבוצי בדוחק ומושבים שנשארו ריקים.',
      exceptionalChips, seatEmptyIssues),
    step(12, 'כולם עובדים — קליטת הנותרים',
      'מי שעדיין בלי עמדה מצטרף למגן (עד 12) לפני שמישהו נח; חייל זמין שנשאר במנוחה — חריגה מדווחת.',
      [...absorbChips, ...byDesignRest], leftoverIssues),
  ];

  return `
<div class="card">
  <h2>ניתוח התהליך — צעד אחר צעד (לפי כללי הלוגיקה)</h2>
  <div class="sub">סדר הצעדים הוא סדר הריצה של המחולל (שלב א׳ — חלוקה לעמדות; שרשורים; שלב ב׳ — איוש המשמרות; כולם עובדים). צעד עמום = לא השפיע היום.</div>
${steps.join('\n')}
</div>`;
}

// ─── week report ───────────────────────────────────────────────────────────

export function buildWeekReportHtml(input: WeekReportInput): string {
  const cards = input.days.map((d) => {
    const shortages = d.shortages.slice(0, 4);
    return `
  <div class="day-card">
    <h3><a href="${esc(d.file)}">${esc(dayTitle(d.day))}</a></h3>
    <div class="chips">
      <span class="chip ${d.errors ? 'err' : 'ok'}">שגיאות: ${d.errors}</span>
      <span class="chip ${d.warnings ? 'warn' : 'ok'}">אזהרות: ${d.warnings}</span>
    </div>
${shortages.length ? `    <ul>\n${shortages.map((s) => `      <li>${esc(s)}</li>`).join('\n')}\n    </ul>` : ''}
  </div>`;
  }).join('\n');

  const rows = [...input.fairness].sort((a, b) =>
    b.totalHours - a.totalHours || a.name.localeCompare(b.name, 'he'));
  const fairRows = rows.map((r) =>
    `<tr><td>${soldierNameHtml(r, r.name)}</td><td>${r.nightHours.toFixed(1)}</td>` +
    `<td>${r.hatkafiHours.toFixed(1)}</td><td>${r.totalHours.toFixed(1)}</td></tr>`).join('\n');

  const stats = (xs: number[]) => {
    if (!xs.length) return { min: 0, max: 0, avg: 0, sd: 0 };
    const min = Math.min(...xs), max = Math.max(...xs);
    const avg = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - avg) ** 2, 0) / xs.length);
    return { min, max, avg, sd };
  };
  const cols = [
    stats(rows.map((r) => r.nightHours)),
    stats(rows.map((r) => r.hatkafiHours)),
    stats(rows.map((r) => r.totalHours)),
  ];
  const footRow = (label: string, pick: (s: ReturnType<typeof stats>) => number) =>
    `<tr><td>${label}</td>${cols.map((c) => `<td>${pick(c).toFixed(1)}</td>`).join('')}</tr>`;

  const body = `
<div class="card">
  <h1>דוח שבועי — שבצ"ק ${esc(input.from)} עד ${esc(input.to)}</h1>
  <div class="sub">הופק ב-${esc(input.generatedAt)}</div>
</div>
<div class="card">
  <h2>ימים</h2>
  <div class="cards">
${cards}
  </div>
</div>
<div class="card">
  <h2>הוגנות שבועית</h2>
  <div class="tbl-wrap"><table class="sortable">
    <thead><tr><th>חייל</th><th>שעות לילה</th><th>שעות התקפי</th><th>סה"כ שעות</th></tr></thead>
    <tbody>
${fairRows}
    </tbody>
    <tfoot>
${footRow('מינימום', (s) => s.min)}
${footRow('מקסימום', (s) => s.max)}
${footRow('ממוצע', (s) => s.avg)}
${footRow('סטיית תקן', (s) => s.sd)}
    </tfoot>
  </table></div>
  <div class="sub">שעות לילה = חפיפת המשימות עם חלון 00:00–06:00 (בלי משימות יומיות שבהן ישנים ובלי כוננויות) · שעות התקפי = שעות בעמדת התקפי, כולל הכוננות (יממת כוננות = 24) · סה"כ שעות = שעות משימה בטווח, עד התקרה היומית לכל שורה (בלי כוננויות). חיילים שהיו בבית כל הטווח אינם מוצגים.</div>
</div>
<footer>הדוח הופק אוטומטית על ידי מחולל השבצ"ק.</footer>`;

  return htmlPage(`דוח שבועי ${input.from} – ${input.to}`, body);
}
