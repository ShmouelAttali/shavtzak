import { multiQuery } from './db.js';
import { Context, Soldier, Position, Slot, Fairness, ChainRule } from './model.js';
import { parseRange, dayStart, dayEnd, addDays, overlaps, nightRange, weekStart, isSunday, Minutes } from './time.js';
import { normalizeName } from './text.js';
import { isCountedNight } from './rest.js';
import { loadTunables, effectiveConfig, isOnCall } from './config.js';

/** H6 role parsing: מ"מ/סמל = senior commander; מ"כ/מ"ח = static commander. */
export function roleFlags(role: string) {
  const r = normalizeName(role);
  const has = (...kw: string[]) => kw.some((k) => r.includes(k));
  const isSenior = has('ממ', 'מ״מ', 'סמל') || /(^|\s)מ מ(\s|$)/.test(r);
  const isStaticCmd = has('מכ', 'מח');
  return { isCommander: isSenior || isStaticCmd, isSeniorCommander: isSenior };
}

export async function loadContext(day: string): Promise<Context> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`bad day: ${day}`);
  const winFrom = addDays(day, -8);
  const yesterday = addDays(day, -1);
  const tomorrow = addDays(day, 1);

  // ONE round trip for everything — per-query round trips (and per-connection
  // TLS handshakes) dominate wall-clock over the WAN pooler. Day literals are
  // regex-validated above; no user input reaches this SQL.
  const [, posRows, candRows, soldierRows, allowedRows, magenRows, fairRows, slotRows, existRows, ydayRows,
    blockRows, exitRows, lockShiftRows, lockDayRows, chainRows, configRows, nextMagenRows] = await multiQuery([
    `insert into schedule_days (day) values ('${day}') on conflict do nothing`,
    `select id, name, mission_class, is_scheduled, config from positions`,
    // id-based closed lists (position_candidates); the name is joined for
    // display only — it rides along even for non-schedulable members
    `select pc.position_id, pc.sub_position_id, pc.soldier_id, pc.priority, s.full_name
     from position_candidates pc join soldiers s on s.id = pc.soldier_id
     order by pc.position_id, pc.priority nulls last, pc.id`,
    `select s.id, s.full_name, s.platoon, coalesce(s.role,'') role,
            coalesce(s.rifle_level,0) rifle,
            coalesce(array_agg(q.qualification) filter (where q.qualification is not null), '{}') quals
     from soldiers s
     left join soldier_qualifications q on q.soldier_id = s.id
     where s.is_schedulable
     group by s.id`,
    // H6c whitelist (soldier_allowed_positions): loaded as position NAMES so
    // allowedIn()'s name comparison stays unchanged; no rows = unrestricted
    `select sap.soldier_id, array_agg(p.name) as names
     from soldier_allowed_positions sap join positions p on p.id = sap.position_id
     group by sap.soldier_id`,
    // the מגן-commander decision effective for this day (weekly history)
    `select h.soldier_id, s.full_name
     from magen_commander_history h join soldiers s on s.id = h.soldier_id
     where h.valid_from <= '${day}'
     order by h.valid_from desc limit 1`,
    `select * from soldier_fairness('${day}')`,
    `select ds.position_id, ds.sub_position_id, sp.name sub_name, ds.period::text, ds.seats, ds.commander_first_seat
     from day_slots ds left join sub_positions sp on sp.id = ds.sub_position_id
     where ds.day = '${day}'`,
    // NB: the day's own auto/chain unlocked rows are EXCLUDED — regeneration
    // replaces them; including them makes every soldier look already-assigned.
    `select sa.soldier_id, sa.position_id, sa.period::text, p.mission_class
     from shift_assignments sa join positions p on p.id = sa.position_id
     where sa.period && tsrange(day_start('${winFrom}'), day_start('${tomorrow}'))
       and not (sa.day = '${day}' and sa.source in ('auto','chain') and not sa.locked)`,
    `select soldier_id, position_id from day_assignments where day = '${yesterday}'`,
    `select soldier_id, period::text from unavailability
     where period && tsrange(day_start('${day}'), day_start('${day}') + interval '1 day')`,
    `select soldier_id, period::text from exit_requests
     where period && tsrange(day_start('${day}'), day_start('${day}') + interval '1 day')`,
    `select soldier_id, position_id, sub_position_id, seat_index, period::text from shift_assignments
     where day = '${day}' and (locked or source in ('manual','import'))`,
    `select soldier_id, position_id from day_assignments
     where day = '${day}' and (locked or source = 'manual')`,
    `select * from chain_rules order by id`,
    `select key, value from config`,
    // the INCOMING week's מגן-commander decision (effective for tomorrow) —
    // used only when tomorrow is a Sunday: the Sunday-08:00 crew changeover
    // falls inside today's (Saturday's) schedule day, and the arriving crew
    // halves follow the incoming week's commander + מחלקה
    `select h.soldier_id, s.full_name
     from magen_commander_history h join soldiers s on s.id = h.soldier_id
     where h.valid_from <= '${tomorrow}'
     order by h.valid_from desc limit 1`,
  ]);

  const positions = new Map<number, Position>();
  const positionByName = new Map<string, number>();
  for (const p of posRows) {
    positions.set(p.id, {
      id: p.id, name: p.name, missionClass: p.mission_class,
      isScheduled: p.is_scheduled,
      config: effectiveConfig(p.config),   // daily:true implies its flag set
    });
    positionByName.set(p.name, p.id);
  }
  for (const c of candRows) {
    const p = positions.get(c.position_id);
    if (!p) continue;
    (p.candidates ??= []).push({
      subPositionId: c.sub_position_id, soldierId: c.soldier_id,
      name: c.full_name, priority: c.priority,
    });
  }

  const allowedBySoldier = new Map<number, string[]>(
    allowedRows.map((r) => [r.soldier_id, r.names]));
  const soldiers = new Map<number, Soldier>();
  for (const r of soldierRows) {
    const flags = roleFlags(r.role);
    const quals: string[] = r.quals;
    soldiers.set(r.id, {
      id: r.id, name: r.full_name, platoon: r.platoon, role: r.role, rifle: r.rifle,
      quals, ...flags,
      // the roster sheet has no qualifications column — driver info arrives as
      // the role (תפקיד), so check both the quals table and the role itself
      isDudDriver: [...quals, r.role].some((q) => normalizeName(q).includes('נהג דוד')),
      isTigerDriver: [...quals, r.role].some((q) => normalizeName(q).includes('נהג טיגריס')),
      allowedPositions: allowedBySoldier.get(r.id) ?? null,
    });
  }

  const fairness = new Map<number, Fairness>();
  for (const f of fairRows) {
    fairness.set(f.soldier_id, {
      nightCount7d: Number(f.night_count_7d),
      nightCountTotal: Number(f.night_count_total),
      missionHours7d: Number(f.mission_hours_7d),
      weightedHours7d: Number(f.weighted_hours_7d),
      readinessHours7d: Number(f.readiness_hours_7d),
      trackerHoursTotal: Number(f.tracker_hours_total),
      positionCounts: f.position_counts ?? {},
    });
  }

  const slots: Slot[] = slotRows.map((s) => ({
      positionId: s.position_id, subPositionId: s.sub_position_id, subName: s.sub_name,
      period: parseRange(s.period), seats: s.seats, commanderFirstSeat: s.commander_first_seat,
    }));

  // Existing assignments in the rest/rotation window (history + prior drafts).
  const existing = new Map<number, { positionId: number; period: [Minutes, Minutes]; missionClass: string }[]>();
  for (const a of existRows) {
    const list = existing.get(a.soldier_id) ?? [];
    list.push({ positionId: a.position_id, period: parseRange(a.period), missionClass: a.mission_class });
    existing.set(a.soldier_id, list);
  }

  // Yesterday's Level-1 position: prefer day_assignments, fall back to the
  // dominant (longest) non-readiness shift of yesterday.
  const yesterdayPosition = new Map<number, number>();
  for (const r of ydayRows) {
    yesterdayPosition.set(r.soldier_id, r.position_id);
  }
  if (yesterdayPosition.size === 0) {
    const yr: [Minutes, Minutes] = [dayStart(yesterday), dayEnd(yesterday)];
    for (const [sid, list] of existing) {
      let best: { positionId: number; h: number } | null = null;
      for (const a of list) {
        if (a.missionClass === 'readiness' || !overlaps(a.period, yr)) continue;
        const h = Math.min(a.period[1], yr[1]) - Math.max(a.period[0], yr[0]);
        if (!best || h > best.h) best = { positionId: a.positionId, h };
      }
      if (best) yesterdayPosition.set(sid, best.positionId);
    }
  }

  // Static-only streak (days ending yesterday, up to 7 back).
  const staticStreak = new Map<number, number>();
  for (const [sid, list] of existing) {
    let streak = 0;
    for (let d = 1; d <= 7; d++) {
      const dr: [Minutes, Minutes] = [dayStart(addDays(day, -d)), dayEnd(addDays(day, -d))];
      let hasStatic = false, hasDynamic = false;
      for (const a of list) {
        if (a.missionClass === 'readiness' || !overlaps(a.period, dr)) continue;
        if (a.missionClass === 'static') hasStatic = true;
        if (a.missionClass === 'dynamic') hasDynamic = true;
      }
      if (hasStatic && !hasDynamic) streak++;
      else break;
    }
    if (streak) staticStreak.set(sid, streak);
  }

  // On-call streak (T6, soft): consecutive days ending yesterday where the
  // soldier had ONLY on-call work (config.on_call — התקפי + עמדות הגנה) and no
  // other assignment. Such a soldier is in constant availability; a 3rd day
  // like that is avoided (ranking demotion + validator warning).
  const onCallPositions = new Set([...positions.values()].filter(isOnCall).map((p) => p.id));
  const onCallStreak = new Map<number, number>();
  for (const [sid, list] of existing) {
    let streak = 0;
    for (let d = 1; d <= 7; d++) {
      const dr: [Minutes, Minutes] = [dayStart(addDays(day, -d)), dayEnd(addDays(day, -d))];
      let hasOnCall = false, hasOther = false;
      for (const a of list) {
        if (!overlaps(a.period, dr)) continue;
        if (onCallPositions.has(a.positionId)) hasOnCall = true;
        else hasOther = true;
      }
      if (hasOnCall && !hasOther) streak++;
      else break;
    }
    if (streak) onCallStreak.set(sid, streak);
  }

  // Consecutive-night streak (R6): days ending yesterday where the soldier
  // held a non-readiness assignment overlapping that day's night window.
  // night_exempt 24h duties (מגן/חפק/תורנים/קצין מוצב — the soldier sleeps)
  // span 00-06 but do not count as nights.
  const isNight = (a: { positionId: number; missionClass: string }) =>
    isCountedNight(a.missionClass, positions.get(a.positionId)?.config?.night_exempt);
  const nightStreak = new Map<number, number>();
  for (const [sid, list] of existing) {
    let streak = 0;
    for (let d = 1; d <= 7; d++) {
      const nr = nightRange(addDays(day, -d));
      if (list.some((a) => isNight(a) && overlaps(a.period, nr))) streak++;
      else break;
    }
    if (streak) nightStreak.set(sid, streak);
  }

  // T5 (soft): תורנות count per soldier in the CURRENT schedule week (from
  // its Sunday 14:00 — empty on a Sunday; fairness is judged per week only).
  const toranutCount7d = new Map<number, number>();
  const toranimId = positionByName.get('תורנים');
  if (toranimId !== undefined) {
    const tw: [Minutes, Minutes] = [dayStart(weekStart(day)), dayStart(day)];
    for (const [sid, list] of existing) {
      const n = list.filter((a) => a.positionId === toranimId
        && a.period[0] >= tw[0] && a.period[0] < tw[1]).length;
      if (n) toranutCount7d.set(sid, n);
    }
  }

  // Unavailability windows intersecting the schedule day.
  const blocked = new Map<number, [Minutes, Minutes][]>();
  for (const u of blockRows) {
    const list = blocked.get(u.soldier_id) ?? [];
    list.push(parseRange(u.period));
    blocked.set(u.soldier_id, list);
  }

  // H9: approved half-day exit windows — kept separately (the exit day gets
  // special packing) AND merged into blocked so every availability check
  // excludes the window itself.
  const exits = new Map<number, [Minutes, Minutes][]>();
  for (const e of exitRows) {
    const p = parseRange(e.period);
    exits.set(e.soldier_id, [...(exits.get(e.soldier_id) ?? []), p]);
    blocked.set(e.soldier_id, [...(blocked.get(e.soldier_id) ?? []), p]);
  }

  const lockedShift = lockShiftRows
    .map((r) => ({
      soldierId: r.soldier_id, positionId: r.position_id,
      subPositionId: r.sub_position_id ?? null, seatIndex: r.seat_index,
      period: parseRange(r.period) as [Minutes, Minutes],
    }));
  const lockedDay = new Map<number, number>();
  for (const r of lockDayRows) {
    lockedDay.set(r.soldier_id, r.position_id);
  }

  const chainRules: ChainRule[] = chainRows.map((c) => ({
    targetPosition: c.target_position, targetStart: String(c.target_start).slice(0, 5),
    sourcePosition: c.source_position, sourceStart: String(c.source_start).slice(0, 5),
    sourceDayOffset: c.source_day_offset, pick: c.pick,
  }));

  const config: Record<string, any> = {};
  for (const c of configRows) config[c.key] = c.value;

  return {
    day, soldiers, positions, positionByName, slots, fairness, existing,
    yesterdayPosition, staticStreak, onCallStreak, nightStreak, toranutCount7d, blocked, exits,
    lockedShift, lockedDay, chainRules,
    magenCommander: magenRows[0]
      ? { soldierId: magenRows[0].soldier_id, name: magenRows[0].full_name }
      : undefined,
    // incoming-week מגן commander (used only when tomorrow is a Sunday)
    nextMagenCommander: isSunday(tomorrow) && nextMagenRows[0]
      ? { soldierId: nextMagenRows[0].soldier_id, name: nextMagenRows[0].full_name }
      : undefined,
    config, tunables: loadTunables(config),
  };
}
