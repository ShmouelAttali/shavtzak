import { multiQuery } from './db.js';
import { Context, Soldier, Position, Slot, Fairness, ChainRule } from './model.js';
import { parseRange, dayStart, dayEnd, addDays, overlaps, nightRange, Minutes } from './time.js';
import { normalizeName } from './text.js';
import { isCountedNight } from './rest.js';
import { loadTunables, effectiveConfig } from './config.js';

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
  const [, posRows, soldierRows, fairRows, slotRows, existRows, ydayRows,
    blockRows, lockShiftRows, lockDayRows, chainRows, configRows] = await multiQuery([
    `insert into schedule_days (day) values ('${day}') on conflict do nothing`,
    `select id, name, mission_class, is_scheduled, config from positions`,
    `select s.id, s.full_name, s.platoon, coalesce(s.role,'') role,
            coalesce(s.rifle_level,0) rifle, s.allowed_positions,
            coalesce(array_agg(q.qualification) filter (where q.qualification is not null), '{}') quals
     from soldiers s
     left join soldier_qualifications q on q.soldier_id = s.id
     where s.is_schedulable
     group by s.id`,
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
    `select soldier_id, position_id, period::text from shift_assignments
     where day = '${day}' and (locked or source in ('manual','import'))`,
    `select soldier_id, position_id from day_assignments
     where day = '${day}' and (locked or source = 'manual')`,
    `select * from chain_rules order by id`,
    `select key, value from config`,
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
      allowedPositions: r.allowed_positions ?? null,
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
  // soldier had ONLY static missions and/or readiness (התקפי/כרמל) — no
  // dynamic task and no daily duty. Such a soldier is in constant on-call;
  // a 3rd day like that is avoided (ranking demotion + validator warning).
  const onCallStreak = new Map<number, number>();
  for (const [sid, list] of existing) {
    let streak = 0;
    for (let d = 1; d <= 7; d++) {
      const dr: [Minutes, Minutes] = [dayStart(addDays(day, -d)), dayEnd(addDays(day, -d))];
      let hasOnCall = false, hasOther = false;
      for (const a of list) {
        if (!overlaps(a.period, dr)) continue;
        if (a.missionClass === 'static' || a.missionClass === 'readiness') hasOnCall = true;
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

  // T5 (soft): תורנות count per soldier in the rolling 7 days before `day`.
  const toranutCount7d = new Map<number, number>();
  const toranimId = positionByName.get('תורנים');
  if (toranimId !== undefined) {
    const tw: [Minutes, Minutes] = [dayStart(addDays(day, -7)), dayStart(day)];
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

  const lockedShift = lockShiftRows
    .map((r) => ({ soldierId: r.soldier_id, positionId: r.position_id, period: parseRange(r.period) as [Minutes, Minutes] }));
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
    yesterdayPosition, staticStreak, onCallStreak, nightStreak, toranutCount7d, blocked,
    lockedShift, lockedDay, chainRules, config, tunables: loadTunables(config),
  };
}
