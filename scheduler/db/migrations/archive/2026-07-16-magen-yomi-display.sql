-- מגן is a daily continuity crew — its card shows no shift times (יומי layout).
update positions set config = config || '{"yomi_display": true}'::jsonb
where name = 'מגן';
