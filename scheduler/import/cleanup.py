#!/usr/bin/env python3
"""
Post-import data cleanup (SPEC §11) — emits SQL on stdout. Three parts:

1. Overlap rows: the history rows rejected by no_double_booking on first import
   (יומי mission alongside a timed shift) are re-inserted with blocks_overlap=false.
   Found by recomputing the full import and diffing against what the DB holds.
2. Name dedupe: soldiers created from history-only spellings (personal_number
   IMP*) that fuzzy-match a roster soldier are merged into the roster row.
3. Unavailability: the roster's per-date status matrix is compressed into
   sparse `unavailability` periods (consecutive blocking runs merged).

Inputs:
  --history        'כל השבצק.values.csv'      (sheet export)
  --roster         'מצבת החיילים.values.csv'  (sheet export)
  --db-soldiers    CSV of `select id, personal_number, full_name from soldiers`
  --db-assignments CSV of `select s.full_name, p.name, lower(a.period), upper(a.period)
                           from shift_assignments a join soldiers s ... join positions p ...
                           where a.source='import'`

Status → unavailability mapping (calendar-day semantics; see SPEC §11):
  full-day block: חופש, לא מגויס, שחרור, גיוס, מחלה   -> [X 00:00, X+1 00:00)
  יציאה בבוקר  -> [X 08:00, X+1 00:00)
  יציאה ב14:00 -> [X 14:00, X+1 00:00)
  יציאה בערב   -> [X 18:00, X+1 08:00)
  חזרה ב14:00  -> [X 00:00, X 14:00)
  חזרה בערב    -> [X 00:00, X 20:00)
  נוכח / לא נקבע / empty / numeric junk -> available (no row)
"""
import argparse, csv, re, sys
from datetime import datetime, timedelta
from difflib import SequenceMatcher

sys.path.insert(0, __import__('os').path.dirname(__file__))
from import_history import (norm, nkey, IGNORE_SOLDIERS, canonical_position,
                            infer_period, parse_date, q)

FULL_BLOCK = {'חופש', 'לא מגויס', 'לא מגוייס', 'שחרור', 'גיוס', 'מחלה'}
PARTIAL = {
    'יציאה בבוקר':  (lambda d: (d + timedelta(hours=8),  d + timedelta(days=1))),
    'יציאה ב14:00': (lambda d: (d + timedelta(hours=14), d + timedelta(days=1))),
    'יציאה בערב':   (lambda d: (d + timedelta(hours=18), d + timedelta(days=1, hours=8))),
    'חזרה ב14:00':  (lambda d: (d,                       d + timedelta(hours=14))),
    'חזרה בערב':    (lambda d: (d,                       d + timedelta(hours=20))),
}

def ts(dt):
    return dt.strftime('%Y-%m-%d %H:%M:%S')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--history', required=True)
    ap.add_argument('--roster', required=True)
    ap.add_argument('--db-soldiers', required=True)
    ap.add_argument('--db-assignments', required=True)
    args = ap.parse_args()
    out = sys.stdout
    log = sys.stderr

    # ── DB state ────────────────────────────────────────────────────────────
    db_soldiers = {}   # nkey -> (id, pn, name)
    for r in csv.reader(open(args.db_soldiers)):
        db_soldiers[nkey(r[2])] = (int(r[0]), r[1], r[2])
    db_rows = set()    # (namekey, position, start, end)
    for r in csv.reader(open(args.db_assignments)):
        db_rows.add((nkey(r[0]), norm(r[1]), r[2][:19], r[3][:19]))

    # ── Part 2: dedupe (do first so overlap inserts use the keeper id) ──────
    merges = {}        # dup_id -> keep_id
    real = [(v[0], v[1], v[2]) for v in db_soldiers.values() if not v[1].startswith('IMP')]
    imps = [(v[0], v[1], v[2]) for v in db_soldiers.values() if v[1].startswith('IMP')]
    name_alias = {}    # nkey(dup name) -> keeper name
    for iid, ipn, iname in imps:
        best, score = None, 0.0
        for rid, rpn, rname in real:
            s = SequenceMatcher(None, nkey(iname), nkey(rname)).ratio()
            if s > score:
                best, score = (rid, rname), s
        if best and score >= 0.85:
            merges[iid] = best[0]
            name_alias[nkey(iname)] = best[1]
            log.write(f'MERGE: "{iname}" (id {iid}) -> "{best[1]}" (id {best[0]}) score={score:.2f}\n')
        else:
            log.write(f'KEEP UNMATCHED: "{iname}" (id {iid}) best score={score:.2f}\n')
    for dup, keep in merges.items():
        print(f'update shift_assignments set soldier_id = {keep} where soldier_id = {dup};', file=out)
        print(f'update day_assignments set soldier_id = {keep} where soldier_id = {dup}'
              f' and not exists (select 1 from day_assignments k where k.day = day_assignments.day'
              f' and k.soldier_id = {keep});', file=out)
        print(f'delete from day_assignments where soldier_id = {dup};', file=out)
        print(f'delete from soldier_qualifications where soldier_id = {dup};', file=out)
        print(f'delete from unavailability where soldier_id = {dup};', file=out)
        print(f'delete from soldiers where id = {dup};', file=out)

    def soldier_id_for(name):
        k = nkey(name)
        if k in name_alias:
            k = nkey(name_alias[k])
        return db_soldiers.get(k, (None,))[0]

    # ── Part 1: missing (overlap-rejected) history rows ─────────────────────
    hist = list(csv.reader(open(args.history)))
    h = [norm(c) for c in hist[0]]
    ci = {k: h.index(k) for k in ('תאריך', 'העמדה', 'סוג', 'השעה', 'החייל')}
    missing = 0
    for r in hist[1:]:
        if len(r) <= max(ci.values()):
            continue
        soldier = norm(r[ci['החייל']])
        if nkey(soldier) in {nkey(x) for x in IGNORE_SOLDIERS}:
            continue
        date = parse_date(r[ci['תאריך']])
        if not date:
            continue
        position, typ, time_text = norm(r[ci['העמדה']]), norm(r[ci['סוג']]), norm(r[ci['השעה']])
        canon = canonical_position(position, typ)
        period = infer_period(date, position, typ, time_text, canon)
        if not period:
            continue
        key = (nkey(name_alias.get(nkey(soldier), soldier)), canon,
               ts(period[0]), ts(period[1]))
        if key in db_rows:
            continue
        sid = soldier_id_for(soldier)
        if sid is None:
            log.write(f'SKIP missing row, unknown soldier: {soldier}\n')
            continue
        db_rows.add(key)
        missing += 1
        print(f"insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)"
              f" select schedule_day_of('{ts(period[0])}'::timestamp),"
              f" coalesce((select id from positions where name = {q(canon)}), 99),"
              f" {sid}, tsrange('{ts(period[0])}','{ts(period[1])}'), 'import', false;", file=out)
    log.write(f'OVERLAP ROWS RE-ADDED (blocks_overlap=false): {missing}\n')

    # ── Part 3: unavailability from roster matrix ───────────────────────────
    rows = list(csv.reader(open(args.roster)))
    hdr_i = next(i for i, r in enumerate(rows) if any(norm(c) == 'שם מלא' for c in r))
    hh = [norm(c) for c in rows[hdr_i]]
    c_name = hh.index('שם מלא')
    datecols = [(j, parse_date(rows[0][j])) for j in range(len(rows[0]))
                if parse_date(rows[0][j]) and parse_date(rows[0][j]).year >= 2026]
    n_periods = 0
    print('truncate unavailability;', file=out)
    for r in rows[hdr_i + 1:]:
        name = norm(r[c_name]) if c_name < len(r) else ''
        if not name:
            continue
        sid = soldier_id_for(name)
        if sid is None:
            continue
        # collect (start, end, kind) windows, then merge adjacent same-kind full days
        windows = []
        for j, d in datecols:
            status = norm(r[j]) if j < len(r) else ''
            if not status or status in ('נוכח', 'לא נקבע') or re.fullmatch(r'[\d.]+', status):
                continue
            if status in FULL_BLOCK:
                windows.append((d, d + timedelta(days=1), status))
            elif status in PARTIAL:
                s, e = PARTIAL[status](d)
                windows.append((s, e, status))
        windows.sort()
        merged = []
        for s, e, k in windows:
            if merged and merged[-1][2] == k and merged[-1][1] >= s:
                merged[-1] = (merged[-1][0], max(merged[-1][1], e), k)
            else:
                merged.append((s, e, k))
        for s, e, k in merged:
            n_periods += 1
            print(f'insert into unavailability (soldier_id, period, kind)'
                  f" values ({sid}, tsrange('{ts(s)}','{ts(e)}'), {q(k)});", file=out)
    log.write(f'UNAVAILABILITY PERIODS: {n_periods}\n')

if __name__ == '__main__':
    main()
