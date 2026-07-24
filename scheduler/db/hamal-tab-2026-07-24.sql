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
-- Access: the חמל tab is visible to scheduler admins (shavtzak_admins) OR to
-- חמל members. חמל membership is a SEPARATE table (not an is_hamal column on
-- shavtzak_admins) on purpose: a חמל member is NOT a scheduler admin and must
-- NOT gain the other scheduler tabs — keeping the two lists distinct means the
-- admins.ts point-lookup for isShavtzakAdmin stays a pure shavtzak_admins query.
create table if not exists hamal_members (
  email    text primary key,     -- lowercased
  note     text,
  added_at timestamp not null default timezone('Asia/Jerusalem', now())
);

-- Manage membership by hand in the Supabase dashboard, e.g.:
--   insert into hamal_members (email, note) values ('someone@example.com', 'חמל');
