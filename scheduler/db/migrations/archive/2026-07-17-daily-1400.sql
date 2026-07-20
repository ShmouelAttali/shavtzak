-- Re-anchor daily missions to the schedule day (resolves SPEC §10's open
-- item): מגן and חפק move from 06:00–22:00 to 14:00–14:00 slots, **effective
-- 2026-07-19** via slot_templates versioning — NOT retroactively: imported
-- history up to 18/07 has מגן/חפק at the old hours, and the validator /
-- הוגנות dashboard runs over those days (a retroactive template change would
-- flag phantom coverage holes). Pre-cutover versions are closed at 2026-07-18
-- and mirrored as new 14:00–14:00 rows from 2026-07-19.
-- Both positions also become sleeping 24h crews: night_exempt (P2 fairness +
-- R6 consecutive nights), same treatment as תורנים / קצין מוצב.
begin;

with closed as (
  update slot_templates set valid_to = '2026-07-18'
  where position_id in (select id from positions where name in ('מגן', 'חפק'))
    and valid_from <= '2026-07-18'
    and (valid_to is null or valid_to > '2026-07-18')
  returning position_id, sub_position_id, seats, commander_first_seat
)
insert into slot_templates
  (position_id, sub_position_id, start_time, duration_minutes, seats, commander_first_seat, valid_from)
select position_id, sub_position_id, '14:00', 1440, seats, commander_first_seat, date '2026-07-19'
from closed;

update positions set config = config || '{"night_exempt": true}'::jsonb
where name in ('מגן', 'חפק');

commit;
