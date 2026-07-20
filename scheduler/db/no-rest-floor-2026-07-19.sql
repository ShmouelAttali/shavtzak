-- Per-position no_rest_floor (owner decision 2026-07-19): מגן, חפק and
-- קצין מוצב are scheduled INTERNALLY by their officer, so a soldier may be
-- assigned to the daily row with no rest at all — the 4h H8 floor does not
-- apply to entering these duties (התקפי already has this via readiness
-- rest-transparency; תורנים keeps the normal rest regime). Idempotent —
-- safe to re-run. Mirrors db/seed.sql.
update positions set config = config || '{"no_rest_floor": true}'::jsonb
where name in ('מגן', 'חפק', 'קצין מוצב');
