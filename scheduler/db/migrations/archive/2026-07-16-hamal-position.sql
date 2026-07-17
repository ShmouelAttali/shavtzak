-- חמל becomes a scheduled standing crew: full schedule day 14:00→14:00,
-- staffed daily by every PRESENT role-חמל soldier (staff_all_roles config,
-- variable crew — no fixed demand). readiness class = rest-transparent
-- (internal shifts). The 5 role-חמל soldiers become schedulable again but
-- whitelisted to חמל only (H6c). Takes effect 2026-07-17.
begin;

update positions
set mission_class = 'readiness', is_scheduled = true,
    config = config || '{"staff_all_roles": ["חמל"]}'::jsonb
where name = 'חמל';

insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (11, '14:00', 1440, 5, '2026-07-17');

update soldiers set is_schedulable = true, allowed_positions = array['חמל']
where translate(coalesce(role,''),'"״','') = 'חמל';

commit;
