import { multiQuery, query } from './db.js';
import {
  Minutes, DAY, parseRange, dayStart, dayEnd, addDays, slotStart, scheduleDayStart,
  overlaps, hours, fmtHM, nightRange, nightRangeAt,
} from './time.js';
import { normalizeName as nrm, hasQualification } from './text.js';
import { isFullRestExempt, isCountedNight } from './rest.js';
import { loadTunables, effectiveConfig, isShiftPosition, isNightExitWindows } from './config.js';
import { roleFlags } from './load.js';
import { partialWindow } from './pairs.js';
import type { SeatRule } from './model.js';

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
  isCommanderSeat: boolean;
  source: string;
  rationale: { code: string }[];
}

/**
 * Post-hoc validation of one schedule day (SPEC §8). Rest regime follows R1:
 * < 4h gap = error, 4–8h = warning (the generation regime; a hard-8h error rule
 * would flag every legal short-task pick).
 */
export async function validateDay(day: string): Promise<Finding[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day: ${day}`);
  const yesterday = addDays(day, -1);
  const [rows, prevRows, unavailRows, dayAssignRows, soldierRows, allowedRows, candRows, subPosRows, chainRows, seatRulePosRows, daySlotRows, posRows, historyRows, configRows, qualRows, exitRows] = await multiQuery([
    ...[day, yesterday].map((d) => `
      select sa.soldier_id, s.full_name, sa.position_id, p.name pos_name, p.mission_class,
             sp.name sub_name, sa.period::text, sa.blocks_overlap, sa.is_commander_seat, sa.source, sa.rationale
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
    // H6c whitelist (soldier_allowed_positions), as position NAMES per soldier
    `select sap.soldier_id, array_agg(p.name) as names
     from soldier_allowed_positions sap join positions p on p.id = sap.position_id
     group by sap.soldier_id`,
    // id-based closed lists: position-level pools (sub null) + named seats
    `select pc.position_id, pc.sub_position_id, pc.soldier_id, pc.priority
     from position_candidates pc
     order by pc.position_id, pc.priority nulls last, pc.id`,
    `select id, position_id, name from sub_positions`,
    `select cr.*, tp.name target_name, sp2.name source_name from chain_rules cr
     join positions tp on tp.id = cr.target_position
     join positions sp2 on sp2.id = cr.source_position order by cr.id`,
    `select id, name, config from positions where config ? 'seat_rules'`,
    `select ds.position_id, sp.name sub_name, ds.period::text, ds.seats, ds.commander_first_seat
     from day_slots ds
     left join sub_positions sp on sp.id = ds.sub_position_id where ds.day = '${day}'`,
    `select id, name, is_scheduled, mission_class, config from positions`,
    // 7-day lookback for streak rules (consecutive nights R6, static streak
    // T3, weekly תורנות T5)
    `select sa.soldier_id, s.full_name, sa.period::text, p.mission_class, p.name pos_name,
            coalesce((p.config->>'night_exempt')::boolean,
                     (p.config->>'daily')::boolean, false) night_exempt
     from shift_assignments sa
     join positions p on p.id = sa.position_id
     left join soldiers s on s.id = sa.soldier_id
     where sa.period && tsrange(day_start('${addDays(day, -7)}'), day_start('${day}') + interval '1 day')
       and p.mission_class <> 'rest'`,
    `select key, value from config`,
    `select soldier_id, qualification from soldier_qualifications`,
    // H9: exit windows ±1 day, so boundary rest gaps can be attributed to the
    // exit day on either side of the 14:00 anchor
    `select soldier_id, period::text from exit_requests
     where period && tsrange(day_start('${addDays(day, -1)}'), day_start('${day}') + interval '1 day')`,
  ]);

  const config: Record<string, any> = {};
  for (const c of configRows as any[]) config[c.key] = c.value;
  const tunables = loadTunables(config);
  const REST_MIN = tunables.restMinH * 60;
  const REST_IDEAL = tunables.restIdealH * 60;
  const DAILY_CAP = tunables.dailyCapH;

  const toRow = (r: any): Row => ({
    soldierId: r.soldier_id, soldierName: r.full_name ?? `#${r.soldier_id}`,
    positionId: r.position_id, positionName: r.pos_name, missionClass: r.mission_class,
    subName: r.sub_name, period: parseRange(r.period), blocksOverlap: r.blocks_overlap,
    isCommanderSeat: r.is_commander_seat, source: r.source,
    rationale: (r.rationale ?? []) as { code: string }[],
  });
  const today = (rows as any[]).map(toRow);
  const prev = (prevRows as any[]).map(toRow);
  const findings: Finding[] = [];
  const dRange: [Minutes, Minutes] = [dayStart(day), dayEnd(day)];
  // R5 (generalized): daily-task positions whose completion grants full rest
  // for starts at/after 14:00 of the following schedule day (חפק/התקפי/קצין
  // מוצב carry full_rest_after; תורנים deliberately does not — R1 applies)
  const posConfig = new Map((posRows as any[]).map((p) => [p.id as number, effectiveConfig(p.config)]));

  // ── id-based config lookups (FK tables, owner decision 2026-07-19) ────────
  // H6c whitelist (soldier_allowed_positions): soldier -> position names;
  // absent soldier = unrestricted
  const allowedNamesBySoldier = new Map<number, string[]>(
    (allowedRows as any[]).map((r) => [r.soldier_id as number, r.names as string[]]));
  // position_candidates: seat name -> sub id, per-seat candidate rows, and
  // position-level pool member ids (sub NULL — the candidate_pool membership)
  const subIdByPosSub = new Map<string, number>(
    (subPosRows as any[]).map((sp) => [`${sp.position_id}|${nrm(sp.name)}`, sp.id as number]));
  const seatCandidateIds = (pid: number, sub: string): number[] => {
    const subId = subIdByPosSub.get(`${pid}|${nrm(sub)}`);
    return subId === undefined ? []
      : (candRows as any[])
          .filter((c) => c.position_id === pid && c.sub_position_id === subId)
          .map((c) => c.soldier_id as number);
  };
  const poolMembers = new Map<number, Set<number>>();
  for (const c of candRows as any[]) {
    if (c.sub_position_id !== null) continue;
    (poolMembers.get(c.position_id)
      ?? poolMembers.set(c.position_id, new Set()).get(c.position_id)!).add(c.soldier_id);
  }

  // H9: half-day exit windows (±1 day); "exit at minute t" = an exit window
  // touching t's schedule day
  const exits = (exitRows as any[]).map((e) => ({
    soldierId: e.soldier_id as number, period: parseRange(e.period) as [Minutes, Minutes],
  }));
  const hasExitAt = (sid: number, t: Minutes) => exits.some((e) =>
    e.soldierId === sid && e.period[1] > scheduleDayStart(t) && e.period[0] < scheduleDayStart(t) + DAY);
  const exitTodayIds = new Set(exits
    .filter((e) => overlaps(e.period, [dayStart(day), dayEnd(day)])).map((e) => e.soldierId));
  // H9 night-exit relaxation (owner 2026-07-19): ALL of a soldier's exit
  // windows today fall entirely within 22:00–06:00 → a night_exit_ok
  // position (תורנים) is additionally allowed; one exit_night_toranut
  // warning replaces the exit_window/exit_daily errors (mirrors exit_magen)
  const nightExitIds = new Set([...exitTodayIds].filter((sid) => isNightExitWindows(
    exits.filter((e) => e.soldierId === sid && overlaps(e.period, dRange)).map((e) => e.period),
    dRange[0])));

  // ── 1+2: rest & overlap over consecutive blocking, non-readiness shifts ──
  // R3: a כונן גשש NIGHT window (22:00–07:00) counts as ~gashash_effective_hours
  // of work — its effective end (window start + 1.5h) joins the rest-gap
  // search even though readiness is otherwise rest-transparent (R2).
  const gashashEnds = new Map<number, Minutes[]>();
  for (const r of [...prev, ...today]) {
    if (r.positionName !== 'כונן גשש' || !overlaps(r.period, nightRangeAt(r.period[0]))) continue;
    (gashashEnds.get(r.soldierId) ?? gashashEnds.set(r.soldierId, []).get(r.soldierId)!)
      .push(r.period[0] + tunables.gashashEffectiveHours * 60);
  }
  const bySoldier = new Map<number, Row[]>();
  for (const r of [...prev, ...today]) {
    if (!r.blocksOverlap || r.missionClass === 'readiness' || r.missionClass === 'rest') continue;
    (bySoldier.get(r.soldierId) ?? bySoldier.set(r.soldierId, []).get(r.soldierId)!).push(r);
  }
  for (const [sid, list] of bySoldier) {
    list.sort((a, b) => a.period[0] - b.period[0]);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.period[0] < dRange[0]) continue; // only judge gaps ending today
      const a = i > 0 ? list[i - 1] : null;
      if (a && overlaps(a.period, b.period)) {
        findings.push({
          severity: 'error', rule: 'overlap', soldierId: sid,
          message: `${b.soldierName}: חפיפה בין ${a.positionName} ${fmtHM(a.period[0])}-${fmtHM(a.period[1])} לבין ${b.positionName} ${fmtHM(b.period[0])}-${fmtHM(b.period[1])}`,
        });
        continue;
      }
      let prevEnd = -Infinity;
      // R5 (generalized): finishing a daily task counts as full rest for
      // starts at/after 14:00 of the schedule day following the task's own day
      if (a && !isFullRestExempt(posConfig.get(a.positionId), a.period[0], b.period[0])) {
        prevEnd = a.period[1];
      }
      for (const e of gashashEnds.get(sid) ?? []) {
        if (e <= b.period[0] && e > prevEnd) prevEnd = e;   // R3 effective end
      }
      if (prevEnd === -Infinity) continue;
      // per-position no_rest_floor (מגן/חפק/קצין מוצב): the crew is scheduled
      // internally by its officer — a soldier may join with no rest, so the
      // rest rule doesn't judge the gap before it (owner 2026-07-19)
      if (posConfig.get(b.positionId)?.no_rest_floor) continue;
      const gap = b.period[0] - prevEnd;
      if (gap < REST_MIN) {
        // R7: on an exit day the packed shifts may be back-to-back — the H8
        // floor degrades to a warning for the exit soldier (either side of
        // the 14:00 boundary)
        if (hasExitAt(sid, b.period[0]) || hasExitAt(sid, prevEnd)) {
          findings.push({
            severity: 'warning', rule: 'exit_rest', soldierId: sid,
            message: `${b.soldierName}: מנוחה ${(gap / 60).toFixed(1)}ש׳ לפני ${b.positionName} ${fmtHM(b.period[0])} — מותר בדוחק ביום יציאה קצרה`,
          });
        } else {
          findings.push({
            severity: 'error', rule: 'rest', soldierId: sid,
            message: `${b.soldierName}: מנוחה ${(gap / 60).toFixed(1)}ש׳ לפני ${b.positionName} ${fmtHM(b.period[0])} (מינימום ${tunables.restMinH})`,
          });
        }
      } else if (gap < REST_IDEAL && !posConfig.get(b.positionId)?.daily) {
        // R1 daily exception (owner, 2026-07-19): 4h rest suffices before a
        // daily 14:00–14:00 duty — the soldier sleeps inside it; no warning
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

  // ── 2c: readiness × mission overlap (H3 strict — the attack↔readiness
  // exception was removed: a soldier is either on a mission or on כוננות) ───
  for (const [sid, list] of readinessBySoldier) {
    const missions = bySoldier.get(sid) ?? [];
    for (const r of list) {
      for (const m of missions) {
        if (!overlaps(r.period, m.period)) continue;
        if (Math.max(r.period[0], m.period[0]) < dRange[0]) continue; // judge today's overlaps only
        findings.push({
          severity: 'error', rule: 'readiness_overlap', soldierId: sid,
          message: `${m.soldierName}: כוננות ${r.positionName} ${fmtHM(r.period[0])}-${fmtHM(r.period[1])} חופפת משימה ${m.positionName} ${fmtHM(m.period[0])}-${fmtHM(m.period[1])}`,
        });
      }
    }
  }

  // unavailability windows intersecting the day (used by the chain-completion
  // check in §3 and the availability check in §6)
  const unavail = (unavailRows as any[]).map((u) => ({
    soldierId: u.soldier_id, period: parseRange(u.period) as [Minutes, Minutes], kind: u.kind,
  }));

  // ── 3: chain sourcing ────────────────────────────────────────────────────
  for (const cr of chainRows as any[]) {
    const tStart = slotStart(day, String(cr.target_start).slice(0, 5));
    // carve-out (owner 2026-07-20): a bus-split ARRIVER half (`handover_in`) is
    // the post-08:00 completion of a Sunday-changeover chain window — its
    // descending-crew first half already satisfies sourcing, so the arriver is
    // exempt from the "didn't descend" check (coverage §10 still verifies it).
    const targets = today.filter((r) => r.positionId === cr.target_position && r.period[0] === tStart
      && !r.rationale.some((e) => e.code === 'handover_in'));
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
    // T4 completion (owner rule 2026-07-18): a non-source soldier is a valid
    // COMPLETION when the descending crew couldn't cover the window (members
    // went home / are otherwise booked). It is an error only when an
    // AVAILABLE source member was left unused — otherwise a warning so the
    // completion stays visible.
    const targetWindow: [Minutes, Minutes] = [tStart,
      Math.max(...targets.map((t) => t.period[1]))];
    const usedSrc = new Set(targets.filter((t) => srcIds.has(t.soldierId)).map((t) => t.soldierId));
    const availableUnused = srcPool.filter((s) =>
      !usedSrc.has(s.soldierId)
      // blocked by an unavailability window during the standby
      && !unavail.some((u) => u.soldierId === s.soldierId && overlaps(u.period, targetWindow))
      // H9: an exit-day member takes no readiness row — a completion instead
      // of him is legitimate
      && !exitTodayIds.has(s.soldierId)
      // H6c: a whitelisted member may not hold the target position at all
      && (allowedNamesBySoldier.get(s.soldierId) == null
          || allowedNamesBySoldier.get(s.soldierId)!.some((p) => nrm(p) === nrm(cr.target_name)))
      // or already holding another blocking assignment overlapping it
      && !today.some((r) => r.soldierId === s.soldierId && r.blocksOverlap
           && r.missionClass !== 'rest' && overlaps(r.period, targetWindow)
           && !(r.positionId === cr.target_position && r.period[0] === tStart)));
    // completions are legitimate only up to the crew's actual shortfall of
    // the window's seats — a redundant outsider on a fully-covered window
    // stays an error
    const needed = (daySlotRows as any[])
      .filter((ds) => ds.position_id === cr.target_position
        && parseRange(ds.period)[0] === tStart)
      .reduce((n, ds) => n + Number(ds.seats), 0) || targets.length;
    let completionsAllowed = availableUnused.length > 0 ? 0
      : Math.max(0, needed - usedSrc.size);
    for (const t of targets) {
      if (srcIds.has(t.soldierId)) continue;
      if (completionsAllowed > 0) {
        completionsAllowed--;
        findings.push({
          severity: 'warning', rule: 'chain', soldierId: t.soldierId,
          message: `${t.soldierName} ב${cr.target_name} ${fmtHM(tStart)}: השלמה מחוץ לצוות היורד (הצוות מ${cr.source_name} ${String(cr.source_start).slice(0, 5)} יצא/חסר)`,
        });
      } else {
        findings.push({
          severity: 'error', rule: 'chain', soldierId: t.soldierId,
          message: `${t.soldierName} ב${cr.target_name} ${fmtHM(tStart)} אך לא ירד מ${cr.source_name} ${String(cr.source_start).slice(0, 5)}${availableUnused.length ? ' — ויש חבר צוות זמין שלא שובץ' : ''}`,
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
  for (const r of today) {
    const hit = unavail.find((u) => u.soldierId === r.soldierId && overlaps(u.period, r.period));
    if (hit) {
      findings.push({
        severity: 'error', rule: 'availability', soldierId: r.soldierId,
        message: `${r.soldierName} משובץ ל${r.positionName} ${fmtHM(r.period[0])} למרות "${hit.kind}"`,
      });
    }
  }

  // ── 6b: H9 exit-day rules — no row inside the exit window, and no daily /
  // readiness row at all on the exit day (the soldier can't hold a 24h duty
  // or an on-call around a half-day exit). Exception — מגן stickiness (owner
  // decision 2026-07-19): a continuity crew member (he held a row of the SAME
  // continuity position yesterday — the validator's mirror of the generator's
  // yesterdayPosition test) KEEPS the crew's daily row despite the exit; both
  // errors downgrade to ONE exit_magen warning — the מגן officer covers his
  // absence internally. A fresh (non-returning) soldier on מגן with an exit
  // keeps the errors. ───────────────────────────────────────────────────────
  for (const r of today) {
    if (r.missionClass === 'rest') continue;
    const stickyRow = !!posConfig.get(r.positionId)?.continuity
      && prev.some((p) => p.soldierId === r.soldierId && p.positionId === r.positionId);
    const hit = exits.find((e) => e.soldierId === r.soldierId && overlaps(e.period, r.period));
    const dailyViol = exitTodayIds.has(r.soldierId)
      && !isShiftPosition({ missionClass: r.missionClass, config: posConfig.get(r.positionId) ?? {} });
    if (stickyRow && (hit || dailyViol)) {
      findings.push({
        severity: 'warning', rule: 'exit_magen', soldierId: r.soldierId,
        message: `${r.soldierName} ב${r.positionName} עם יציאה קצרה — באחריות מפקד ה${r.positionName}`,
      });
      continue;
    }
    // H9 night-exit relaxation: a night-exit soldier on a night_exit_ok
    // position (תורנים) — one warning instead of the two errors
    if (nightExitIds.has(r.soldierId) && posConfig.get(r.positionId)?.night_exit_ok
      && (hit || dailyViol)) {
      findings.push({
        severity: 'warning', rule: 'exit_night_toranut', soldierId: r.soldierId,
        message: `${r.soldierName} ב${r.positionName} עם יציאה קצרה לילית — באחריות מפקד ה${r.positionName}`,
      });
      continue;
    }
    if (hit) {
      findings.push({
        severity: 'error', rule: 'exit_window', soldierId: r.soldierId,
        message: `${r.soldierName} משובץ ל${r.positionName} ${fmtHM(r.period[0])}-${fmtHM(r.period[1])} בתוך חלון יציאה קצרה`,
      });
    }
    if (dailyViol) {
      findings.push({
        severity: 'error', rule: 'exit_daily', soldierId: r.soldierId,
        message: `${r.soldierName} ביציאה קצרה היום — משובץ למשימה יומית/כוננות ${r.positionName}`,
      });
    }
  }

  // ── 7: present but unassigned / 8: unknown soldier ───────────────────────
  const assignedDay = new Set((dayAssignRows as any[]).map((r) => r.soldier_id));
  const schedulable = new Map((soldierRows as any[]).map((s) => [s.id, { name: s.full_name, ok: s.is_schedulable }]));
  const fullyOut = new Set(unavail
    .filter((u) => u.period[0] <= dRange[0] && u.period[1] >= dRange[1])
    .map((u) => u.soldierId));
  // partial-day soldiers (leaver/arriver on an exchange day) are only available
  // for part of the schedule day — resting for lack of a fitting shift is
  // EXPECTED, not an everyone-works violation (owner 2026-07-20)
  const blocksBySoldier = new Map<number, [Minutes, Minutes][]>();
  for (const u of unavail) {
    const arr = blocksBySoldier.get(u.soldierId) ?? [];
    arr.push(u.period); blocksBySoldier.set(u.soldierId, arr);
  }
  const isPartialDay = (sid: number) => !!partialWindow(blocksBySoldier.get(sid) ?? [], dRange);
  if (assignedDay.size > 0) {
    for (const [sid, { name, ok }] of schedulable) {
      if (ok && !fullyOut.has(sid) && !assignedDay.has(sid)) {
        findings.push({
          severity: 'warning', rule: 'unassigned', soldierId: sid,
          message: `${name} זמין אך ללא שיבוץ יומי`,
        });
      }
    }
    // everyone works (owner rule): an available soldier bucketed to מנוחה is
    // a planning exception — every present soldier must do a shift.
    // Exception (mirrors the generator's seatRestrict skip): candidates of a
    // NON-release seat rule (e.g. the חפק מ"פ/סמ"פ commander seat) are
    // reserved to their seat with no substitutes (H6b) — the unchosen ones
    // rest BY DESIGN and are not flagged.
    const seatReserved = new Set<number>();
    for (const p of posRows as any[]) {
      for (const rule of (p.config?.seat_rules ?? []) as any[]) {
        if (rule.release_unpicked) continue;
        for (const cid of seatCandidateIds(p.id, rule.sub)) seatReserved.add(cid);
        const roles = new Set(((rule.roles ?? []) as string[]).map(nrm));
        for (const s of soldierRows as any[]) {
          if (roles.has(nrm(s.role ?? ''))) seatReserved.add(s.id);
        }
      }
    }
    for (const r of dayAssignRows as any[]) {
      if (r.pos_name !== 'מנוחה' || fullyOut.has(r.soldier_id) || seatReserved.has(r.soldier_id)
          || isPartialDay(r.soldier_id)) continue;
      const s = schedulable.get(r.soldier_id);
      if (!s?.ok) continue;
      findings.push({
        severity: 'warning', rule: 'rest_bucket', soldierId: r.soldier_id,
        message: `${s.name} במנוחה — כל חייל זמין אמור לעבוד`,
      });
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
  const soldierInfo = new Map((soldierRows as any[]).map((s) => [s.id as number, s]));
  const qualsBySoldier = new Map<number, string[]>();
  for (const q of qualRows as any[]) {
    (qualsBySoldier.get(q.soldier_id) ?? qualsBySoldier.set(q.soldier_id, []).get(q.soldier_id)!)
      .push(q.qualification);
  }
  for (const p of seatRulePosRows as any[]) {
    const rules: SeatRule[] = p.config?.seat_rules ?? [];
    const posSubs = new Set((daySlotRows as any[])
      .filter((s) => s.position_id === p.id).map((s) => nrm(s.sub_name ?? '')));
    if (!posSubs.size) continue;   // position has no slots this day
    for (const rule of rules) {
      if (!posSubs.has(nrm(rule.sub))) continue;   // seat not in effect this day
      // named candidates from position_candidates (id-matched); a seat with
      // no rows falls back to its role-based list
      const named = seatCandidateIds(p.id, rule.sub);
      const candIds = named.length
        ? named
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
        // H6b qual guard (warning): the named list stays authoritative, but a
        // seat with an expected qualification flags a mismatched occupant
        if (rule.qual) {
          const info = soldierInfo.get(r.soldierId);
          if (info && !hasQualification(qualsBySoldier.get(r.soldierId) ?? [], info.role, rule.qual)) {
            findings.push({
              severity: 'warning', rule: 'seat_qualification', soldierId: r.soldierId,
              message: `${r.soldierName} במושב ${rule.sub} ב${p.name} ללא הסמכת ${rule.qual}`,
            });
          }
        }
        // H6b commander seat: a commander:true rule must yield commander-seat rows
        if (rule.commander && !r.isCommanderSeat) {
          findings.push({
            severity: 'error', rule: 'seat_rules', soldierId: r.soldierId,
            message: `מושב ${rule.sub} ב${p.name} הוא מושב מפקד אך ${r.soldierName} אינו מסומן כמושב מפקד`,
          });
        }
      }
      // exclusivity: candidates serve only in this position; a release rule
      // frees the unchosen candidates once the seat is covered by someone else,
      // and a candidate blocked for the seat's window is excused entirely
      const seatFilled = seatRows.length > 0;
      const slotRow = (daySlotRows as any[]).find((ds) => ds.position_id === p.id
        && nrm(ds.sub_name ?? '') === nrm(rule.sub));
      const window = slotRow ? parseRange(slotRow.period) : dRange;
      for (const cid of candIds) {
        const isChosen = seatRows.some((sr) => sr.soldierId === cid);
        const blockedForSeat = unavail.some((u) => u.soldierId === cid && overlaps(u.period, window));
        const allowedElsewhere = (!!rule.release_unpicked && seatFilled && !isChosen)
          || (!isChosen && blockedForSeat);
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

  // ── 10: slot coverage — empty seats are errors (visible at the top) ──────
  const posInfo = new Map((posRows as any[]).map((p) => [p.id, p]));
  for (const ds of daySlotRows as any[]) {
    const p = posInfo.get(ds.position_id);
    if (!p || !p.is_scheduled || p.mission_class === 'rest') continue;
    if (p.config?.staff_all_roles) continue;   // variable crew — seats is a cap, not demand
    const period = parseRange(ds.period);
    // draft rows carry the sub-position; imported history rows don't — count
    // null-sub rows toward any sub-slot they overlap so published days aren't
    // falsely flagged. A seat may be covered by a replacement PAIR (H1) — two
    // rows splitting the slot at the handover — so staffing is the MINIMUM
    // concurrent row count over the slot window (a split-covered seat counts
    // as staffed; a partially-covered one does not).
    const covering = today
      .filter((r) => r.positionId === ds.position_id
        && overlaps(r.period, period)
        && (r.subName === null || nrm(r.subName) === nrm(ds.sub_name ?? '') || ds.sub_name === null))
      .map((r) => [Math.max(r.period[0], period[0]), Math.min(r.period[1], period[1])] as [Minutes, Minutes]);
    const points = [...new Set([period[0], ...covering.flat()])]
      .filter((t) => t >= period[0] && t < period[1]);
    const n = Math.min(...points.map((t) =>
      covering.filter((c) => c[0] <= t && t < c[1]).length));
    // flex positions (config.flex_seats, e.g. מגן 10-12, סיור 3-4/shift):
    // the generator may staff below the template seat count down to the flex
    // minimum — coverage is judged against that minimum
    const flexMin: number | undefined = posConfig.get(ds.position_id)?.flex_seats?.min;
    const required = flexMin !== undefined ? Math.min(ds.seats, flexMin) : ds.seats;
    if (n < required) {
      findings.push({
        severity: 'error', rule: 'coverage',
        message: `${p.name}${ds.sub_name ? ` ${ds.sub_name}` : ''} ${fmtHM(period[0])}: אוישו ${n}/${required} מושבים`,
      });
    }
  }

  // ── 11: per-soldier position whitelist (H6c) ─────────────────────────────
  // staff_all_roles derivation: a soldier whose role matches a staff_all_roles
  // position (חמל) may serve ONLY there — the implicit equivalent of an
  // explicit allowed_positions row (which, when present, still wins).
  const roleHome = new Map<string, string>();   // normalized role -> position name
  for (const p of posRows as any[]) {
    for (const role of (p.config?.staff_all_roles ?? []) as string[]) roleHome.set(nrm(role), p.name);
  }
  for (const s of soldierRows as any[]) {
    const home = roleHome.get(nrm(s.role));
    const allowed: string[] | null = allowedNamesBySoldier.get(s.id) ?? (home ? [home] : null);
    if (!allowed) continue;
    const allowedSet = new Set(allowed.map(nrm));
    for (const r of today) {
      if (r.soldierId !== s.id || r.missionClass === 'rest') continue;
      if (!allowedSet.has(nrm(r.positionName))) {
        findings.push({
          severity: 'error', rule: 'allowed_positions', soldierId: s.id,
          message: `${r.soldierName} מוגבל ל${allowed.join('/')} אך משובץ ל${r.positionName} ${fmtHM(r.period[0])}`,
        });
      }
    }
  }

  // ── 11b: H6 role gates ────────────────────────────────────────────────────
  const flagsBySoldier = new Map((soldierRows as any[]).map((s) => [s.id as number, roleFlags(s.role)]));
  for (const r of today) {
    if (r.missionClass === 'rest') continue;
    const f = flagsBySoldier.get(r.soldierId);
    if (!f) continue;
    // H6-pool: a position with config.candidate_pool (קצין מוצב) is manned
    // only from its position_candidates members (sub NULL, id-matched).
    // Import rows predate the rule — not judged.
    const hasPool = !!posConfig.get(r.positionId)?.candidate_pool;
    if (hasPool && r.source !== 'import' && !poolMembers.get(r.positionId)?.has(r.soldierId)) {
      findings.push({
        severity: 'error', rule: 'role_gate', soldierId: r.soldierId,
        message: `${r.soldierName} משובץ ל${r.positionName} אך אינו ברשימת המועמדים הקבועה`,
      });
    }
    if (!hasPool && r.positionName === 'קצין מוצב' && !f.isSeniorCommander) {
      findings.push({
        severity: 'error', rule: 'role_gate', soldierId: r.soldierId,
        message: `${r.soldierName} משובץ לקצין מוצב אך אינו סמל/מ"מ`,
      });
    }
    if (r.positionName === 'עמדות הגנה' && f.isSeniorCommander) {
      findings.push({
        severity: 'error', rule: 'role_gate', soldierId: r.soldierId,
        message: `${r.soldierName} משובץ לעמדות הגנה אך מ"מ/סמל אינם מאיישים עמדות (H6)`,
      });
    }
  }
  // commander-first-seat slots (סיור/התקפי): the commander seat is ROLE-based
  // there — a commander-seat row held by a non-commander is an error, and the
  // slot must actually carry a commander-seat row. Deliberately NOT applied
  // per-row globally: the כרמל commander seat is rifle-based (T4a) and the
  // חפק מפקד seat is gated by its own H6b role list (מ"פ/סמ"פ), which
  // roleFlags doesn't classify. Skipped when every covering row is an
  // imported history row (imports carry no seat metadata) or the slot is
  // entirely unstaffed (coverage flags that already).
  for (const ds of daySlotRows as any[]) {
    if (!ds.commander_first_seat) continue;
    const period = parseRange(ds.period);
    const covering = today.filter((r) => r.positionId === ds.position_id && overlaps(r.period, period));
    if (!covering.length || covering.every((r) => r.source === 'import')) continue;
    for (const r of covering) {
      if (r.isCommanderSeat && !flagsBySoldier.get(r.soldierId)?.isCommander) {
        findings.push({
          severity: 'error', rule: 'role_gate', soldierId: r.soldierId,
          message: `${r.soldierName} במושב מפקד ב${r.positionName} ${fmtHM(r.period[0])} אך אינו מפקד`,
        });
      }
    }
    if (!covering.some((r) => r.isCommanderSeat)) {
      findings.push({
        severity: 'error', rule: 'role_gate',
        message: `${posInfo.get(ds.position_id)?.name ?? ds.position_id} ${fmtHM(period[0])}: אין מפקד במשמרת (המושב הראשון הוא מושב מפקד)`,
      });
    }
  }

  // ── 11c: H6d driver requirement — every crew of a position with
  // config.driver_qual (סיור → נהג דוד, התקפי → נהג טיגריס) must include a
  // qualified driver. Import rows predate the rule — crews that are entirely
  // imported are excused.
  //
  // Driver-shortage PRIORITY (owner 2026-07-24): when נהג דוד are too few for
  // every crew, the scarce drivers stay with the EARLIER-starting crews —
  // noon (14:00) keeps its driver longest, then night (22:00), and the morning
  // (06:00) crew is the first to go without. Chronological start order == this
  // priority (14:00 < 22:00 < 06:00-next). A driverless crew is therefore only
  // a WARNING when (a) the driver pool is genuinely exhausted — no idle
  // qualified driver could have covered the crew's window — AND (b) the
  // driverless crews are exactly the lowest-priority (latest-starting) ones. A
  // driver that was available/skipped, or a lower-priority crew that kept a
  // driver while a higher-priority one went without (priority violated), stays
  // an ERROR. ────────────────────────────────────────────────────────────────
  for (const p of posRows as any[]) {
    const dq: string | undefined = posConfig.get(p.id)?.driver_qual;
    if (!dq) continue;
    const crews = new Map<Minutes, Row[]>();
    for (const r of today) {
      if (r.positionId !== p.id) continue;
      (crews.get(r.period[0]) ?? crews.set(r.period[0], []).get(r.period[0])!).push(r);
    }
    if (!crews.size) continue;
    // shift priority = chronological start order (0 = keep a driver longest)
    const rankOf = new Map([...crews.keys()].sort((a, b) => a - b).map((s, i) => [s, i]));
    const crewHasDriver = (crew: Row[]) => crew.some((r) => hasQualification(
      qualsBySoldier.get(r.soldierId) ?? [], soldierInfo.get(r.soldierId)?.role ?? '', dq));
    // qualified drivers present today who are genuinely IDLE — no non-rest
    // assignment anywhere today, so the daily cap did not already spend them on
    // another crew; only such a driver could have covered a driverless crew
    const busyToday = new Set(today.filter((r) => r.missionClass !== 'rest').map((r) => r.soldierId));
    const idleDrivers = [...soldierInfo.keys()].filter((sid) => {
      const info = soldierInfo.get(sid);
      return !!info && info.is_schedulable && !busyToday.has(sid)
        && hasQualification(qualsBySoldier.get(sid) ?? [], info.role ?? '', dq);
    });
    const blockedDuring = (sid: number, w: [Minutes, Minutes]) =>
      unavail.some((u) => u.soldierId === sid && overlaps(u.period, w));
    for (const [start, crew] of crews) {
      if (crew.every((r) => r.source === 'import')) continue;
      if (crewHasDriver(crew)) continue;
      const window = crew[0].period;
      const rank = rankOf.get(start)!;
      // a qualified driver was free to cover THIS crew but wasn't used
      const skipped = idleDrivers.some((sid) => !blockedDuring(sid, window));
      // priority violated: a lower-priority (later) crew kept a driver while
      // this higher-priority crew went without
      const priorityViolated = [...crews.entries()].some(([s2, c2]) =>
        rankOf.get(s2)! > rank && crewHasDriver(c2));
      const exhaustedLowest = !skipped && !priorityViolated;
      findings.push({
        severity: exhaustedLowest ? 'warning' : 'error', rule: 'driver',
        message: exhaustedLowest
          ? `${p.name} ${fmtHM(start)}: אין ${dq} בצוות — מאגר ה${dq} מוצה, זו משמרת בעדיפות הנמוכה ביותר`
          : `${p.name} ${fmtHM(start)}: אין ${dq} בצוות`,
      });
    }
  }

  // ── 12: consecutive nights (R6): 2 in a row = warning, 3+ = error.
  // night_exempt 24h duties (מגן/חפק/תורנים/קצין מוצב) span 00-06 but the
  // soldier sleeps — they do not count as nights (same exemption as P2). ────
  const history = (historyRows as any[]).map((r) => ({
    soldierId: r.soldier_id as number,
    name: (r.full_name ?? `#${r.soldier_id}`) as string,
    missionClass: r.mission_class as string,
    positionName: r.pos_name as string,
    nightExempt: r.night_exempt as boolean,
    period: parseRange(r.period) as [Minutes, Minutes],
  }));
  const countsAsNight = (h: { missionClass: string; nightExempt: boolean }) =>
    isCountedNight(h.missionClass, h.nightExempt);
  const hasNight = (sid: number, d: string) => history.some((h) =>
    h.soldierId === sid && countsAsNight(h) && overlaps(h.period, nightRange(d)));
  const tonight = new Map<number, string>();
  for (const h of history) {
    if (countsAsNight(h) && overlaps(h.period, nightRange(day))) tonight.set(h.soldierId, h.name);
  }
  for (const [sid, name] of tonight) {
    let run = 1;
    while (run <= 7 && hasNight(sid, addDays(day, -run))) run++;
    if (run === 2) {
      findings.push({
        severity: 'warning', rule: 'consecutive_nights', soldierId: sid,
        message: `${name}: לילה שני ברצף`,
      });
    } else if (run >= 3) {
      findings.push({
        severity: 'error', rule: 'consecutive_nights', soldierId: sid,
        message: `${name}: ${run} לילות ברצף (מקסימום 2)`,
      });
    }
  }

  // ── 13: static streak (T3): 3rd static-only day without a dynamic break ──
  const staticOnly = (sid: number, d: string): boolean => {
    const dr: [Minutes, Minutes] = [dayStart(d), dayEnd(d)];
    let hasStatic = false, hasDynamic = false;
    for (const h of history) {
      if (h.soldierId !== sid || h.missionClass === 'readiness' || !overlaps(h.period, dr)) continue;
      if (h.missionClass === 'static') hasStatic = true;
      if (h.missionClass === 'dynamic') hasDynamic = true;
    }
    return hasStatic && !hasDynamic;
  };
  const activeToday = new Map<number, string>();
  for (const h of history) {
    if (overlaps(h.period, dRange)) activeToday.set(h.soldierId, h.name);
  }
  for (const [sid, name] of activeToday) {
    if (!staticOnly(sid, day)) continue;
    let streak = 0;
    while (streak < 7 && staticOnly(sid, addDays(day, -(streak + 1)))) streak++;
    if (streak >= 2) {
      findings.push({
        severity: 'warning', rule: 'static_streak', soldierId: sid,
        message: `${name}: ${streak + 1} ימי עמדה ברצף ללא יום דינמי`,
      });
    }
  }

  // ── 13a: sub-position rotation (P4b, soft): a soldier should man a
  // DIFFERENT static post each shift within one schedule day ────────────────
  {
    const seen = new Map<string, { name: string; sub: string; periods: [Minutes, Minutes][] }>();
    for (const r of today) {
      if (r.missionClass !== 'static' || r.source === 'import' || !r.subName) continue;
      const key = `${r.soldierId}|${r.positionId}|${nrm(r.subName)}`;
      const cur = seen.get(key) ?? { name: r.soldierName, sub: r.subName, periods: [] };
      cur.periods.push(r.period);
      seen.set(key, cur);
    }
    for (const [key, { name, sub, periods }] of seen) {
      // CONTIGUOUS same-post rows are one continuous stint (an unavoidable
      // back-to-back exit pair stays at one post by design) — count stints
      const sorted = [...periods].sort((a, b) => a[0] - b[0]);
      let stints = 1;
      for (let i = 1; i < sorted.length; i++) if (sorted[i][0] > sorted[i - 1][1]) stints++;
      if (stints < 2) continue;
      findings.push({
        severity: 'warning', rule: 'sub_rotation', soldierId: Number(key.split('|')[0]),
        message: `${name}: ${sorted.length} משמרות באותה עמדה (${sub}) באותה יממה`,
      });
    }
  }

  // ── 13b: on-call streak (T6, soft): 3+ consecutive days of ONLY static +
  // readiness (התקפי/כרמל) work — the soldier is in constant on-call ────────
  const onCallPosNames = new Set((posRows as any[]).filter((p) => p.config?.on_call).map((p) => p.name));
  const onCallOnly = (sid: number, d: string): boolean => {
    const dr: [Minutes, Minutes] = [dayStart(d), dayEnd(d)];
    let hasOnCall = false, hasOther = false;
    for (const h of history) {
      if (h.soldierId !== sid || !overlaps(h.period, dr)) continue;
      if (onCallPosNames.has(h.positionName)) hasOnCall = true;
      else hasOther = true;
    }
    return hasOnCall && !hasOther;
  };
  for (const [sid, name] of activeToday) {
    if (!onCallOnly(sid, day)) continue;
    let streak = 0;
    while (streak < 7 && onCallOnly(sid, addDays(day, -(streak + 1)))) streak++;
    if (streak >= 2) {
      findings.push({
        severity: 'warning', rule: 'oncall_streak', soldierId: sid,
        message: `${name}: ${streak + 1} ימים ברצף של עמדות/כוננות בלבד (זמינות מתמדת)`,
      });
    }
  }

  // ── 14: weekly תורנות (T5, soft): 2+ תורנות days within 7 days = warning ──
  const toranToday = new Map<number, string>();
  for (const h of history) {
    if (h.positionName === 'תורנים' && overlaps(h.period, dRange)) toranToday.set(h.soldierId, h.name);
  }
  for (const [sid, name] of toranToday) {
    const hadPrior = [1, 2, 3, 4, 5, 6].some((d) => {
      const dr: [Minutes, Minutes] = [dayStart(addDays(day, -d)), dayEnd(addDays(day, -d))];
      return history.some((h) => h.soldierId === sid && h.positionName === 'תורנים' && overlaps(h.period, dr));
    });
    if (hadPrior) {
      findings.push({
        severity: 'warning', rule: 'second_toranut_week', soldierId: sid,
        message: `${name}: תורנות שנייה בתוך 7 ימים`,
      });
    }
  }

  // ── 15: config-role/qualification lint — soldier NAMES left the config
  // (position_candidates FKs make dangling names impossible), but role and
  // qualification STRINGS remain data keys: every role in staff_all_roles /
  // seat_rules[].roles must match at least one roster soldier's role, and
  // every qualification in driver_qual / seat_rules[].qual must match at
  // least one soldier (soldier_qualifications rows, or the role free-text —
  // mirroring hasQualification, the gate that actually selects). An unmatched
  // string means the gate can never pick anyone — a data bug, not a
  // preference. ─────────────────────────────────────────────────────────────
  {
    const rosterRoles = new Set((soldierRows as any[]).map((s) => nrm(s.role ?? '')));
    const lintRoles = (pos: string, listName: string, roles: string[]) => {
      for (const r of roles) {
        if (!rosterRoles.has(nrm(r))) {
          findings.push({
            severity: 'warning', rule: 'config_roles',
            message: `${pos}: התפקיד "${r}" ב-${listName} לא תואם אף חייל במצבת — הכלל לא יבחר אף אחד`,
          });
        }
      }
    };
    const lintQual = (pos: string, listName: string, qual: string) => {
      const anyMatch = (soldierRows as any[]).some((s) =>
        hasQualification(qualsBySoldier.get(s.id) ?? [], s.role ?? '', qual));
      if (!anyMatch) {
        findings.push({
          severity: 'warning', rule: 'config_roles',
          message: `${pos}: ההסמכה "${qual}" ב-${listName} לא תואמת אף חייל במצבת — הכלל לא יבחר אף אחד`,
        });
      }
    };
    for (const p of posRows as any[]) {
      lintRoles(p.name, 'staff_all_roles', (p.config?.staff_all_roles ?? []) as string[]);
      if (p.config?.driver_qual) lintQual(p.name, 'driver_qual', p.config.driver_qual);
      for (const r of (p.config?.seat_rules ?? []) as SeatRule[]) {
        lintRoles(p.name, `seat_rules/${r.sub}`, r.roles ?? []);
        if (r.qual) lintQual(p.name, `seat_rules/${r.sub}`, r.qual);
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
