-- ── חמל: manual-only, per-shift via day-scoped slot_templates (2026-07-24) ───
-- One-off idempotent delta for the live Supabase DB. The consolidated baseline
-- (db/schema.sql + db/seed.sql) already carries the same end state for fresh
-- builds. Safe to re-run.
--
-- REPLACES the earlier bespoke per-shift design (dropped table
-- position_day_shifts + a full-day חמל slot_template). New model:
--
--  * חמל is MANUAL-ONLY (positions.is_scheduled=false): the generator never
--    auto-fills it. staff_all_roles config is KEPT (drives חמל-tab auth in
--    api/admins.ts + the H6c role whitelist).
--  * On-demand shift windows = DAY-SCOPED slot_templates rows (position=חמל,
--    valid_from = valid_to = the schedule day), written by the חמל tab — the
--    generic "add a shift on this one day" mechanism. חמל keeps NO permanent
--    template, so a virgin day emits no חמל slot.
--  * Picks stay ordinary shift_assignments rows (source='manual', locked=true,
--    blocks_overlap=false) — these do NOT FK slot_templates, so dropping חמל's
--    permanent template below is safe and leaves existing manual picks intact.

begin;

-- 1. Drop the bespoke structure table (its role moves to day-scoped slot_templates).
drop table if exists position_day_shifts;

-- 2. חמל becomes manual-only.
update positions set is_scheduled = false where name = 'חמל';

-- 3. Remove חמל's permanent full-day slot_template (no permanent חמל templates).
--    Day-scoped ones (valid_from = valid_to) written by the tab are untouched
--    only if they somehow pre-exist; the full-day baseline row had
--    valid_from < valid_to (open-ended valid_to), so this removes it. Restrict
--    to non-day-scoped rows to preserve any day-scoped structure already saved.
delete from slot_templates
 where position_id = (select id from positions where name = 'חמל')
   and (valid_to is null or valid_to <> valid_from);

-- 4. Seed the default חמל shift windows (idempotent).
insert into config (key, value) values
  ('hamal_default_shifts',
   '[{"start":"14:00","end":"22:00"},{"start":"22:00","end":"06:00"},{"start":"06:00","end":"14:00"}]')
on conflict (key) do nothing;

commit;
