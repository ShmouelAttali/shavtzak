/***************
 * שבצ"ק - ולידציה, מילוי ומצבה (קובץ מאוחד) - v3.17 שעון לחימה 14:00-14:00
 *
 * Sheet names:
 * - כל השבצק
 * - מצבת החיילים
 *
 * שינויים בגרסה זו (v3.17) - משימה יומית: בלעדיות, ושתי עמודות סטטוס:
 * 1. ולידציה חדשה, validateDailyMissionExclusivity_: מי שמחזיק שורה
 *    יומית אינו מחזיק שום שורה נוספת באותה יממה מבצעית. הזיהוי הוא
 *    לפי *צורת הזמן* (isDaily) ולא לפי מילת מפתח בעברית - ב-09/08
 *    שינה הגיליון את כתיב הכוננות ההתקפית מ"כוננות | התקפי" ל"התקפי |
 *    התקפי", וכל כלל תלוי-מילה נפל בשקט. בכתיב הישן שורה כזאת שווה 0
 *    שעות ופטורה מבדיקת החפיפות, ולכן כוננות במקביל לעמדה סטטית לא
 *    הפיקה שום שגיאה. הפטורים - גשש, כרמל/כוננות, וזוג
 *    כוננות התקפית + פעילות התקפית - מרוכזים במקום אחד.
 * 2. שורה יומית שווה 0 שעות עבודה גם בכתיב החדש: התנאי ב-
 *    buildParsedShifts_ הורחב מ-isAttackReadiness לכל שורת התקפי
 *    *יומית*. בלעדיו כוננות + תגבצ ערב הפיקו "יותר מ־8 שעות ביום"
 *    על 13 שעות, בעוד שהצמד הזה מאושר (הכוננות היא שמבצעת אותן).
 * 3. שורה יומית נבדקת מול *שתי* עמודות הסטטוס. slotIsTomorrow דרשה
 *    טווח שעות אמיתי, ולכן שורה יומית נבדקה מול "היום" בלבד: חייל
 *    שיוצא לחופש מחר ב-06:00 עבר בשקט, למרות ש-06:00-14:00 של היממה
 *    נשארות בלי איוש. שעת ההחלפה של v3.15 נשמרת, ובלי עמודת "מחר"
 *    שתי העמודות זהות ולא מדווחים פעמיים.
 * 4. משימה יומית *מפוצלת* תופסת רק את הטווח שכתוב בה: הטווח נשמר
 *    (spanStartMin/spanEndMin) ו-shiftWindowOnOpAxis_ מחזירה אותו,
 *    כך שבלעדיות, זמינות ויציאות נמדדות מול החלון האמיתי. בלעדיו
 *    "14:00-09:00" + עמדה ב-10:00 (הזנב שהפיצול משחרר בכוונה) נפסלה
 *    כחפיפה, ו"14:00-06:00" אצל מי שיוצא לחופש מחר ב-06:00 דווחה
 *    כשיבוץ בחופש. נמדד על 14 ימים אמיתיים: 4 מ-7 שגיאות הבלעדיות
 *    ו-חלק מ-44 התראות הזמינות היו הדפוס הזה.
 *
 * שינויים ב-v3.16 - "זמין" נמדד על היממה המבצעית:
 * 1. availableMinutesInOpDay_ מחשבת כמה מהיממה (14:00 עד 14:00 למחרת)
 *    החייל בכלל נוכח בה, מתוך שלושת המקורות שכבר קיימים בקובץ: חופש /
 *    לא מגויס, חלון ההחלפה של החופש (v3.15) והיציאה הקצרה (v3.12).
 * 2. ההתראה "מסומן כזמין אבל בלי משימה" מדלגת על מי שאין לו ולו דקה
 *    אחת ביממה. הזמינות נמדדה עד כה ברזולוציית יום קלנדרי, ולכן חייל
 *    שסטטוסו "יציאה מ14" ולמחרת בחופש נראה זמין - היממה שלו ריקה
 *    לגמרי, ובכל זאת נדלקה עליו התראה.
 * 3. ההערה בהתראה מתארת עכשיו את היממה בפועל ("זמין 6 שעות ביממה"),
 *    ולא את עמודות הסטטוס. הנוסח הקודם אמר על אותו חייל "זמין בחלק
 *    היום" - בדיוק החצי שבו איננו.
 * 4. ⚠ בלי עמודת "מחר" בגיליון החצי השני נחשב נוכח: עדיף התראה
 *    מיותרת על התראה אמיתית שנבלעת.
 *
 * שינויים ב-v3.15 - שעת ההחלפה של החופש:
 * 1. ההחלפה היא ב-06:00, וביום ראשון ב-09:00. לכן יום היציאה לחופש ויום
 *    החזרה ממנו הם ימים *חלקיים*, ולא ימים חסומים:
 *      - ביום החופש הראשון אפשר לשבץ משמרת שנגמרת עד שעת ההחלפה
 *        (02:00-06:00 תקין).
 *      - ביום החזרה אפשר לשבץ רק משמרת שמתחילה משעת ההחלפה ואילך
 *        (06:00 תקין, 02:00 לא) - שגיאה חדשה, שקודם לא נתפסה בכלל.
 *    שעת ההחלפה נקבעת לפי היום הקלנדרי שבו היא קורית.
 * 2. readRoster_ מאתר גם את עמודת התאריך של *אתמול*, כי בלעדיה אין דרך
 *    לדעת אם יום חופש הוא הראשון שלו. הגיליון לא משתנה: getDataRange
 *    קורא ממילא את הטאב כולו, וזה רק אינדוקס של עמודה שכבר בזיכרון.
 * 3. סטטוס קודם ריק = "לא ידוע", לא "נוכח" - אחרת כל יום חופש היה
 *    נראה כיום הראשון שלו והחלון היה נפתח באמצע החופש.
 * 4. "לא מגויס" אינו חופש ואינו מקבל את החלון (VACATION_STATUS_WORDS).
 * 5. שעת ההחלפה תמיד לפני 14:00, ולכן החלון החלקי נופל בחצי "מחר" של
 *    היממה המבצעית; חצי "היום" (14:00-24:00) מתנהג כמו קודם.
 *
 * שינויים ב-v3.14 - רוטציה סטטית:
 * 1. אזהרה חדשה: חייל שעושה עמדות הגנה MAX_CONSECUTIVE_STATIC_DAYS+1
 *    ימים מבצעיים רצופים. יום בעמדות הגנה הוא שני סבבים של 4 שעות,
 *    ואחריו החייל אמור לעבור לרוטציה דינמית (סיור/התקפי). שלושה ימים
 *    רצופים אינם אסורים - לפעמים אין ברירה - ולכן אזהרה ולא שגיאה.
 * 2. getOpDayShifts_ חולצה מ-getPreviousOpDayShifts_ כדי לקרוא גם ימים
 *    מבצעיים רחוקים יותר. היסטוריית הרוטציה נקראת עם מאגרי שגיאות
 *    מקומיים: שורה פגומה מלפני שלושה ימים לא תחסום ולידציה של היום.
 *
 * שינויים ב-v3.13:
 * 1. ההתראה "חייל מסומן כזמין אבל בלי משימה" מדלגת על אנשי המפל"ג
 *    (UNASSIGNED_ALERT_EXEMPT_UNITS). הם אינם משובצים בשבצ"ק הפלוגתי,
 *    ולכן ההתראה עליהם הייתה רעש קבוע - 6 מתוך 42 התראות ביום נבדק.
 * 2. readRoster_ טוען גם מחלקה ותפקיד. שתי העמודות אופציונליות: אם
 *    אינן קיימות רק הפטור לא יעבוד, והוולידציה ממשיכה כרגיל.
 *
 * שינויים ב-v3.12 - יציאה קצרה מאושרת:
 * 1. סטטוס יציאה ב"מצבת החיילים" נקרא כחלון זמן אמיתי, באחת משלוש
 *    צורות בשעות עגולות ובתוך יום קלנדרי אחד:
 *      "יציאה מ10 עד 22" - חלון מפורש
 *      "יציאה מ20"       - יוצא ואינו חוזר עד חצות
 *      "יציאה עד 10"     - אינו בבסיס מחצות ועד השעה הזו
 *    שיבוץ שחופף לחלון הוא שגיאה. הבדיקה חצי-פתוחה: יציאה עד 22
 *    ומשימה שמתחילה ב-22:00 תקינות.
 * 2. היציאה אינה משימה - היא לא נספרת בשעות עבודה ולא דורשת מנוחה
 *    סביבה. זה מתקיים מאליו: היציאה נמצאת במצבה ולא ב"כל השבצק",
 *    ולכן אינה נכנסת לחישובי השעות והמנוחה.
 * 3. ערך שמתחיל ב"יציאה" עם ספרות ואינו בפורמט מפיק אזהרה. אסור
 *    שייבלע בשקט - חייל שיצא ייראה זמין.
 * 4. ערכי הרשימה ההיסטוריים (יציאה בערב / בבוקר / ב14:00) ממשיכים
 *    להתנהג בדיוק כמו קודם ואינם חוסמים.
 *    parseExitStatus_ משותפת גם ל-ShavtzakRecommendation.
 *
 * שינויים קודמים (v3.11):
 * 1. משימה יומית מזוהה לפי אורך הטווח ולא רק לפי המילה "יומי".
 *    ב"כל השבצק" אותה משימה נכתבת גם "14:00-14:00" וגם מפוצלת
 *    בהעברה ב-09:00 ("14:00-09:00"). כל טווח באורך
 *    DAILY_MIN_SPAN_HOURS ומעלה נספר כ-DAILY_HOURS ולא נכנס
 *    לבדיקת חפיפות - בדיוק כמו "יומי". קודם לכן הן נספרו לפי
 *    אורכן המלא (19-24 שעות) וייצרו חריגות וחפיפות שווא.
 * 2. הובהר שעמודת "תאריך" היא התאריך הקלנדרי האמיתי של השורה,
 *    והיממה המבצעית היא קיבוץ מעליה (ראה operationalDayOfDateTime_).
 * 3. נמחק קוד מת: calendarDateForOpDaySlot_ (שהתיאור שלה סתר את
 *    הנ"ל ולא נקראה מעולם), findCarmelRowsToFill_ ו-
 *    findAttackReadinessRowsToFill_ (הוחלפו ב-
 *    groupCarmelRowsByAbsoluteStart_) ו-runAllShabzakValidationForIso.
 *
 * שינויים קודמים (v3.10):
 * 1. היממה המבצעית: 14:00 עד 14:00 למחרת (OPERATIONAL_DAY_START_HOUR).
 * 2. כונן גשש: 3 משמרות (14-22 / 22-07 / 07-14) על בסיס יורדי סיור.
 *    - לא נספר במנוחה ולא בתקרת 8 השעות (כוננות שינה).
 *    - ולידציה חדשה: כל משמרת גשש חייבת להיות מאוישת ע"י חייל
 *      שירד מסיור שמסתיים עד 90 דקות לפני תחילת המשמרת.
 * 3. "כרמל על בסיס יורדים" נכתב מחדש גנרית: הכרמל תקין אם החייל ירד
 *    מעמדת הגנה שמסתיימת בדיוק בשעת תחילת הכרמל (כולל מהיום הקודם).
 *    זה מחליף את buildDefenseByStartMap_ / getDefenseSourceForCarmel_
 *    שחסרו בקוד המקורי.
 ***************/

const CONFIG = {
  SCHEDULE_SHEET_NAME: 'כל השבצק',
  ROSTER_SHEET_NAME: 'מצבת החיילים',

  // שעון לחימה: תחילת היממה המבצעית.
  OPERATIONAL_DAY_START_HOUR: 14,

  IGNORE_SOLDIERS: [
    '',
    'הפלוגה הקודמת',
    'על בסיס מגן'
  ],

  DEFENSE_POSTS: ['שג', 'מזרחית', 'בונקר', 'דרומית'],

  CARMEL_POSITIONS: ['כרמל חטיבה', 'מפקד כרמל חטיבה'],

  CARMEL_TYPE: 'כרמל חטיבה',

  ATTACK_TYPE: 'התקפי',
  READINESS_KEYWORD: 'כוננות',

  TRACKER_KEYWORD: 'גשש',
  // משמרת גשש חייבת להתחיל עד 90 דקות אחרי סוף הסיור של המיועד
  // (ירד ב-06:00 -> משמרת 07:00 = פער 60 דקות).
  TRACKER_DESCENT_MAX_GAP_MIN: 90,

  MIN_REST_HOURS: 8,
  MAX_DAILY_HOURS: 8,

  DAILY_HOURS: 8,

  // v3.14: רוטציה. יום בעמדות הגנה (DEFENSE_POSTS) = שני סבבים של 4 שעות,
  // וביום שאחריו החייל אמור לעבור לרוטציה דינמית (סיור/התקפי). מספר
  // הימים המבצעיים הרצופים בעמדות הגנה שעדיין נחשבים תקינים; מעבר לזה
  // עולה אזהרה. 0 מכבה את הבדיקה.
  MAX_CONSECUTIVE_STATIC_DAYS: 2,

  // v3.11: משימה יומית נכתבת ב"כל השבצק" בכמה צורות שוות ערך -
  // "יומי", "14:00-14:00", וגם מפוצלת בהעברה ב-09:00
  // ("14:00-09:00" = 19 שעות). כל טווח שאורכו לפחות DAILY_MIN_SPAN_HOURS
  // נחשב משימה יומית: נספר כ-DAILY_HOURS ולא נכנס לבדיקת חפיפות.
  // המשלים הקצר ("09:00-14:00" = 5 שעות) נשאר משמרת רגילה לכל דבר.
  DAILY_MIN_SPAN_HOURS: 12,

  SINGLE_TIME_DURATION_BY_TYPE: {
    'סיור': 8,
    'עמדות הגנה': 4,
    'כרמל': 4,
    'חמל': 8
  },

  SPECIAL_FIXED_RANGES_BY_POSITION: {
    'תגבצ בוקר': { start: '06:00', end: '10:00' },
    'תגבצ ערב': { start: '17:00', end: '22:00' }
  },

  UNAVAILABLE_STATUS_WORDS: ['חופש', 'לא מגויס'],

  // v3.15: החופש מתחלף ב-06:00, וביום ראשון ב-09:00. כלומר ביום החופש
  // הראשון החייל עוד זמין *עד* שעת ההחלפה, וביום החזרה הוא זמין רק
  // *ממנה*. שעת ההחלפה נקבעת לפי היום הקלנדרי שבו ההחלפה מתרחשת:
  // היום הראשון של החופש ביציאה, ויום החזרה בחזרה.
  // "לא מגויס" אינו חופש ואינו מקבל את החלון הזה.
  VACATION_STATUS_WORDS: ['חופש'],
  VACATION_CHANGE_HOUR: 6,
  VACATION_CHANGE_HOUR_SUNDAY: 9,

  // v3.12: יציאה קצרה מאושרת נרשמת ב"מצבת החיילים" באחת משלוש הצורות
  // (שעות עגולות, יום קלנדרי אחד): "יציאה מ10 עד 22", "יציאה מ20"
  // (עד חצות), "יציאה עד 10" (מחצות). היא חוסמת שיבוץ שחופף לה, לא
  // נספרת כשעות עבודה, ולא דורשת מנוחה סביבה - חייל שיצא עד 22
  // יכול לעלות למשימה שמתחילה ב-22:00.
  EXIT_STATUS_PREFIX: 'יציאה',

  // ערכי היציאה ההיסטוריים מרשימת "אפשרויות" - אין להם שעות, והם
  // ממשיכים להתנהג כמו קודם (לא חוסמים). לא מתריעים עליהם כשגיאת פורמט.
  LEGACY_EXIT_STATUSES: ['יציאה בערב', 'יציאה בבוקר', 'יציאה ב14:00'],

  HEADER_NAMES: {
    scheduleDate: 'תאריך',
    position: 'העמדה',
    type: 'סוג',
    time: 'השעה',
    soldier: 'החייל',
    rosterFullName: 'שם מלא',
    rosterPlatoon: 'מחלקה',
    rosterRole: 'תפקיד'
  },

  // v3.13: מי לא נכלל בהתראת "מסומן כזמין אבל בלי משימה". אנשי המפל"ג
  // (מ"פ, סמ"פ, רס"פ, סרס"פ, מנהלה) אינם משובצים בשבצ"ק הפלוגתי, ולכן
  // ההתראה עליהם הייתה רעש קבוע. ההשוואה סובלנית לגרשיים, כך שגם
  // מפל"ג וגם מפל״ג נתפסים.
  UNASSIGNED_ALERT_EXEMPT_UNITS: ['מפלג']
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('פעולות שבצ״ק')
    .addItem('ולידציה לטאב שבצק', 'validateCurrentShabzakTab')
    .addItem('ולידציה לטאב כל השבצק', 'validateAllShabzakByDate')
    .addSeparator()
    .addItem('מלא כרמל חטיבה', 'fillCarmelHativa')
    .addItem('מלא כרמל גשש', 'fillCarmelGashash')
    .addSeparator()
    .addItem('צפה בשינויים', 'showRosterStatusChanges')
    .addToUi();

  // תפריט ההמלצות (מהקובץ ShavtzakRecommendation)
  if (typeof installShabtzakRecommendationsMenu === 'function') {
    installShabtzakRecommendationsMenu();
  }
}


function readSchedule_(sheet, errors) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { rows: [] };

  const headerRowIndex = findHeaderRow_(values, [
    CONFIG.HEADER_NAMES.scheduleDate,
    CONFIG.HEADER_NAMES.position,
    CONFIG.HEADER_NAMES.type,
    CONFIG.HEADER_NAMES.time,
    CONFIG.HEADER_NAMES.soldier
  ]);

  if (headerRowIndex === -1) {
    errors.push('לא נמצאה שורת כותרות בטאב "' + sheet.getName() + '".');
    return { rows: [] };
  }

  const headers = values[headerRowIndex].map(normalize_);
  const col = {
    date: headers.indexOf(CONFIG.HEADER_NAMES.scheduleDate),
    position: headers.indexOf(CONFIG.HEADER_NAMES.position),
    type: headers.indexOf(CONFIG.HEADER_NAMES.type),
    time: headers.indexOf(CONFIG.HEADER_NAMES.time),
    soldier: headers.indexOf(CONFIG.HEADER_NAMES.soldier)
  };

  const rows = [];

  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const row = values[i];
    const date = parseDateCell_(row[col.date]);
    const soldier = normalize_(row[col.soldier]);

    if (!date && !soldier) continue;

    rows.push({
      rowNumber: i + 1,
      date,
      position: normalize_(row[col.position]),
      type: normalize_(row[col.type]),
      timeText: normalizeTimeText_(row[col.time]),
      soldier
    });
  }

  return { rows };
}

function readRoster_(sheet, targetDate, errors) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { soldiers: new Map() };

  const fullNameHeader = CONFIG.HEADER_NAMES.rosterFullName;
  const headerRowIndex = findHeaderRow_(values, [fullNameHeader]);

  if (headerRowIndex === -1) {
    errors.push('לא נמצאה כותרת "' + fullNameHeader + '" בטאב "' + sheet.getName() + '".');
    return { soldiers: new Map() };
  }

  const headers = values[headerRowIndex].map(normalize_);
  const fullNameCol = headers.indexOf(fullNameHeader);
  // v3.13: מחלקה/תפקיד אינם חובה - בלעדיהם רק פטור המפל"ג לא יעבוד,
  // ואין סיבה להכשיל בגללם את כל הוולידציה.
  const platoonCol = headers.indexOf(CONFIG.HEADER_NAMES.rosterPlatoon);
  const roleCol = headers.indexOf(CONFIG.HEADER_NAMES.rosterRole);

  const dateCol = findRosterDateColumn_(values, headerRowIndex, targetDate);

  if (dateCol === -1) {
    errors.push('לא נמצאה עמודת תאריך ' + formatDate_(targetDate) + ' בטאב "' + sheet.getName() + '".');
    return { soldiers: new Map() };
  }

  // v3.7: יום השיבוץ חוצה שני ימים קלנדריים (שעון 14:00), ולכן טוענים
  // גם את עמודת המחר. משבצת שנופלת קלנדרית ב-targetDate+1 נבדקת מולה.
  const tomorrowDateCol = findRosterDateColumn_(values, headerRowIndex, addDays_(targetDate, 1));

  // v3.15: כדי לדעת אם יום חופש הוא היום *הראשון* שלו (ולכן זמין עד
  // שעת ההחלפה) צריך גם את היום שלפניו. אין כאן שום דרישה מהגיליון:
  // getDataRange כבר קרא את הטאב כולו, וזה רק איתור של עמודת תאריך
  // נוספת מתוכו - כמו שהמנוע עושה מאז ומתמיד (colForDate של אתמול).
  // אם התאריך הזה לא קיים בשורת התאריכים (למשל היום הראשון בטאב),
  // הסטטוס נשאר ריק = "לא ידוע", והזמינות מתנהגת כמו לפני v3.15.
  const yesterdayDateCol = findRosterDateColumn_(values, headerRowIndex, addDays_(targetDate, -1));

  const isUnavailable = function(statusText) {
    return CONFIG.UNAVAILABLE_STATUS_WORDS.some(function(word){ return statusText.indexOf(word) !== -1; });
  };

  const soldiers = new Map();

  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const name = normalize_(values[i][fullNameCol]);
    if (!name) continue;

    const statusToday = normalize_(values[i][dateCol]);
    const statusTomorrow = tomorrowDateCol !== -1 ? normalize_(values[i][tomorrowDateCol]) : statusToday;
    const statusYesterday = yesterdayDateCol !== -1 ? normalize_(values[i][yesterdayDateCol]) : '';
    const unavailableToday = isUnavailable(statusToday);
    const unavailableTomorrow = isUnavailable(statusTomorrow);

    soldiers.set(name, {
      name,
      platoon: platoonCol !== -1 ? normalize_(values[i][platoonCol]) : '',
      role: roleCol !== -1 ? normalize_(values[i][roleCol]) : '',
      status: statusToday,          // תאימות לאחור
      statusToday: statusToday,
      statusTomorrow: statusTomorrow,
      statusYesterday: statusYesterday,
      hasYesterdayColumn: yesterdayDateCol !== -1,
      unavailable: unavailableToday, // תאימות לאחור: זמינות "היום"
      unavailableToday: unavailableToday,
      unavailableTomorrow: unavailableTomorrow,
      hasTomorrowColumn: tomorrowDateCol !== -1,
      // "פעיל" = זמין בלפחות אחד משני חלקי היום המבצעי.
      active: !(unavailableToday && unavailableTomorrow)
    });
  }

  // v3.15: התאריך נשמר כדי שהוולידציה תדע לאיזה יום קלנדרי כל עמודה
  // שייכת - שעת ההחלפה של החופש תלויה ביום בשבוע.
  return { soldiers, targetDate: stripTime_(targetDate) };
}

function buildParsedShifts_(rows, errors, warnings, contextLabel) {
  const parsed = [];

  rows.forEach(row => {
    if (!row.date) {
      errors.push(contextLabel + ': שורה ' + row.rowNumber + ' בלי תאריך תקין.');
      return;
    }

    if (shouldIgnoreSoldier_(row.soldier)) return;

    const isCarmel = isCarmel_(row);
    const isAttackReadiness = isAttackReadiness_(row);
    const isAttackGroup = isAttackGroup_(row);
    const isTracker = isTracker_(row);
    const timeInfo = parseShiftTime_(row, warnings, contextLabel);

    parsed.push({
      rowNumber: row.rowNumber,
      date: row.date,
      position: row.position,
      type: row.type,
      timeText: row.timeText,
      soldier: row.soldier,
      isCarmel,
      isAttackReadiness,
      isAttackGroup,
      isTracker,
      hasRealTimeRange: timeInfo.hasRealTimeRange,
      isDaily: timeInfo.isDaily,
      startMin: timeInfo.startMin,
      endMin: timeInfo.endMin,
      spanStartMin: timeInfo.spanStartMin !== undefined ? timeInfo.spanStartMin : null,
      spanEndMin: timeInfo.spanEndMin !== undefined ? timeInfo.spanEndMin : null,
      // כרמל, כוננות התקפית וכונן גשש הם כוננויות שינה -
      // לא נספרים בתקרת 8 השעות היומית.
      // v3.17: "כוננות התקפית" מזוהה כאן לפי צורת הזמן - כל שורת התקפי
      // *יומית* - ולא רק לפי המילה "כוננות", שהגיליון הפסיק לכתוב.
      // אחרת הכוננות מוסיפה 8 שעות, והצמד המאושר כוננות + תגבצ ערב
      // מפיק "יותר מ־8 שעות ביום" על משמרת אחת בת 5 שעות.
      hoursForDailyTotal: (isCarmel || isAttackReadiness || isTracker ||
        (isAttackGroup && timeInfo.isDaily)) ? 0 : timeInfo.hoursForDailyTotal
    });
  });

  return parsed;
}

function parseShiftTime_(row, warnings, contextLabel) {
  const text = normalizeTimeText_(row.timeText);

  if (text === 'יומי') return dailyTimeInfo_();

  const fixed = CONFIG.SPECIAL_FIXED_RANGES_BY_POSITION[row.position];
  if (fixed) {
    const start = timeStringToMinutes_(fixed.start);
    const end = timeStringToMinutes_(fixed.end);
    const startOp = normalizeToOperationalDay_(start);
    const endOp = normalizeEnd_(startOp, normalizeToOperationalDay_(end));

    return {
      isDaily: false,
      hasRealTimeRange: true,
      startMin: startOp,
      endMin: endOp,
      hoursForDailyTotal: diffHours_(startOp, endOp)
    };
  }

  if (text.indexOf('-') !== -1) {
    const parts = text.split('-').map(s => s.trim());
    const start = timeStringToMinutes_(parts[0]);
    const end = timeStringToMinutes_(parts[1]);

    if (start === null || end === null) {
      warnings.push(contextLabel + ': שורה ' + row.rowNumber + ' — לא הצלחתי לפרש טווח שעות "' + text + '".');
      return emptyTimeInfo_();
    }

    const startOp = normalizeToOperationalDay_(start);
    const endOp = normalizeEnd_(startOp, normalizeToOperationalDay_(end));

    // v3.11: טווח ארוך (יממה שלמה "14:00-14:00", או חלק ארוך של משימה
    // יומית מפוצלת כמו "14:00-09:00") הוא אותה משימה שנכתבת במקום אחר
    // "יומי" - אותן עמדות, אותו תוכן. בלי זה היא נספרת לפי אורכה המלא
    // (חריגה ודאית מתקרת 8 השעות) וגם חופפת לכל שאר המשבצות של אותו
    // חייל באותו יום.
    // v3.17: בטווח *חלקי* ("14:00-09:00") הטווח המפורש נשמר
    // (spanStartMin/spanEndMin) - משימה יומית מפוצלת תופסת רק את הטווח
    // שכתוב בה, לא את היממה כולה. בלעדיות, זמינות ויציאות נמדדות מולו;
    // בלעדיו "14:00-09:00" + עמדה ב-10:00 (הזנב שהפיצול קיים בדיוק כדי
    // לשחרר) הייתה נפסלת כחפיפה. טווח של יממה שלמה ("14:00-14:00") נשאר
    // זהה ל"יומי" בכל שדה - אותה משימה בכתיב אחר (מוצמד בבדיקות).
    if (endOp - startOp >= 24 * 60) return dailyTimeInfo_();
    if (endOp - startOp >= CONFIG.DAILY_MIN_SPAN_HOURS * 60) {
      return Object.assign(dailyTimeInfo_(), { spanStartMin: startOp, spanEndMin: endOp });
    }

    return {
      isDaily: false,
      hasRealTimeRange: true,
      startMin: startOp,
      endMin: endOp,
      hoursForDailyTotal: diffHours_(startOp, endOp)
    };
  }

  const start = timeStringToMinutes_(text);
  if (start !== null) {
    const startOp = normalizeToOperationalDay_(start);
    let duration = CONFIG.SINGLE_TIME_DURATION_BY_TYPE[row.type];

    if (!duration && isCarmel_(row)) {
      duration = 4;
    }

    if (!duration) {
      warnings.push(contextLabel + ': שורה ' + row.rowNumber + ' — שעה בודדת "' + text + '" לסוג "' + row.type + '" ללא משך מוגדר. לא נספר בשעות/חפיפות.');
      return emptyTimeInfo_();
    }
    return {
      isDaily: false,
      hasRealTimeRange: true,
      startMin: startOp,
      endMin: startOp + duration * 60,
      hoursForDailyTotal: duration
    };
  }

  warnings.push(contextLabel + ': שורה ' + row.rowNumber + ' — לא הצלחתי לפרש את השעה "' + text + '".');
  return emptyTimeInfo_();
}

/* ============================================================
 * יציאה קצרה מאושרת ("יציאה מ10 עד 22" / "יציאה מ20" / "יציאה עד 10")
 * משותף ל-ShabtzakOps ול-ShavtzakRecommendation (אותו פרויקט,
 * אותו scope גלובלי). פונקציה טהורה - בלי תלות ב-CONFIG של אף צד.
 * ============================================================ */

// מחזיר {startMin, endMin} בדקות מחצות של אותו יום קלנדרי, או null.
// שלוש הצורות המותרות, כולן בשעות עגולות ובתוך יום קלנדרי אחד:
//   "יציאה מ10 עד 22" - חלון מפורש.
//   "יציאה מ20"       - יוצא ואינו חוזר עד סוף היום (חצות).
//   "יציאה עד 10"     - אינו בבסיס מחצות ועד השעה הזו.
// שעה תקפה היא 0-23, ושעת הסיום חייבת להיות אחרי ההתחלה.
function parseExitStatus_(text) {
  const t = normalize_(text);

  const hourToMinutes = function(raw) {
    const h = Number(raw);
    if (!isFinite(h) || h < 0 || h > 23) return null;
    return h * 60;
  };

  const forms = [
    { re: /^יציאה\s+מ\s*(\d{1,2})\s+עד\s+(\d{1,2})$/,
      build: function(m) { return { start: hourToMinutes(m[1]), end: hourToMinutes(m[2]) }; } },
    { re: /^יציאה\s+מ\s*(\d{1,2})$/,
      build: function(m) { return { start: hourToMinutes(m[1]), end: 24 * 60 }; } },
    { re: /^יציאה\s+עד\s*(\d{1,2})$/,
      build: function(m) { return { start: 0, end: hourToMinutes(m[1]) }; } }
  ];

  for (let i = 0; i < forms.length; i++) {
    const m = t.match(forms[i].re);
    if (!m) continue;

    const range = forms[i].build(m);
    if (range.start === null || range.end === null) return null;
    if (range.end <= range.start) return null;

    return { startMin: range.start, endMin: range.end, text: t };
  }

  return null;
}

// האם הטקסט *מתיימר* להיות יציאה עם שעות (ולכן שגיאת פורמט אם לא נפרס).
// ערכי הרשימה ההיסטוריים (יציאה בערב וכו') אינם נחשבים.
function looksLikeTimedExit_(text) {
  const t = normalize_(text);
  if (t.indexOf(CONFIG.EXIT_STATUS_PREFIX) !== 0) return false;
  if (CONFIG.LEGACY_EXIT_STATUSES.indexOf(t) !== -1) return false;
  return /\d/.test(t);
}

// חפיפה בין שני טווחים חצי-פתוחים: [aStart,aEnd) מול [bStart,bEnd).
// נגיעה בקצה אינה חפיפה - יציאה שמסתיימת ב-22:00 ומשימה שמתחילה
// ב-22:00 הן תקינות.
function rangesOverlap_(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/* ============================================================
 * v3.15: חופש - שעת ההחלפה
 * שלוש הפונקציות האלה משמשות גם את מנוע ההמלצות (קובץ אחד, scope
 * אחד), בדיוק כמו parseExitStatus_ ו-rangesOverlap_. אין להעביר אותן
 * לקובץ השני - הוא נטען אחרי, ואז ההגדרה שם תדרוס את זו.
 * ============================================================ */

function isVacationStatusText_(text) {
  const t = normalize_(text);
  if (!t) return false;
  return CONFIG.VACATION_STATUS_WORDS.some(function(word){ return t.indexOf(word) !== -1; });
}

/**
 * שעת ההחלפה של החופש, בדקות מחצות, לפי היום הקלנדרי שבו היא קורית:
 * 06:00, וביום ראשון 09:00.
 */
function vacationChangeMinutesForDate_(date) {
  const sunday = !!date && date.getDay() === 0;
  const hour = sunday ? CONFIG.VACATION_CHANGE_HOUR_SUNDAY : CONFIG.VACATION_CHANGE_HOUR;
  return hour * 60;
}

/**
 * מה קורה ביום קלנדרי מסוים, לפי הסטטוס שלו ושל היום שלפניו:
 *   'start'  - היום הראשון של החופש: זמין עד שעת ההחלפה.
 *   'end'    - יום החזרה מחופש: זמין רק משעת ההחלפה.
 *   'full'   - יום חופש שלם (או "לא מגויס") - לא זמין בכלל.
 *   ''       - יום רגיל.
 *
 * ⚠ סטטוס קודם ריק = לא ידוע (אין עמודה כזו בגיליון, או שהתא לא מולא),
 * ולא "נוכח". בלי ההבחנה הזאת כל יום חופש היה נראה כיום הראשון שלו
 * ברגע שהעמודה חסרה, ומשמרת 02:00-06:00 באמצע חופש הייתה מאושרת.
 * במקרה הזה חוזרים להתנהגות שלפני v3.15: חופש = יום שלם.
 */
function vacationTransitionForDay_(prevStatus, dayStatus) {
  const onVacation = isVacationStatusText_(dayStatus);
  const prevKnown = !!normalize_(prevStatus);
  const prevOnVacation = isVacationStatusText_(prevStatus);

  if (onVacation) {
    if (prevKnown && !prevOnVacation) return 'start';
    return 'full';
  }
  if (prevKnown && prevOnVacation) return 'end';
  return '';
}

// חלון המשבצת על ציר היממה המבצעית (דקות מחצות של יום השבצ"ק).
// משימה יומית שנכתבה "יומי" תופסת את היממה כולה; משימה יומית מפוצלת
// ("14:00-09:00") תופסת רק את הטווח שכתוב בה (v3.17) - כך "14:00-06:00"
// אצל מי שיוצא לחופש מחר ב-06:00 אינה חפיפה, בדיוק כמו במנוע.
function shiftWindowOnOpAxis_(shift) {
  const dayStart = CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
  if (shift.isDaily) {
    if (shift.spanStartMin !== null && shift.spanStartMin !== undefined) {
      return { start: shift.spanStartMin, end: shift.spanEndMin };
    }
    return { start: dayStart, end: dayStart + 24 * 60 };
  }
  if (shift.hasRealTimeRange) return { start: shift.startMin, end: shift.endMin };
  return null;
}

// משימה יומית = היממה המבצעית המלאה 14:00 עד 14:00 למחרת.
// לצורך תקרת השעות היא נספרת כ-DAILY_HOURS (8) ולא כ-24, ובלי טווח
// שעות אמיתי - כלומר לא נכנסת לבדיקת החפיפות.
// v3.17: spanStartMin/spanEndMin - הטווח המפורש של משימה יומית מפוצלת
// ("14:00-09:00"), על ציר היממה. null = נכתבה "יומי" ותופסת יממה שלמה.
function dailyTimeInfo_() {
  return {
    isDaily: true,
    hasRealTimeRange: false,
    startMin: null,
    endMin: null,
    spanStartMin: null,
    spanEndMin: null,
    hoursForDailyTotal: CONFIG.DAILY_HOURS
  };
}

function emptyTimeInfo_() {
  return {
    isDaily: false,
    hasRealTimeRange: false,
    startMin: null,
    endMin: null,
    hoursForDailyTotal: 0
  };
}

function validateRestBetweenShifts_(targetShifts, previousShifts, errors) {
  const targetDate = findLastScheduleDate_(targetShifts);

  const previousAdjusted = previousShifts.map(s => Object.assign({}, s, {
    startMin: s.startMin === null ? null : s.startMin - 24 * 60,
    endMin: s.endMin === null ? null : s.endMin - 24 * 60
  }));

  const allRelevant = previousAdjusted.concat(targetShifts)
    .filter(s => !s.isCarmel)
    .filter(s => !s.isAttackReadiness)
    // v2.0: כונן גשש שקוף למנוחה - גם כמשימה קודמת (ישן בכוננות)
    // וגם כמשימה נבדקת (יורד הסיור נכנס אליה בכוונה בלי מנוחה).
    .filter(s => !s.isTracker)
    .filter(s => s.hasRealTimeRange);

  const bySoldier = groupBy_(allRelevant, s => s.soldier);

  bySoldier.forEach((shifts, soldier) => {
    shifts.sort((a, b) => a.startMin - b.startMin);

    for (let i = 1; i < shifts.length; i++) {
      const prev = shifts[i - 1];
      const curr = shifts[i];

      if (!sameDate_(curr.date, targetDate)) continue;

      const restHours = diffHours_(prev.endMin, curr.startMin);
      if (restHours < CONFIG.MIN_REST_HOURS) {
        errors.push(
          'מנוחה פחות מ־' + CONFIG.MIN_REST_HOURS + ' שעות: ' +
          soldier + ' — בין ' +
          describeShift_(prev) + ' לבין ' +
          describeShift_(curr) + '. מנוחה בפועל: ' +
          formatHours_(restHours) + ' שעות.'
        );
      }
    }
  });
}

function validateOverlaps_(targetShifts, errors) {
  const timed = targetShifts.filter(s => s.hasRealTimeRange);
  const bySoldier = groupBy_(timed, s => s.soldier);

  bySoldier.forEach((shifts, soldier) => {
    shifts.sort((a, b) => a.startMin - b.startMin);

    for (let i = 1; i < shifts.length; i++) {
      const prev = shifts[i - 1];
      const curr = shifts[i];

      if (curr.startMin < prev.endMin) {
        if (isAllowedAttackReadinessOverlap_(prev, curr)) continue;

        errors.push(
          'חפיפה: ' + soldier + ' משובץ במקביל ב־' +
          describeShift_(prev) + ' וגם ב־' +
          describeShift_(curr) + '.'
        );
      }
    }
  });
}

/**
 * v3.17: משימה יומית היא בלעדית - מי שמחזיק בה אינו מחזיק שום עמדה
 * נוספת באותה יממה מבצעית.
 *
 * הזיהוי הוא לפי *צורת הזמן* (isDaily: "יומי", "14:00-14:00", והחצי
 * הארוך של משימה מפוצלת) ולא לפי מילת מפתח בעברית. ב-09/08 שינה
 * הגיליון את כתיב הכוננות ההתקפית מ"כוננות | התקפי" ל"התקפי | התקפי",
 * וכל כלל תלוי-מילה נפל בשקט. הבדיקה הזאת היא רשת הביטחון: כתיב חדש
 * או עמדה שאיש לא ראה עוד נופלים למסלול הבלעדי כברירת מחדל.
 *
 * ⚠ שורה יומית אינה נכנסת ל-validateOverlaps_ (אין לה טווח שעות
 * אמיתי) ובכתיב הישן גם שווה 0 שעות, ולכן עד כה כוננות במקביל לעמדה
 * סטטית לא הפיקה שום שגיאה - לא חפיפה ולא חריגת שעות.
 *
 * "במקביל" = חפיפה בזמן על החלון שהמשימה באמת תופסת (shiftWindowOnOpAxis_):
 * "יומי" תופס יממה שלמה, אבל משימה מפוצלת ("14:00-09:00") תופסת רק את
 * הטווח שלה - מי שסיים אותה ב-09:00 ועלה לעמדה ב-10:00 אינו במקביל.
 * נמדד על 14 ימים אמיתיים: הכלל הגורף ("אותה יממה") ייצר 7 שגיאות
 * ש-4 מהן היו בדיוק דפוס הפיצול-והמשלים הזה.
 */
function validateDailyMissionExclusivity_(targetShifts, errors) {
  const bySoldier = groupBy_(
    targetShifts.filter(function(s){ return !shouldIgnoreSoldier_(s.soldier); }),
    function(s){ return s.soldier; }
  );

  bySoldier.forEach(function(shifts, soldier){
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length; j++) {
        const a = shifts[i];
        const b = shifts[j];
        if (!a.isDaily && !b.isDaily) continue;

        const daily = a.isDaily ? a : b;
        const other = a.isDaily ? b : a;
        if (isExemptFromDailyExclusivity_(daily, other)) continue;

        const dailyWindow = shiftWindowOnOpAxis_(daily);
        const otherWindow = shiftWindowOnOpAxis_(other);
        if (!dailyWindow || !otherWindow) continue; // שורה לא-פריסה כבר קיבלה אזהרת פורמט
        if (!rangesOverlap_(dailyWindow.start, dailyWindow.end, otherWindow.start, otherWindow.end)) continue;

        errors.push(
          'משימה יומית במקביל למשימה נוספת: ' + soldier + ' — ' +
          describeShift_(daily) + ' וגם ' + describeShift_(other) + '.'
        );
      }
    }
  });
}

/**
 * v3.17: הפטורים מבלעדיות המשימה היומית - כולם, במקום אחד.
 * מילת מפתח בעברית לא מחליטה *אם* שורה יומית בלעדית, אלא רק מעניקה
 * פטור מפורש; כל פטור חדש נכנס לכאן ולשום מקום אחר.
 */
function isExemptFromDailyExclusivity_(daily, other) {
  // כונן גשש הוא כוננות שינה על גבי משימה אמיתית, וכשהוא נכתב "יומי"
  // הוא חוסם רק את משמרתו בפועל (אותו כלל כמו במנוע מאז v3.2).
  if (daily.isTracker || other.isTracker) return true;

  // כרמל/כוננות מוחזקים מעצם הגדרתם על גבי משימה אחרת - hoursForDailyTotal
  // שלהם 0, והם מסוננים גם מבדיקת המנוחה.
  if (daily.isCarmel || other.isCarmel) return true;

  // הצמד המאושר (החלטת בעלים 16/08): צוות הכוננות ההתקפית הוא זה
  // שמבצע את הפעילויות ההתקפיות (תגבצ ערב / פטרול / צ'קפוסט), ולכן
  // כוננות התקפית יומית ופעילות התקפית באותה יממה תקינות.
  if (daily.isAttackGroup && other.isAttackGroup) return true;

  return false;
}

/**
 * v2.0 - נכתב מחדש (הפונקציות buildDefenseByStartMap_ /
 * getDefenseSourceForCarmel_ חסרו בקוד המקורי):
 * כרמל תקין אם החייל ירד מעמדת הגנה שמסתיימת בדיוק בשעת תחילת הכרמל.
 * הבדיקה כוללת גם את היום הקודם (מוזז 24 שעות אחורה), כך שגם משבצות
 * הכרמל של תחילת היממה (14:00) שמקורן ביורדי 10:00-14:00 של אתמול -
 * נבדקות נכון תחת שעון 14:00-14:00.
 */
function validateCarmelBasedOnDefensePosts_(targetShifts, previousShifts, errors) {
  previousShifts = previousShifts || [];

  const previousAdjusted = previousShifts.map(s => Object.assign({}, s, {
    startMin: s.startMin === null ? null : s.startMin - 24 * 60,
    endMin: s.endMin === null ? null : s.endMin - 24 * 60
  }));

  // מפה: זמן סיום (בציר של היום הנוכחי) -> קבוצת חיילים שירדו מעמדה בזמן הזה.
  const defenseByEnd = new Map();
  previousAdjusted.concat(targetShifts)
    .filter(s => s.hasRealTimeRange)
    .filter(s => CONFIG.DEFENSE_POSTS.indexOf(s.position.trim()) !== -1)
    .forEach(s => {
      const key = String(s.endMin);
      if (!defenseByEnd.has(key)) defenseByEnd.set(key, new Set());
      defenseByEnd.get(key).add(s.soldier);
    });

  targetShifts
    .filter(s => s.isCarmel)
    .filter(s => s.hasRealTimeRange)
    .forEach(c => {
      const allowed = defenseByEnd.get(String(c.startMin)) || new Set();

      if (!allowed.has(c.soldier)) {
        errors.push(
          'כרמל לא על בסיס יורדים: ' +
          c.soldier + ' משובץ ב־' + describeShift_(c) +
          ', אבל לא נמצא כיורד מעמדות הגנה במשמרת שמסתיימת ב־' +
          minutesToTimeLabel_(c.startMin) + '.'
        );
      }
    });
}

function validateCarmelMinimumStaff_(targetShifts, errors) {
  const carmel = targetShifts
    .filter(s => s.isCarmel)
    .filter(s => s.hasRealTimeRange);

  const byStart = groupBy_(carmel, s => String(s.startMin));

  byStart.forEach((shifts, startKey) => {
    const regularCount = shifts.filter(s => s.position.trim() === 'כרמל חטיבה').length;
    const commanderCount = shifts.filter(s => s.position.trim() === 'מפקד כרמל חטיבה').length;

    if (regularCount < 3 || commanderCount < 1) {
      errors.push(
        'חוסר בכרמל בשעה ' + minutesToTimeLabel_(Number(startKey)) +
        ': יש ' + regularCount + ' כרמל חטיבה ו־' + commanderCount +
        ' מפקד כרמל חטיבה. נדרש לפחות 3 כרמל חטיבה ו־1 מפקד כרמל חטיבה.'
      );
    }
  });
}

/**
 * v2.0 - חדש: כל משמרת כונן גשש (14-22 / 22-07 / 07-14) חייבת להיות
 * מאוישת ע"י חייל שירד מסיור שמסתיים עד TRACKER_DESCENT_MAX_GAP_MIN
 * דקות לפני תחילת המשמרת:
 * - משמרת 14:00-22:00 <- יורד סיור 06:00-14:00 (של היום הקודם)
 * - משמרת 22:00-07:00 <- יורד סיור 14:00-22:00 (של אותו יום)
 * - משמרת 07:00-14:00 <- יורד סיור 22:00-06:00 (של אותו יום, פער 60 דק')
 */
function validateTrackerBasedOnTours_(targetShifts, previousShifts, errors) {
  previousShifts = previousShifts || [];

  const previousAdjusted = previousShifts.map(s => Object.assign({}, s, {
    startMin: s.startMin === null ? null : s.startMin - 24 * 60,
    endMin: s.endMin === null ? null : s.endMin - 24 * 60
  }));

  const tours = previousAdjusted.concat(targetShifts)
    .filter(s => s.hasRealTimeRange)
    .filter(s => s.type.trim() === 'סיור' || s.position.trim() === 'סיור');

  const maxGap = CONFIG.TRACKER_DESCENT_MAX_GAP_MIN;

  targetShifts
    .filter(s => s.isTracker)
    .filter(s => s.hasRealTimeRange)
    .forEach(t => {
      const hasMatchingTour = tours.some(tour =>
        tour.soldier === t.soldier &&
        t.startMin - tour.endMin >= 0 &&
        t.startMin - tour.endMin <= maxGap
      );

      if (!hasMatchingTour) {
        errors.push(
          'כונן גשש לא על בסיס יורד סיור: ' +
          t.soldier + ' משובץ ב־' + describeShift_(t) +
          ', אבל לא ירד מסיור שמסתיים עד ' + maxGap +
          ' דקות לפני תחילת המשמרת.'
        );
      }
    });
}

function validateDailyHours_(targetShifts, roster, errors, warnings) {
  const hoursBySoldier = new Map();

  // קודם מכניסים כל מי שמשובץ למפה עם 0 שעות.
  // כך גם חייל שמשובץ רק בכרמל/גשש יקבל הערה של 0 שעות.
  targetShifts.forEach(s => {
    if (shouldIgnoreSoldier_(s.soldier)) return;

    if (!hoursBySoldier.has(s.soldier)) {
      hoursBySoldier.set(s.soldier, 0);
    }
  });

  // מוסיפים שעות רק ממשימות שאינן כוננות (כרמל/כוננות התקפית/גשש).
  targetShifts
    .filter(s => !s.isCarmel && !s.isTracker)
    .forEach(s => {
      if (shouldIgnoreSoldier_(s.soldier)) return;

      if (!hoursBySoldier.has(s.soldier)) {
        hoursBySoldier.set(s.soldier, 0);
      }

      hoursBySoldier.set(
        s.soldier,
        hoursBySoldier.get(s.soldier) + (s.hoursForDailyTotal || 0)
      );
    });

  hoursBySoldier.forEach((hours, soldier) => {
    if (hours > CONFIG.MAX_DAILY_HOURS) {
      errors.push(
        'יותר מ־' + CONFIG.MAX_DAILY_HOURS + ' שעות ביום: ' +
        soldier + ' עושה ' + formatHours_(hours) + ' שעות.'
      );
    } else if (hours < CONFIG.MAX_DAILY_HOURS) {
      warnings.push(
        'פחות מ־' + CONFIG.MAX_DAILY_HOURS + ' שעות ביום: ' +
        soldier + ' עושה ' + formatHours_(hours) + ' שעות.'
      );
    }
  });
}

/**
 * v3.14: רוטציה סטטית - יותר מ-MAX_CONSECUTIVE_STATIC_DAYS ימים מבצעיים
 * רצופים בעמדות הגנה.
 *
 * יום בעמדות הגנה הוא שני סבבים של 4 שעות (למשל 14-18 ו-02-06), ולכן
 * מספר הסבבים *בתוך* יום נשמר ממילא ע"י תקרת 8 השעות. מה שאינו נבדק הוא
 * הרוטציה בין הימים: אחרי יום סטטי החייל אמור לקבל יום דינמי (סיור /
 * התקפי). אזהרה ולא שגיאה - לפעמים אין ברירה.
 *
 * history = ימים מבצעיים קודמים לפי סדר עולה של מרחק (אתמול, שלשום, ...),
 * כל אחד { opDay, shifts }. הרצף נספר מהיום הנבדק אחורה ונעצר ביום הראשון
 * שאינו בעמדות הגנה - כך "סטטי, דינמי, סטטי" אינו נחשב רצף.
 */
function validateConsecutiveStaticDays_(targetShifts, history, warnings) {
  const maxDays = CONFIG.MAX_CONSECUTIVE_STATIC_DAYS;
  if (!maxDays) return;

  const previousDays = history || [];
  if (previousDays.length < maxDays) return;

  const staticSoldiersOn = function(shifts) {
    const set = new Set();
    (shifts || [])
      .filter(isDefensePostShift_)
      .forEach(function(s) {
        if (!shouldIgnoreSoldier_(s.soldier)) set.add(normalize_(s.soldier));
      });
    return set;
  };

  const today = staticSoldiersOn(targetShifts);
  if (!today.size) return;

  const historySets = previousDays.map(function(day) {
    return { opDay: day.opDay, soldiers: staticSoldiersOn(day.shifts) };
  });

  // שם החייל להצגה - כפי שנכתב בשבצ"ק של היום.
  const displayName = new Map();
  targetShifts.forEach(function(s) {
    const key = normalize_(s.soldier);
    if (key && !displayName.has(key)) displayName.set(key, s.soldier);
  });

  today.forEach(function(key) {
    const streakDates = [];

    for (let i = 0; i < historySets.length; i++) {
      if (!historySets[i].soldiers.has(key)) break;
      streakDates.push(historySets[i].opDay);
    }

    const streak = streakDates.length + 1;
    if (streak <= maxDays) return;

    // הרצף נקטע בקצה ההיסטוריה שנקראה - אז הוא ארוך *לפחות* כך.
    const truncated = streakDates.length === historySets.length;
    const since = streakDates[streakDates.length - 1];

    warnings.push(
      (truncated ? 'לפחות ' : '') + streak + ' ימים רצופים בעמדות הגנה: ' +
      (displayName.get(key) || key) + ' (מ־' + formatDate_(since) + ') - ' +
      'היום הזה אמור היה להיות רוטציה דינמית (סיור/התקפי).'
    );
  });
}

// v3.14: מהי משבצת "עמדות הגנה". שני הזיהויים נחוצים: העמודה "סוג" היא
// הכתיב הרגיל ב"כל השבצק", ורשימת DEFENSE_POSTS תופסת גם שורה שבה הסוג
// נכתב אחרת אבל העמדה עצמה היא שג/מזרחית/בונקר/דרומית.
function isDefensePostShift_(shift) {
  if (!shift) return false;
  if (normalize_(shift.type) === 'עמדות הגנה') return true;
  return CONFIG.DEFENSE_POSTS.indexOf(normalize_(shift.position)) !== -1;
}

/**
 * v3.16: כמה דקות מהיממה המבצעית (14:00 עד 14:00 למחרת) החייל בכלל
 * נוכח בהן. 0 = הוא אינו חלק מהיממה הזאת.
 *
 * עד כה הזמינות נמדדה ברזולוציית יום קלנדרי, ולכן חייל שסטטוסו
 * "יציאה מ14" והוא בחופש למחרת נראה זמין - היממה שלו ריקה לגמרי,
 * ובכל זאת נדלקה עליו "מסומן כזמין אבל בלי משימה". כאן שני חצאי
 * היממה נחתכים מול שלושת המקורות שכבר קיימים בקובץ: חופש / לא מגויס,
 * חלון ההחלפה של החופש (v3.15) והיציאה הקצרה המאושרת (v3.12).
 *
 * ⚠ בלי עמודת "מחר" בגיליון אי אפשר לדעת מה קורה בחצי השני, ולכן הוא
 * נחשב נוכח: עדיף התראה מיותרת על התראה אמיתית שנבלעת.
 */
function availableMinutesInOpDay_(soldier, roster) {
  const dayStart = CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
  const dayEnd = dayStart + 24 * 60;
  const blocked = [];

  const block = function(start, end) {
    const s = Math.max(start, dayStart);
    const e = Math.min(end, dayEnd);
    if (e > s) blocked.push({ start: s, end: e });
  };

  const halves = [
    {
      offset: 0,
      status: soldier.statusToday,
      prev: soldier.statusYesterday,
      unavailable: soldier.unavailableToday,
      known: true
    },
    {
      offset: 24 * 60,
      status: soldier.statusTomorrow,
      prev: soldier.statusToday,
      unavailable: soldier.unavailableTomorrow,
      known: !!soldier.hasTomorrowColumn
    }
  ];

  halves.forEach(function(half){
    if (!half.known) return;

    const dayDate = roster.targetDate ? addDays_(roster.targetDate, half.offset ? 1 : 0) : null;
    const changeMin = vacationChangeMinutesForDate_(dayDate);
    const transition = vacationTransitionForDay_(half.prev, half.status);

    if (half.unavailable) {
      // יום החופש הראשון: נוכח עד שעת ההחלפה בלבד. שעת ההחלפה תמיד
      // לפני 14:00, ולכן בחצי "היום" החיתוך מבטל אותה ממילא.
      if (transition === 'start') block(half.offset + changeMin, half.offset + 24 * 60);
      else block(half.offset, half.offset + 24 * 60);
    } else if (transition === 'end') {
      // יום החזרה מחופש: מגיע רק בשעת ההחלפה.
      block(half.offset, half.offset + changeMin);
    }

    const exit = parseExitStatus_(half.status);
    if (exit) block(half.offset + exit.startMin, half.offset + exit.endMin);
  });

  blocked.sort(function(a, b){ return a.start - b.start; });

  let free = 0;
  let cursor = dayStart;
  blocked.forEach(function(b){
    if (b.start > cursor) free += b.start - cursor;
    cursor = Math.max(cursor, b.end);
  });
  return free + Math.max(0, dayEnd - cursor);
}

function validateAvailabilityAndMissingAssignments_(targetShifts, roster, errors, warnings) {
  // v3.7: זמינות נבדקת לפי היום הקלנדרי של כל משבצת.
  // משבצת שמתחילה לפני שעת תחילת היממה (למשל 06:00, 08:00) נופלת
  // קלנדרית ל"מחר", ולכן נבדקת מול סטטוס המחר של החייל.
  const dayStartMin = CONFIG.OPERATIONAL_DAY_START_HOUR * 60;

  const slotIsTomorrow = function(shift) {
    if (!shift || !shift.hasRealTimeRange) return false;
    const clockStart = ((shift.startMin % (24 * 60)) + (24 * 60)) % (24 * 60);
    return clockStart < dayStartMin;
  };

  const assignedNames = new Set();
  const conflicts = []; // {name, status, part}
  const exitConflicts = []; // {name, status, part, shift}
  const vacationConflicts = []; // v3.15: {name, part, shift, changeText, kind}
  const badExitFormats = new Set();

  // v3.15: החופש מתחלף ב-06:00 (ביום ראשון 09:00), ולכן יום היציאה ויום
  // החזרה הם ימים חלקיים. שעת ההחלפה נקבעת לפי היום הקלנדרי של העמודה,
  // ומתורגמת לציר היממה המבצעית: 06:00 של "היום" יושב לפני תחילת היממה
  // (14:00), ולכן בפועל החלון החלקי תמיד נופל בחצי "מחר" - וחצי "היום"
  // ממשיך להתנהג בדיוק כמו לפני v3.15.
  const dayContextFor = function(soldier, isTomorrow) {
    const prevStatus = isTomorrow ? soldier.statusToday : soldier.statusYesterday;
    const dayStatus = isTomorrow ? soldier.statusTomorrow : soldier.statusToday;

    // בלי עמודת מחר שתי העמודות זהות, ואי אפשר לדעת מה קרה "לפני" -
    // אין להסיק מזה יום ראשון של חופש.
    if (isTomorrow && !soldier.hasTomorrowColumn) {
      return { transition: isVacationStatusText_(dayStatus) ? 'full' : '', changeMin: 0 };
    }

    const dayDate = roster.targetDate ? addDays_(roster.targetDate, isTomorrow ? 1 : 0) : null;
    const changeMin = vacationChangeMinutesForDate_(dayDate) + (isTomorrow ? 24 * 60 : 0);

    return {
      transition: vacationTransitionForDay_(prevStatus, dayStatus),
      changeMin: changeMin,
      changeText: minutesToTimeLabel_(vacationChangeMinutesForDate_(dayDate))
    };
  };

  // v3.12: יציאה קצרה נבדקת מול הזמן בפועל, לא מול היום כולו.
  // עמודת "היום" היא היום הקלנדרי של תחילת היממה, ולכן שעותיה יושבות
  // כמות שהן על ציר היממה; עמודת "מחר" מוסטת ב-24 שעות.
  // יציאה עשויה לחצות את 14:00 (למשל 12:00-20:00) - הבדיקה מול שתי
  // העמודות מכסה את שני חלקי היממה בלי להסתמך על שיוך היום של המשבצת.
  const exitWindowsFor = function(soldier) {
    const windows = [];
    const columns = [
      { status: soldier.statusToday, part: 'היום', offset: 0 },
      { status: soldier.statusTomorrow, part: 'מחר', offset: 24 * 60 }
    ];

    columns.forEach(function(c){
      const exit = parseExitStatus_(c.status);
      if (exit) {
        windows.push({
          start: exit.startMin + c.offset,
          end: exit.endMin + c.offset,
          status: normalize_(c.status),
          part: c.part
        });
      } else if (looksLikeTimedExit_(c.status)) {
        badExitFormats.add(soldier.name + ' — "' + normalize_(c.status) + '"');
      }
    });

    // שתי העמודות זהות כשאין עמודת מחר בגיליון - לא סופרים פעמיים.
    if (!soldier.hasTomorrowColumn) return windows.slice(0, 1);
    return windows;
  };

  // בדיקת חצי אחד של היממה מול עמודת הסטטוס שלו.
  // מחזירה true = "טופל, אין להמשיך לשאר הבדיקות של השורה הזאת".
  const checkStatusHalf = function(s, soldier, isTomorrow, window) {
    const unavailable = isTomorrow ? soldier.unavailableTomorrow : soldier.unavailableToday;
    const status = isTomorrow ? soldier.statusTomorrow : soldier.statusToday;
    const part = isTomorrow ? 'מחר' : 'היום';
    const dayContext = dayContextFor(soldier, isTomorrow);

    if (unavailable) {
      // v3.15: ביום הראשון של החופש החייל עוד כאן עד שעת ההחלפה, ולכן
      // משמרת שמסתיימת עד אז תקינה. חצי-פתוח: משמרת שנגמרת ב-06:00
      // ומסירה שמתחילה ב-06:00 שתיהן בסדר.
      const leavesToday = dayContext.transition === 'start' &&
        window && window.end <= dayContext.changeMin;
      if (!leavesToday) {
        conflicts.push({ name: s.soldier, status: status, part: part, shift: describeShift_(s) });
      }
      return true;
    }

    // v3.15: ביום החזרה מחופש החייל מגיע רק בשעת ההחלפה - משמרת
    // שמתחילה לפניה היא שגיאה, גם אם הסטטוס באותו יום הוא "נוכח".
    if (dayContext.transition === 'end' && window && window.start < dayContext.changeMin) {
      vacationConflicts.push({
        name: s.soldier,
        part: part,
        shift: describeShift_(s),
        changeText: dayContext.changeText
      });
      return true;
    }

    return false;
  };

  targetShifts.forEach(function(s){
    if (shouldIgnoreSoldier_(s.soldier)) return;
    assignedNames.add(s.soldier);

    const soldier = roster.soldiers.get(s.soldier);
    if (!soldier) return; // מטופל בהמשך

    const window = shiftWindowOnOpAxis_(s);

    // v3.17: משימה יומית תופסת את שני חצאי היממה, ולכן היא נבדקת מול
    // *שתי* עמודות הסטטוס. עד כה slotIsTomorrow דרשה טווח שעות אמיתי,
    // ולכן שורה יומית נבדקה מול "היום" בלבד - וחייל שיוצא לחופש מחר
    // ב-06:00 עבר בשקט, למרות ש-06:00-14:00 נשארות בלי איוש.
    // ⚠ בלי עמודת "מחר" שתי העמודות זהות - חצי אחד, לא דיווח כפול.
    const halves = (s.isDaily && soldier.hasTomorrowColumn)
      ? [false, true]
      : [slotIsTomorrow(s)];

    for (let i = 0; i < halves.length; i++) {
      if (checkStatusHalf(s, soldier, halves[i], window)) return;
    }

    if (!window) return;

    exitWindowsFor(soldier).forEach(function(w){
      if (!rangesOverlap_(window.start, window.end, w.start, w.end)) return;
      exitConflicts.push({
        name: s.soldier,
        status: w.status,
        part: w.part,
        shift: describeShift_(s)
      });
    });
  });

  // חייל משובץ שלא נמצא במצבה
  assignedNames.forEach(function(name){
    if (!roster.soldiers.get(name)) {
      errors.push('חייל משובץ אבל לא נמצא במצבת החיילים: ' + name + '.');
    }
  });

  // שיבוץ בחלק-יום שבו החייל לא זמין
  conflicts.forEach(function(c){
    errors.push(
      'חייל משובץ בזמן שהוא "' + c.status + '" (' + c.part + '): ' +
      c.name + ' — ' + c.shift + '.'
    );
  });

  // v3.15: שיבוץ לפני שעת ההחלפה ביום החזרה מחופש
  vacationConflicts.forEach(function(c){
    errors.push(
      'חייל משובץ לפני שעת ההחלפה ביום חזרתו מחופש (' + c.changeText + ', ' + c.part + '): ' +
      c.name + ' — ' + c.shift + '.'
    );
  });

  // v3.12: שיבוץ שחופף ליציאה קצרה מאושרת
  exitConflicts.forEach(function(c){
    errors.push(
      'חייל משובץ בזמן יציאה מאושרת "' + c.status + '" (' + c.part + '): ' +
      c.name + ' — ' + c.shift + '.'
    );
  });

  // ערך שנראה כמו יציאה עם שעות אבל לא בפורמט - חייבים להתריע,
  // אחרת היציאה נבלעת בשקט והחייל ייראה זמין.
  if (warnings) {
    badExitFormats.forEach(function(text){
      warnings.push(
        'סטטוס יציאה בפורמט לא תקין (נדרש "יציאה מ10 עד 22" / "יציאה מ20" / ' +
        '"יציאה עד 10", בשעות עגולות ובאותו יום): ' + text + '.'
      );
    });
  }

  // חייל שזמין בחלק כלשהו של היום המבצעי ולא שובץ כלל
  roster.soldiers.forEach(function(soldier){
    if (!soldier.active) return;
    if (assignedNames.has(soldier.name)) return;
    // v3.13: המפל"ג אינו משובץ בשבצ"ק הפלוגתי - לא התראה.
    if (isExemptFromUnassignedAlert_(soldier)) return;
    // v3.16: הסטטוס נקרא מעמודות היום הקלנדרי, אבל ההתראה היא על
    // היממה המבצעית. מי שאין לו בה ולו דקה אחת אינו "זמין בלי משימה".
    const availableMinutes = availableMinutesInOpDay_(soldier, roster);
    if (availableMinutes <= 0) return;

    // v3.16: ההערה מתארת את היממה המבצעית בפועל. הנוסח הקודם נגזר
    // מעמודות הסטטוס בלבד, ולכן אמר את ההפך מהאמת על מי שיצא ב-14:00
    // ויוצא לחופש למחרת: "זמין בחלק היום" - בדיוק החצי שבו איננו.
    // ⚠ בכוונה בלי formatHours_: היא מוגדרת בשני הקבצים, וההגדרה של
    // מנוע ההמלצות (הנטען אחרון) גוברת - כלומר הטקסט כאן היה משתנה
    // בין הרצה אמיתית לבין כלי בדיקה שטוען רק את הקובץ הזה.
    const hoursText = String(Math.round(availableMinutes / 6) / 10);
    let note;
    if (availableMinutes >= 24 * 60) {
      note = 'סטטוס: "' + soldier.statusToday + '"';
    } else {
      note = 'זמין ' + hoursText + ' שעות ביממה (היום: "' +
        soldier.statusToday + '", מחר: "' + soldier.statusTomorrow + '")';
    }

    errors.push('חייל מסומן כזמין אבל בלי משימה: ' + soldier.name + ' — ' + note + '.');
  });
}

function findHeaderRow_(values, requiredHeaders) {
  const required = requiredHeaders.map(normalize_);

  for (let r = 0; r < values.length; r++) {
    const row = values[r].map(normalize_);
    const ok = required.every(h => row.indexOf(h) !== -1);
    if (ok) return r;
  }

  return -1;
}

function findRosterDateColumn_(values, headerRowIndex, targetDate) {
  for (let r = 0; r <= headerRowIndex; r++) {
    for (let c = 0; c < values[r].length; c++) {
      const d = parseDateCell_(values[r][c]);
      if (d && sameDate_(d, targetDate)) return c;
    }
  }
  return -1;
}

function findLastScheduleDate_(rows) {
  let max = null;

  rows.forEach(r => {
    if (!r.date) return;
    if (!max || r.date.getTime() > max.getTime()) max = r.date;
  });

  return max;
}

function parseDateCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return stripTime_(value);
  }

  const text = normalize_(value);
  if (!text) return null;

  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;

  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  let year = Number(m[3]);
  if (year < 100) year += 2000;

  return new Date(year, month, day);
}

/**
 * v3.13: השוואת שם יחידה/תפקיד בלי גרשיים. הגיליון כותב מפל"ג עם גרש
 * כפול ASCII, ולפעמים עם גרשיים עבריים (״), ו-normalize_ אינו מסיר
 * אותם - כך שהשוואה ישירה מול 'מפלג' הייתה נכשלת.
 */
function normalizeUnitText_(value) {
  return normalize_(value).replace(/["'׳״]/g, '');
}

/**
 * v3.13: אנשי המפל"ג לא משובצים בשבצ"ק הפלוגתי, ולכן ההתראה
 * "מסומן כזמין אבל בלי משימה" עליהם היא רעש ולא ממצא.
 */
function isExemptFromUnassignedAlert_(soldier) {
  const units = CONFIG.UNASSIGNED_ALERT_EXEMPT_UNITS || [];
  if (!units.length || !soldier) return false;

  const text = normalizeUnitText_(soldier.platoon) + ' ' + normalizeUnitText_(soldier.role);
  return units.some(function(unit){
    const key = normalizeUnitText_(unit);
    return !!key && text.indexOf(key) !== -1;
  });
}

function normalize_(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\u200f/g, '')
    .replace(/\u200e/g, '')
    .replace(/\u202a/g, '')
    .replace(/\u202b/g, '')
    .replace(/\u202c/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeTimeText_(value) {
  if (value === null || value === undefined) return '';

  // אם התא הוא שעה אמיתית בגוגל שיט, getValues מחזיר Date עם תאריך 30/12/1899
  if (value instanceof Date && !isNaN(value.getTime())) {
    const h = value.getHours();
    const m = value.getMinutes();
    return pad2_(h) + ':' + pad2_(m);
  }

  let text = normalize_(value);

  // Google Sheets sometimes displays 6:00:00
  text = text.replace(/(\d{1,2}):(\d{2}):00/g, '$1:$2');

  return text;
}

function timeStringToMinutes_(text) {
  text = normalizeTimeText_(text);

  const m = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);

  if (h < 0 || h > 23 || min < 0 || min > 59) return null;

  return h * 60 + min;
}

/**
 * שעון לחימה: יום שיבוץ הוא 14:00 עד 14:00.
 *
 * v3.11 - הבהרה: עמודת "תאריך" ב"כל השבצק" היא תמיד התאריך הקלנדרי
 * האמיתי של השורה. משבצת 06:00 נרשמת בתאריך של אותו בוקר, לא בתאריך
 * היום המבצעי שהתחיל אתמול ב-14:00. היממה המבצעית היא *קיבוץ* מעל
 * התאריכים הקלנדריים (ראה operationalDayOfDateTime_), לא כתיב אחר שלהם.
 * שעות לפני 14:00 מקבלות +24 שעות רק על ציר הזמן הפנימי של היממה,
 * כדי שאפשר יהיה להשוות ולמיין משמרות בתוך אותה יממה.
 */
// v3.0: היום המבצעי (שעון לחימה) - התאריך הקלנדרי שאליו שייכת משבצת.
// שעה לפני OPERATIONAL_DAY_START_HOUR (14:00) שייכת ליום המבצעי
// שהתחיל ביום הקלנדרי הקודם.
// v3.5: מחזיר את המשמרות של *היום המבצעי הקודם* מתוך "כל השבצק",
// מחושב לפי היום המבצעי ולא לפי התאריך הקלנדרי הגולמי. זה מתקן את
// הבאג שבו חלק ממשמרות הכרמל מולאו מהיום הלא-נכון: משבצת בוקר
// (למשל עמדה 10:00-14:00) נחשבת ליום המבצעי שהתחיל אתמול ב-14:00.
// scheduleOpDay = היום המבצעי של השבצ"ק הנוכחי (stripTime של E1).
function getPreviousOpDayShifts_(allScheduleRows, scheduleOpDay, errors, warnings) {
  return getOpDayShifts_(
    allScheduleRows, addDays_(scheduleOpDay, -1),
    errors, warnings, 'כל השבצק - יום מבצעי קודם'
  );
}

// v3.14: הפילטר עצמו, לכל יום מבצעי - כדי שגם היסטוריית הרוטציה
// (שלשום ואחורה) תיקרא באותה הלוגיקה בדיוק.
function getOpDayShifts_(allScheduleRows, opDay, errors, warnings, contextLabel) {
  const rowsInOpDay = allScheduleRows.filter(function(r) {
    if (!r.date) return false;
    // מזהים לאיזה יום מבצעי שייכת השורה לפי תאריכה הקלנדרי + שעת ההתחלה.
    const t = parseShiftTime_(r, [], 'זיהוי יום מבצעי');
    // אם אין שעה תקינה, נופלים לשיוך לפי התאריך הגולמי (14:00 והלאה = אותו יום).
    const startMin = t.hasRealTimeRange ? (t.startMin % (24 * 60)) : (CONFIG.OPERATIONAL_DAY_START_HOUR * 60);
    const rowOpDay = operationalDayOfDateTime_(r.date, startMin);
    return sameDate_(rowOpDay, opDay);
  });

  return buildParsedShifts_(rowsInOpDay, errors, warnings, contextLabel);
}

/**
 * v3.14: הימים המבצעיים שלפני היום הנבדק, לפי סדר עולה של מרחק
 * (אתמול, שלשום, ...) - הקלט של validateConsecutiveStaticDays_.
 *
 * השגיאות והאזהרות של הפירסור נזרקות בכוונה: ההיסטוריה היא רקע לבדיקת
 * רוטציה בלבד, ושורה פגומה מלפני שלושה ימים לא אמורה לחסום את הוולידציה
 * של היום (שני מסלולי ההרצה עוצרים כש-errors אינו ריק).
 */
function getStaticRotationHistory_(allScheduleRows, scheduleOpDay) {
  // מספיק לקרוא MAX_CONSECUTIVE_STATIC_DAYS ימים כדי *לזהות* חריגה, אבל
  // אז ההודעה תמיד תגיד "3 ימים" גם כשהרצף בפועל ארוך יותר. חמישה ימי
  // מרווח נוספים נותנים את אורך הרצף האמיתי, ומעליהם ההודעה אומרת "לפחות".
  const daysBack = CONFIG.MAX_CONSECUTIVE_STATIC_DAYS + 5;
  const history = [];

  for (let i = 1; i <= daysBack; i++) {
    const opDay = addDays_(scheduleOpDay, -i);
    history.push({
      opDay: opDay,
      shifts: getOpDayShifts_(allScheduleRows, opDay, [], [], 'כל השבצק - היסטוריית רוטציה')
    });
  }

  return history;
}

function operationalDayOfDateTime_(calDate, minutesFromMidnight) {
  const dayStart = CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
  if (minutesFromMidnight < dayStart) return addDays_(calDate, -1);
  return stripTime_(calDate);
}

function normalizeToOperationalDay_(minutesFromMidnight) {
  const dayStart = CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
  if (minutesFromMidnight < dayStart) return minutesFromMidnight + 24 * 60;
  return minutesFromMidnight;
}

function normalizeEnd_(startOp, endOp) {
  if (endOp <= startOp) return endOp + 24 * 60;
  return endOp;
}

function shouldIgnoreSoldier_(name) {
  const normalized = normalize_(name);
  return CONFIG.IGNORE_SOLDIERS.indexOf(normalized) !== -1;
}

function isCarmel_(shift) {
  return shift.type === CONFIG.CARMEL_TYPE ||
    CONFIG.CARMEL_POSITIONS.indexOf(shift.position.trim()) !== -1;
}

function isTracker_(shift) {
  if (!shift) return false;
  const text = normalize_(shift.position + ' ' + shift.type);
  return text.indexOf(CONFIG.TRACKER_KEYWORD) !== -1;
}

function isAttackGroup_(shift) {
  if (!shift) return false;

  const text = normalize_(shift.position + ' ' + shift.type);
  return text.indexOf(CONFIG.ATTACK_TYPE) !== -1;
}

function isAttackReadiness_(shift) {
  if (!shift) return false;

  const text = normalize_(shift.position + ' ' + shift.type);
  return text.indexOf(CONFIG.READINESS_KEYWORD) !== -1 &&
    text.indexOf(CONFIG.ATTACK_TYPE) !== -1;
}

function isAllowedAttackReadinessOverlap_(a, b) {
  const aIsReadiness = !!a.isAttackReadiness || isAttackReadiness_(a);
  const bIsReadiness = !!b.isAttackReadiness || isAttackReadiness_(b);
  const aIsAttackGroup = !!a.isAttackGroup || isAttackGroup_(a);
  const bIsAttackGroup = !!b.isAttackGroup || isAttackGroup_(b);

  return (aIsReadiness && bIsAttackGroup) ||
    (bIsReadiness && aIsAttackGroup);
}

function groupBy_(items, keyFn) {
  const map = new Map();

  items.forEach(item => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });

  return map;
}

function diffHours_(startMin, endMin) {
  return (endMin - startMin) / 60;
}

function describeShift_(s) {
  const time = s.hasRealTimeRange
    ? minutesToTimeLabel_(s.startMin) + '-' + minutesToTimeLabel_(s.endMin)
    : s.timeText;

  return s.position + ' / ' + s.type + ' / ' + time + ' / שורה ' + s.rowNumber;
}

function minutesToTimeLabel_(minutes) {
  minutes = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return pad2_(h) + ':' + pad2_(m);
}

function pad2_(n) {
  return String(n).padStart(2, '0');
}

function formatHours_(hours) {
  if (Math.abs(hours - Math.round(hours)) < 0.001) return String(Math.round(hours));
  return String(Math.round(hours * 10) / 10);
}

function stripTime_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, days) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function sameDate_(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function formatDate_(d) {
  return pad2_(d.getDate()) + '/' + pad2_(d.getMonth() + 1) + '/' + d.getFullYear();
}

function showValidationResult_(errors, warnings, headerLines) {
  const html = HtmlService.createHtmlOutput(buildValidationResultHtml_(errors, warnings, headerLines))
    .setWidth(900)
    .setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'תוצאות ולידציה');
}

// בונה את גוף ה-HTML של תוצאות הוולידציה (בלי לפתוח דיאלוג),
// כדי שאפשר יהיה גם להזריק אותו לתוך חלון קיים.
function buildValidationResultHtml_(errors, warnings, headerLines) {
  const lines = [];
  if (headerLines && headerLines.length) lines.push(...headerLines);

  if (!errors.length && !warnings.length) {
    lines.push('✅ לא נמצאו שגיאות או הערות.');
  } else {
    if (errors.length) {
      lines.push('❌ שגיאות (' + errors.length + ')');
      lines.push(...errors.map((e, i) => (i + 1) + '. ' + e));
      lines.push('');
    }
    if (warnings.length) {
      lines.push('⚠️ הערות (' + warnings.length + ')');
      lines.push(...warnings.map((w, i) => (i + 1) + '. ' + w));
      lines.push('');
    }
  }

  return '<div dir="rtl" style="font-family:Arial,sans-serif; white-space:pre-wrap; line-height:1.45; padding:12px;">' +
    escapeHtml_(lines.join('\n')) +
    '</div>';
}

function escapeHtml_(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getCurrentShabzakLayout_(sheet, errors) {
  const values = sheet.getDataRange().getValues();

  const headerRowIndex = findHeaderRow_(values, [
    CONFIG.HEADER_NAMES.position,
    CONFIG.HEADER_NAMES.type,
    CONFIG.HEADER_NAMES.time,
    CONFIG.HEADER_NAMES.soldier
  ]);

  if (headerRowIndex === -1) {
    errors.push('לא נמצאה שורת כותרות בטאב "שבצק" עם העמודות: העמדה, סוג, השעה, החייל.');
    return null;
  }

  const headers = values[headerRowIndex].map(normalize_);

  return {
    values,
    headerRowIndex,
    col: {
      position: headers.indexOf(CONFIG.HEADER_NAMES.position),
      type: headers.indexOf(CONFIG.HEADER_NAMES.type),
      time: headers.indexOf(CONFIG.HEADER_NAMES.time),
      soldier: headers.indexOf(CONFIG.HEADER_NAMES.soldier)
    }
  };
}

function readRifleLevelMap_(rosterSheet, errors) {
  const values = rosterSheet.getDataRange().getValues();

  const headerRowIndex = findHeaderRow_(values, [
    CONFIG.HEADER_NAMES.rosterFullName,
    'רובאי'
  ]);

  if (headerRowIndex === -1) {
    errors.push('לא נמצאה שורת כותרות במצבת החיילים עם "שם מלא" ו"רובאי".');
    return new Map();
  }

  const headers = values[headerRowIndex].map(normalize_);
  const nameCol = headers.indexOf(CONFIG.HEADER_NAMES.rosterFullName);
  const rifleCol = headers.indexOf('רובאי');

  const map = new Map();

  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const name = normalize_(values[i][nameCol]);
    if (!name) continue;

    const rifleText = normalize_(values[i][rifleCol]);
    const rifle = Number(String(rifleText).replace(/[^\d.-]/g, ''));

    map.set(name, isNaN(rifle) ? 0 : rifle);
  }

  return map;
}

function isPatrolShift_(shift) {
  if (!shift) return false;

  const text = normalize_(shift.position + ' ' + shift.type);
  return text.indexOf('סיור') !== -1;
}

// v3.9: מקבץ שורות כרמל-חטיבה למילוי לפי רגע ההתחלה המוחלט (תאריך H + שעה).
// כך משבצת כרמל 14:00 של 10/08 נבדלת מ-14:00 של 11/08, ומקבלת את היורדים
// מהתאריך הנכון בדיוק.
function groupCarmelRowsByAbsoluteStart_(currentRows) {
  const byKey = {};
  currentRows.forEach(function(row){
    if (!isCarmel_(row)) return;
    if (!row.date) return;
    const timeInfo = parseShiftTime_(row, [], 'כרמל חטיבה');
    if (!timeInfo.hasRealTimeRange) return;

    const clockStart = ((timeInfo.startMin % (24*60)) + (24*60)) % (24*60);
    const startAbs = makeDateTime_(row.date, clockStart);
    const key = String(startAbs.getTime());

    if (!byKey[key]) {
      byKey[key] = {
        startAbs: startAbs,
        label: formatDate_(row.date) + ' ' + minutesToTimeLabel_(clockStart),
        rows: []
      };
    }
    byKey[key].rows.push(row);
  });

  // מיון: מפקד קודם, ואז לפי מספר שורה.
  const groups = Object.keys(byKey).map(function(k){ return byKey[k]; });
  groups.forEach(function(g){
    g.rows.sort(function(a, b){
      const aCmd = normalize_(a.position) === 'מפקד כרמל חטיבה';
      const bCmd = normalize_(b.position) === 'מפקד כרמל חטיבה';
      if (aCmd && !bCmd) return -1;
      if (!aCmd && bCmd) return 1;
      return a.rowNumber - b.rowNumber;
    });
  });
  groups.sort(function(a, b){ return a.startAbs.getTime() - b.startAbs.getTime(); });
  return groups;
}

function chooseCarmelCommander_(soldiers, rifleMap) {
  if (!soldiers.length) return '';

  let best = soldiers[0];
  let bestRifle = rifleMap.get(best) || 0;

  soldiers.forEach(name => {
    const rifle = rifleMap.get(name) || 0;
    if (rifle > bestRifle) {
      best = name;
      bestRifle = rifle;
    }
  });

  return best;
}

function unique_(arr) {
  const seen = new Set();
  const result = [];

  arr.forEach(item => {
    if (seen.has(item)) return;
    seen.add(item);
    result.push(item);
  });

  return result;
}

function showRosterStatusChanges() {
  const ss = SpreadsheetApp.getActive();

  const shabzakSheet = ss.getSheetByName('שבצק');
  const rosterSheet = ss.getSheetByName(CONFIG.ROSTER_SHEET_NAME);

  if (!shabzakSheet) {
    showValidationResult_(['לא נמצא טאב בשם "שבצק".'], []);
    return;
  }

  if (!rosterSheet) {
    showValidationResult_(['לא נמצא טאב בשם "' + CONFIG.ROSTER_SHEET_NAME + '".'], []);
    return;
  }

  const errors = [];

  const targetDate = parseDateCell_(shabzakSheet.getRange('E1').getValue());

  if (!targetDate) {
    showValidationResult_([
      'לא הצלחתי לזהות תאריך בתא E1 בטאב "שבצק".'
    ], []);
    return;
  }

  const previousDate = addDays_(targetDate, -1);

  const changes = getRosterStatusChanges_(rosterSheet, previousDate, targetDate, errors);

  if (errors.length) {
    showValidationResult_(errors, []);
    return;
  }

  const html = buildRosterStatusChangesHtml_(changes, previousDate, targetDate);

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(650).setHeight(700),
    'שינויים במצבת החיילים'
  );
}

function getRosterStatusChanges_(rosterSheet, previousDate, targetDate, errors) {
  const values = rosterSheet.getDataRange().getValues();

  if (!values.length) {
    errors.push('טאב "' + rosterSheet.getName() + '" ריק.');
    return [];
  }

  const headerRowIndex = findHeaderRow_(values, [CONFIG.HEADER_NAMES.rosterFullName]);

  if (headerRowIndex === -1) {
    errors.push('לא נמצאה כותרת "' + CONFIG.HEADER_NAMES.rosterFullName + '" בטאב "' + rosterSheet.getName() + '".');
    return [];
  }

  const headers = values[headerRowIndex].map(normalize_);
  const fullNameCol = headers.indexOf(CONFIG.HEADER_NAMES.rosterFullName);

  const previousDateCol = findRosterDateColumn_(values, headerRowIndex, previousDate);
  const targetDateCol = findRosterDateColumn_(values, headerRowIndex, targetDate);

  if (previousDateCol === -1) {
    errors.push('לא נמצאה עמודת תאריך אתמול ' + formatDate_(previousDate) + ' בטאב "' + rosterSheet.getName() + '".');
    return [];
  }

  if (targetDateCol === -1) {
    errors.push('לא נמצאה עמודת תאריך היום ' + formatDate_(targetDate) + ' בטאב "' + rosterSheet.getName() + '".');
    return [];
  }

  const changes = [];

  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const name = normalize_(values[i][fullNameCol]);
    if (!name) continue;

    const previousStatus = normalizeStatusForDisplay_(values[i][previousDateCol]);
    const todayStatus = normalizeStatusForDisplay_(values[i][targetDateCol]);

    if (previousStatus !== todayStatus) {
      changes.push({
        name,
        previousStatus,
        todayStatus
      });
    }
  }

  changes.sort((a, b) => a.name.localeCompare(b.name, 'he'));

  return changes;
}

function normalizeStatusForDisplay_(value) {
  const status = normalize_(value);
  return status || 'ריק';
}

function buildRosterStatusChangesHtml_(changes, previousDate, targetDate) {
  const rowsHtml = changes.length
    ? changes.map(change => {
      return '<li>' +
        '<b>' + escapeHtml_(change.name) + '</b>' +
        ' — היום <b>' + escapeHtml_(change.todayStatus) + '</b>' +
        ' <span class="previous">(אתמול ' + escapeHtml_(change.previousStatus) + ')</span>' +
        '</li>';
    }).join('')
    : '<li class="empty">לא נמצאו שינויים בין אתמול להיום.</li>';

  return `
    <html>
      <head>
        <style>
          body {
            direction: rtl;
            font-family: Arial, sans-serif;
            padding: 18px;
            background: #fafafa;
            color: #222;
          }

          h2 {
            margin: 0 0 6px;
            font-size: 22px;
          }

          .subtitle {
            margin-bottom: 16px;
            color: #555;
            line-height: 1.5;
          }

          .dateBox {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 14px;
            font-weight: bold;
          }

          .count {
            margin-bottom: 12px;
            color: #555;
          }

          ul {
            margin: 0;
            padding: 0 22px 0 0;
            line-height: 1.8;
          }

          li {
            margin-bottom: 6px;
            background: #fff;
            border: 1px solid #e3e3e3;
            border-radius: 8px;
            padding: 8px 10px;
          }

          .previous {
            color: #666;
          }

          .empty {
            list-style: none;
            color: #555;
          }
        </style>
      </head>

      <body>
        <h2>צפה בשינויים</h2>

        <div class="subtitle">
          מוצגים חיילים שהסטטוס שלהם במצבת החיילים השתנה ביחס ליום הקודם.
        </div>

        <div class="dateBox">
          תאריך: ${escapeHtml_(formatDate_(targetDate))}
          <br>
          בהשוואה לאתמול: ${escapeHtml_(formatDate_(previousDate))}
        </div>

        <div class="count">
          נמצאו ${changes.length} שינויים
        </div>

        <ul>
          ${rowsHtml}
        </ul>
      </body>
    </html>
  `;
}

function readCurrentShabzakTab_(sheet, targetDate, errors) {
  const values = sheet.getDataRange().getValues();

  if (values.length < 2) return [];

  const headerRowIndex = findHeaderRow_(values, [
    CONFIG.HEADER_NAMES.position,
    CONFIG.HEADER_NAMES.type,
    CONFIG.HEADER_NAMES.time,
    CONFIG.HEADER_NAMES.soldier
  ]);

  if (headerRowIndex === -1) {
    errors.push('לא נמצאה שורת כותרות בטאב "שבצק" עם העמודות: העמדה, סוג, השעה, החייל.');
    return [];
  }

  const headers = values[headerRowIndex].map(normalize_);

  const col = {
    date: headers.indexOf(CONFIG.HEADER_NAMES.scheduleDate),
    position: headers.indexOf(CONFIG.HEADER_NAMES.position),
    type: headers.indexOf(CONFIG.HEADER_NAMES.type),
    time: headers.indexOf(CONFIG.HEADER_NAMES.time),
    soldier: headers.indexOf(CONFIG.HEADER_NAMES.soldier)
  };

  const rows = [];

  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const row = values[i];

    const soldier = normalize_(row[col.soldier]);
    const position = normalize_(row[col.position]);
    const type = normalize_(row[col.type]);
    const timeText = normalizeTimeText_(row[col.time]);

    // מדלג על שורות ריקות לגמרי
    if (!soldier && !position && !type && !timeText) continue;

    // מדלג על שורות ביניים / כותרות / רווחים
    if (!soldier && !position) continue;

    // v3.9: התאריך נלקח מעמודת התאריך שליד השורה (עמודה H).
    // כל שורה נושאת את תאריכה הקלנדרי האמיתי; E1 משמש רק כברירת מחדל
    // אם השורה חסרת תאריך (למשל שורות ישנות).
    let rowDate = targetDate;
    if (col.date !== -1) {
      const parsed = parseDateCell_(row[col.date]);
      if (parsed) rowDate = parsed;
    }

    rows.push({
      rowNumber: i + 1,
      date: rowDate,
      position,
      type,
      timeText,
      soldier
    });
  }

  return rows;
}

/* ============================================================
 * v3.5 - מילוי כרמל חטיבה (מתוקן ליום מבצעי + מעבר לכוננות)
 * ============================================================ */

function fillCarmelHativa() {
  const ss = SpreadsheetApp.getActive();
  const currentSheet = ss.getSheetByName('שבצק');
  const allScheduleSheet = ss.getSheetByName(CONFIG.SCHEDULE_SHEET_NAME);
  const rosterSheet = ss.getSheetByName(CONFIG.ROSTER_SHEET_NAME);

  if (!currentSheet) { showValidationResult_(['לא נמצא טאב בשם "שבצק".'], []); return; }
  if (!allScheduleSheet) { showValidationResult_(['לא נמצא טאב בשם "' + CONFIG.SCHEDULE_SHEET_NAME + '".'], []); return; }
  if (!rosterSheet) { showValidationResult_(['לא נמצא טאב בשם "' + CONFIG.ROSTER_SHEET_NAME + '".'], []); return; }

  const errors = [];
  const warnings = [];

  const targetDate = parseDateCell_(currentSheet.getRange('E1').getValue());
  if (!targetDate) { showValidationResult_(['לא הצלחתי לזהות תאריך בתא E1 בטאב "שבצק".'], []); return; }
  const scheduleOpDay = stripTime_(targetDate);

  const layout = getCurrentShabzakLayout_(currentSheet, errors);
  if (!layout) { showValidationResult_(errors, warnings); return; }

  const currentRows = readCurrentShabzakTab_(currentSheet, targetDate, errors);
  const parsedCurrentRows = buildParsedShifts_(currentRows, errors, warnings, 'שבצק');

  // v3.5: היום המבצעי הקודם, לפי יום מבצעי ולא לפי תאריך גולמי.
  const allSchedule = readSchedule_(allScheduleSheet, errors);
  const parsedPreviousRows = getPreviousOpDayShifts_(allSchedule.rows, scheduleOpDay, errors, warnings);

  const rifleMap = readRifleLevelMap_(rosterSheet, errors);
  if (errors.length) { showValidationResult_(errors, warnings); return; }

  // v3.5 (בעיה #2): מי שירד מעמדה אבל עבר לכוננות התקפי לא זמין לכרמל.
  // בונים סט של "לא זמינים לכרמל" מתוך כל מי שמשובץ לכוננות התקפי בשבצ"ק הנוכחי,
  // ומחליפים אותם ביורדי סיור ערב פנויים.
  const readinessSoldiers = new Set(
    parsedCurrentRows
      .filter(function(s){ return s.isAttackReadiness || s.isAttackGroup; })
      .map(function(s){ return s.soldier; })
      .filter(function(n){ return !shouldIgnoreSoldier_(n); })
  );

  const sourceLookup = buildCarmelSourceMap_(parsedCurrentRows, parsedPreviousRows, rifleMap);
  const carmelGroups = groupCarmelRowsByAbsoluteStart_(currentRows);

  const updates = [];
  const fillMessages = [];

  carmelGroups.forEach(function(group){
    // group = { startAbs, label, rows: [...] }
    let sourceSoldiers = sourceLookup.forCarmelStart(group.startAbs);
    const carmelRows = group.rows;

    // v3.10: כרמל חטיבה מתמלא *רק* מיורדי עמדות הגנה - לעולם לא מסיור.
    // מי שירד מעמדה אך עבר לכוננות התקפי פשוט מוסר מהרשימה (לא מוחלף
    // בסיור), והמשבצת שלו נשארת ריקה למילוי ידני, עם אזהרה.
    const movedToReadiness = sourceSoldiers.filter(function(name){ return readinessSoldiers.has(name); });
    sourceSoldiers = sourceSoldiers.filter(function(name){ return !readinessSoldiers.has(name); });
    if (movedToReadiness.length) {
      warnings.push('כרמל ' + group.label + ': ירדו מעמדה אך עברו לכוננות התקפי (הושמטו, למילוי ידני): ' + movedToReadiness.join(', ') + '.');
    }

    if (!sourceSoldiers.length) {
      warnings.push('לא נמצאו יורדים מעמדות הגנה עבור כרמל חטיבה ב-' + group.label + '.');
      return;
    }

    const commander = chooseCarmelCommander_(sourceSoldiers, rifleMap);
    const regulars = sourceSoldiers.filter(function(s){ return s !== commander; });

    const commanderRows = carmelRows.filter(function(r){ return normalize_(r.position) === 'מפקד כרמל חטיבה'; });
    const regularRows = carmelRows.filter(function(r){ return normalize_(r.position) === 'כרמל חטיבה'; });

    if (!commanderRows.length) warnings.push('לא נמצאה שורת "מפקד כרמל חטיבה" ב-' + group.label + '.');
    else updates.push({ rowNumber: commanderRows[0].rowNumber, value: commander });

    if (regularRows.length < 3) warnings.push('ב-' + group.label + ' נמצאו רק ' + regularRows.length + ' שורות "כרמל חטיבה". נדרש לפחות 3.');

    regularRows.slice(0, 3).forEach(function(row, index){
      updates.push({ rowNumber: row.rowNumber, value: regulars[index] || '' });
    });

    fillMessages.push(group.label + ': מפקד — ' + commander + '; כרמל — ' + regulars.slice(0, 3).join(', '));
  });

  if (!updates.length) {
    showValidationResult_(['לא נמצאו שורות לעדכון.'], warnings, ['מילוי כרמל חטיבה לתאריך ' + formatDate_(targetDate), '']);
    return;
  }

  const soldierCol = layout.col.soldier + 1;
  updates.forEach(function(update){ currentSheet.getRange(update.rowNumber, soldierCol).setValue(update.value); });

  const header = [
    'מילוי כרמל חטיבה לתאריך ' + formatDate_(targetDate) + ' (יממה מבצעית 14:00-14:00)',
    '', 'בוצעו ' + updates.length + ' עדכונים.', '',
    'כללי מקור (לפי יום מבצעי):',
    '- כרמל X ← עמדת הגנה שמסתיימת ב-X (כולל מהיום המבצעי הקודם)',
    '- מי שעבר לכוננות התקפי הוחלף ביורד סיור ערב פנוי', '',
    'פירוט:', ...fillMessages, ''
  ];
  showValidationResult_([], warnings, header);
}



/* ============================================================
 * v3.5 - מילוי כרמל גשש (לפי יורדי סיור)
 * 14 ← ירד מסיור 14 | 22 ← ירד מסיור 22 | 07 ← ירד מסיור 06
 * ============================================================ */

function fillCarmelGashash() {
  const ss = SpreadsheetApp.getActive();
  const currentSheet = ss.getSheetByName('שבצק');
  const allScheduleSheet = ss.getSheetByName(CONFIG.SCHEDULE_SHEET_NAME);

  if (!currentSheet) { showValidationResult_(['לא נמצא טאב בשם "שבצק".'], []); return; }
  if (!allScheduleSheet) { showValidationResult_(['לא נמצא טאב בשם "' + CONFIG.SCHEDULE_SHEET_NAME + '".'], []); return; }

  const errors = [];
  const warnings = [];

  const targetDate = parseDateCell_(currentSheet.getRange('E1').getValue());
  if (!targetDate) { showValidationResult_(['לא הצלחתי לזהות תאריך בתא E1 בטאב "שבצק".'], []); return; }
  const scheduleOpDay = stripTime_(targetDate);

  const layout = getCurrentShabzakLayout_(currentSheet, errors);
  if (!layout) { showValidationResult_(errors, warnings); return; }

  const currentRows = readCurrentShabzakTab_(currentSheet, targetDate, errors);
  const parsedCurrentRows = buildParsedShifts_(currentRows, errors, warnings, 'שבצק');
  const allSchedule = readSchedule_(allScheduleSheet, errors);
  const parsedPreviousRows = getPreviousOpDayShifts_(allSchedule.rows, scheduleOpDay, errors, warnings);
  if (errors.length) { showValidationResult_(errors, warnings); return; }

  const sourceByTrackerStart = buildGashashSourceMap_(parsedCurrentRows, parsedPreviousRows);
  const trackerRowsByStart = findTrackerRowsToFill_(currentRows);

  const updates = [];
  const fillMessages = [];

  Object.keys(trackerRowsByStart).forEach(function(startKey){
    const startMin = Number(startKey);
    const trackerRows = trackerRowsByStart[startKey] || [];
    const sourceSoldiers = (sourceByTrackerStart[startKey] || []).slice();

    if (!sourceSoldiers.length) {
      warnings.push('לא נמצא יורד סיור מתאים לכונן גשש שמתחיל ב־' + minutesToTimeLabel_(startMin) + '.');
      return;
    }

    trackerRows.forEach(function(row, index){
      updates.push({ rowNumber: row.rowNumber, value: sourceSoldiers[index] || '' });
    });

    fillMessages.push(minutesToTimeLabel_(startMin) + ': ' + sourceSoldiers.slice(0, trackerRows.length).join(', '));
  });

  if (!updates.length) {
    showValidationResult_(['לא נמצאו שורות כונן גשש למילוי.'], warnings, ['מילוי כרמל גשש לתאריך ' + formatDate_(targetDate), '']);
    return;
  }

  const soldierCol = layout.col.soldier + 1;
  updates.forEach(function(update){ currentSheet.getRange(update.rowNumber, soldierCol).setValue(update.value); });

  const header = [
    'מילוי כרמל גשש לתאריך ' + formatDate_(targetDate) + ' (יממה מבצעית 14:00-14:00)',
    '', 'בוצעו ' + updates.length + ' עדכונים.', '',
    'כללי מקור:',
    '- כונן גשש 14:00 ← ירד מסיור 14:00 (סיור שמסתיים ב-14:00)',
    '- כונן גשש 22:00 ← ירד מסיור 22:00',
    '- כונן גשש 07:00 ← ירד מסיור 06:00', '',
    'פירוט:', ...fillMessages, ''
  ];
  showValidationResult_([], warnings, header);
}

// כונן גשש X ← סיור שמסתיים ב-Y, כאשר X הוא זמן היעד המובנה.
// גשש 14 ← סיור שמסתיים 14 | גשש 22 ← סיור שמסתיים 22 | גשש 07 ← סיור שמסתיים 06.
function buildGashashSourceMap_(parsedCurrentRows, parsedPreviousRows) {
  const result = {};
  const all = parsedCurrentRows.concat(parsedPreviousRows);

  // התאמה לפי *שעת השעון* של סוף הסיור מול שעת ההתחלה של הגשש,
  // ולא לפי דקות-יום-מבצעי: השעה 14:00 היא גם סוף יממה (2280) וגם
  // תחילת יממה (840), כך שהשוואת דקות-מבצעי מפספסת סיור שמסתיים ב-14:00.
  const clockMin = function(m) { return ((m % (24*60)) + (24*60)) % (24*60); };

  const pairs = [
    { trackerStart: '14:00', tourEndClock: timeStringToMinutes_('14:00') },
    { trackerStart: '22:00', tourEndClock: timeStringToMinutes_('22:00') },
    { trackerStart: '07:00', tourEndClock: timeStringToMinutes_('06:00') }
  ];

  pairs.forEach(function(p){
    // מפתח היעד = דקות-יום-מבצעי של תחילת משמרת הגשש (תואם ל-findTrackerRowsToFill_).
    const trackerStartOp = normalizeToOperationalDay_(timeStringToMinutes_(p.trackerStart));

    const soldiers = all
      .filter(function(s){ return isPatrolShift_(s); })
      .filter(function(s){ return s.hasRealTimeRange; })
      .filter(function(s){ return clockMin(s.endMin) === p.tourEndClock; })
      .map(function(s){ return s.soldier; })
      .filter(function(n){ return !shouldIgnoreSoldier_(n); });

    result[String(trackerStartOp)] = unique_(soldiers);
  });

  return result;
}

function findTrackerRowsToFill_(currentRows) {
  const map = {};
  currentRows.forEach(function(row){
    if (!isTracker_(row)) return;
    const timeInfo = parseShiftTime_(row, [], 'כונן גשש');
    if (!timeInfo.hasRealTimeRange) return;
    const key = String(timeInfo.startMin);
    if (!map[key]) map[key] = [];
    map[key].push(row);
  });
  Object.keys(map).forEach(function(key){ map[key].sort(function(a,b){ return a.rowNumber - b.rowNumber; }); });
  return map;
}

function buildCarmelSourceMap_(parsedCurrentRows, parsedPreviousRows, rifleMap) {
  // v3.9: מחזיר פונקציית-חיפוש: בהינתן רגע התחלה מוחלט של משבצת כרמל,
  // מחזירה את רשימת יורדי עמדות ההגנה שמסתיימים בדיוק באותו רגע.
  // התאמה לפי תאריך+שעה מוחלטים (עמודה H), בלי חשבון "יום מבצעי".
  const all = parsedCurrentRows.concat(parsedPreviousRows);

  const byEndTime = {}; // key = getTime() של רגע הסיום -> [soldiers]
  all
    .filter(function(s){ return s.type === 'עמדות הגנה'; })
    .filter(function(s){ return CONFIG.DEFENSE_POSTS.indexOf(s.position) !== -1; })
    .filter(function(s){ return s.hasRealTimeRange && s.date; })
    .filter(function(s){ return !shouldIgnoreSoldier_(s.soldier); })
    .forEach(function(s){
      const endAbs = absoluteEndDateTime_(s);
      if (!endAbs) return;
      const k = String(endAbs.getTime());
      if (!byEndTime[k]) byEndTime[k] = [];
      if (byEndTime[k].indexOf(s.soldier) === -1) byEndTime[k].push(s.soldier);
    });

  return {
    // מחזיר את היורדים עבור משבצת כרמל שמתחילה ברגע המוחלט הנתון.
    forCarmelStart: function(carmelStartAbs) {
      if (!carmelStartAbs) return [];
      return (byEndTime[String(carmelStartAbs.getTime())] || []).slice();
    }
  };
}

// v3.9: רגע ההתחלה המוחלט של משמרת (תאריך השורה מעמודה H + שעת התחלה).
function absoluteStartDateTime_(shift) {
  if (!shift || !shift.date || !shift.hasRealTimeRange) return null;
  const clockStart = ((shift.startMin % (24*60)) + (24*60)) % (24*60);
  return makeDateTime_(shift.date, clockStart);
}

// רגע הסיום המוחלט: התחלה + משך.
function absoluteEndDateTime_(shift) {
  const startAbs = absoluteStartDateTime_(shift);
  if (!startAbs) return null;
  const durationMin = shift.endMin - shift.startMin; // חיובי תמיד (normalizeEnd_)
  return new Date(startAbs.getTime() + durationMin * 60 * 1000);
}

function makeDateTime_(calDate, minutesFromMidnight) {
  const d = stripTime_(calDate);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutesFromMidnight/60), minutesFromMidnight%60, 0, 0);
}



/* ============================================================
 * v3.5 - ולידציה משותפת + בורר תאריך ל"כל השבצק"
 * ============================================================ */

// ליבת הוולידציה - משותפת לשני מסלולי ההרצה (טאב שבצק / כל השבצק).
// v3.14: staticRotationHistory - הימים המבצעיים הקודמים (אתמול, שלשום, ...)
// לבדיקת הרוטציה הסטטית. אופציונלי: בלעדיו הבדיקה פשוט מדלגת.
function runShabzakValidation_(parsedTarget, parsedPrevious, roster, titleDate, sourceLabel, returnHtml, staticRotationHistory) {
  const errors = [];
  const warnings = [];

  validateRestBetweenShifts_(parsedTarget, parsedPrevious, errors);
  validateOverlaps_(parsedTarget, errors);
  validateDailyMissionExclusivity_(parsedTarget, errors);
  validateCarmelBasedOnDefensePosts_(parsedTarget, parsedPrevious, errors);
  validateCarmelMinimumStaff_(parsedTarget, errors);
  validateTrackerBasedOnTours_(parsedTarget, parsedPrevious, errors);
  validateDailyHours_(parsedTarget, roster, errors, warnings);
  validateConsecutiveStaticDays_(parsedTarget, staticRotationHistory, warnings);
  validateAvailabilityAndMissingAssignments_(parsedTarget, roster, errors, warnings);

  const header = [
    'ולידציה: ' + titleDate + ' (יממה מבצעית 14:00-14:00)',
    '', 'מקור נתונים: ' + sourceLabel, '',
    'נבדקו:',
    '- מנוחה של לפחות 8 שעות בין שמירות, כולל היום הקודם',
    '- חפיפות בין משימות',
    '- משימה יומית בלעדית: בלי עמדה נוספת באותה יממה ' +
      '(פטורים: גשש, כרמל, ופעילות התקפית על גבי כוננות התקפית)',
    '- כרמל על בסיס יורדים מעמדות הגנה',
    '- לפחות 3 כרמל חטיבה + 1 מפקד כרמל חטיבה בכל משמרת',
    '- כונן גשש על בסיס יורדי סיור (14/22/07)',
    '- לא יותר מ־8 שעות ביום + הערה על פחות מ־8',
    '- לא יותר מ־' + CONFIG.MAX_CONSECUTIVE_STATIC_DAYS +
      ' ימים רצופים בעמדות הגנה (רוטציה סטטי/דינמי)',
    '- חופש/לא מגויס מול שיבוץ, ונוכחים בלי משימה',
    '- שעת ההחלפה של החופש: 06:00, וביום ראשון 09:00',
    '- יציאה קצרה מאושרת ("יציאה מ.. עד ..") מול שעות המשבצת', ''
  ];
  if (returnHtml) return buildValidationResultHtml_(errors, warnings, header);
  showValidationResult_(errors, warnings, header);
}

function validateCurrentShabzakTab() {
  const ss = SpreadsheetApp.getActive();
  const currentSheet = ss.getSheetByName('שבצק');
  const allScheduleSheet = ss.getSheetByName(CONFIG.SCHEDULE_SHEET_NAME);
  const rosterSheet = ss.getSheetByName(CONFIG.ROSTER_SHEET_NAME);

  if (!currentSheet) { showValidationResult_(['לא נמצא טאב בשם "שבצק".'], []); return; }
  if (!allScheduleSheet) { showValidationResult_(['לא נמצא טאב בשם "' + CONFIG.SCHEDULE_SHEET_NAME + '".'], []); return; }
  if (!rosterSheet) { showValidationResult_(['לא נמצא טאב בשם "' + CONFIG.ROSTER_SHEET_NAME + '".'], []); return; }

  const errors = [];
  const warnings = [];

  const targetDate = parseDateCell_(currentSheet.getRange('E1').getValue());
  if (!targetDate) { showValidationResult_(['לא הצלחתי לזהות תאריך בתא E1 בטאב "שבצק".'], []); return; }
  const scheduleOpDay = stripTime_(targetDate);

  const targetRows = readCurrentShabzakTab_(currentSheet, targetDate, errors);
  if (!targetRows.length) { showValidationResult_(['לא נמצאו שיבוצים בטאב "שבצק" עבור ' + formatDate_(targetDate) + '.'], []); return; }

  const allSchedule = readSchedule_(allScheduleSheet, errors);
  const parsedPrevious = getPreviousOpDayShifts_(allSchedule.rows, scheduleOpDay, errors, warnings);
  const roster = readRoster_(rosterSheet, targetDate, errors);
  const parsedTarget = buildParsedShifts_(targetRows, errors, warnings, 'שבצק');

  const staticHistory = getStaticRotationHistory_(allSchedule.rows, scheduleOpDay);

  if (errors.length) { showValidationResult_(errors, warnings); return; }
  runShabzakValidation_(parsedTarget, parsedPrevious, roster, formatDate_(targetDate), 'טאב "שבצק" (E1) + יום מבצעי קודם מ"כל השבצק"', false, staticHistory);
}

// v3.5 (בעיה #3): ולידציה ל"כל השבצק" - בורר תאריך, ואז אותה ולידציה.
function validateAllShabzakByDate() {
  const html = HtmlService.createHtmlOutput(
    '<div dir="rtl" style="font-family:Arial,sans-serif;padding:16px;">' +
    '<div id="picker">' +
      '<p>בחר את תאריך יום השבצ״ק (היממה מתחילה ב-14:00 בתאריך זה):</p>' +
      '<input type="date" id="d" style="font-size:16px;padding:6px;" />' +
      '<div style="margin-top:16px;">' +
        '<button id="btn" style="font-size:15px;padding:6px 18px;" onclick="go()">הרץ ולידציה</button>' +
      '</div>' +
    '</div>' +
    '<div id="status" style="display:none;margin-top:8px;font-size:15px;">' +
      '<span class="spin" style="display:inline-block;width:16px;height:16px;border:3px solid #ccc;border-top-color:#3367d6;border-radius:50%;vertical-align:middle;animation:sp 0.8s linear infinite;"></span>' +
      '<span style="margin-right:8px;">מריץ ולידציה, רגע...</span>' +
    '</div>' +
    '<div id="result" style="display:none;"></div>' +
    '<style>@keyframes sp{to{transform:rotate(360deg)}}</style>' +
    '<script>' +
    'function go(){' +
      'var v=document.getElementById("d").value;' +
      'if(!v){alert("בחר תאריך");return;}' +
      'document.getElementById("btn").disabled=true;' +
      'document.getElementById("picker").style.display="none";' +
      'document.getElementById("status").style.display="block";' +
      'google.script.run' +
        '.withSuccessHandler(showResult)' +
        '.withFailureHandler(showError)' +
        '.getAllShabzakValidationHtml(v);' +
    '}' +
    'function showResult(html){' +
      'document.getElementById("status").style.display="none";' +
      'var r=document.getElementById("result");' +
      'r.style.display="block";r.innerHTML=html;' +
    '}' +
    'function showError(err){' +
      'document.getElementById("status").style.display="none";' +
      'var r=document.getElementById("result");' +
      'r.style.display="block";' +
      'r.innerHTML="<div style=\'color:#b00;\'>שגיאה: "+(err&&err.message?err.message:err)+"</div>";' +
    '}' +
    '</script></div>'
  ).setWidth(900).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html, 'ולידציה לטאב כל השבצק');
}

// v3.6: מחזיר את תוצאות הוולידציה כ-HTML (במקום לפתוח דיאלוג חדש),
// כדי שהחלון של בורר התאריך יציג אותן באותו מקום.
function getAllShabzakValidationHtml(iso) {
  const parts = String(iso).split('-');
  const targetDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return runAllShabzakValidationForDate_(targetDate, true);
}

function runAllShabzakValidationForDate_(targetDate, returnHtml) {
  const ss = SpreadsheetApp.getActive();
  const allScheduleSheet = ss.getSheetByName(CONFIG.SCHEDULE_SHEET_NAME);
  const rosterSheet = ss.getSheetByName(CONFIG.ROSTER_SHEET_NAME);

  // עוזר: מציג בדיאלוג *או* מחזיר HTML, לפי מקור הקריאה.
  const emit = function(errs, warns, header) {
    if (returnHtml) return buildValidationResultHtml_(errs, warns, header || []);
    showValidationResult_(errs, warns, header || []);
    return null;
  };

  if (!allScheduleSheet) { return emit(['לא נמצא טאב בשם "' + CONFIG.SCHEDULE_SHEET_NAME + '".'], []); }
  if (!rosterSheet) { return emit(['לא נמצא טאב בשם "' + CONFIG.ROSTER_SHEET_NAME + '".'], []); }

  const errors = [];
  const warnings = [];
  const scheduleOpDay = stripTime_(targetDate);

  const allSchedule = readSchedule_(allScheduleSheet, errors);

  // "היום" = כל השורות ב"כל השבצק" ששייכות ליום המבצעי הנבחר.
  const targetRowsRaw = allSchedule.rows.filter(function(r){
    if (!r.date) return false;
    const t = parseShiftTime_(r, [], 'זיהוי יום');
    const startMin = t.hasRealTimeRange ? (t.startMin % (24*60)) : (CONFIG.OPERATIONAL_DAY_START_HOUR*60);
    return sameDate_(operationalDayOfDateTime_(r.date, startMin), scheduleOpDay);
  });

  if (!targetRowsRaw.length) {
    return emit(['לא נמצאו שיבוצים ב"' + CONFIG.SCHEDULE_SHEET_NAME + '" ליום המבצעי ' + formatDate_(targetDate) + '.'], []);
  }

  const parsedTarget = buildParsedShifts_(targetRowsRaw, errors, warnings, 'כל השבצק - יום נבחר');
  const parsedPrevious = getPreviousOpDayShifts_(allSchedule.rows, scheduleOpDay, errors, warnings);
  const roster = readRoster_(rosterSheet, targetDate, errors);
  const staticHistory = getStaticRotationHistory_(allSchedule.rows, scheduleOpDay);

  if (errors.length) { return emit(errors, warnings); }
  return runShabzakValidation_(parsedTarget, parsedPrevious, roster, formatDate_(targetDate), 'טאב "' + CONFIG.SCHEDULE_SHEET_NAME + '" ליום מבצעי נבחר', returnHtml, staticHistory);
}
