#!/usr/bin/env python3
"""Unit tests for the sheet -> DB import mapping.  Run: python3 -m unittest discover scheduler/import"""
import os, sys, unittest
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from import_history import (IGNORE_SOLDIERS, PHONE_IN_NAME, canonical_position,
                            infer_period, nkey)


def period(date, position, typ, time_text):
    d = datetime.strptime(date, '%d/%m/%Y')
    canon = canonical_position(position, typ)
    return canon, infer_period(d, position, typ, time_text, canon)


class NightCutover(unittest.TestCase):
    """Before 21/07/2026 an hour < 06:00 meant the NEXT calendar morning; from
    21/07 the sheet writes the true calendar date (see NIGHT_CUTOVER)."""

    def test_before_cutover_carries_to_next_morning(self):
        _, (start, end) = period('19/07/2026', 'שג', 'עמדות הגנה', '02:00')
        self.assertEqual(start, datetime(2026, 7, 20, 2))
        self.assertEqual(end, datetime(2026, 7, 20, 6))

    def test_from_cutover_stays_on_its_own_date(self):
        _, (start, end) = period('21/07/2026', 'שג', 'עמדות הגנה', '02:00')
        self.assertEqual(start, datetime(2026, 7, 21, 2))
        self.assertEqual(end, datetime(2026, 7, 21, 6))

    def test_daytime_hours_never_carry(self):
        for date in ('19/07/2026', '25/07/2026'):
            _, (start, _) = period(date, 'שג', 'עמדות הגנה', '22:00')
            self.assertEqual(start.strftime('%d/%m/%Y %H:%M'), date + ' 22:00')

    def test_ranges_follow_the_same_rule(self):
        _, (start, end) = period('24/07/2026', 'סיור', 'סיור', '1:00-6:00')
        self.assertEqual((start, end), (datetime(2026, 7, 24, 1), datetime(2026, 7, 24, 6)))
        _, (start, end) = period('18/07/2026', 'סיור', 'סיור', '1:00-6:00')
        self.assertEqual((start, end), (datetime(2026, 7, 19, 1), datetime(2026, 7, 19, 6)))


class PositionMapping(unittest.TestCase):
    def test_hafak2_is_its_own_position(self):
        self.assertEqual(canonical_position('חפק2', 'חפק'), 'חפק2')
        self.assertEqual(canonical_position('חפק', 'חפק'), 'חפק')

    def test_ad_hoc_forces_map_to_mesimot_shonot(self):
        for name in ('כח אלישיב', 'כח אמיתי', 'כח גלעד', 'כח שאג', 'משימות שונות'):
            self.assertEqual(canonical_position(name, 'משימות שונות'), 'משימות שונות', name)
        self.assertEqual(canonical_position('תפיסת בית', 'משימות שונות'), 'משימות שונות')

    def test_konenut_hatkafi_is_hatkafi(self):
        self.assertEqual(canonical_position('כוננות התקפי', 'כוננות התקפי'), 'התקפי')

    def test_known_names_still_map_as_before(self):
        cases = [('שג', 'עמדות הגנה', 'עמדות הגנה'), ('מגן + תגבצ', 'מגן השומרון', 'מגן'),
                 ('מפקד כרמל חטיבה', 'כרמל חטיבה', 'כרמל חטיבה'), ('חמל', 'חמל', 'חמל'),
                 ('כונן גשש', 'נוספים', 'כונן גשש'), ('תורנים', 'נוספים', 'תורנים'),
                 ('קצין מוצב', 'נוספים', 'קצין מוצב'), ('סיור', 'סיור', 'סיור')]
        for pos, typ, want in cases:
            self.assertEqual(canonical_position(pos, typ), want, pos)

    def test_deep_activity_is_its_own_position_and_runs_to_the_boundary(self):
        """סוג='פעילות עומק' (from 27/07/2026): העמדה is the team, the bare 00:00
        runs to the 14:00 schedule-day boundary (owner 2026-07-26)."""
        for team in ('צוות א', 'צוות ב', 'נהג טיגריס'):
            canon, (start, end) = period('27/07/2026', team, 'פעילות עומק', '00:00')
            self.assertEqual(canon, 'פעילות עומק', team)
            self.assertEqual((start, end), (datetime(2026, 7, 27, 0), datetime(2026, 7, 27, 14)))

    def test_earlier_deep_missions_keep_their_hatkafi_attribution(self):
        """The keyword is the full 'פעילות עומק', so the older עומק missions —
        typed התקפי — must NOT be re-attributed."""
        self.assertEqual(canonical_position('פטרול עומק - אודלה', 'התקפי'), 'התקפי')
        self.assertEqual(canonical_position('פטרול עומק', 'התקפי'), 'התקפי')

    def test_daily_rows_span_the_1400_schedule_day(self):
        for pos, typ in (('חפק2', 'חפק'), ('כח גלעד', 'משימות שונות')):
            _, (start, end) = period('24/07/2026', pos, typ, 'יומי')
            self.assertEqual((start, end), (datetime(2026, 7, 24, 14), datetime(2026, 7, 25, 14)))


class SoldierColumnPlaceholders(unittest.TestCase):
    def test_hishtana_is_ignored(self):
        self.assertIn(nkey('השתנה'), {nkey(x) for x in IGNORE_SOLDIERS})

    def test_outsiders_written_with_a_phone_number_are_ignored(self):
        self.assertTrue(PHONE_IN_NAME.search('משה 058-5858823'))
        self.assertTrue(PHONE_IN_NAME.search('רומן 054-2470108'))
        self.assertIsNone(PHONE_IN_NAME.search('מנדי הלפרין'))


if __name__ == '__main__':
    unittest.main()
