-- ============================================================================
-- Shavtzak Scheduler — seed step 2: id-based candidate lists.
-- Apply AFTER schema.sql + seed.sql + the roster import (import_history.py) —
-- these inserts resolve soldiers BY NAME once, at seed time, and store ids.
-- Any name that fails to resolve ABORTS the whole file (single transaction).
--
-- This file is the only place soldier names may appear outside the roster:
-- it is the human-editable manifest; the DB stores soldier_id FKs.
-- ============================================================================

begin;

-- SQL mirror of src/text.ts normalizeName (strip ״"׳'` + collapse whitespace)
create function pg_temp.norm(t text) returns text language sql immutable as
$$ select btrim(regexp_replace(translate(t, '״׳"''`', ''), '\s+', ' ', 'g')) $$;

create function pg_temp.soldier(n text) returns bigint language plpgsql as $$
declare sid bigint;
begin
  select id into sid from soldiers where pg_temp.norm(full_name) = pg_temp.norm(n);
  if sid is null then
    raise exception 'seed-candidates: soldier "%" not found in roster', n;
  end if;
  return sid;
end $$;

create function pg_temp.position(n text) returns smallint language plpgsql as $$
declare pid smallint;
begin
  select id into pid from positions where pg_temp.norm(name) = pg_temp.norm(n);
  if pid is null then
    raise exception 'seed-candidates: position "%" not found', n;
  end if;
  return pid;
end $$;

create function pg_temp.sub(pos text, n text) returns smallint language plpgsql as $$
declare sid smallint;
begin
  select sp.id into sid from sub_positions sp
   where sp.position_id = pg_temp.position(pos) and pg_temp.norm(sp.name) = pg_temp.norm(n);
  if sid is null then
    raise exception 'seed-candidates: sub-position "%"/"%" not found', pos, n;
  end if;
  return sid;
end $$;

-- ── קצין מוצב candidate pool (H6-pool, unordered — fairness-rotated) ────────
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select pg_temp.position('קצין מוצב'), null, pg_temp.soldier(n), null
from unnest(array[
  'שמואל אטלי', 'צבי שור', 'יוחאי יעקובסון', 'אורי שאג',
  'אלעד זיו', 'אביאל גיאת', 'עמיחי ברוורמן', 'גלעד דביר'
]) n;

-- ── חפק named seats (H6b; metadata stays in positions.config seat_rules) ────
-- קשר: ORDERED preference list (priority 1..n)
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select pg_temp.position('חפק'), pg_temp.sub('חפק', 'קשר'), pg_temp.soldier(n), ord
from unnest(array['יהודה חושן', 'אור חיים בלונדר', 'יחיעם אושפיזאי'])
     with ordinality t(n, ord);

-- חובש: unordered
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select pg_temp.position('חפק'), pg_temp.sub('חפק', 'חובש'), pg_temp.soldier(n), null
from unnest(array['כפיר לנדסמן', 'שחר מיכאלי']) n;

-- נהג: unordered
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select pg_temp.position('חפק'), pg_temp.sub('חפק', 'נהג'), pg_temp.soldier(n), null
from unnest(array['אמיר יונייב', 'יאיר מובשוביץ']) n;

-- ── H6c per-soldier position whitelists ─────────────────────────────────────
insert into soldier_allowed_positions (soldier_id, position_id)
select pg_temp.soldier(s), pg_temp.position(p)
from (values
  ('יהונתן רוט', 'עמדות הגנה'),
  ('יהונתן רוט', 'כרמל חטיבה'),
  ('יהונתן רוט', 'תורנים'),
  ('אריאל ביר',  'סיור')
) v(s, p);

-- NB: no magen_commander_history row here — that is a weekly ops decision
-- (weekly-shavtzak flow), not template seed data.

commit;
