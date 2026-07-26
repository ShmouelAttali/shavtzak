-- A qualification is not a תפקיד (owner 2026-07-26)
--
-- The sheet's תפקיד column mixes role and qualification and import_history.py
-- copies it verbatim, so soldiers.role held נהג דוד / נהג טיגריס / חובש / נגב /
-- קלע / מט"ב for 15 soldiers. Every one of them ALSO carried the matching
-- soldier_qualifications row (verified before this ran), so the role value was
-- pure duplication — and it leaked into מצבת חיילים's now-closed תפקיד dropdown
-- as if those were roles.
--
-- Those soldiers become לוחם: nothing is lost, because the qualification lives
-- in soldier_qualifications, which is what hasQualification() and every gate
-- that matters (H6b seats, P5 driver fit, the הסמכה filter) reads. The dropdown
-- itself is fixed in api/roster.ts (mergeRoleCatalog subtracts known
-- qualifications from the OBSERVED side; declared roles are untouched).
--
-- Guarded, so it can only ever clear a role whose qualification is already
-- recorded — a soldier holding the string ONLY as a role keeps it and shows up
-- in the SELECT below for a human decision.
-- Idempotent.

begin;

update soldiers s
   set role = 'לוחם'
 where s.archived_at is null
   and translate(s.role, '"''׳״', '') in
       ('נהג דוד', 'נהג טיגריס', 'חובש', 'קלע', 'נגב', 'מאג', 'רחפן', 'מטב')
   and exists (select 1 from soldier_qualifications q
                where q.soldier_id = s.id
                  and translate(q.qualification, '"''׳״', '')
                      = translate(s.role, '"''׳״', ''));

commit;

-- Leftovers needing a human call (expected: none):
--   select s.full_name, s.role from soldiers s
--    where s.archived_at is null
--      and translate(s.role, '"''׳״', '') in
--          ('נהג דוד','נהג טיגריס','חובש','קלע','נגב','מאג','רחפן','מטב');
