// Structured "why was this soldier picked" rationale, captured by the
// generator at decision time and persisted as jsonb on shift_assignments.
// Entries are {code, params} — Hebrew wording lives ONLY in the templates
// below, so text can change without regenerating drafts.
//
// This module is intentionally import-free: the frontend bundles it directly
// (RationalePopup renders entries client-side), and Vite must not have to
// resolve scheduler-style './x.js' specifiers.

export type RationaleCode =
  // reasons (✓)
  | 'continuity_crew'       // returning member of a continuity crew (מגן)
  | 'commander_quota'       // picked in the position's Level-1 commander quota
  | 'rotation_switch'       // T-rules satisfied: different position than yesterday
  | 'rotation_break_static' // T3 bonus: dynamic task breaks a static streak
  | 'rest_ok'               // full rest before the shift
  | 'duty_rest'             // R5 generalized: finished a daily task — full rest from 14:00
  | 'handover_out'          // H1 pair: departing half — serves until the handover
  | 'handover_in'           // H1 pair: arriving half — takes over at the handover
  | 'no_prior'              // no earlier shift nearby — fully rested
  | 'fewest_nights'         // at/below the candidate group's night median (P2)
  | 'low_load'              // at/below the candidate group's load median (P3)
  | 'commander_seat'        // seat requires a commander
  | 'pulled_from_rest'      // completed from the מנוחה pool
  | 'seat_rule'             // dedicated-candidate seat (H6b, e.g. חפק)
  | 'role_crew'             // staff_all_roles position (חמל): the whole role staffs daily
  | 'chain'                 // T4 overlay: crew descends from a source shift
  | 'chain_min_tracker'     // chain pick rule: minimum tracker hours
  | 'chain_commander'       // chain commander slot: commander in crew / highest rifle
  | 'chain_completion'      // chain crew short (source went home) — completed fresh
  | 'magen_commander'       // the weekly מגן commander decision (config)
  | 'driver_quota'          // picked in the position's Level-1 driver quota
  | 'driver_seat'           // seat requires a qualified driver
  | 'platoon_group'         // P5: joins a commander's same-platoon group (התקפי)
  | 'no_rest_fill'          // everyone works: leftover soldier joins מגן
  // caveats (⚠)
  | 'caveat_rest_lt4'       // בדוחק: under the 4h hard rest floor
  | 'caveat_rest_lt8_long'  // בדוחק: under 8h rest before a long task
  | 'caveat_short_rest'     // primary pick but rest < 8h (R1 quasi-constraint)
  | 'caveat_same_position'  // T1: same position as yesterday
  | 'caveat_same_class'     // T2: same mission class as yesterday
  | 'caveat_static_streak'  // T3: 3rd+ consecutive static day
  | 'caveat_third_night'    // R6: third consecutive night (max 2)
  | 'caveat_no_alternative';// the primary candidate list was empty

export interface RationaleEntry {
  code: RationaleCode;
  params?: Record<string, string | number>;
}

/** Hebrew templates; {param} placeholders are interpolated by renderRationale. */
export const TEMPLATES: Record<RationaleCode, string> = {
  continuity_crew: 'ממשיך בצוות {position} מאתמול (רציפות צוות)',
  commander_quota: 'שובץ במכסת המפקדים של {position}',
  rotation_switch: 'רוטציה: אתמול {yesterday} → היום {today}',
  rotation_break_static: 'משימה דינמית שוברת רצף של {streak} ימים סטטיים',
  rest_ok: 'סיים משמרת ב-{lastEnd} — {restH} שעות מנוחה לפני תחילת המשמרת ({start})',
  duty_rest: 'סיים משימה יומית ({position}) — נחשב כמנוחה מלאה החל מ-14:00',
  handover_out: 'זוג מתחלף: מאייש עד {handover}, ואז {partner} מחליף אותו (יציאה)',
  handover_in: 'זוג מתחלף: נכנס ב-{handover} במקום {partner} (חזרה)',
  no_prior: 'ללא משמרת קודמת סמוכה — מנוחה מלאה',
  fewest_nights: 'מהמעוטים בלילות בקבוצה: {nights} לילות בשבוע האחרון (חציון הקבוצה: {median})',
  low_load: 'עומס שבועי נמוך בקבוצה: {hours} שעות משוקללות (חציון הקבוצה: {median})',
  commander_seat: 'מושב מפקד — נדרש מפקד למשמרת זו',
  pulled_from_rest: 'הושלם ממנוחה — לא נותר מועמד פנוי בקבוצת העמדה',
  seat_rule: 'מושב {seat} ב{position} — מועמד ייעודי (עדיפות {priority} ברשימה)',
  role_crew: 'צוות {position} — כל חיילי {role} הנוכחים מאיישים יומית',
  chain: '{target}: ירד מ{source} של {sourceStart} (שרשור)',
  chain_min_tracker: 'נבחר מהצוות היורד עם מינימום שעות גשש',
  chain_commander: 'מפקד הכונן — מפקד מהצוות, או הרובאי הבכיר באין מפקד',
  chain_completion: 'השלמה לכוננות: הצוות שירד מ{source} יצא/חסר — נבחר חייל זמין (עדיפות למי שחזר לבסיס)',
  magen_commander: 'מפקד המגן שנקבע לשבוע — מוביל את צוות המגן',
  driver_quota: 'שובץ במכסת הנהגים של {position} (נדרש {qual})',
  driver_seat: 'מושב נהג — נדרש {qual} בצוות',
  platoon_group: 'מצטרף לקבוצה של {commander} (מחלקה {platoon})',
  no_rest_fill: 'צורף ל{position} — כל חייל זמין משובץ (אין מנוחה)',
  caveat_rest_lt4: 'פחות מ-4 שעות מנוחה לפני המשמרת',
  caveat_rest_lt8_long: 'פחות מ-8 שעות מנוחה לפני משימה ארוכה',
  caveat_short_rest: 'מנוחה קצרה: {restH} שעות בלבד',
  caveat_same_position: 'אותה עמדה כמו אתמול ({position})',
  caveat_same_class: 'אותו סוג משימה כמו אתמול ({cls})',
  caveat_static_streak: 'יום סטטי {streak}+ ברצף',
  caveat_third_night: 'לילה שלישי ברצף (מקסימום 2)',
  caveat_no_alternative: 'לא נמצא מועמד כשיר אחר — אחרת המושב היה נשאר ריק',
};

export const RATIONALE_CODES = Object.keys(TEMPLATES) as RationaleCode[];

export const isCaveat = (e: RationaleEntry): boolean => e.code.startsWith('caveat_');

export function renderRationale(e: RationaleEntry): string {
  const tpl = TEMPLATES[e.code] ?? e.code;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(e.params?.[k] ?? `{${k}}`));
}
