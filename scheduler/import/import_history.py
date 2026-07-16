#!/usr/bin/env python3
"""
One-time import: sheet CSV exports -> scheduler DB (SQL on stdout).

Inputs (CSV exports of the Google Sheet tabs):
  --roster   'מצבת החיילים.values.csv'  -> soldiers
  --history  'כל השבצק.values.csv'      -> shift_assignments (source='import')

Time inference mirrors the Apps Script engine v2.6 / validator rules:
  * single time  -> duration by type: סיור 8h, עמדות הגנה 4h, כרמל 4h (22:00 -> 8h), חמל 8h
  * 'יומי'       -> 06:00-22:00; for כוננות/כרמל 'יומי' -> full readiness day
  * range 'a-b'  -> as given (end <= start -> +24h)
  * כונן גשש     -> 05:30 -> 05:30 next day ; תורן -> 07:30-22:00
Times before 06:00 belong to the next calendar morning of the row's date
(the sheet's convention), then each row lands in the 14:00-anchored schedule day
via schedule_day_of() in the DB.
"""
import argparse, csv, re, sys, unicodedata
from datetime import datetime, timedelta

QUOTES = re.compile(r'[״"\'׳`]')

def norm(s):
    if s is None:
        return ''
    s = unicodedata.normalize('NFC', str(s))
    s = s.replace(' ', ' ').replace('﻿', '')
    s = re.sub(r'[‎‏‪-‬]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def nkey(s):
    return QUOTES.sub('', norm(s)).lower()

IGNORE_SOLDIERS = {'', 'הפלוגה הקודמת', 'על בסיס מגן'}

# position-name keywords -> canonical position name (order matters).
# NB: 'מגן' MUST precede 'תגבצ' — the position 'מגן' contains both.
POSITION_MAP = [
    ('גשש',        'כונן גשש'),
    ('תורן',       'תורנים'),
    ('קצין מוצב',  'קצין מוצב'),
    ('כרמל',       'כרמל חטיבה'),
    ('כוננות',     'התקפי'),
    ('חמל',        'חמל'),
    ('מגן',        'מגן'),
    ('תגבצ',       'תגבצ'),
    ('סיור',       'סיור'),
]
DEFENSE_POSTS = {'שג', 'בונקר', 'מזרחית', 'דרומית'}

# qualifications hide in the roster's תפקיד (when it isn't a command role) and
# in the free-text הערות column ('מאג + קלע.', 'מ"כ + נגביסט', 'רחפן - יולי').
# 'נגב' also matches 'נגביסט'.
QUAL_KEYWORDS = ['נהג דוד', 'נהג טיגריס', 'חובש', 'קלע', 'נגב', 'מאג', 'רחפן', 'מטב']

def extract_quals(role, notes):
    text = nkey(role) + ' | ' + nkey(notes)
    return {q for q in QUAL_KEYWORDS if nkey(q) in text}

def canonical_position(position, typ):
    text = nkey(position + ' ' + typ)
    if nkey(position) in {nkey(p) for p in DEFENSE_POSTS} or 'עמדות הגנה' in text:
        return 'עמדות הגנה'
    for kw, name in POSITION_MAP:
        if nkey(kw) in text:
            return name
    if 'התקפי' in text:
        return 'התקפי'
    return 'התקפי' if 'פטרול' in text or 'צ׳קפוסט' in text else 'אחר'

SINGLE_TIME_DURATION = {'סיור': 8, 'עמדות הגנה': 4, 'כרמל': 4, 'חמל': 8, 'כרמל חטיבה': 4}

def parse_time(text):
    m = re.match(r'^(\d{1,2})[:.](\d{2})', text)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r'^(\d{1,2})$', text)
    if m:
        return int(m.group(1)), 0
    return None

def parse_date(text):
    text = norm(text)
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y'):
        try:
            return datetime.strptime(text, fmt).replace(hour=0, minute=0, second=0)
        except ValueError:
            pass
    return None

def infer_period(date, position, typ, time_text, canon):
    """Return (start,end) datetimes or None."""
    t = norm(time_text).replace('–', '-').replace('—', '-')
    t = re.sub(r'(\d{1,2}:\d{2}):00', r'\1', t)

    def at(h, m=0, plus_days=0):
        d = date + timedelta(days=plus_days)
        return d.replace(hour=h, minute=m)

    if canon == 'כונן גשש':
        return at(5, 30), at(5, 30, 1)
    if canon == 'תורנים':
        return at(7, 30), at(22, 0)

    if 'יומי' in t or not t:
        if canon in ('התקפי', 'כרמל חטיבה'):
            return at(6, 0), at(6, 0, 1)          # readiness full day (old anchor)
        return at(6, 0), at(22, 0)

    if '-' in t:
        parts = [p.strip() for p in t.split('-', 1)]
        s, e = parse_time(parts[0]), parse_time(parts[1])
        if s and e is not None and e:
            carry = 1 if s[0] < 6 else 0
            start = at(s[0], s[1], carry)
            end = at(e[0], e[1], carry)
            if end <= start:
                end += timedelta(days=1)
            return start, end
        return None

    s = parse_time(t)
    if not s:
        return None
    carry = 1 if s[0] < 6 else 0
    start = at(s[0], s[1], carry)
    if canon == 'כרמל חטיבה' and s[0] == 22:
        return start, start + timedelta(hours=8)
    if canon == 'התקפי' or 'התקפי' in nkey(typ):
        return start, at(6, 0, 1)
    hours = SINGLE_TIME_DURATION.get(norm(typ)) or SINGLE_TIME_DURATION.get(canon)
    if not hours:
        return None
    return start, start + timedelta(hours=hours)

def q(s):
    return "'" + s.replace("'", "''") + "'"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--roster')
    ap.add_argument('--history', required=True)
    args = ap.parse_args()

    out = sys.stdout
    soldiers = {}          # nkey -> (name, personal_number)

    if args.roster:
        rows = list(csv.reader(open(args.roster)))
        header_idx = next(i for i, r in enumerate(rows) if any(norm(c) == 'שם מלא' for c in r))
        h = [norm(c) for c in rows[header_idx]]
        c_name, c_pn = h.index('שם מלא'), (h.index('מספר אישי') if 'מספר אישי' in h else None)
        c_platoon = h.index('מחלקה') if 'מחלקה' in h else None
        c_role = h.index('תפקיד') if 'תפקיד' in h else None
        c_rifle = h.index('רובאי') if 'רובאי' in h else None
        c_notes = h.index('הערות') if 'הערות' in h else None
        for r in rows[header_idx + 1:]:
            name = norm(r[c_name]) if c_name < len(r) else ''
            if not name or nkey(name) in {nkey(x) for x in IGNORE_SOLDIERS}:
                continue
            pn = norm(r[c_pn]) if c_pn is not None and c_pn < len(r) else ''
            platoon = norm(r[c_platoon]) if c_platoon is not None and c_platoon < len(r) else ''
            role = norm(r[c_role]) if c_role is not None and c_role < len(r) else ''
            rifle = re.sub(r'\D', '', norm(r[c_rifle])) if c_rifle is not None and c_rifle < len(r) else ''
            notes = norm(r[c_notes]) if c_notes is not None and c_notes < len(r) else ''
            if nkey(name) not in soldiers:
                soldiers[nkey(name)] = (name, pn, platoon, role, rifle, extract_quals(role, notes))

    hist = list(csv.reader(open(args.history)))
    h = [norm(c) for c in hist[0]]
    ci = {k: h.index(k) for k in ('תאריך', 'העמדה', 'סוג', 'השעה', 'החייל')}

    assignments, skipped, days = [], [], set()
    for i, r in enumerate(hist[1:], start=2):
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
            skipped.append((i, position, typ, time_text))
            continue
        if nkey(soldier) not in soldiers:
            soldiers[nkey(soldier)] = (soldier, '', '', '', '', set())
        assignments.append((soldier, canon, period))

    # emit SQL (no wrapping transaction: genuine overlaps in manual history data
    # should fail row-by-row against no_double_booking, not abort the import)
    print("insert into positions (id, name, mission_class) values (99,'אחר','other')"
          ' on conflict do nothing;', file=out)
    for idx, (name, pn, platoon, role, rifle, _quals) in enumerate(soldiers.values(), start=1):
        pn2 = pn or f'IMP{idx:04d}'
        print(f'insert into soldiers (personal_number, full_name, platoon, role, rifle_level)'
              f' values ({q(pn2)}, {q(name)}, {q(platoon or "לא ידוע")}, {q(role)},'
              f' {rifle or "null"}) on conflict (personal_number) do nothing;', file=out)
    # H2: role חמל is excluded from scheduling (no חמל shift logic yet)
    print("update soldiers set is_schedulable = false"
          " where translate(coalesce(role,''),'\"״','') = 'חמל';", file=out)
    for name, _pn, _platoon, _role, _rifle, quals in soldiers.values():
        for qual in sorted(quals):
            print(f'insert into soldier_qualifications (soldier_id, qualification)'
                  f' select id, {q(qual)} from soldiers where full_name = {q(name)}'
                  f' on conflict do nothing;', file=out)
    for soldier, canon, (start, end) in assignments:
        sd = start.date() if start.hour >= 14 or (start.hour == 14 and start.minute >= 0) else start.date() - timedelta(days=1)
        days.add(sd)
    for d in sorted(days):
        print(f"insert into schedule_days (day, status) values ('{d}','published')"
              ' on conflict do nothing;', file=out)
    for soldier, canon, (start, end) in assignments:
        blocks = 'false' if canon in ('התקפי', 'כרמל חטיבה', 'כונן גשש') else 'true'
        print(f'insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)'
              f' select schedule_day_of({q(start.isoformat(sep=" "))}::timestamp),'
              f" coalesce((select id from positions where name = {q(canon)}), 99),"
              f' (select id from soldiers where full_name = {q(soldier)} limit 1),'
              f' tsrange({q(start.isoformat(sep=" "))}, {q(end.isoformat(sep=" "))}),'
              f" 'import', {blocks};", file=out)
    print(f'-- imported: {len(assignments)} assignments, {len(soldiers)} soldiers, '
          f'{len(days)} days; skipped {len(skipped)} rows', file=out)
    for row in skipped[:20]:
        print(f'-- skipped: {row}', file=out)

if __name__ == '__main__':
    main()
