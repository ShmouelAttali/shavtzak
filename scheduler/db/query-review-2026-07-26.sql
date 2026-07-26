-- ============================================================================
-- Query review — schema delta (2026-07-26)
-- Spec: ../SPEC.md
--
-- Standalone LIVE-DB delta — NOT a migration to replay. Apply ONCE to Supabase
-- (via the supabase-access skill). The consolidated baseline (db/schema.sql)
-- has been updated to match — tests rebuild from schema.sql (freshSchema), so
-- this file is only for the already-built live database.
--
-- Nothing here changes RESULTS — index changes, a function body rewritten to
-- identical semantics, and a dead function dropped:
--   1. seat_overrides (slot_template_id) — cover the cascade FK.
--   2. slot_templates (position_id, valid_from) where day-scoped — the one
--      access path the existing GiST exclusion deliberately does NOT index.
--   3. drop exit_requests_soldier_period — 100% duplicated by the exclusion
--      constraint's own index.
--   4. soldiers ((normalized full_name)) — the name resolution in
--      api/exit-requests.ts, today a full scan + JS compare.
--
-- KNOWN PRE-EXISTING DRIFT (benign, NOT touched here): the live seats>=0 check
-- on seat_overrides is named `seat_overrides_seats_nonneg` (added by
-- seat-overrides-hourly-2026-07-19.sql), while a fresh schema.sql build names
-- the equivalent inline check `seat_overrides_seats_check`. Same predicate,
-- different name — see db/seat-overrides-drop-stale-check-2026-07-26.sql.
-- ============================================================================

-- 1. seat_overrides.slot_template_id: cover the ON DELETE CASCADE FK ──────────
-- The column is only the 4th member of seat_overrides_uniq (position_id,
-- valid_from, start_time, slot_template_id), so nothing can lead with it:
--   * every `delete from slot_templates ...` (the מבנה יומי / חמל tabs delete
--     the day's day-scoped templates wholesale on each save) has to seq-scan
--     seat_overrides once per deleted row to enforce the cascade;
--   * day_slots' correlated `o.slot_template_id = st.id` probe runs per slot.
-- Partial: a null slot_template_id is the classic position/start_time override
-- and is never looked up by this column.
create index if not exists seat_overrides_template
  on seat_overrides (slot_template_id) where slot_template_id is not null;

-- 2. slot_templates: index the DAY-SCOPED rows ────────────────────────────────
-- The only index leading with position_id is the slot_templates_no_overlap
-- exclusion GiST — and its predicate is `where (valid_from is distinct from
-- valid_to)`, i.e. it excludes EXACTLY the day-scoped rows (valid_from =
-- valid_to) that the חמל + מבנה יומי tabs write and read on every request:
--   api/hamal.ts:        position_id = $1 and valid_from = valid_to
--                        and valid_from between $2 and $3
--   api/day-structure.ts: valid_from = $1 and valid_to = $1
--                        and position_id = any($2)   (delete, twice per save)
-- Same partial predicate as the exclusion's complement, so the two indexes
-- partition the table between them.
create index if not exists slot_templates_day_scoped
  on slot_templates (position_id, valid_from) where valid_from = valid_to;

-- 3. drop the duplicated exit_requests index ─────────────────────────────────
-- `exit_requests_no_overlap exclude using gist (soldier_id with =, period
-- with &&)` is backed by an implicit gist(soldier_id, period) index — byte for
-- byte the same structure exit_requests_soldier_period built a second time.
-- Every write paid for both. Lookups keep using the exclusion's index.
drop index if exists exit_requests_soldier_period;

-- 4. normalized-name index on soldiers ───────────────────────────────────────
-- MUST STAY IN LOCKSTEP WITH normalizeName() in scheduler/src/text.ts:
--     (s ?? '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim()
-- The SQL below is an exact mirror, verified character class by character
-- class against the JS (incl. NBSP U+00A0 and BOM U+FEFF, which JS's \s
-- matches but Postgres's \s does not — hence they are translated to a plain
-- space instead of being deleted, and the following \s+ collapse absorbs them):
--     translate  from = NBSP, BOM, ״, ", ׳, ', `
--                to   = two spaces → NBSP/BOM become ' ', the five quote
--                       characters have no counterpart and are DELETED
--     regexp_replace \s+ → ' '   (JS .replace(/\s+/g, ' '))
--     btrim                      (JS .trim(); after the collapse only plain
--                                 spaces can be left at the edges)
-- All three functions are IMMUTABLE, so this is index-able.
-- Caller: api/exit-requests.ts resolveSoldier() — its normalized fallback
-- currently reads the WHOLE roster and compares in JS. With this index the
-- lookup is `where <expr> = $1` passing normalizeName(name) as the parameter.
-- Not unique: two different rows CAN normalize to the same key (only
-- full_name itself is unique), and resolveSoldier picks the first match.
create index if not exists soldiers_name_normalized on soldiers (
  (btrim(regexp_replace(
     translate(full_name, chr(160) || chr(65279) || '״"׳''`', '  '),
     '\s+', ' ', 'g')))
);
