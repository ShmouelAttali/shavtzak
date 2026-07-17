-- R5 generalized: finishing a daily 14:00–14:00 task — מגן, חפק, התקפי,
-- קצין מוצב — counts as a full 8h rest for assignments starting at/after
-- 14:00 of the NEXT schedule day (a gap of 0 at the 14:00 boundary is fine).
-- מגן is included so the continuity crew can repeat back-to-back
-- (14:00→14:00 then 14:00→14:00 again, gap 0) without a rest violation.
-- תורנים is deliberately EXCLUDED: finishing תורן מטבח at 14:00 grants no
-- exemption — the normal R1 regime applies (>= 4h rest, earliest next start
-- 18:00; 4–8h allowed with warning for short tasks only).
update positions set config = config || '{"full_rest_after": true}'::jsonb
where name in ('מגן', 'חפק', 'התקפי', 'קצין מוצב');
