-- Remove תגבצ from the active model (owner decision, 2026-07-17): the duty is
-- gone — no templates, no staffing links, no drafts. Imported history rows
-- (24/6–16/7) still reference the position, so the row itself remains ONLY as
-- a history tombstone (is_scheduled=false, no slots) and can never be
-- scheduled again. All code/spec/seed references are removed alongside.
begin;

-- stale draft rows that still contain תגבצ windows are regenerable — drop them
delete from shift_assignments
where position_id = (select id from positions where name = 'תגבצ')
  and source in ('auto', 'chain') and not locked;
delete from day_assignments
where position_id = (select id from positions where name = 'תגבצ')
  and source in ('auto', 'chain') and not locked;

-- no concrete slots, ever
delete from slot_templates
where position_id = (select id from positions where name = 'תגבצ');

-- drop the staffing links (תגבצ ← התקפי) and the obsolete מגן package key
update positions set config = config - 'staffed_by' where name = 'תגבצ';
update positions set config = config - 'covers'     where name = 'התקפי';
update positions set config = config - 'package'    where name = 'מגן';

update positions set is_scheduled = false where name = 'תגבצ';

commit;
