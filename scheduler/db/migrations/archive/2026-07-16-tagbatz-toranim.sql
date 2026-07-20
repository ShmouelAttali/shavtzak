-- 1) תגבצ disabled for now: is_scheduled=false — its slots leave day_slots for
--    all days, so the התקפי crew no longer staffs תגבצ windows (revert by
--    flipping the flag back).
-- 2) תורנים becomes a full schedule day 14:00→14:00 (was 07:30–22:00) to align
--    with the general rotation. Takes effect 2026-07-17.
-- 3) קצין מוצב likewise 14:00→14:00 (was 06:00–22:00) — it has no hours, it's
--    the whole day. Takes effect 2026-07-17.
begin;

update positions set is_scheduled = false where name = 'תגבצ';

update slot_templates set valid_to = '2026-07-16'
where position_id in (7, 9) and valid_to is null;

insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (7, '14:00', 1440, 2, '2026-07-17'),
       (9, '14:00', 1440, 1, '2026-07-17');

commit;
