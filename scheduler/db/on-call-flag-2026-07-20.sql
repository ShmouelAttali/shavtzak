-- T6 on-call scope (owner 2026-07-20): "on-call" = התקפי + עמדות הגנה only.
-- חמל / כרמל / כונן גשש are readiness but must NOT count toward the
-- constant-availability streak. Mark the two on-call positions with a
-- config.on_call flag (the code reads config.on_call, not mission_class).
update positions set config = config || '{"on_call":true}'::jsonb
where name in ('התקפי', 'עמדות הגנה');
