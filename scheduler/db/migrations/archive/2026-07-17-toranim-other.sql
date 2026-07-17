-- תורנים reclassification: mission_class 'static' → 'other' — the duty exits
-- static-streak (T3) and class-alternation (T2) rotation logic entirely.
-- night_exempt stays; NO full_rest_after (R1's 4h floor applies after it).
-- The companion SOFT rule (T5: at most one תורנות per soldier per rolling
-- 7 days) lives in the generator ranking + a validator warning
-- ('second_toranut_week') — no schema change needed for it.
update positions set mission_class = 'other' where name = 'תורנים';
