-- ── חמל tab (Task 8, 2026-07-24) ────────────────────────────────────────────
-- Dedicated manual-assignment tab for the חמל crew.
--
-- Model (owner decision): "manual replaces auto-staffing". A day that has any
-- manual/locked חמל rows is authoritative — the generator SKIPS its auto
-- role-based (staff_all_roles) fill for that day (see scheduler/src/level1.ts
-- and level2.ts). The picks are stored as ordinary shift_assignments +
-- day_assignments rows (position = חמל, source='manual', locked=true), so the
-- generator's persist step never deletes them and they flow straight into the
-- main שבצק/report display like any other row.
--
-- Access (owner decision, revised 2026-07-24): NO separate members table.
-- A "חמל member" is any soldier whose role is one of the חמל position's
-- config.staff_all_roles, matched to the logged-in user by soldiers.email
-- (see api/admins.ts). This reuses the roster we already have; soldier emails
-- are populated from the מצבת החיילים sheet. The index below serves the
-- case-insensitive email lookup used by the auth check.

drop table if exists hamal_members;   -- superseded by the soldiers.email + role derivation

create index if not exists soldiers_email_lower_idx on soldiers (lower(email));
