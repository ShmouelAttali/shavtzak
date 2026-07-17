-- Roster-matrix semantics fix: the bus leaves/arrives at 10:00, not midnight.
-- Full-day home blocks shift +10h on both ends: a departing soldier works
-- until 10:00 of his first home day; a returnee is available from 10:00 of
-- his first present day (no rest needed — rest counts from his last shift).
update unavailability
set period = tsrange(lower(period) + interval '10 hours',
                     upper(period) + interval '10 hours')
where kind in ('חופש','לא מגויס','לא מגוייס','שחרור','גיוס','מחלה')
  and extract(hour from lower(period)) = 0
  and extract(hour from upper(period)) = 0;
