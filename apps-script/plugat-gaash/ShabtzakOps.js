/***************
 * שבצ"ק - ולידציה, מילוי ומצבה (קובץ מאוחד) - v3.12 שעון לחימה 14:00-14:00
 *
 * Sheet names:
 * - כל השבצק
 * - מצבת החיילים
 *
 * שינויים בגרסה זו (v3.12) - יציאה קצרה מאושרת:
 * 1. סטטוס "יציאה HH:MM-HH:MM" ב"מצבת החיילים" (יום קלנדרי אחד,
 *    סיום אחרי התחלה) נקרא כחלון זמן אמיתי. שיבוץ שחופף לו הוא
 *    שגיאה. הבדיקה חצי-פתוחה: יציאה עד 22:00 ומשימה מ-22:00 תקינות.
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

  // v3.12: יציאה קצרה מאושרת נרשמת ב"מצבת החיילים" בפורמט
  // "יציאה HH:MM-HH:MM" (יום קלנדרי אחד, שעת סיום אחרי שעת התחלה).
  // היא חוסמת שיבוץ שחופף לה, לא נספרת כשעות עבודה, ולא דורשת מנוחה
  // סביבה - חייל שיצא עד 22:00 יכול לעלות למשימה ב-22:00.
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
    rosterFullName: 'שם מלא'
  }
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

  const dateCol = findRosterDateColumn_(values, headerRowIndex, targetDate);

  if (dateCol === -1) {
    errors.push('לא נמצאה עמודת תאריך ' + formatDate_(targetDate) + ' בטאב "' + sheet.getName() + '".');
    return { soldiers: new Map() };
  }

  // v3.7: יום השיבוץ חוצה שני ימים קלנדריים (שעון 14:00), ולכן טוענים
  // גם את עמודת המחר. משבצת שנופלת קלנדרית ב-targetDate+1 נבדקת מולה.
  const tomorrowDateCol = findRosterDateColumn_(values, headerRowIndex, addDays_(targetDate, 1));

  const isUnavailable = function(statusText) {
    return CONFIG.UNAVAILABLE_STATUS_WORDS.some(function(word){ return statusText.indexOf(word) !== -1; });
  };

  const soldiers = new Map();

  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const name = normalize_(values[i][fullNameCol]);
    if (!name) continue;

    const statusToday = normalize_(values[i][dateCol]);
    const statusTomorrow = tomorrowDateCol !== -1 ? normalize_(values[i][tomorrowDateCol]) : statusToday;
    const unavailableToday = isUnavailable(statusToday);
    const unavailableTomorrow = isUnavailable(statusTomorrow);

    soldiers.set(name, {
      name,
      status: statusToday,          // תאימות לאחור
      statusToday: statusToday,
      statusTomorrow: statusTomorrow,
      unavailable: unavailableToday, // תאימות לאחור: זמינות "היום"
      unavailableToday: unavailableToday,
      unavailableTomorrow: unavailableTomorrow,
      hasTomorrowColumn: tomorrowDateCol !== -1,
      // "פעיל" = זמין בלפחות אחד משני חלקי היום המבצעי.
      active: !(unavailableToday && unavailableTomorrow)
    });
  }

  return { soldiers };
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
      // כרמל, כוננות התקפית וכונן גשש הם כוננויות שינה -
      // לא נספרים בתקרת 8 השעות היומית.
      hoursForDailyTotal: (isCarmel || isAttackReadiness || isTracker) ? 0 : timeInfo.hoursForDailyTotal
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
    if (endOp - startOp >= CONFIG.DAILY_MIN_SPAN_HOURS * 60) return dailyTimeInfo_();

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
 * יציאה קצרה מאושרת ("יציאה HH:MM-HH:MM" במצבת החיילים)
 * משותף ל-ShabtzakOps ול-ShavtzakRecommendation (אותו פרויקט,
 * אותו scope גלובלי). פונקציה טהורה - בלי תלות ב-CONFIG של אף צד.
 * ============================================================ */

// מחזיר {startMin, endMin} בדקות מחצות של אותו יום קלנדרי, או null.
// דורש פורמט קשיח ויום קלנדרי אחד: שעת הסיום חייבת להיות אחרי ההתחלה.
function parseExitStatus_(text) {
  const t = normalize_(text);
  const m = t.match(/^יציאה\s+([01]\d|2[0-3]):([0-5]\d)\s*-\s*([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;

  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (endMin <= startMin) return null;

  return { startMin: startMin, endMin: endMin, text: t };
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

// חלון המשבצת על ציר היממה המבצעית (דקות מחצות של יום השבצ"ק).
// משימה יומית תופסת את היממה כולה.
function shiftWindowOnOpAxis_(shift) {
  const dayStart = CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
  if (shift.isDaily) return { start: dayStart, end: dayStart + 24 * 60 };
  if (shift.hasRealTimeRange) return { start: shift.startMin, end: shift.endMin };
  return null;
}

// משימה יומית = היממה המבצעית המלאה 14:00 עד 14:00 למחרת.
// לצורך תקרת השעות היא נספרת כ-DAILY_HOURS (8) ולא כ-24, ובלי טווח
// שעות אמיתי - כלומר לא נכנסת לבדיקת החפיפות.
function dailyTimeInfo_() {
  return {
    isDaily: true,
    hasRealTimeRange: false,
    startMin: null,
    endMin: null,
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
  const badExitFormats = new Set();

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

  targetShifts.forEach(function(s){
    if (shouldIgnoreSoldier_(s.soldier)) return;
    assignedNames.add(s.soldier);

    const soldier = roster.soldiers.get(s.soldier);
    if (!soldier) return; // מטופל בהמשך

    const isTomorrow = slotIsTomorrow(s);
    const unavailable = isTomorrow ? soldier.unavailableTomorrow : soldier.unavailableToday;
    const status = isTomorrow ? soldier.statusTomorrow : soldier.statusToday;

    if (unavailable) {
      conflicts.push({
        name: s.soldier,
        status: status,
        part: isTomorrow ? 'מחר' : 'היום',
        shift: describeShift_(s)
      });
      return;
    }

    const window = shiftWindowOnOpAxis_(s);
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
        'סטטוס יציאה בפורמט לא תקין (נדרש "יציאה HH:MM-HH:MM" באותו יום): ' + text + '.'
      );
    });
  }

  // חייל שזמין בחלק כלשהו של היום המבצעי ולא שובץ כלל
  roster.soldiers.forEach(function(soldier){
    if (!soldier.active) return;
    if (assignedNames.has(soldier.name)) return;

    // אם זמין רק בחלק אחד של היום, מציינים זאת כדי שההודעה תהיה מדויקת.
    let note;
    if (!soldier.unavailableToday && !soldier.unavailableTomorrow) {
      note = 'סטטוס: "' + soldier.statusToday + '"';
    } else if (!soldier.unavailableToday) {
      note = 'זמין בחלק "היום" (סטטוס מחר: "' + soldier.statusTomorrow + '")';
    } else {
      note = 'זמין בחלק "מחר" (סטטוס היום: "' + soldier.statusToday + '")';
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
  const prevOpDay = addDays_(scheduleOpDay, -1);

  const rowsInPrevOpDay = allScheduleRows.filter(function(r) {
    if (!r.date) return false;
    // מזהים לאיזה יום מבצעי שייכת השורה לפי תאריכה הקלנדרי + שעת ההתחלה.
    const t = parseShiftTime_(r, [], 'זיהוי יום מבצעי');
    // אם אין שעה תקינה, נופלים לשיוך לפי התאריך הגולמי (14:00 והלאה = אותו יום).
    const startMin = t.hasRealTimeRange ? (t.startMin % (24 * 60)) : (CONFIG.OPERATIONAL_DAY_START_HOUR * 60);
    const rowOpDay = operationalDayOfDateTime_(r.date, startMin);
    return sameDate_(rowOpDay, prevOpDay);
  });

  return buildParsedShifts_(rowsInPrevOpDay, errors, warnings, 'כל השבצק - יום מבצעי קודם');
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
function runShabzakValidation_(parsedTarget, parsedPrevious, roster, titleDate, sourceLabel, returnHtml) {
  const errors = [];
  const warnings = [];

  validateRestBetweenShifts_(parsedTarget, parsedPrevious, errors);
  validateOverlaps_(parsedTarget, errors);
  validateCarmelBasedOnDefensePosts_(parsedTarget, parsedPrevious, errors);
  validateCarmelMinimumStaff_(parsedTarget, errors);
  validateTrackerBasedOnTours_(parsedTarget, parsedPrevious, errors);
  validateDailyHours_(parsedTarget, roster, errors, warnings);
  validateAvailabilityAndMissingAssignments_(parsedTarget, roster, errors, warnings);

  const header = [
    'ולידציה: ' + titleDate + ' (יממה מבצעית 14:00-14:00)',
    '', 'מקור נתונים: ' + sourceLabel, '',
    'נבדקו:',
    '- מנוחה של לפחות 8 שעות בין שמירות, כולל היום הקודם',
    '- חפיפות בין משימות',
    '- כרמל על בסיס יורדים מעמדות הגנה',
    '- לפחות 3 כרמל חטיבה + 1 מפקד כרמל חטיבה בכל משמרת',
    '- כונן גשש על בסיס יורדי סיור (14/22/07)',
    '- לא יותר מ־8 שעות ביום + הערה על פחות מ־8',
    '- חופש/לא מגויס מול שיבוץ, ונוכחים בלי משימה',
    '- יציאה קצרה מאושרת ("יציאה HH:MM-HH:MM") מול שעות המשבצת', ''
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

  if (errors.length) { showValidationResult_(errors, warnings); return; }
  runShabzakValidation_(parsedTarget, parsedPrevious, roster, formatDate_(targetDate), 'טאב "שבצק" (E1) + יום מבצעי קודם מ"כל השבצק"');
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

  if (errors.length) { return emit(errors, warnings); }
  return runShabzakValidation_(parsedTarget, parsedPrevious, roster, formatDate_(targetDate), 'טאב "' + CONFIG.SCHEDULE_SHEET_NAME + '" ליום מבצעי נבחר', returnHtml);
}
