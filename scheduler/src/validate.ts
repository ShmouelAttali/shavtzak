import { multiQuery, query } from './db.js';
import {
  Minutes, parseRange, dayStart, dayEnd, addDays, slotStart, overlaps, hours, fmtHM,
} from './time.js';

export interface Finding {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  soldierId?: number;
}

interface Row {
  soldierId: number;
  soldierName: string;
  positionId: number;
  positionName: string;
  missionClass: string;
  subName: string | null;
  period: [Minutes, Minutes];
  blocksOverlap: boolean;
}

const REST_MIN = 4 * 60;
const REST_IDEAL = 8 * 60;
const DAILY_CAP = 8;

/**
 * Post-hoc validation of one schedule day (SPEC §8). Rest regime follows R1:
 * < 4h gap = error, 4–8h = warning (the generation regime; a hard-8h error rule
 * would flag every legal short-task pick).
 */
export async function validateDay(day: string): Promise<Finding[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day: ${day}`);
  const yesterday = addDays(day, -1);
  const [rows, prevRows, unavailRows, dayAssignRows, soldierRows, chainRows, seatRulePosRows, daySlotRows] = await multiQuery([
    ...[day, yesterday].map((d) => `
      select sa.soldier_id, s.full_name, sa.position_id, p.name pos_name, p.mission_class,
             sp.name sub_name, sa.period::text, sa.blocks_overlap
      from shift_assignments sa
      join positions p on p.id = sa.position_id
      left join sub_positions sp on sp.id = sa.sub_position_id
      left join soldiers s on s.id = sa.soldier_id
      where sa.day = '${d}'`),
    `select soldier_id, period::text, kind from unavailability
     where period && tsrange(day_start('${day}'), day_start('${day}') + interval '1 day')`,
    `select da.soldier_id, p.name pos_name from day_assignments da
     join positions p on p.id = da.position_id where da.day = '${day}'`,
    `select id, full_name, is_schedulable, coalesce(role,'') role from soldiers`,
    `select cr.*, tp.name target_name, sp2.name source_name from chain_rules cr
     join positions tp on tp.id = cr.target_position
     join positions sp2 on sp2.id = cr.source_position order by cr.id`,
    `select id, name, config from positions where config ? 'seat_rules'`,
    `select ds.position_id, sp.name sub_name from day_slots ds
     left join sub_positions sp on sp.id = ds.sub_position_id where ds.day = '${day}'`,
  ]);

  const toRow = (r: any): Row => ({
    soldierId: r.soldier_id, soldierName: r.full_name ?? `#${r.soldier_id}`,
    positionId: r.position_id, positionName: r.pos_name, missionClass: r.mission_class,
    subName: r.sub_name, period: parseRange(r.period), blocksOverlap: r.blocks_overlap,
  });
  const today = (rows as any[]).map(toRow);
  const prev = (prevRows as any[]).map(toRow);
  const findings: Finding[] = [];
  const dRange: [Minutes, Minutes] = [dayStart(day), dayEnd(day)];

  // ── 1+2: rest & overlap over consecutive blocking, non-readiness shifts ──
  const bySoldier = new Map<number, Row[]>();
  for (const r of [...prev, ...today]) {
    if (!r.blocksOverlap || r.missionClass === 'readiness' || r.missionClass === 'rest') continue;
    (bySoldier.get(r.soldierId) ?? bySoldier.set(r.soldierId, []).get(r.soldierId)!).push(r);
  }
  for (const [sid, list] of bySoldier) {
    list.sort((a, b) => a.period[0] - b.period[0]);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (b.period[0] < dRange[0]) continue; // only judge gaps ending today
      if (overlaps(a.period, b.period)) {
        findings.push({
          severity: 'error', rule: 'overlap', soldierId: sid,
          message: `${b.soldierName}: חפיפה בין ${a.positionName} ${fmtHM(a.period[0])}-${fmtHM(a.period[1])} לבין ${b.positionName} ${fmtHM(b.period[0])}-${fmtHM(b.period[1])}`,
        });
        continue;
      }
      // R5: attack ends by ~06:00 and counts as full rest for >= 14:00 starts
      if (a.positionName === 'התקפי' && b.period[0] >= dRange[0]) continue;
      const gap = b.period[0] - a.period[1];
      if (gap < REST_MIN) {
        findings.push({
          severity: 'error', rule: 'rest', soldierId: sid,
          message: `${b.soldierName}: מנוחה ${(gap / 60).toFixed(1)}ש׳ לפני ${b.positionName} ${fmtHM(b.period[0])} (מינימום 4)`,
        });
      } else if (gap < REST_IDEAL) {
        findings.push({
          severity: 'warning', rule: 'rest', soldierId: sid,
          message: `${b.soldierName}: מנוחה קצרה ${(gap / 60).toFixed(1)}ש׳ לפני ${b.positionName} ${fmtHM(b.period[0])}`,
        });
      }
    }
  }

  // ── 2b: two simultaneous standbys (readiness × readiness) ────────────────
  const readinessBySoldier = new Map<number, Row[]>();
  for (const r of [...prev, ...today]) {
    if (r.missionClass !== 'readiness') continue;
    (readinessBySoldier.get(r.soldierId)
      ?? readinessBySoldier.set(r.soldierId, []).get(r.soldierId)!).push(r);
  }
  for (const [sid, list] of readinessBySoldier) {
    list.sort((a, b) => a.period[0] - b.period[0]);
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (b.period[0] < dRange[0]) continue;
      if (overlaps(a.period, b.period) && a.positionName !== b.positionName) {
        findings.push({
          severity: 'error', rule: 'double_readiness', soldierId: sid,
          message: `${b.soldierName}: שתי כוננויות במקביל — ${a.positionName} ${fmtHM(a.period[0])}-${fmtHM(a.period[1])} וגם ${b.positionName} ${fmtHM(b.period[0])}-${fmtHM(b.period[1])}`,
        });
      }
    }
  }

  // ── 3: chain sourcing ────────────────────────────────────────────────────
  for (const cr of chainRows as any[]) {
    const tStart = slotStart(day, String(cr.target_start).slice(0, 5));
    const targets = today.filter((r) => r.positionId === cr.target_position && r.period[0] === tStart);
    if (!targets.length) continue;
    const srcDay = addDays(day, cr.source_day_offset);
    const sStart = slotStart(srcDay, String(cr.source_start).slice(0, 5));
    const srcPool = (cr.source_day_offset === 0 ? today : prev)
      .filter((r) => r.positionId === cr.source_position && r.period[0] === sStart);
    if (!srcPool.length) {
      findings.push({
        severity: 'warning', rule: 'chain',
        message: `${cr.target_name} ${fmtHM(tStart)}: לא נמצא צוות מקור (${cr.source_name} ${String(cr.source_start).slice(0, 5)})`,
      });
      continue;
    }
    const srcIds = new Set(srcPool.map((r) => r.soldierId));
    for (const t of targets) {
      if (!srcIds.has(t.soldierId)) {
        findings.push({
          severity: 'error', rule: 'chain', soldierId: t.soldierId,
          message: `${t.soldierName} ב${cr.target_name} ${fmtHM(tStart)} אך לא ירד מ${cr.source_name} ${String(cr.source_start).slice(0, 5)}`,
        });
      }
    }
  }

  // ── 4: carmel staffing 3+1 per start ─────────────────────────────────────
  const carmel = today.filter((r) => r.positionName === 'כרמל חטיבה');
  const byStart = new Map<Minutes, Row[]>();
  for (const r of carmel) (byStart.get(r.period[0]) ?? byStart.set(r.period[0], []).get(r.period[0])!).push(r);
  for (const [start, list] of byStart) {
    const regular = list.filter((r) => r.subName !== 'מפקד כרמל חטיבה').length;
    const cmd = list.filter((r) => r.subName === 'מפקד כרמל חטיבה').length;
    if (regular < 3 || cmd < 1) {
      findings.push({
        severity: 'error', rule: 'carmel_staffing',
        message: `כרמל חטיבה ${fmtHM(start)}: ${regular} רגילים + ${cmd} מפקד (נדרש 3+1)`,
      });
    }
  }

  // ── 5: daily cap (counted hours, readiness excluded) ─────────────────────
  const capBySoldier = new Map<number, { name: string; h: number }>();
  for (const r of today) {
    if (r.missionClass === 'readiness' || r.missionClass === 'rest') continue;
    const cur = capBySoldier.get(r.soldierId) ?? { name: r.soldierName, h: 0 };
    cur.h += Math.min(hours(r.period), DAILY_CAP);
    capBySoldier.set(r.soldierId, cur);
  }
  for (const [sid, { name, h }] of capBySoldier) {
    if (h > DAILY_CAP + 0.01) {
      findings.push({
        severity: 'error', rule: 'daily_cap', soldierId: sid,
        message: `${name}: ${h.toFixed(1)} שעות משימה ביום (מקסימום ${DAILY_CAP})`,
      });
    }
  }

  // ── 6: assignment during unavailability ──────────────────────────────────
  const unavail = (unavailRows as any[]).map((u) => ({
    soldierId: u.soldier_id, period: parseRange(u.period) as [Minutes, Minutes], kind: u.kind,
  }));
  for (const r of today) {
    const hit = unavail.find((u) => u.soldierId === r.soldierId && overlaps(u.period, r.period));
    if (hit) {
      findings.push({
        severity: 'error', rule: 'availability', soldierId: r.soldierId,
        message: `${r.soldierName} משובץ ל${r.positionName} ${fmtHM(r.period[0])} למרות "${hit.kind}"`,
      });
    }
  }

  // ── 7: present but unassigned / 8: unknown soldier ───────────────────────
  const assignedDay = new Set((dayAssignRows as any[]).map((r) => r.soldier_id));
  const schedulable = new Map((soldierRows as any[]).map((s) => [s.id, { name: s.full_name, ok: s.is_schedulable }]));
  const fullyOut = new Set(unavail
    .filter((u) => u.period[0] <= dRange[0] && u.period[1] >= dRange[1])
    .map((u) => u.soldierId));
  if (assignedDay.size > 0) {
    for (const [sid, { name, ok }] of schedulable) {
      if (ok && !fullyOut.has(sid) && !assignedDay.has(sid)) {
        findings.push({
          severity: 'warning', rule: 'unassigned', soldierId: sid,
          message: `${name} זמין אך ללא שיבוץ יומי`,
        });
      }
    }
  }
  for (const r of today) {
    const s = schedulable.get(r.soldierId);
    if (!s) {
      findings.push({
        severity: 'error', rule: 'unknown_soldier', soldierId: r.soldierId,
        message: `שיבוץ לחייל לא מוכר (#${r.soldierId}) ב${r.positionName}`,
      });
    } else if (!s.ok) {
      findings.push({
        severity: 'warning', rule: 'unknown_soldier', soldierId: r.soldierId,
        message: `${s.name} משובץ אך מסומן לא-לשיבוץ (מפלג/חמ"ל)`,
      });
    }
  }

  // ── 9: seat-rule positions (H6b, e.g. חפק) ───────────────────────────────
  const nrm = (s: string) => s.replace(/[״"׳']/g, '').trim();
  for (const p of seatRulePosRows as any[]) {
    const rules: { sub: string; soldiers?: string[]; roles?: string[]; release_unpicked?: boolean }[] =
      p.config?.seat_rules ?? [];
    const posSubs = new Set((daySlotRows as any[])
      .filter((s) => s.position_id === p.id).map((s) => nrm(s.sub_name ?? '')));
    if (!posSubs.size) continue;   // position has no slots this day
    for (const rule of rules) {
      if (!posSubs.has(nrm(rule.sub))) continue;   // seat not in effect this day
      const candIds = rule.soldiers
        ? (soldierRows as any[])
            .filter((s) => rule.soldiers!.some((n) => nrm(n) === nrm(s.full_name)))
            .map((s) => s.id as number)
        : (soldierRows as any[])
            .filter((s) => (rule.roles ?? []).some((r) => nrm(r) === nrm(s.role)))
            .map((s) => s.id as number);
      const candSet = new Set(candIds);
      const seatRows = today.filter((r) => r.positionId === p.id && nrm(r.subName ?? '') === nrm(rule.sub));
      if (!seatRows.length) {
        findings.push({
          severity: 'warning', rule: 'seat_rules',
          message: `מושב ${rule.sub} ב${p.name} לא מאויש`,
        });
      }
      for (const r of seatRows) {
        if (!candSet.has(r.soldierId)) {
          findings.push({
            severity: 'error', rule: 'seat_rules', soldierId: r.soldierId,
            message: `${r.soldierName} במושב ${rule.sub} ב${p.name} אך אינו ברשימת המועמדים`,
          });
        }
      }
      // exclusivity: candidates serve only in this position; a release rule
      // frees the unchosen candidates once the seat is covered by someone else
      const seatFilled = seatRows.length > 0;
      for (const cid of candIds) {
        const isChosen = seatRows.some((sr) => sr.soldierId === cid);
        const allowedElsewhere = !!rule.release_unpicked && seatFilled && !isChosen;
        if (allowedElsewhere) continue;
        const elsewhere = today.filter((r) => r.soldierId === cid
          && r.positionId !== p.id && r.missionClass !== 'rest');
        for (const e of elsewhere) {
          findings.push({
            severity: 'error', rule: 'seat_rules', soldierId: cid,
            message: `${e.soldierName} שמור למושב ${rule.sub} ב${p.name} אך משובץ ל${e.positionName} ${fmtHM(e.period[0])}`,
          });
        }
      }
    }
  }

  return findings;
}

/** Validate and persist the snapshot on schedule_days.validation. */
export async function validateAndStore(day: string): Promise<Finding[]> {
  const findings = await validateDay(day);
  await query(`update schedule_days set validation = $2 where day = $1`,
    [day, JSON.stringify(findings)]);
  return findings;
}
