-- Split the Level-1 rest bucket: soldiers whose unavailability covers the whole
-- schedule day now land in בבית; מנוחה = actually resting on base.
insert into positions (id, name, mission_class, is_scheduled, blocks_day, config)
values (13, 'בבית', 'rest', true, false, '{}')
on conflict do nothing;

-- H2: role חמל is excluded from scheduling entirely (no חמל shift logic yet)
update soldiers set is_schedulable = false
where translate(coalesce(role,''),'"״','') = 'חמל';
