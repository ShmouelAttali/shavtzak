-- Draft lifecycle delta (2026-07-24) — Tasks 6 & 7.
-- Standalone live-DB delta; the same columns are folded into the consolidated
-- baseline (db/schema.sql). Apply once to the live DB; NEVER replay onto a
-- schema.sql-built database.
--
-- Task 6: persist the self-contained generation report HTML in the DB so the
--         draft UI can re-open it any time (GET /api/report).
-- Task 7A: publish flow — approved_by already existed; add published_at.
--          Publish = status 'generated' -> 'published' (+ approved_by, published_at);
--          unpublish reverts. Generating a 'published' day is refused (409).

alter table schedule_days add column if not exists report_html  text;
alter table schedule_days add column if not exists published_at  timestamptz;
