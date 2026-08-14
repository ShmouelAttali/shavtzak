/** @OnlyCurrentDoc */
/**
 * Shabtzak Recommendations Engine v3.22 - שעון לחימה 14:00-14:00
 *
 * שינויים ב-v3.22 - משבצת החפ"ק הראשונה, ומקור המנוחה בעמודה:
 * 1. משבצת החפ"ק הראשונה שמורה לצוות המפל"ג, ורק לו. הכלל דו-כיווני:
 *    איש מפל"ג מומלץ *רק* שם, ומי שאינו מפל"ג נדחה משם.
 *    hafakCommandStaffSeats: 0 מכבה אותו.
 * 2. בעקבות זה אנשי המפל"ג נקראים למצבה שהמנוע מכיר, גם שהם מחוץ
 *    ל-includePlatoons. עד כה הם לא נקראו כלל, ולכן הסמ"פ שיושב בחפ"ק
 *    כל יום קיבל "⚠ החייל לא נמצא במצבת החיילים" - התראה שקרית על
 *    שיבוץ תקין לגמרי.
 * 3. המפל"ג ירד מ-excludedPlatoonOrRoleKeywords (שנשאר לחמ"ל בלבד):
 *    חסימה גורפת שם הייתה גוברת על הכלל התלוי-משבצת. הבדיקה החדשה
 *    יושבת *מחוץ* ל-availabilityCache, שמפתחו ברזולוציית יום בלבד -
 *    אותה מלכודת של היציאה הקצרה ב-v3.6.
 * 4. עמודת "מנוחה" מסמנת "(מהתקפי)" כשהפער נמדד מכוננות התקפית יומית.
 *    המספר עצמו לא משתנה - v3.14 נשאר בתוקף - אבל בלי הסימון "4ש׳"
 *    נראה שם כמנוחה קצרה בלי שום רמז לכך שהזיכוי הוא מה שהכשיר אותה.
 *
 * שינויים ב-v3.21 - "משימה קודמת" מזהה חופש ויציאה ארוכה:
 * 1. העמודה הציגה תמיד את המשמרת האחרונה בפועל, גם כשהחייל היה בבית
 *    מאז. "סיור 22:00" מלפני שלושה ימים מטעה את הקצין שקורא את העמודה
 *    כדי לדעת במה האיש עסוק לאחרונה. עכשיו מוצג "חופש" או
 *    "יציאה 10:00-22:00" במקומה.
 * 2. נבדק *רק* הפער שבין סוף המשימה הקודמת לתחילת המשבצת. חופש שנגמר
 *    לפני המשמרת ההיא אינו רלוונטי, וחלון שחופף לפער תמיד עדכני ממנה.
 * 3. יציאה קצרה נספרת רק אם היא ארוכה מ-previousColumn.longExitMinHours
 *    (8) שעות: "יציאה מ10 עד 22" נכנסת, "יציאה מ20" (4 שעות) לא.
 * 4. כששניהם חלים מנצח המאוחר מביניהם, ובתיקו החופש.
 * 5. ⚠ במצבת החיילים יש שלוש עמודות בלבד (אתמול/היום/מחר), ולכן חופש
 *    ישן יותר מזה פשוט אינו נראה - והעמודה נשארת כשהייתה. זו מגבלת
 *    נתונים, לא בחירה: אין מאיפה לקרוא יום רביעי אחורה.
 *
 * שינויים ב-v3.20 - המשבצת האחרונה בהתקפי שמורה לנהג טיגריס:
 * 1. אותו כלל שקיים בסיור מאז v3.6 (משבצת אחרונה = נהג דוד), עכשיו גם
 *    בהתקפי עם נהג טיגריס: מי שאינו נהג טיגריס נדחה מהמשבצת, ונהג
 *    טיגריס שיכול עדיין לאייש משבצת-נהג פנויה אינו מומלץ לעמדה אחרת.
 * 2. ⚠ בהתקפי זו המשבצת האחרונה של *הקבוצה כולה*, לא של כל צוות.
 *    כך הגיליון נכתב בפועל: בבלוקים בני 8 מושבים (07-11/08) הטיגריס
 *    יושב במושב 8 בלבד, ומושב 4 - סוף הצוות הראשון - לעולם אינו נהג.
 *    זה שונה מכלל המפקד, שהוא כן לכל צוות (getTeamTasksForTask_).
 * 3. הכלל מוגדר פעם אחת ב-driverSeatRules ולא כשני עותקים של אותן שש
 *    פונקציות; שכפול הוא בדיוק איך שכללים כאלה נפרדים זה מזה עם הזמן.
 *    שמירת הנהגים מכבדת את סוג הנהג - נהג דוד אינו שמור למושב הטיגריס.
 * 4. סטטוס הקבוצה בהתקפי מדבר עכשיו על *מיקום* הטיגריס. ההודעה הישנה
 *    ("יש/חסר נהג טיגריס") נשארת רק לקבוצה בת מושב אחד, שבה אין
 *    "משבצת אחרונה" נפרדת.
 *
 * שינויים ב-v3.19 - "בדוחק" מסביר את עצמו, ומשימה יומית שווה 8 שעות:
 * 1. תא המועמדים כותב עכשיו "(בדוחק: עומס 16ש׳)" במקום "(בדוחק)" יבש.
 *    ארבעה כללים שונים מייצרים את אותה מילה, ושלושה מהם אינם נראים
 *    בשום עמודה: תקרת העומס היומי, מנוחה *אחרי* המשבצת, וייעוד הגשש.
 *    נמדד על הגיליון החי: 74 מתוך 100 הסימונים היו תקרת העומס, כלומר
 *    הרוב המכריע של הסימונים לא היה ניתן להסבר מהמסך.
 * 2. dailyMissionWorkloadHours: 16 -> 8, וכוננות התקפית נספרת ככוננות
 *    (0 שעות עבודה) בדיוק כמו כונן גשש ב-v3.16. הוולידציה תמיד ספרה
 *    כך - CONFIG.DAILY_HOURS = 8, ו-hoursForDailyTotal = 0 לכוננות
 *    התקפית - והמנוע ספר 16. חייל בכוננות התקפית עבר בכך את תקרת
 *    maxSameDayMissionHours (10) *לפני* שקיבל משבצת כלשהי, ולכן ירד
 *    ל"בדוחק" בכל משבצת ביממה המבצעית הזאת.
 * 3. אותו כלל חל על שני מוני השעות (העומס היומי ו-7 הימים), כדי שלא
 *    ייווצר הפרש חדש בין השניים.
 *
 * שינויים ב-v3.18 - שעת ההחלפה של החופש (06:00, ביום ראשון 09:00):
 * 1. יום היציאה לחופש ויום החזרה ממנו הם ימים חלקיים: ביום הראשון
 *    ממליצים על משמרת שנגמרת עד שעת ההחלפה, וביום החזרה רק על משמרת
 *    שמתחילה ממנה ואילך. משמרת 02:00 ביום חזרה נדחית, 06:00 מומלצת.
 * 2. הבדיקה יושבת *מחוץ* ל-availabilityCache (findVacationChangeConflict_),
 *    כי הקאש ממופתח ברזולוציית יום והתשובה כאן תלויה בשעות המשבצת -
 *    בדיוק כמו יציאה קצרה מאושרת ב-v3.6.
 * 3. getStatusForSlot_ מחזיר גם את סטטוס היום שלפני המשבצת, שהוא מה
 *    שמבדיל יום ראשון של חופש מיום חזרה.
 * 4. הלוגיקה המשותפת (isVacationStatusText_, vacationChangeMinutesForDate_,
 *    vacationTransitionForDay_) מוגדרת ב-ShabtzakOps.js ומשמשת את שני
 *    הקבצים, כמו parseExitStatus_ ו-rangesOverlap_. בוולידציה זהו v3.15.
 *
 * שינויים ב-v3.17 - כונן גשש אינו משימה סטטית:
 * 1. getMissionClass_('tracker') מחזיר '' (לא מסווג) במקום 'static'.
 *    הגשש הוא כוננות שינה של 0 שעות עבודה על גבי משימה אמיתית, ולכן
 *    אינו שייך לרוטציה סטטי<->דינמי בשום כיוון.
 * 2. מה שיוצא מזה: הגשש לא נספר ב-staticMissionClassCount (משקל 5),
 *    לא גורר את קנס "אותה מחלקת משימה אתמול", לא מקבל קנס רצף
 *    סטטיות ולא בונוס שבירת רצף.
 * 3. ברצף הסטטיות: יום שכל מה שהיה בו הוא גשש נספר עד כה כיום סטטי
 *    והאריך את הרצף, ולכן חייל שרק ישן בכוננות קיבל את קנס "חייב
 *    דינמית". עכשיו יום כזה מתנהג כיום מנוחה ומאפס את הרצף. יום עם
 *    עמדה סטטית אמיתית ממשיך להיספר בדיוק כמו קודם.
 *
 * שינויים ב-v3.16 - כונן גשש = 0 שעות עבודה, כמו כרמל:
 * 1. שני צדי הסקריפט לא הסכימו. הוולידציה (ShabtzakOps) נותנת לגשש
 *    hoursForDailyTotal = 0 ומסננת אותו מ-validateDailyHours_ בדיוק
 *    כמו כרמל; המנוע, לעומת זאת, ספר אותו כ-8 שעות משימה למשמרת
 *    (trackerDailyWorkloadHours) - גם ב-totalHours של 7 הימים (משקל
 *    1.4 לשעה) וגם בעומס היומי. יורד סיור נראה שם כמי שעשה 16 שעות.
 * 2. עכשיו שעות הגשש נרשמות ב-konenutHours בשני מוני השעות, בדיוק
 *    כמו כרמל: 0 שעות משימה, 0 במשקל השעות, 0 בתקרה היומית. תצוגת
 *    "עומס 7 ימים" מציגה אותן כ"כוננות".
 * 3. ההגדרה isKonenutCategory_ *לא* השתנתה - היא שולטת גם בדילוג על
 *    המלצות ובחסימות, והגשש חייב להמשיך לקבל המלצות. השינוי נקודתי
 *    לשעות בלבד; ספירת המשימות לרוטציה טופלה בנפרד ב-v3.17.
 * 4. עם זה ירד גם הפטור הזמני מתקרת העומס שנוסף ב-v3.15: כשהגשש שווה
 *    0 שעות, 8ש׳ סיור + גשש הם 8 שעות ולא 16, והתקרה פשוט לא נחצית.
 *
 * שינויים ב-v3.15 - כונן גשש: רק יורדי הסיור, ולפי הוגנות:
 * 1. עד כה "ירד מהסיור התואם" היה בונוס (trackerAfterTourBonus) בלבד,
 *    ולכן חייל שלא היה בסיור יכול היה לעלות לראש רשימת הגשש. עכשיו
 *    מי שלא ירד מסיור שהסתיים עד trackerTourDescentMaxGapHours לפני
 *    תחילת המשמרת יורד ל"בדוחק" - כלומר מוצג רק כשאין אף יורד סיור
 *    זמין, ותמיד בתחתית הרשימה ועם אזהרה. זו לא חסימה קשיחה בכוונה:
 *    משמרת גשש חייבת להתאייש גם ביום שבו הסיור עדיין לא שובץ.
 * 2. הוגנות גשש, בדיוק כמו הוגנות תורנויות (v3.10): בין יורדי הסיור
 *    מדרגים לפי כמה משמרות "כונן גשש" עשה החייל בכל ההיסטוריה של
 *    "כל השבצק" - לא רק בחלון הלוקבק. קנס לינארי עם תקרה, כך שמי
 *    שעשה הכי מעט עולה לראש והיסטוריה חריגה לא חוסמת לתמיד.
 * 3. אותה קריאה יחידה של "כל השבצק" מזינה עכשיו שלושה צרכנים: חלון
 *    הלוקבק, ספירת התורנויות וספירת הגששים.
 * 4. תקרת העומס היומי (maxSameDayMissionHours) הפסיקה להוריד את יורד
 *    הסיור ל"בדוחק": 8ש׳ סיור + 8ש׳ גשש חצו אותה תמיד, ולכן בלי זה
 *    *כל* מועמד תקין לגשש היה מסומן "בדוחק" והסימון היה מאבד משמעות.
 *    (v3.16 החליף את הפטור הזה בפתרון השורש - 0 שעות עבודה לגשש.)
 *
 * שינויים ב-v3.14 - מנוחה לפני כוננות התקפית יומית:
 * 1. הכוננות ההתקפית היומית מזכה 4 שעות מנוחה גם *לפניה*, לא רק
 *    אחריה: שעותיה הראשונות הן המתנה, ולכן היא "מתחילה בפועל"
 *    ב-18:00. כך מי שירד מעמדה סטטית ב-10:00 נחשב כמי שנח 8 שעות
 *    ומומלץ כרגיל, במקום להידחות ל"בדוחק" (attackRestCreditBeforeHours).
 * 2. רק בצד ה"לפני". בצד ה"אחרי" אין צורך: מי שכבר משובץ לכוננות
 *    יומית נדחה עוד קודם ("כבר משובץ למשימה יומית"), כך שהיא לעולם
 *    אינה מגיעה לבדיקת המנוחה כמשימה הבאה.
 * 3. שני זיכויים אינם מצטברים (max): שתי כוננויות צמודות עדיין
 *    נופלות בבדיקת המנוחה.
 * 4. הזיכוי פותח כשירות בלבד: בונוס הזמינות, עמודת "מנוחה" והנימוק
 *    "נח X" ממשיכים להציג את הפער האמיתי בין המשמרות. זה גם שינוי
 *    מול v3.9, שהציגה שם את השעות כולל הזיכוי - העמודה תואמת עכשיו
 *    את מה שכתוב בשבצ"ק, וההסבר לזיכוי יושב בעמודת ההתאמה.
 * ⚠ בוולידציה (ShabtzakOps) הכוננות ההתקפית ממילא שקופה למנוחה
 *    לגמרי - validateRestBetweenShifts_ מסננת אותה - כך שהשינוי הזה
 *    מיישר את ההמלצות לוולידציה, ולא להפך.
 *
 * שינויים ב-v3.11 - קצין מוצב פתוח לכל מפקד:
 * 1. עד כה קצין מוצב נדרש סמל או מ״מ (isSeniorCommander), ולכן מ״כים
 *    ומ״חים נדחו ממנו למרות שהם מפקדים לכל דבר. עכשיו הרף זהה לרף
 *    של מפקד סיור: soldierCanCommandTask_ מחזיר isCommander לכל
 *    המשימות הפיקודיות, בלי חריג לקצין מוצב.
 * 2. גם סטטוס הקבוצה והאזהרה התיישרו: "יש/חסר מפקד" במקום
 *    "יש/חסר סמל/מ״מ".
 *
 * שינויים ב-v3.10 - תורנות: קבוצת רוטציה והוגנות:
 * 1. תיקון זיהוי: "תורנים" (נו"ן רגילה) לא נתפס ע"י החיפוש 'תורן'
 *    (נו"ן סופית), ולכן 108 שורות התורנות ב"כל השבצק" - וגם המשבצות
 *    של היום - נפלו ל-day_blocking בלי שום קבוצת רוטציה. התוצאה:
 *    סטטיות ואז תורנות לא נחשבו לאותה קבוצה ולא נענשו. שני האיותים
 *    נמצאים עכשיו ב-toranutKeywords, ותורנות היא daily_duty = סטטית.
 * 2. הוגנות תורנויות: בשיבוץ תורנות נספרות *כל* התורנויות הקודמות של
 *    החייל בכל "כל השבצק" (לא רק חלון הלוקבק), וכל אחת מוסיפה קנס.
 *    כך מי שעשה הכי מעט עולה לראש הרשימה. התקרה מונעת חסימת-לתמיד של
 *    מי שהיסטורית עשה הרבה.
 * 3. "כל השבצק" נקרא פעם אחת ומשרת גם את חלון הלוקבק וגם את הספירה
 *    ההיסטורית, כדי לא לשלם קריאה שנייה על גיליון של ~4700 שורות.
 *
 * שינויים ב-v3.9 - זיכוי מנוחה אחרי התקפי יומי:
 * 1. כוננות התקפית יומית (התקפי / יומי) תופסת 14:00-14:00 אבל רובה
 *    המתנה - בוולידציה היא נספרת כ-8 שעות עבודה בלבד. לכן בסיומה
 *    (14:00) החייל נחשב כמי שכבר נח attackRestCreditHours (4) שעות,
 *    ולא כמי שיורד ממשמרת רגע לפני המשימה הבאה.
 * 2. התוצאה המכוונת: הוא כשיר מיד לעמדה סטטית של 4 שעות (מינימום
 *    מנוחה 4), עם אזהרת "מנוחה קצרה"; משימה ארוכה מ-4 שעות (סיור)
 *    עדיין נדחית - היא דורשת 8 שעות מנוחה.
 * 3. הזיכוי חל רק על התקפי *יומי*, לשני הכיוונים (המשימה שאחריו
 *    ולמשימה שלפני התקפי הבא). פעילות התקפי עם טווח שעות מפורש היא
 *    משמרת רגילה ואינה מזוכה.
 *
 * שינויים ב-v3.8 - צוותי התקפי:
 * 1. התקפי יוצא בשני צוותים באותה קבוצה (משבצות 1-4 ו-5-8). ההעדפה
 *    "אותה מחלקה כמו המפקד" נמדדת מול מפקד הצוות של אותה משבצת:
 *    משבצות 2-4 לפי המפקד במשבצת 1, ומשבצות 6-8 לפי המפקד במשבצת 5.
 *    קודם כל שמונה המשבצות נמדדו מול המפקד שבמשבצת 1.
 * 2. אם לצוות אין מפקד משלו (למשל אין מפקד במשבצת 5) חוזרים למפקד
 *    הקבוצה, כך שגם המשבצות האלה מעדיפות חיילים מאותה מחלקה.
 *
 * שינויים ב-v3.7 - יציאה קצרה מאושרת:
 * 1. סטטוס יציאה ב"מצבת החיילים" ("יציאה מ10 עד 22" / "יציאה מ20" /
 *    "יציאה עד 10") חוסם רק את חלון הזמן שלו, לא את היום כולו
 *    (findExitConflict_). הבדיקה חצי-פתוחה:
 *    חייל שיצא עד 22 יכול לעלות למשימה שמתחילה ב-22:00.
 *    היא נעשית מחוץ ל-availabilityCache, שמפתחו ברזולוציית יום בלבד
 *    ולכן היה מחזיר את אותה תשובה לשתי משבצות בשעות שונות.
 * 2. היציאה אינה נכנסת ל-assignments ולכן אינה נספרת בשעות עבודה
 *    ואינה משפיעה על חישובי מנוחה - היא רק תופסת את חלון הזמן שלה.
 * 3. exitPackageMisfitPenalty: קנס רך על משימה חלקית שתדרוש משמרת
 *    משלימה שאין לה חלון פנוי סביב היציאה (למשל עמדת הגנה של 4 שעות
 *    מול יציאה ארוכה). כשהיציאה מתאימה לכמה סוגי משימות אין קנס לאף
 *    אחד מהם, והבחירה נשארת בידי שאר השיקולים.
 *    פירוס הפורמט ב-parseExitStatus_ (מוגדר ב-ShabtzakOps).
 *
 * שינויים ב-v3.6 - משבצת הנהג בסיור:
 * 1. המשבצת האחרונה בכל סיור שמורה לנהג דוד, כפי שהראשונה שמורה
 *    למפקד. מי שאינו נהג דוד נדחה מהמשבצת הזו; אם אין נהג פנוי היא
 *    תישאר "אין מועמד מתאים", כדי שיהיה גלוי שחסר נהג.
 * 2. נהג דוד לא מומלץ לשום עמדה אחרת כל עוד יש משבצת-נהג פנויה בסיור
 *    שהוא באמת יכול לאייש (זמין, מנוחה, בלי התנגשות). ברגע שכל
 *    המשבצות שהוא יכול לקחת מאוישות - הוא משוחרר. הבדיקה היא לכל נהג
 *    בנפרד ולכן אין קיפאון ביום שבו אין מספיק נהגים לכל שלושת הסיורים.
 * 3. "רצוי נהג דוד" הוחלף בסטטוס משבצת מפורש לכל סיור, לא רק ללילה.
 *
 * שינויים ב-v3.5 - המצבה נקראת ישירות מ"מצבת החיילים":
 * 1. עד כה המצבה שוכפלה לעמודות A:G של "שבצק" בנוסחאות
 *    (ARRAYFORMULA/VLOOKUP/XLOOKUP) והסקריפט קרא משם. עכשיו הוא קורא
 *    שם מלא / מחלקה / תפקיד וסטטוס אתמול-היום-מחר ישירות מ"מצבת
 *    החיילים", לפי כותרות ולפי עמודות התאריך במטריצת הנוכחות.
 *    בדרך נעלם באג יישור: עמודה A סוננה למחלקות 1/2/3/חמ"ל בעוד
 *    שעמודות הסטטוס (E:G) לא סוננו, כך שכל דילוג במצבה היה מזיז
 *    לכל החיילים שאחריו את הסטטוס בשורה אחת.
 * 2. עמודת "משימה יום קודם" (B) ירדה: היא נגזרה מ"כל השבצק", ואת
 *    ההיסטוריה הסקריפט קורא ממילא ישירות משם.
 * 3. עמודות המשימות והפלט ב"שבצק" מזוהות לפי הכותרות ולא לפי מיקום
 *    קבוע (resolveScheduleLayout_), כדי שמחיקת עמודות A:G לא תדרוש
 *    שינוי קוד. תא התאריך נשאר scheduleDateCell (E1).
 *
 * שינויים מרכזיים ב-v3.0:
 * 1. היממה המבצעית מוגדרת בקונפיג (operationalDay.startHour = 14):
 *    כל שיוך ליום, חסימות "יומי", רצפים ו"אתמול" עובדים לפי 14:00-14:00.
 *    שעות לפני 14:00 בשבצ"ק של יום D שייכות קלנדרית ל-D+1 (carry אוטומטי).
 * 2. כל משימה "יומית" (יומי בעמודת השעה) = 14:00 עד 14:00 למחרת,
 *    כולל תורן מטבח, מגן+תגבצ, חפק וקצין מוצב.
 *    עומס: משימה יומית נספרת עד 16 שעות (dailyMissionWorkloadHours),
 *    לא 24, ולא נספרת כלילה (מניחים שינה).
 * 3. כונן גשש - 3 משמרות המבוססות על יורדי סיור:
 *    14:00-22:00 (ירד מסיור 14), 22:00-07:00 (ירד מסיור 22),
 *    07:00-14:00 (ירד מסיור 06; מתחיל 07:00 בגלל הפעילות הקבועה 05:30-07:00).
 *    רושמים בעמודת השעה טווח (למשל "22:00-07:00").
 *    מי שירד מסיור שמסתיים עד שעה וחצי לפני תחילת המשמרת מקבל בונוס
 *    ייעוד גדול ופטור מבדיקת מנוחה (זו התבנית המתוכננת - הוא ישן בכוננות).
 *    הגשש אינו נספר כלילה ושקוף למנוחה של המשימה הבאה.
 *    (v3.16: הוא גם אינו נספר כשעות עבודה כלל - ראה למעלה.)
 *
 * כולל גם (מגרסאות 2.7-2.8, למקרה שלא הוטמעו אצלך):
 * - התקפי חוסם רק את משבצת הזמן שלו; כמה פעילויות התקפי לא-חופפות
 *   מותרות לאותו חייל; תקרת עומס יומי (maxSameDayMissionHours: 10)
 *   שמעבר לה מועמד יורד ל"בדוחק".
 * - מנגנון "בדוחק", רצף סטטיות, בונוס רוטציה, כל שיפורי הביצועים.
 */

const SHABTZAK_REC_CONFIG = {
  sheets: {
    schedule: 'שבצק',
    history: 'כל השבצק',
    roster: 'מצבת החיילים'
  },

  scheduleDateCell: 'E1',

  // שעון לחימה: היממה המבצעית מתחילה ב-14:00 ומסתיימת ב-14:00 למחרת.
  // שעות לפני 14:00 בשבצ"ק של יום D מתרחשות קלנדרית ב-D+1.
  operationalDay: {
    startHour: 14,
    startMinute: 0
  },

  // v3.5: המצבה נקראת ישירות מטאב "מצבת החיילים" - עמודות המידע לפי
  // כותרת, וסטטוס אתמול/היום/מחר מעמודות התאריך של מטריצת הנוכחות.
  roster: {
    headerLabels: {
      fullName: 'שם מלא',
      role: 'תפקיד',
      platoon: 'מחלקה'
    },
    // שורת הכותרות (ומעליה שורת התאריכים) מזוהות בסריקת השורות הראשונות.
    headerSearchRows: 6,
    // מאגר המועמדים: רק המחלקות האלה. רשימה ריקה = כל המצבה.
    //
    // v3.20: אנשי המפל"ג נקראים *בנוסף* למחלקות האלה (ראה
    // commandStaffPlatoonKeywords). הם אינם מועמדים לשום עמדה מלבד
    // משבצת החפ"ק הראשונה, אבל הם חייבים להיות במצבה שהמנוע מכיר -
    // אחרת שיבוץ שלהם בחפ"ק נראה כמו חייל שאינו קיים בגיליון.
    //
    // 2026-08-10, החלטת המפקד: חמ"ל יצא מהמאגר. אנשי החמ"ל מנהלים
    // משמרות משל עצמם בטאב "שיבוץ חמל", ולכן אינם נספרים ואינם מומלצים
    // לשום עמדה. עד כה הם נכנסו למאגר ונדחו רק בשלב הזמינות
    // (excludedPlatoonOrRoleKeywords) - כלומר נבדקו לחינם בכל עמדה.
    // החסימה ההיא נשארת כרשת ביטחון.
    //
    // הרשימה נהגה זהה לנוסחת ה-FILTER בעמודה A של "שבצק", אבל מאז v3.5
    // המצבה נקראת ישירות מ"מצבת החיילים" ועמודות A:G הן שארית תצוגה
    // שהסקריפט אינו קורא - ולכן אין צורך לתחזק את השתיים ביחד.
    includePlatoons: ['1', '2', '3']
  },

  // v3.5: עמודות המשימות ב"שבצק" מזוהות לפי הכותרות בשורת הכותרת ולא
  // לפי מיקום קבוע, כדי שמחיקת עמודות המצבה הכפולה (A:G) לא תדרוש
  // שינוי קוד. הפלט נכתב מיד אחרי העמודה האחרונה מבין אלה.
  // עמודת "תאריך" (אם קיימת) היא התאריך הקלנדרי המפורש של השורה,
  // והיא מבטלת ניחוש carry לפי שעה.
  tasks: {
    headerLabels: {
      date: 'תאריך',
      position: 'העמדה',
      type: 'סוג',
      time: 'השעה',
      soldier: 'החייל'
    },
    // v3.8: היו 6. מעל טבלת המשימות ב"שבצק" יש עכשיו שורות סיכום
    // (חיילים זמינים / במגן / לסיור), ולכן שורת הכותרות יורדת למטה.
    // חלון רחב יותר כדי שהוספת שורות בראש הטאב לא תשבור את הזיהוי.
    headerSearchRows: 20
  },

  // כונן גשש: שעה בודדת בעמודת השעה -> משך משמרת מובנה.
  trackerShiftEndByStartHour: {
    14: { hour: 22, minute: 0 },
    22: { hour: 7, minute: 0 },
    7: { hour: 14, minute: 0 },
    6: { hour: 14, minute: 0 }
  },

  output: {
    // v3.5: headerRow/startCol מחושבים בזמן ריצה מתוך שורת הכותרות
    // של המשימות (ראה resolveScheduleLayout_).
    width: 6,
    headers: ['מועמדים', 'משימה קודמת', 'מנוחה', 'עומס 7 ימים', 'התאמה / אזהרות', 'סטטוס צוות'],
    columnWidths: [185, 230, 105, 145, 290, 260],
    // הערות תא (notes) עם פירוט מלא לכל מועמד. כיבוי חוסך ~1-2 שניות בכתיבה.
    writeNotes: true
  },

  // true = ה-toast בסיום מציג פירוק זמנים לפי שלב (קריאה/חישוב/כתיבה) -
  // שימושי לאבחון אם משהו עדיין איטי.
  debugTiming: true,

  history: {
    firstDataRow: 2,
    dateCol: 1,
    positionCol: 2,
    typeCol: 3,
    timeCol: 4,
    soldierCol: 5,
    // ביצועים: קוראים רק את N השורות האחרונות של "כל השבצק"
    // (בהנחה שההיסטוריה נכתבת כרונולוגית). 1500 שורות ≈ 15 ימים
    // בקצב של ~99 שורות ליום - הרבה מעבר לחלון של 10 ימים.
    maxScanRows: 1500
  },

  recommendationsLimit: 6,
  historyLookbackDays: 10,
  scoreLookbackDays: 7,

  // v3.21: עמודת "משימה קודמת". כשבין המשמרת הקודמת למשבצת החייל היה
  // בבית, המשמרת הישנה מטעה - ומציגים במקומה חופש/יציאה.
  // יציאה קצרה נחשבת רק אם היא ארוכה מ-longExitMinHours שעות; יציאה
  // בת ארבע שעות אינה "מה שהוא עשה לאחרונה".
  previousColumn: {
    longExitMinHours: 8
  },

  rest: {
    idealHours: 8,
    minimumHours: 4,
    maxDisplayedRestHours: 99,
    // כונן גשש: הכוננות ברובה שינה/המתנה, ולכן מועמד שאינו "יורד הסיור
    // המיועד" נבדק מול חלון פעילות קצר ולא מול כל המשמרת.
    // יורד הסיור התואם פטור לגמרי מבדיקת מנוחה (ראה trackerAfterTourBonus).
    trackerEffectiveDurationHours: 1.5,
    // v3.9: כוננות התקפית יומית (14:00-14:00) היא ברובה המתנה - בוולידציה
    // היא נספרת כ-8 שעות עבודה בלבד. לכן בסיומה החייל נחשב כמי שכבר נח
    // כך וכך שעות, כדי שיוכל לעלות מיד לעמדה סטטית (4 שעות).
    attackRestCreditHours: 4,
    // v3.14: אותו היגיון בכיוון ההפוך. השעות הראשונות של הכוננות הן
    // המתנה, ולכן היא "מתחילה בפועל" מאוחר יותר (14:00 -> 18:00): מי
    // שירד מעמדה סטטית ב-10:00 נחשב כמי שנח 8 שעות לפניה, ולא 4.
    // זיכוי ולא שעת התחלה קבועה - כדי שגם כוננות שנכתבה בשעה אחרת
    // תקבל את אותן 4 השעות.
    attackRestCreditBeforeHours: 4
  },

  roles: {
    commanderKeywords: ['ממ', 'מ״מ', 'מ\"מ', 'סמל', 'מכ', 'מ״כ', 'מ\"כ', 'מח', 'מ״ח', 'מ\"ח'],
    seniorCommanderKeywords: ['ממ', 'מ״מ', 'מ\"מ', 'סמל'],
    staticCommanderKeywords: ['מכ', 'מ״כ', 'מ\"כ', 'מח', 'מ״ח', 'מ\"ח'],
    dudDriverKeywords: ['נהג דוד'],
    tigerDriverKeywords: ['נהג טיגריס']
  },

  unavailableStatusKeywords: ['חופש', 'חופשה', 'לא מגויס', 'לא מגוייס'],

  // v3.20: המפל"ג ירד מכאן. הוא כבר לא חסום גורף אלא תלוי-משבצת
  // (isCommandStaffSeat_), וחסימה גורפת כאן הייתה גוברת עליה.
  // החמ"ל נשאר חסום גורף - הוא מנהל שבצ"ק משל עצמו.
  excludedPlatoonOrRoleKeywords: ['חמל', 'חמ״ל', 'חמ"ל'],

  // v3.20: משבצת החפ"ק הראשונה שמורה לצוות המפל"ג (מ"פ / סמ"פ / רס"פ /
  // סרס"פ). הכלל דו-כיווני: איש מפל"ג מומלץ *רק* שם, ומי שאינו מפל"ג
  // נדחה משם. hafakCommandStaffSeats: 0 מכבה את הכלל כולו.
  // ⚠ המחלקה בגיליון כתובה מפל"ג עם גרשיים; normalizeForSearch_ מסיר
  // אותם, ולכן 'מפלג' הוא הכתיב הנכון כאן (ראה מלכודת הכתיב במיומנות).
  commandStaffPlatoonKeywords: ['מפלג'],
  hafakKeywords: ['חפק'],
  hafakCommandStaffSeats: 1,

  ignoredTaskKeywords: ['חמל', 'חמ״ל', 'חמ\"ל'],

  staticDefenseKeywords: ['עמדות הגנה', 'עמדת הגנה', 'שג', 'ש״ג', 'ש\"ג', 'בונקר', 'מזרחית', 'דרומית'],

  // כוננות: מדולג בהמלצות, חוסם לפי הכללים בקוד, נספר כשעות כוננות בלבד,
  // שקוף למנוחה (מניחים שינה).
  carmelTaskKeywords: ['כרמל חטיבה', 'כרמל', 'כוננות'],

  // כונן גשש: קטגוריית tracker. עובד ב-3 משמרות (14-22 / 22-07 / 07-14)
  // המבוססות על יורדי סיור - רושמים טווח שעות בעמודת השעה.
  trackerKeywords: ['כונן גשש', 'גשש'],

  // תורנות. שתי הצורות נחוצות: "תורנים" נכתב בנו"ן רגילה ו-"תורן רס״פ"
  // בנו"ן סופית, ולכן חיפוש 'תורן' בלבד פספס את 108 שורות ה"תורנים"
  // שב"כל השבצק". הבדיקה תמיד אחרי הגשש - "כונן גשש ותורן רס״פ" היא
  // משמרת גשש ולא תורנות.
  toranutKeywords: ['תורנ', 'תורן'],

  postOfficerKeywords: ['קצין מוצב'],

  fullDayBlockingTimeKeywords: ['יומי'],

  // v3.7: התקפי יוצא בצוותים של 4 באותה קבוצה - משבצות 1-4 ו-5-8.
  // המשבצת הראשונה בכל צוות היא מפקד הצוות, ולפיו נקבעת העדפת המחלקה
  // לשאר משבצות אותו צוות. 0 = בלי חלוקה לצוותים.
  attackTeamSize: 4,

  // v3.20: המשבצת האחרונה בקבוצה שמורה לנהג. אותו כלל בשתי המשימות,
  // רק הנהג שונה. ⚠ בהתקפי זו האחרונה של הקבוצה כולה ולא של כל צוות -
  // כך הגיליון נכתב בפועל (בבלוק בן 8, הטיגריס במושב 8 בלבד).
  driverSeatRules: [
    { category: 'tour', flag: 'isDudDriver', label: 'נהג דוד', groupLabel: 'סיור' },
    { category: 'attack', flag: 'isTigerDriver', label: 'נהג טיגריס', groupLabel: 'התקפי' }
  ],

  magenKeywords: ['מגן', 'מגן השומרון'],
  tagbatzKeywords: ['תגבצ', 'תגב״צ', 'תגב"צ'],

  missionClassDisplayNames: {
    static: 'סטטית',
    dynamic: 'דינמית'
  },

  onEdit: {
    // v3.5: העמודות שמפעילות ריצה אוטומטית = עמודות המשימות שזוהו
    // בזמן ריצה. עמודות הסטטוס הישנות (E:G) ירדו - הן היו נוסחאות,
    // וחישוב מחדש של נוסחה לא מפעיל onEdit ממילא.
    watchDateCell: 'E1',
    lockTimeoutMs: 0 // 0 = אם כבר רצה ריצה אחרת, פשוט מוותרים (העריכה הבאה תריץ שוב)
  },

  scoring: {
    totalHourWeight: 1.4,
    nightWeight: 7,
    staticWeight: 5,
    tourWeight: 3,
    attackWeight: 8,
    commandTaskWeight: 3,
    shortRestPenalty: 28,
    veryShortRestPenalty: 80,
    samePositionPenalty: 24,
    sameCategoryPenalty: 8,
    sameTaskPreviousDayPenalty: 42,
    sameCategoryPreviousDayPenalty: 12,
    sameMissionClassPreviousDayPenalty: 18,
    // בונוס רוטציה: עשה אתמול משימה מסווגת (סטטית/דינמית) מסוג *אחר*
    // מהמשימה הנוכחית -> עדיפות. מתון בכוונה כדי לא לדרוס מנוחה ועומס.
    rotationAlternationBonus: -10,
    // רצף סטטיות: מי שעשה יומיים+ ברצף רק משימות סטטיות -
    // קנס כבד על סטטית נוספת, בונוס על דינמית ששוברת את הרצף.
    twoDayStaticStreakPenalty: 55,
    twoDayStaticStreakBreakBonus: -25,
    // מועמד "בדוחק": נכשל בכללי מנוחה אבל לא בחסימה קשיחה.
    // מוצג רק כשאין מספיק מועמדים תקינים, תמיד בתחתית הרשימה.
    fallbackBasePenalty: 400,
    // v3.16: כונן גשש = 0 שעות עבודה, כמו כרמל. השעות נרשמות ככוננות
    // (konenutHours) ולכן אינן נכנסות ל-totalHours, לתקרת העומס היומי
    // או למשקל השעות. trackerDailyWorkloadHours (8) ירד - הוא היה
    // הסיבה לכך שיורד סיור נראה כמי שעשה 16 שעות ביום.
    // v3.0: בונוס ייעוד לגשש - מי שירד מסיור שמסתיים עד
    // trackerTourDescentMaxGapHours לפני תחילת המשמרת הוא המיועד
    // (14->14:00-22:00, 22->22:00-07:00, 06->07:00-14:00),
    // ומקבל פטור מבדיקת מנוחה (ישן בכוננות).
    trackerAfterTourBonus: -35,
    trackerTourDescentMaxGapHours: 1.5,
    // v3.15: הגשש שמור ליורדי הסיור. מי שאינו יורד סיור יורד ל"בדוחק"
    // (fallback) ולא נחסם - כדי שמשמרת גשש תתאייש גם ביום שבו הסיור
    // עדיין לא שובץ, אבל תמיד מתחת לכל יורד סיור זמין.
    trackerRequireTourDescent: true,
    // v3.15 הוגנות גשש: קנס לכל משמרת "כונן גשש" קודמת של החייל בכל
    // "כל השבצק", לא רק בחלון הלוקבק. אותם מספרים כמו הוגנות התורנויות
    // (v3.10) - זה בדיוק אותו כלל תור, על תור אחר.
    trackerHistoryWeight: 8,
    trackerHistoryCap: 6,
    // v3.19: משימה יומית נספרת בעומס כמו בוולידציה - CONFIG.DAILY_HOURS,
    // כלומר 8 - ולא 16 כמו ב-v3.0. שני הקבצים חייבים להסכים כמה שווה
    // משימה, אחרת המנוע מסמן "בדוחק" חיילים שהוולידציה מרוצה מהם.
    // יש בדיקה שמקבעת את השוויון מול CONFIG.DAILY_HOURS.
    dailyMissionWorkloadHours: 8,
    magenTagbatzPackageBonus: -12,
    staticCommanderCrowdingPenalty: 25,
    samePlatoonAsGroupCommanderBonus: -12,
    seniorCommanderStaticBlock: true,
    availableRestBonusPerHour: -0.9,
    commanderNeededBonus: -26,
    commanderMissingPenalty: 90,
    dudDriverNightBonus: -16,
    // v3.9 הוגנות תורנויות: קנס לכל תורנות קודמת של החייל בכל
    // "כל השבצק", לא רק בחלון הלוקבק. ההתפלגות בפועל (09/08/26, 128
    // חיילים) היא חציון 0 / ממוצע 0.8 / מקסימום 18, ולכן משקל 8 מפריד
    // היטב בין מי שלא עשה לבין מי שעשה 2-3, והתקרה מונעת ממי שיש לו
    // היסטוריה חריגה להיחסם לתמיד.
    toranutHistoryWeight: 8,
    toranutHistoryCap: 6,
    // v3.6: משבצת הנהג בסיור פתוחה רק לנהגי דוד; הבונוס קובע איזה נהג
    // ייבחר ראשון כשיש כמה, מול שיקולי המנוחה והעומס.
    dudDriverSeatBonus: -30,
    tigerDriverNeededBonus: -35,
    tigerDriverMissingPenalty: 100,
    commanderInNonFirstSlotPenalty: 18,
    currentDayHighLoadHours: 8,
    currentDayHighLoadPenalty: 65,
    currentDayExtraHourPenalty: 7,
    currentDayWouldExceedPenalty: 28,
    // תקרת עומס יומי: מעבר לזה המועמד יורד ל"בדוחק" (לא נחסם לגמרי,
    // כדי שתמיד תהיה המלצה - אבל תמיד בתחתית ועם אזהרה ברורה).
    maxSameDayMissionHours: 10,

    // v3.7: יציאה קצרה מאושרת ("יציאה מ10 עד 22" וכו' במצבת החיילים).
    // החסימה הקשיחה היא רק על חפיפה בפועל; זהו קנס *רך* על משימה
    // חלקית שתדרוש משמרת משלימה שאין לה מקום סביב היציאה.
    // כשהיציאה מתאימה לכמה סוגי משימות - אין קנס לאף אחד מהם,
    // והבחירה נשארת בידי שאר השיקולים (רוטציה, עומס, מנוחה).
    exitPackageMisfitPenalty: 45,
    exitDailyTargetHours: 8
  }
};

/* ============================================================
 * תפריט + טריגרים
 * ============================================================ */

function installShabtzakRecommendationsMenu() {
  SpreadsheetApp.getUi()
    .createMenu('שבצ״ק')
    .addItem('עדכן המלצות', 'updateShabtzakRecommendations')
    .addItem('נקה המלצות', 'clearShabtzakRecommendations')
    .addSeparator()
    .addItem('התקן ריצה אוטומטית (onEdit)', 'installShabtzakTriggers')
    .addItem('הסר ריצה אוטומטית', 'removeShabtzakTriggers')
    .addToUi();
}

/**
 * מתקין טריגר onEdit מותקן (installable) שמריץ עדכון המלצות
 * בכל עריכה רלוונטית. להריץ פעם אחת ולאשר הרשאות.
 */
function installShabtzakTriggers() {
  removeShabtzakTriggers();
  ScriptApp.newTrigger('onShabtzakEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast('ריצה אוטומטית הותקנה', 'שבצ״ק', 4);
  } catch (e) { /* אין UI בהרצה מרחוק */ }
}

function removeShabtzakTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'onShabtzakEdit') ScriptApp.deleteTrigger(t);
  });
}

/**
 * v2.6: הרצה ידנית מהירה - מיועדת לקיצור מקלדת (מאקרו).
 * עוקפת את תור הטריגרים של גוגל (שגרם לעיכוב של 10+ שניות לפני
 * שהקוד בכלל התחיל). עטופה בנעילה כדי לא להתנגש בריצה מקבילה.
 *
 * חיבור לקיצור מקלדת:
 * תוספים -> מאקרו -> ייבוא מאקרו -> בחר runShabtzakNow ->
 * ניהול מאקרו -> הקצה מספר (Ctrl+Alt+Shift+מספר).
 */
function runShabtzakNow() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(0)) {
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast('ריצה אחרת באמצע - נסה שוב עוד רגע', 'שבצ״ק', 3);
    } catch (err) {}
    return;
  }
  try {
    updateShabtzakRecommendations();
  } finally {
    lock.releaseLock();
  }
}

/**
 * מאזין עריכות. רץ רק כשהעריכה נוגעת לטאב השבצ"ק ולעמודות הרלוונטיות.
 * שינויים שהסקריפט עצמו כותב (M:R) לא מפעילים טריגר, כך שאין לולאה.
 *
 * v2.2 - תיקון "לפעמים אין תוצאה": כשעריכה מגיעה בזמן שריצה אחרת
 * באמצע, היא לא נזרקת יותר - נרשם דגל "ממתין", והריצה הפעילה
 * מריצה סבב נוסף בסיומה כדי לקלוט את השינוי האחרון.
 */
function onShabtzakEdit(e) {
  const config = SHABTZAK_REC_CONFIG;
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== config.sheets.schedule) return;

  const col = e.range.getColumn();
  const lastCol = e.range.getLastColumn();
  const w = config.onEdit;

  const dateCellA1 = w.watchDateCell || config.scheduleDateCell;
  const touchesDate = e.range.getA1Notation().indexOf(dateCellA1) !== -1;

  // v3.5: טווח העמודות שמפעיל ריצה נגזר מהכותרות שזוהו, כך שהוא נשאר
  // נכון גם אם עמודות נמחקו/נוספו משמאל למשימות.
  let touchesTasks = false;
  try {
    const layout = resolveScheduleLayout_(sheet, config);
    const from = layout.taskFirstCol;
    const to = layout.taskFirstCol + layout.taskColCount - 1;
    touchesTasks = (col <= to && lastCol >= from);
  } catch (err) {
    // פריסה לא מזוהה: לא מריצים בכל עריכה (זה רק ייצר שגיאות חוזרות).
    // ההרצה הידנית מהתפריט תציג את השגיאה המדויקת.
    return;
  }

  if (!touchesDate && !touchesTasks) return;

  const cache = CacheService.getDocumentCache();
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(w.lockTimeoutMs || 0)) {
    // ריצה אחרת באמצע - מסמנים שיש שינוי שממתין לקליטה.
    cache.put('shabtzak_pending', '1', 120);
    return;
  }

  try {
    let guard = 0;
    do {
      cache.remove('shabtzak_pending');
      updateShabtzakRecommendations();
      guard++;
      // אם בזמן הריצה נכנסו עריכות נוספות - מריצים שוב (עד 3 סבבים).
    } while (cache.get('shabtzak_pending') && guard < 3);
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * ריצה ראשית
 * ============================================================ */

function updateShabtzakRecommendations() {
  const runStart = Date.now();
  const timing = { read: 0, compute: 0, write: 0 };
  resetNormalizeCache_();

  const config = SHABTZAK_REC_CONFIG;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // חיווי התחלה: הפער בין העריכה שלך להודעה הזו = זמן שיגור הטריגר
  // של גוגל (לא בשליטת הסקריפט). ממנה ועד "עודכנו" = הזמן שלנו.
  try { ss.toast('מעדכן המלצות...', 'שבצ״ק', 2); } catch (err) {}
  const sheet = ss.getSheetByName(config.sheets.schedule);
  if (!sheet) throw new Error('לא נמצא טאב בשם: ' + config.sheets.schedule);

  const baseDate = parseDateOnly_(sheet.getRange(config.scheduleDateCell).getValue());
  if (!baseDate) throw new Error('לא הצלחתי לקרוא תאריך מתוך ' + config.sheets.schedule + '!' + config.scheduleDateCell);

  // v3.5: הפריסה נגזרת מהכותרות, לא ממיקומים קבועים.
  const layout = resolveScheduleLayout_(sheet, config);

  const lastRow = Math.max(sheet.getLastRow(), layout.firstDataRow);
  const rowCount = Math.max(0, lastRow - layout.firstDataRow + 1);
  if (rowCount === 0) return;

  const taskValues = sheet
    .getRange(layout.firstDataRow, layout.taskFirstCol, rowCount, layout.taskColCount)
    .getValues();

  // v3.5: המצבה מגיעה מ"מצבת החיילים" ולא מעמודות A:G של "שבצק".
  const roster = readRosterSoldiers_(ss, baseDate, config);
  const soldiers = roster.soldiers;
  const soldiersByName = makeSoldiersByName_(soldiers);
  const currentTasks = parseCurrentTasks_(taskValues, baseDate, layout, config);

  const historySheet = ss.getSheetByName(config.sheets.history);
  const historyValues = historySheet ? readHistoryValues_(historySheet, config) : [];
  const historyAssignments = parseHistoryAssignments_(historyValues, baseDate, config);
  const toranutHistoryCounts = countToranutHistory_(historyValues, config);
  const trackerHistoryCounts = countTrackerHistory_(historyValues, config);
  const currentAssignments = currentTasks
    .filter(function(t) { return t && t.assigned; })
    .map(function(t) { return taskToAssignment_(t, config); });

  const allAssignments = historyAssignments.concat(currentAssignments);

  // v3.5: "משימה יום קודם" נגזרת מההיסטוריה עצמה במקום מעמודה B של
  // "שבצק" (שהייתה נוסחת FILTER מעל אותו "כל השבצק"). משמשת כגיבוי
  // תצוגה כשלא חושבה משימה קודמת למועמד - למשל כשהוא נדחה מוקדם.
  attachPreviousDayText_(soldiers, allAssignments, baseDate);
  timing.read = Date.now() - runStart;

  // ---- אינדקסים (לב שיפור הביצועים) ----
  const assignmentsBySoldier = indexBySoldier_(allAssignments);
  const currentBySoldier = indexBySoldier_(currentAssignments);
  const taskGroups = buildTaskGroups_(currentTasks);

  const context = {
    soldiersByName: soldiersByName,
    currentTasks: currentTasks,
    taskGroups: taskGroups,
    assignmentsBySoldier: assignmentsBySoldier,
    currentBySoldier: currentBySoldier,
    baseDate: baseDate,
    toranutHistoryCounts: toranutHistoryCounts,
    trackerHistoryCounts: trackerHistoryCounts,
    statsCache: {},
    availabilityCache: {},
    config: config
  };

  // v3.6: נהגי דוד שמורים למשבצות הנהג בסיורים, ומ-v3.20 גם נהגי טיגריס
  // למשבצת האחרונה בהתקפי. מחשבים פעם אחת לריצה לאילו משבצות-נהג פנויות
  // כל נהג *יכול* בפועל להיכנס; רק בגללן הוא נחסם משאר העמדות
  // (ראה driverReservedElsewhere_).
  context.driverReservations = computeDriverReservations_(soldiers, context);

  const output = [];
  const notes = [];
  const backgrounds = [];

  for (let i = 0; i < rowCount; i++) {
    const task = currentTasks[i];
    if (!task) {
      output.push(makeBlankOutputRow_(config));
      notes.push(['']);
      backgrounds.push(makeBackgroundRow_('#ffffff', config.output.width));
      continue;
    }

    const group = taskGroups[task.groupKey] || { tasks: [task] };
    const groupStatus = getGroupStatusText_(task, group, soldiersByName, config, currentTasks);

    if (isSkippedRecommendationTask_(task, config)) {
      const skipReason = isKonenutCategory_(task.category)
        ? 'כוננות: אין המלצות; חוסם לפי כללי כוננות; נספר כשעות כוננות בלבד'
        : 'המשימה מוגדרת להתעלמות בקונפיגורציה';
      output.push(['מדולג', '', '', '', skipReason, groupStatus]);
      notes.push(['']);
      backgrounds.push(makeBackgroundRow_('#f3f4f6', config.output.width));
      continue;
    }

    // דירוג יחיד לכל שורה: משמש גם למשובצים (חלופות) וגם לפנויים (המלצות)
    context.group = group;
    context.ignoreSameRow = !!task.assigned;
    const ranking = rankCandidatesForTask_(task, soldiers, context);

    if (task.assigned) {
      const assignedSoldier = soldiersByName[normalizeNameKey_(task.assigned)];
      if (!assignedSoldier) {
        output.push(['משובץ: ' + task.assigned, '', '', '', '⚠ החייל לא נמצא ב"' + config.sheets.roster + '" (או שאינו במחלקות המשובצות)', groupStatus]);
        notes.push(['']);
        backgrounds.push(makeBackgroundRow_('#fff7ed', config.output.width));
        continue;
      }

      const assignedEval = evaluateCandidateForTask_(assignedSoldier, task, context);
      const alternatives = ranking.ranked
        .filter(function(ev) { return ev.soldier.nameKey !== assignedSoldier.nameKey; })
        .slice(0, 3);

      const warnings = assignedEval.rejected
        ? '⚠ ' + assignedEval.rejectReason
        : assignedEval.warnings.join(' | ');

      output.push(formatAssignedOutputRow_(assignedEval, alternatives, groupStatus, warnings, config));
      notes.push([buildCandidateNote_(assignedEval, alternatives)]);
      backgrounds.push(makeBackgroundRow_(assignedEval.rejected ? '#fee2e2' : '#ecfdf5', config.output.width));
      continue;
    }

    if (!ranking.ranked.length) {
      output.push(['אין מועמד מתאים', '', '', '', ranking.rejectedSummary, groupStatus]);
      notes.push(['']);
      backgrounds.push(makeBackgroundRow_('#fee2e2', config.output.width));
      continue;
    }

    const top = ranking.ranked.slice(0, config.recommendationsLimit);
    output.push(formatRecommendationsOutputRow_(
      top, groupStatus, formatTaskSoftWarnings_(task, group, soldiersByName, config), config
    ));
    notes.push([buildCandidatesNote_(top)]);
    backgrounds.push(makeBackgroundRow_('#eff6ff', config.output.width));
  }

  timing.compute = Date.now() - runStart - timing.read;
  writeRecommendationOutput_(sheet, output, notes, backgrounds, layout, config);
  // v2.5: flush מאלץ commit של כל הכתיבות + חישוב-מחדש של נוסחאות
  // תלויות *עכשיו*, בתוך המדידה - בלעדיו ה-commit קורה בסיום הסקריפט
  // אחרי ה-toast, וההודעה מציגה זמן קצר בהרבה מהמציאות.
  SpreadsheetApp.flush();
  timing.write = Date.now() - runStart - timing.read - timing.compute;

  // חיווי ריצה: כדי שתמיד יהיה ברור אם ומתי הריצה הסתיימה.
  try {
    const seconds = Math.round((Date.now() - runStart) / 100) / 10;
    let msg = 'המלצות עודכנו (' + seconds + ' שניות)';
    // v3.5: אם חסרה עמודת תאריך במצבה, הסטטוסים יוצאים ריקים - וזה
    // משנה זמינות. עדיף להגיד את זה מפורשות מאשר להמליץ בשקט על מי
    // שבחופש.
    if (roster.missingDateLabels.length) {
      msg += ' | ⚠ אין עמודת ' + roster.missingDateLabels.join('/') +
        ' ב"' + config.sheets.roster + '"';
    }
    if (config.debugTiming) {
      msg += ' | קריאה ' + Math.round(timing.read / 100) / 10 +
        ' | חישוב ' + Math.round(timing.compute / 100) / 10 +
        ' | כתיבה ' + Math.round(timing.write / 100) / 10;
    }
    ss.toast(msg, 'שבצ״ק', 4);
  } catch (err) { /* אין UI בהרצה מרחוק */ }
}

function clearShabtzakRecommendations() {
  const config = SHABTZAK_REC_CONFIG;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(config.sheets.schedule);
  if (!sheet) throw new Error('לא נמצא טאב בשם: ' + config.sheets.schedule);
  const layout = resolveScheduleLayout_(sheet, config);
  const lastRow = Math.max(sheet.getLastRow(), layout.firstDataRow);
  const rowCount = Math.max(0, lastRow - layout.outputHeaderRow + 1);
  if (rowCount === 0) return;
  sheet.getRange(layout.outputHeaderRow, layout.outputStartCol, rowCount, config.output.width)
    .clearContent()
    .clearNote()
    .setBackground(null);
  PropertiesService.getDocumentProperties().deleteProperty('shabtzak_layout');
}

/* ============================================================
 * כתיבת פלט
 * ============================================================ */

function writeRecommendationOutput_(sheet, output, notes, backgrounds, layout, config) {
  // ביצועים v2.2: פעולות עיצוב (כותרת, גבולות, רוחב עמודות, גלישת טקסט)
  // הן קריאות API איטיות שלא משתנות בין ריצות. מריצים אותן רק כשהפריסה
  // השתנתה (מספר שורות/עמודות) - ברוב הריצות נשארים רק ערכים+צבעים+הערות.
  const props = PropertiesService.getDocumentProperties();
  const layoutKey = 'shabtzak_layout';
  const layoutSig = [layout.outputHeaderRow, layout.outputStartCol, config.output.width, output.length].join('|');
  const needLayout = props.getProperty(layoutKey) !== layoutSig;

  const bodyRange = sheet.getRange(layout.firstDataRow, layout.outputStartCol, output.length, config.output.width);
  // v2.3: בלי clearContent/clearNote - setValues ו-setNotes דורסים ממילא
  // את אותו טווח בדיוק. שתי קריאות API פחות.
  bodyRange.setValues(output);
  bodyRange.setBackgrounds(backgrounds);

  if (config.output.writeNotes !== false) {
    const notesRange = sheet.getRange(layout.firstDataRow, layout.outputStartCol, notes.length, 1);
    notesRange.setNotes(notes);
  }

  if (needLayout) {
    const headerRange = sheet.getRange(layout.outputHeaderRow, layout.outputStartCol, 1, config.output.width);
    headerRange.setValues([config.output.headers]);
    headerRange
      .setFontWeight('bold')
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle')
      .setBackground('#dbeafe');

    bodyRange.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
    bodyRange.setVerticalAlignment('top');
    bodyRange.setHorizontalAlignment('right');

    sheet.getRange(layout.outputHeaderRow, layout.outputStartCol, output.length + 1, config.output.width)
      .setBorder(true, true, true, true, true, true, '#d1d5db', SpreadsheetApp.BorderStyle.SOLID);

    if (config.output.columnWidths && config.output.columnWidths.length) {
      for (let c = 0; c < config.output.width; c++) {
        sheet.setColumnWidth(layout.outputStartCol + c, config.output.columnWidths[c] || 160);
      }
    }

    props.setProperty(layoutKey, layoutSig);
  }
}

/* ============================================================
 * פרסינג: חיילים, משימות, היסטוריה
 * ============================================================ */

/**
 * v3.5: מזהה את פריסת טאב "שבצק" לפי הכותרות במקום מיקומים קבועים.
 * כל מספרי העמודות/השורות שמוחזרים הם 1-based.
 *
 * שורת הכותרות היא הראשונה (מבין headerSearchRows) שמכילה גם "העמדה"
 * וגם "החייל". הקריאה מתחילה בשורת הכותרות עצמה - isHeaderLikeTaskRow_
 * מסננת אותה - כדי שמספרי השורות בפלט יישארו מיושרים לגיליון.
 * כותרות הפלט יושבות שורה אחת מעל שורת הכותרות של המשימות, כפי שהן
 * בגיליון היום.
 */
function resolveScheduleLayout_(sheet, config) {
  const labels = config.tasks.headerLabels;
  const searchRows = Math.min(config.tasks.headerSearchRows || 6, sheet.getMaxRows());
  const lastCol = Math.max(1, sheet.getLastColumn());
  const band = sheet.getRange(1, 1, searchRows, lastCol).getValues();

  const positionKey = normalizeForSearch_(labels.position);
  const soldierKey = normalizeForSearch_(labels.soldier);

  let headerRowIndex = -1;
  let headers = null;
  for (let i = 0; i < band.length; i++) {
    const row = band[i].map(normalizeForSearch_);
    if (row.indexOf(positionKey) !== -1 && row.indexOf(soldierKey) !== -1) {
      headerRowIndex = i;
      headers = row;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('לא נמצאה שורת כותרות בטאב "' + config.sheets.schedule +
      '" עם העמודות: ' + labels.position + ', ' + labels.soldier + '.');
  }

  const colOf = function(label) {
    const idx = headers.indexOf(normalizeForSearch_(label));
    return idx === -1 ? 0 : idx + 1;
  };

  const col = {
    date: colOf(labels.date),
    position: colOf(labels.position),
    type: colOf(labels.type),
    time: colOf(labels.time),
    soldier: colOf(labels.soldier)
  };

  ['type', 'time'].forEach(function(key) {
    if (!col[key]) {
      throw new Error('חסרה עמודת "' + labels[key] + '" בשורת הכותרות של "' +
        config.sheets.schedule + '".');
    }
  });

  const used = [col.position, col.type, col.time, col.soldier];
  if (col.date) used.push(col.date);
  const taskFirstCol = Math.min.apply(null, used);
  const taskLastCol = Math.max.apply(null, used);

  return {
    headerRow: headerRowIndex + 1,
    firstDataRow: headerRowIndex + 1,
    col: col,
    taskFirstCol: taskFirstCol,
    taskColCount: taskLastCol - taskFirstCol + 1,
    outputHeaderRow: Math.max(1, headerRowIndex),
    outputStartCol: taskLastCol + 1
  };
}

/**
 * v3.5: קוראת את המצבה ישירות מטאב "מצבת החיילים".
 *
 * מבנה הטאב: שורת תאריכים (DD/MM/YY) מעל שורת הכותרות, ואחריה שורה
 * לכל חייל. הסטטוס ליום מסוים = התא בהצטלבות שורת החייל עם עמודת
 * התאריך.
 *
 * הסינון לפי מחלקה (includePlatoons) שיחזר במקור בדיוק את נוסחת
 * ה-FILTER בעמודה A של "שבצק". ⚠ מאז 2026-08-10 הוא כבר לא: חמ"ל
 * הוצא מהמאגר בלבד, והנוסחה בעמודה A נותרה כשהייתה - עמודות A:G הן
 * שארית תצוגה שהפונקציה הזו אינה קוראת ממילא.
 *
 * מחזירה { soldiers, missingDateLabels }.
 */
function readRosterSoldiers_(ss, baseDate, config) {
  const sheetName = config.sheets.roster;
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('לא נמצא טאב בשם: ' + sheetName);

  const values = sheet.getDataRange().getValues();
  const labels = config.roster.headerLabels;
  const searchRows = Math.min(config.roster.headerSearchRows || 6, values.length);
  const fullNameKey = normalizeForSearch_(labels.fullName);

  let headerRowIndex = -1;
  let headers = null;
  for (let i = 0; i < searchRows; i++) {
    const row = values[i].map(normalizeForSearch_);
    if (row.indexOf(fullNameKey) !== -1) {
      headerRowIndex = i;
      headers = row;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('לא נמצאה שורת כותרות עם "' + labels.fullName + '" בטאב "' + sheetName + '".');
  }

  const colOf = function(label) { return headers.indexOf(normalizeForSearch_(label)); };
  const nameCol = colOf(labels.fullName);
  const roleCol = colOf(labels.role);
  const platoonCol = colOf(labels.platoon);

  if (roleCol === -1 || platoonCol === -1) {
    throw new Error('חסרות עמודות "' + labels.role + '" / "' + labels.platoon +
      '" בשורת הכותרות של "' + sheetName + '".');
  }

  const dateColByTime = buildRosterDateColumnMap_(values, headerRowIndex);
  const colForDate = function(date) {
    const found = dateColByTime[date.getTime()];
    return found === undefined ? -1 : found;
  };

  const yesterdayCol = colForDate(addDays_(baseDate, -1));
  const todayCol = colForDate(baseDate);
  const tomorrowCol = colForDate(addDays_(baseDate, 1));

  const missingDateLabels = [];
  if (yesterdayCol === -1) missingDateLabels.push('אתמול');
  if (todayCol === -1) missingDateLabels.push('היום');
  if (tomorrowCol === -1) missingDateLabels.push('מחר');

  const includePlatoons = config.roster.includePlatoons || [];
  const includeSet = {};
  includePlatoons.forEach(function(p) { includeSet[normalizeForSearch_(p)] = true; });

  const statusAt = function(row, colIndex) {
    return colIndex === -1 ? '' : cleanText_(row[colIndex]);
  };

  const soldiers = [];
  for (let i = headerRowIndex + 1; i < values.length; i++) {
    const row = values[i];
    const name = cleanText_(row[nameCol]);
    if (!name) continue;

    const platoon = cleanText_(row[platoonCol]);
    // v3.20: המפל"ג נקרא תמיד, גם כשהוא מחוץ ל-includePlatoons. הוא
    // אינו מועמד לשום עמדה חוץ ממשבצת החפ"ק הראשונה (הסינון עצמו
    // ב-evaluateCandidateForTask_), אבל בלי שיהיה במצבה, שיבוץ שלו
    // בחפ"ק היה מקבל "החייל לא נמצא במצבת החיילים".
    const isCommandStaff = containsAny_(platoon, config.commandStaffPlatoonKeywords || []);
    if (includePlatoons.length && !includeSet[normalizeForSearch_(platoon)] && !isCommandStaff) continue;

    const role = cleanText_(row[roleCol]);
    const soldier = {
      rowIndex: i + 1,
      name: name,
      nameKey: normalizeNameKey_(name),
      platoon: platoon,
      role: role,
      statusYesterday: statusAt(row, yesterdayCol),
      statusToday: statusAt(row, todayCol),
      statusTomorrow: statusAt(row, tomorrowCol)
    };

    soldier.isCommandStaff = isCommandStaff;
    soldier.isCommander = containsAny_(role, config.roles.commanderKeywords);
    soldier.isSeniorCommander = containsAny_(role, config.roles.seniorCommanderKeywords);
    soldier.isStaticCommander = containsAny_(role, config.roles.staticCommanderKeywords);
    soldier.isDudDriver = containsAny_(role, config.roles.dudDriverKeywords);
    soldier.isTigerDriver = containsAny_(role, config.roles.tigerDriverKeywords);

    soldiers.push(soldier);
  }

  return { soldiers: soldiers, missingDateLabels: missingDateLabels };
}

/**
 * v3.5: מחשבת לכל חייל את משימות היום המבצעי הקודם, כטקסט קצר.
 * זו בדיוק המידע שעמודה B של "שבצק" סיפקה בנוסחה - רק שכאן הוא נגזר
 * מאותן שיבוצים שהמנוע כבר קרא מ"כל השבצק", ולפי אותה חלוקה ליום
 * מבצעי (14:00-14:00) שבה המנוע משתמש בכל מקום אחר.
 */
function attachPreviousDayText_(soldiers, assignments, baseDate) {
  const previousOpDay = addDays_(dateOnly_(baseDate), -1).getTime();
  const bySoldier = {};

  assignments.forEach(function(a) {
    if (!a || !a.soldierKey || !a.start) return;
    if (getOperationalBaseDateForDate_(a.start).getTime() !== previousOpDay) return;
    if (!bySoldier[a.soldierKey]) bySoldier[a.soldierKey] = [];
    bySoldier[a.soldierKey].push(a);
  });

  soldiers.forEach(function(soldier) {
    const list = bySoldier[soldier.nameKey];
    if (!list || !list.length) {
      soldier.previousDayText = '';
      return;
    }
    list.sort(function(x, y) { return x.start.getTime() - y.start.getTime(); });
    soldier.previousDayText = list.map(function(a) {
      const title = a.position || a.type || categoryDisplayName_(a.category);
      return title + ' ' + formatTimeOnly_(a.start);
    }).join(', ');
  });
}

/**
 * שורת התאריכים של מטריצת הנוכחות: השורה שמעל הכותרות שיש בה הכי הרבה
 * תאים שנפרסים כתאריך. מחזירה מיפוי timestamp -> אינדקס עמודה (0-based).
 */
function buildRosterDateColumnMap_(values, headerRowIndex) {
  let bestRow = -1;
  let bestCount = 0;

  for (let i = 0; i < headerRowIndex; i++) {
    let count = 0;
    for (let c = 0; c < values[i].length; c++) {
      if (parseDateOnly_(values[i][c])) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestRow = i;
    }
  }

  const map = {};
  if (bestRow === -1) return map;

  const row = values[bestRow];
  for (let c = 0; c < row.length; c++) {
    const date = parseDateOnly_(row[c]);
    // תאריך כפול בשורה: הראשון קובע, כמו XLOOKUP.
    if (date && map[date.getTime()] === undefined) map[date.getTime()] = c;
  }
  return map;
}

function makeSoldiersByName_(soldiers) {
  const map = {};
  soldiers.forEach(function(s) { map[s.nameKey] = s; });
  return map;
}

function indexBySoldier_(assignments) {
  const map = {};
  assignments.forEach(function(a) {
    if (!a || !a.soldierKey) return;
    if (!map[a.soldierKey]) map[a.soldierKey] = [];
    map[a.soldierKey].push(a);
  });
  return map;
}

function isHeaderLikeTaskRow_(position, type, timeText, assigned) {
  const p = normalizeForSearch_(position);
  const t = normalizeForSearch_(type);
  const tm = normalizeForSearch_(timeText);
  const a = normalizeForSearch_(assigned);
  if (p === 'העמדה' || p === 'עמדה') return true;
  if (t === 'סוג' && (tm === 'השעה' || tm === 'שעה')) return true;
  if (a === 'החייל' || a === 'חייל') return true;
  return false;
}

function parseCurrentTasks_(values, baseDate, layout, config) {
  const tasks = [];
  // v3.5: אינדקסים יחסיים לתוך הטווח שנקרא, לפי העמודות שזוהו.
  const first = layout.taskFirstCol;
  const iDate = layout.col.date ? layout.col.date - first : -1;
  const iPosition = layout.col.position - first;
  const iType = layout.col.type - first;
  const iTime = layout.col.time - first;
  const iAssigned = layout.col.soldier - first;

  values.forEach(function(row, idx) {
    const rowDate = iDate >= 0 ? parseDateOnly_(row[iDate]) : null;
    const position = cleanText_(row[iPosition]);
    const type = cleanText_(row[iType]);
    const timeValue = row[iTime];
    const assigned = cleanText_(row[iAssigned]);
    const timeText = cleanText_(timeValue);

    if ((!position && !type && !timeText && !assigned) || isHeaderLikeTaskRow_(position, type, timeText, assigned)) {
      tasks.push(null);
      return;
    }

    tasks.push(buildTaskFromFields_({
      rowNumber: layout.firstDataRow + idx,
      position: position,
      type: type,
      timeValue: timeValue,
      assigned: assigned,
      baseDate: rowDate || baseDate,
      explicitDate: !!rowDate,
      config: config
    }));
  });
  return tasks;
}

/**
 * v3.9: קריאה אחת של כל "כל השבצק". שני צרכנים שונים לה - חלון הלוקבק
 * (parseHistoryAssignments_, שממשיך לבנות אובייקטים רק לזנב) וספירת
 * התורנויות ההיסטורית, שצריכה את הגיליון כולו.
 */
function readHistoryValues_(historySheet, config) {
  const lastRow = historySheet.getLastRow();
  const firstRow = config.history.firstDataRow;
  if (lastRow < firstRow) return [];

  const maxCol = Math.max(
    config.history.dateCol, config.history.positionCol, config.history.typeCol,
    config.history.timeCol, config.history.soldierCol
  );
  return historySheet.getRange(firstRow, 1, lastRow - firstRow + 1, maxCol).getValues();
}

/**
 * v3.9: כמה תורנויות עשה כל חייל בכל ההיסטוריה. משמש להוגנות בשיבוץ
 * תורנות (applyToranutFairnessScoring_) - שם דווקא כן רוצים את התמונה
 * המלאה ולא את חלון עשרת הימים.
 */
function countToranutHistory_(values, config) {
  return countHistoryRowsBy_(values, config, isToranutText_);
}

/**
 * v3.15: כמה משמרות "כונן גשש" עשה כל חייל בכל ההיסטוריה. משמש להוגנות
 * בשיבוץ גשש (applyTrackerFairnessScoring_), בדיוק כמו ספירת התורנויות.
 * שתי הספירות זרות זו לזו: isToranutText_ מחריג שורות גשש.
 */
function countTrackerHistory_(values, config) {
  return countHistoryRowsBy_(values, config, isTrackerText_);
}

/**
 * ספירה לפי חייל של שורות "כל השבצק" שעונות על predicate(position, type).
 */
function countHistoryRowsBy_(values, config, matches) {
  const counts = {};
  values.forEach(function(row) {
    const soldier = cleanText_(row[config.history.soldierCol - 1]);
    if (!soldier) return;
    if (!matches(
      cleanText_(row[config.history.positionCol - 1]),
      cleanText_(row[config.history.typeCol - 1]),
      config)) return;

    const key = normalizeNameKey_(soldier);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function parseHistoryAssignments_(historyValues, currentBaseDate, config) {
  if (!historyValues || !historyValues.length) return [];

  // ביצועים: בונים אובייקטים רק לזנב הגיליון. מניחים שההיסטוריה נכתבת
  // כרונולוגית (שורות חדשות למטה); הסינון לפי תאריך בהמשך מגבה בכל מקרה.
  const maxScan = config.history.maxScanRows || 0;
  const values = (maxScan > 0 && historyValues.length > maxScan)
    ? historyValues.slice(historyValues.length - maxScan)
    : historyValues;

  const lookbackStart = addDays_(currentBaseDate, -config.historyLookbackDays - 2);
  // היום המבצעי הנוכחי (מתחיל ב-14:00 של currentBaseDate).
  const currentOpDay = getOperationalBaseDateForDate_(
    makeDateWithTime_(currentBaseDate, opDayStartHour_(), opDayStartMinute_(), 0));
  const assignments = [];

  values.forEach(function(row) {
    // v3.3: פרה-פילטר זול ורחב לפי התאריך הקלנדרי הגולמי (עם יום סלאק
    // לכל צד), רק כדי לא לבנות אובייקטים לשנים של היסטוריה.
    // הסינון המדויק נעשה אחרי הבנייה, לפי *היום המבצעי* של המשימה.
    const rowDate = parseDateOnly_(row[config.history.dateCol - 1]);
    if (!rowDate) return;
    if (rowDate < lookbackStart) return;
    if (rowDate > addDays_(currentBaseDate, 1)) return;

    const soldier = cleanText_(row[config.history.soldierCol - 1]);
    if (!soldier) return;

    const task = buildTaskFromFields_({
      rowNumber: null,
      position: cleanText_(row[config.history.positionCol - 1]),
      type: cleanText_(row[config.history.typeCol - 1]),
      timeValue: row[config.history.timeCol - 1],
      assigned: soldier,
      baseDate: rowDate,
      explicitDate: true,
      config: config
    });

    // v3.3: שומרים רק משימות שהיום המבצעי שלהן *קודם* ליום המבצעי הנוכחי.
    // כך משמרת בוקר (למשל סיור לילה שמסתיים ב-06:00 קלנדרית "מחר")
    // ששייכת ליממה הקודמת נשמרת - במקום להיזרק כמו קודם. היום המבצעי
    // הנוכחי עצמו מיוצג במלואו בגיליון I:L ולכן מסונן החוצה מההיסטוריה.
    const taskOpDay = getOperationalBaseDateForDate_(task.start);
    if (taskOpDay >= currentOpDay) return;

    const assignment = taskToAssignment_(task, config);
    if (assignment.end > lookbackStart) {
      assignment.source = 'history';
      assignments.push(assignment);
    }
  });
  return assignments;
}

/* ============================================================
 * בניית משימה: קטגוריה, זמנים
 * ============================================================ */

function buildTaskFromFields_(args) {
  const config = args.config;
  const category = getTaskCategory_(args.position, args.type, args.timeValue, config);
  const isDailyText = isDailyTimeValue_(args.timeValue, config);
  const isMagenTagbatzPackage = isMagenTagbatzText_(args.position + ' ' + args.type, config);
  const parsedRange = parseTimeRange_(args.timeValue);
  const parsedTime = parsedRange ? parsedRange.start : parseTimeValue_(args.timeValue);

  // v3.0 שעון לחימה: "יומי" = 14:00 עד 14:00 למחרת, לכל הקטגוריות.
  // כונן גשש עובד במשמרות (14-22 / 22-07 / 07-14) - טווח מפורש בעמודת השעה.
  let start, end;

  // v3.2: תאריך מפורש (עמודה H) מבטל את ניחוש ה-carry לפי שעה.
  const explicitDate = !!args.explicitDate;
  const carryFor = function(hour) {
    return (!explicitDate && hour < opDayStartHour_()) ? 1 : 0;
  };

  if (category === 'tracker') {
    if (parsedRange) {
      // משמרת גשש מפורשת, למשל "22:00-07:00".
      start = makeDateWithTime_(args.baseDate, parsedRange.start.hour, parsedRange.start.minute, carryFor(parsedRange.start.hour));
      end = makeDateWithTime_(dateOnly_(start), parsedRange.end.hour, parsedRange.end.minute, 0);
      if (end <= start) end = addDays_(end, 1);
    } else if (parsedTime) {
      // v3.2: שעה בודדת -> משך משמרת מובנה (14->22, 22->07, 06/07->14).
      start = makeDateWithTime_(args.baseDate, parsedTime.hour, parsedTime.minute, carryFor(parsedTime.hour));
      const shiftEnd = (config.trackerShiftEndByStartHour || {})[parsedTime.hour];
      if (shiftEnd) {
        end = makeDateWithTime_(dateOnly_(start), shiftEnd.hour, shiftEnd.minute || 0, 0);
        if (end <= start) end = addDays_(end, 1);
      } else {
        end = addHours_(start, 8);
      }
    } else {
      // ללא שעה כלל (כולל "יומי"): כל היממה המבצעית. מומלץ לרשום שעה מפורשת.
      start = makeDateWithTime_(args.baseDate, opDayStartHour_(), opDayStartMinute_(), 0);
      end = makeDateWithTime_(addDays_(args.baseDate, 1), opDayStartHour_(), opDayStartMinute_(), 0);
    }
  } else if (isDailyText) {
    // כל משימה יומית (כוננות התקפית, מגן+תגבצ, חפק, תורן, קצין מוצב):
    // היממה המבצעית המלאה 14:00-14:00.
    start = makeDateWithTime_(args.baseDate, opDayStartHour_(), opDayStartMinute_(), 0);
    end = makeDateWithTime_(addDays_(args.baseDate, 1), opDayStartHour_(), opDayStartMinute_(), 0);
  } else {
    start = inferTaskStart_(args.baseDate, args.position, args.type, category, parsedTime, parsedRange, explicitDate);
    end = inferTaskEnd_(args.baseDate, start, args.position, args.type, category, parsedRange);
  }

  const durationHours = Math.max(0, hoursBetween_(start, end));
  const groupKey = makeTaskGroupKey_(args.position, args.type, category, start);

  return {
    rowNumber: args.rowNumber,
    position: args.position,
    type: args.type,
    timeValue: args.timeValue,
    timeText: cleanText_(args.timeValue),
    assigned: args.assigned || '',
    category: category,
    isFullDayByTime: isDailyText && category !== 'tracker',
    isDailyKonenut: category === 'carmel' && isDailyText,
    isMagenTagbatzPackage: isMagenTagbatzPackage,
    start: start,
    end: end,
    durationHours: durationHours,
    groupKey: groupKey
  };
}

function inferTaskStart_(baseDate, position, type, category, parsedTime, parsedRange, explicitDate) {
  if (category === 'post_officer') return makeDateWithTime_(baseDate, opDayStartHour_(), opDayStartMinute_(), 0);

  // carry: שעה לפני תחילת היממה המבצעית (14:00) מתרחשת קלנדרית למחרת -
  // אלא אם השורה נושאת תאריך קלנדרי מפורש (עמודה H).
  const carryFor = function(hour) {
    return (!explicitDate && hour < opDayStartHour_()) ? 1 : 0;
  };

  if (parsedRange && parsedRange.start) {
    return makeDateWithTime_(baseDate, parsedRange.start.hour, parsedRange.start.minute, carryFor(parsedRange.start.hour));
  }

  if (parsedTime) {
    return makeDateWithTime_(baseDate, parsedTime.hour, parsedTime.minute, carryFor(parsedTime.hour));
  }

  return makeDateWithTime_(baseDate, opDayStartHour_(), opDayStartMinute_(), 0);
}

function inferTaskEnd_(baseDate, start, position, type, category, parsedRange) {
  if (category === 'post_officer') {
    return makeDateWithTime_(addDays_(dateOnly_(start), 1), opDayStartHour_(), opDayStartMinute_(), 0);
  }

  if (parsedRange && parsedRange.end) {
    let end = makeDateWithTime_(dateOnly_(start), parsedRange.end.hour, parsedRange.end.minute, 0);
    if (end <= start) end = addDays_(end, 1);
    return end;
  }

  if (category === 'carmel') {
    // כרמל חטיבה עם שעה בודדת: משבצות של 4 שעות,
    // ומשבצת שמתחילה ב-22:00 נמשכת עד 06:00 (8 שעות).
    if (start.getHours() === 22 && start.getMinutes() === 0) {
      return makeDateWithTime_(addDays_(dateOnly_(start), 1), 6, 0, 0);
    }
    return addHours_(start, 4);
  }

  if (category === 'tour') return addHours_(start, 8);
  if (category === 'static') return addHours_(start, 4);
  if (category === 'attack') {
    // התקפי ללא שעה מפורשת: עד סוף היממה המבצעית.
    return makeDateWithTime_(addDays_(getOperationalBaseDateForDate_(start), 1), opDayStartHour_(), opDayStartMinute_(), 0);
  }

  return addHours_(start, 4);
}

function getTaskCategory_(position, type, timeValue, config) {
  const text = normalizeForSearch_(position + ' ' + type);
  const isFullDayByTime = isDailyTimeValue_(timeValue, config);
  if (!text && !isFullDayByTime) return 'regular';

  // סדר חשוב: גשש ותורן לפני כוננות/יומי, כדי ששורות כמו
  // "כונן גשש ותורן רס\"פ / יומי" יקבלו את הזמנים הנכונים שלהן.
  if (isTrackerText_(position, type, config)) return 'tracker';
  if (isToranutText_(position, type, config)) return 'daily_duty';

  if (containsAny_(text, config.carmelTaskKeywords || [])) return 'carmel';
  if (containsAny_(text, config.ignoredTaskKeywords)) return 'ignored';
  if (containsAny_(text, config.postOfficerKeywords)) return 'post_officer';

  if (text.indexOf('התקפי') !== -1) return 'attack';

  if (containsAny_(text, config.tagbatzKeywords)) return 'tagbatz';
  if (containsAny_(text, config.magenKeywords)) return 'magen';
  if (text.indexOf('סיור') !== -1) return 'tour';
  if (containsAny_(text, config.staticDefenseKeywords)) return 'static';

  if (isFullDayByTime) return 'day_blocking';

  return 'regular';
}

/* ============================================================
 * סיווגים: כוננות, יומי, מגן+תגבצ, מחלקות משימה
 * ============================================================ */

function isMagenTagbatzText_(text, config) {
  const normalized = normalizeForSearch_(text);
  return containsAny_(normalized, config.magenKeywords) && containsAny_(normalized, config.tagbatzKeywords);
}

function isKonenutCategory_(category) {
  // רק כרמל/כוננות. הגשש *לא* נכלל כאן בכוונה: ההגדרה הזאת שולטת גם
  // בדילוג על המלצות, בחסימות ובחלון "אתמול", והגשש חייב להמשיך לקבל
  // המלצות (isSkippedRecommendationTask_) ולהיספר לרוטציה.
  // v3.16: שעות העבודה שלו כן מטופלות כמו כרמל - 0 - אבל זה נעשה
  // נקודתית בשני מוני השעות (calculateStats_ /
  // calculateSameOperationalDayHours_), לא דרך הדגל הזה.
  return category === 'carmel';
}

function isKonenutAssignment_(assignment) {
  return !!assignment && isKonenutCategory_(assignment.category);
}

/**
 * חסימת "משימה יומית" מלאה: יומי/קצין מוצב.
 * v2.0: כוננויות (carmel/tracker) *לא* נכללות כאן - יש להן כללי חסימה משלהן.
 */
function isFullDayBlockingAssignment_(taskOrAssignment, config) {
  if (taskOrAssignment && taskOrAssignment.category === 'tracker') return false;
  if (!taskOrAssignment || !taskOrAssignment.category) return false;
  if (isKonenutCategory_(taskOrAssignment.category)) return false;
  const cfg = config || SHABTZAK_REC_CONFIG;
  return taskOrAssignment.category === 'post_officer' ||
    taskOrAssignment.category === 'day_blocking' ||
    !!taskOrAssignment.isFullDayByTime ||
    isDailyTimeValue_(taskOrAssignment.timeText || taskOrAssignment.timeValue || '', cfg);
}

function isDailyTimeValue_(timeValue, config) {
  const cfg = config || SHABTZAK_REC_CONFIG;
  const text = normalizeForSearch_(timeValue);
  if (!text) return false;
  return containsAny_(text, cfg.fullDayBlockingTimeKeywords || ['יומי']);
}

function isSkippedRecommendationTask_(task, config) {
  // v2.1: כונן גשש כן מקבל המלצות (הוא קם 05:30-07:00, חשוב לבחור מי שישן).
  // כרמל נשאר מדולג.
  return !!task && (task.category === 'ignored' || task.category === 'carmel');
}

function isMissionRelevantAssignment_(assignment) {
  return !!assignment && assignment.category !== 'ignored' && !isKonenutAssignment_(assignment);
}

// כוננות שקופה למנוחה: מניחים שהחייל ישן.
// v2.7: גם כונן גשש נשאר שקוף למנוחה (ישן בלילה, זמין למחרת ב-06:00).
// v3.16: ובעקבות זה גם 0 שעות עבודה - אותה הנחה בדיוק, שני מקומות.
function isRestRelevantAssignment_(assignment) {
  if (!assignment) return false;
  if (assignment.category === 'tracker') return false;
  return isMissionRelevantAssignment_(assignment);
}

/**
 * v3.9: כוננות התקפית יומית - זיכוי מנוחה בסיומה.
 * ההתקפי היומי חוסם 14:00-14:00 אבל רובו המתנה (בוולידציה הוא נספר
 * כ-8 שעות בלבד), ולכן ב-14:00 החייל נחשב כמי שכבר נח את הזיכוי.
 * התקפי עם טווח שעות מפורש הוא משמרת רגילה - בלי זיכוי.
 */
function isDailyAttackAssignment_(taskOrAssignment) {
  return !!taskOrAssignment &&
    taskOrAssignment.category === 'attack' &&
    !!taskOrAssignment.isFullDayByTime;
}

/**
 * v3.19: "כוננות התקפית" בעיני הוולידציה - isAttackReadiness_ מוגדרת
 * ב-ShabtzakOps.js ודורשת גם 'כוננות' וגם 'התקפי' בטקסט. משתמשים בה
 * ישירות במקום לשכפל את הכלל, כדי ששני הקבצים לא יוכלו להיפרד.
 * ⚠ זה *לא* אותו דבר כמו isDailyAttackAssignment_: זו שאלת ניסוח
 * בגיליון (יש 'כוננות'?), וזו שאלת טווח שעות (יומי?).
 */
function isAttackReadinessAssignment_(taskOrAssignment) {
  if (!taskOrAssignment) return false;
  return isAttackReadiness_({
    position: taskOrAssignment.position || '',
    type: taskOrAssignment.type || ''
  });
}

function restCreditAfter_(taskOrAssignment, config) {
  if (!isDailyAttackAssignment_(taskOrAssignment)) return 0;
  const cfg = config || SHABTZAK_REC_CONFIG;
  return Number(cfg.rest.attackRestCreditHours || 0);
}

/**
 * v3.14: הכיוון ההפוך - זיכוי מנוחה *לפני* כוננות התקפית יומית.
 * ההערה ב-v3.9 כבר הבטיחה את זה, אבל רק צד ה"אחרי" מומש בפועל.
 */
function restCreditBefore_(taskOrAssignment, config) {
  if (!isDailyAttackAssignment_(taskOrAssignment)) return 0;
  const cfg = config || SHABTZAK_REC_CONFIG;
  return Number(cfg.rest.attackRestCreditBeforeHours || 0);
}

function isMagenCategory_(taskOrAssignment) {
  return !!taskOrAssignment && (
    taskOrAssignment.category === 'magen' ||
    (taskOrAssignment.category === 'day_blocking' && !!taskOrAssignment.isMagenTagbatzPackage)
  );
}

function isTagbatzCategory_(taskOrAssignment) {
  return !!taskOrAssignment && (
    taskOrAssignment.category === 'tagbatz' ||
    (taskOrAssignment.category === 'day_blocking' && !!taskOrAssignment.isMagenTagbatzPackage)
  );
}

function sameOperationalDay_(aDate, bDate) {
  return getOperationalBaseDateForDate_(aDate).getTime() === getOperationalBaseDateForDate_(bDate).getTime();
}

function hasMagenTagbatzPackageForTask_(assignments, task) {
  const sameDayAssignments = assignments.filter(function(a) {
    return a && a.start && task && task.start && sameOperationalDay_(a.start, task.start);
  });
  return sameDayAssignments.some(isMagenCategory_) && sameDayAssignments.some(isTagbatzCategory_);
}

function isMagenTagbatzComplement_(a, b) {
  if (!a || !b || !a.start || !b.start || !sameOperationalDay_(a.start, b.start)) return false;
  return (a.category === 'magen' && b.category === 'tagbatz') ||
    (a.category === 'tagbatz' && b.category === 'magen');
}

/**
 * v3.15: זיהוי משמרת "כונן גשש", במקום אחד - משמש גם לסיווג הקטגוריה
 * וגם לספירת ההיסטוריה להוגנות. תמיד נבדק *לפני* התורנות.
 */
function isTrackerText_(position, type, config) {
  const cfg = config || SHABTZAK_REC_CONFIG;
  const text = normalizeForSearch_((position || '') + ' ' + (type || ''));
  if (!text) return false;
  return containsAny_(text, cfg.trackerKeywords || ['גשש']);
}

/**
 * v3.9: זיהוי תורנות, במקום אחד. מוגדר אחרי הגשש בכוונה - שורה כמו
 * "כונן גשש ותורן רס״פ" היא משמרת גשש ולא תורנות.
 */
function isToranutText_(position, type, config) {
  const cfg = config || SHABTZAK_REC_CONFIG;
  const text = normalizeForSearch_((position || '') + ' ' + (type || ''));
  if (!text) return false;
  if (isTrackerText_(position, type, cfg)) return false;
  return containsAny_(text, cfg.toranutKeywords || []);
}

/**
 * שתי קבוצות הרוטציה: סטטית (עמדות הגנה, תורנות) מול דינמית (סיור,
 * התקפי). אחרי יום בקבוצה אחת מעדיפים לעבור לשנייה - ולכן סטטיות ואז
 * תורנות *אינה* רוטציה, שתיהן באותה קבוצה.
 *
 * v3.17: כונן גשש אינו שייך לאף אחת מהשתיים ומחזיר '' (לא מסווג).
 * הוא כוננות שינה של 0 שעות עבודה המוחזקת על גבי משימה אמיתית, ולכן
 * אינו "יום סטטי" שצריך רוטציה אחריו ואינו נספר ב-staticMissionClassCount.
 * כל הצרכנים בודקים במפורש 'static'/'dynamic' או truthiness, ולכן ''
 * פשוט מוציא את הגשש מכל חשבונות הרוטציה - וזו הכוונה:
 * - משבצת גשש עצמה לא מקבלת קנס רצף סטטיות ולא בונוס שבירת רצף.
 * - יום שכל מה שהיה בו הוא גשש אינו יום סטטי ומאפס את רצף הסטטיות,
 *   כמו יום מנוחה. יום עם עמדה סטטית אמיתית לא הושפע.
 */
function getMissionClass_(category, config, taskOrAssignment) {
  const position = taskOrAssignment ? taskOrAssignment.position : '';
  const type = taskOrAssignment ? taskOrAssignment.type : '';
  if (category === 'tracker') return '';
  // גשש שנרשם "יומי" ולכן נפל ל-day_blocking - אותו דין.
  if (isTrackerText_(position, type, config)) return '';
  if (category === 'static' || category === 'daily_duty') return 'static';
  // רשת ביטחון לשורות "יומי" שלא נתפסו בקטגוריה עצמה.
  if (category === 'day_blocking' && isToranutText_(position, type, config)) return 'static';
  if (category === 'tour' || category === 'attack') return 'dynamic';
  return '';
}

function missionClassDisplayName_(missionClass, config) {
  const names = (config && config.missionClassDisplayNames) || {};
  return names[missionClass] || missionClass || 'דומה';
}

function taskToAssignment_(task, config) {
  return {
    soldierName: task.assigned,
    soldierKey: normalizeNameKey_(task.assigned),
    rowNumber: task.rowNumber,
    position: task.position,
    type: task.type,
    category: task.category,
    timeText: task.timeText || cleanText_(task.timeValue),
    isFullDayByTime: !!task.isFullDayByTime,
    isDailyKonenut: !!task.isDailyKonenut,
    isMagenTagbatzPackage: !!task.isMagenTagbatzPackage,
    start: task.start,
    end: task.end,
    durationHours: task.durationHours,
    source: 'current'
  };
}

/* ============================================================
 * קבוצות משימה (צוותים)
 * ============================================================ */

function buildTaskGroups_(tasks) {
  const groups = {};
  tasks.forEach(function(task) {
    if (!task) return;
    if (!groups[task.groupKey]) groups[task.groupKey] = { key: task.groupKey, tasks: [] };
    groups[task.groupKey].tasks.push(task);
  });
  return groups;
}

function makeTaskGroupKey_(position, type, category, start) {
  return [category, normalizeForSearch_(position), normalizeForSearch_(type), start.getTime()].join('|');
}

function getGroupTasksSortedByRow_(group) {
  if (!group || !group.tasks) return [];
  return group.tasks
    .filter(function(t) { return !!t; })
    .slice()
    .sort(function(a, b) {
      return (a.rowNumber || 999999) - (b.rowNumber || 999999);
    });
}

function getFirstTaskInGroup_(group) {
  const tasks = getGroupTasksSortedByRow_(group);
  return tasks.length ? tasks[0] : null;
}

function isFirstTaskInGroup_(task, group) {
  const first = getFirstTaskInGroup_(group);
  return !!(task && first && task.rowNumber === first.rowNumber);
}

function getLastTaskInGroup_(group) {
  const tasks = getGroupTasksSortedByRow_(group);
  return tasks.length ? tasks[tasks.length - 1] : null;
}

function requiresCommanderFirstSlot_(task, config) {
  if (!task || !task.category) return false;
  return task.category === 'tour' || task.category === 'tagbatz' || task.category === 'attack';
}

/**
 * v3.6: המשבצת האחרונה בכל סיור שמורה לנהג דוד, כמו שהמשבצת הראשונה
 * שמורה למפקד. בקבוצה בת משבצת אחת המפקד גובר - לא דורשים שהחייל
 * היחיד יהיה גם מפקד וגם נהג.
 */
/**
 * v3.20: שתי משבצות נהג, אותו דפוס בדיוק - המשבצת האחרונה בקבוצה שמורה
 * לנהג. בסיור זה נהג דוד (v3.6), ובהתקפי נהג טיגריס.
 *
 * ⚠ בהתקפי זו המשבצת האחרונה של *הקבוצה כולה*, לא של כל צוות: הגיליון
 * נכתב כך בפועל - בבלוקים בני 8 מושבים הטיגריס יושב במושב 8 בלבד,
 * ומושב 4 (סוף הצוות הראשון) אינו נהג. זה שונה מכלל המפקד, שהוא כן
 * לכל צוות (getTeamTasksForTask_), ולכן אי אפשר לגזור אחד מהשני.
 *
 * מוגדר כרשימה אחת ולא כשני עותקים של אותן שש פונקציות - שני עותקים
 * הם בדיוק איך שכללים כאלה נפרדים זה מזה עם הזמן.
 */
function driverSeatRuleForTask_(task, config) {
  if (!task) return null;
  const rules = (config && config.driverSeatRules) || SHABTZAK_REC_CONFIG.driverSeatRules || [];
  for (let i = 0; i < rules.length; i++) {
    if (rules[i].category === task.category) return rules[i];
  }
  return null;
}

/**
 * v3.22: משבצת החפ"ק הראשונה שמורה לצוות המפל"ג.
 *
 * שלוש פונקציות קטנות במקום אחת, כי כל אחת נשאלת בנפרד: מי הוא איש
 * מפל"ג, מהי משימת חפ"ק, ואיזו משבצת בתוכה שמורה. הכלל עצמו דו-כיווני
 * ויושב ב-evaluateCandidateForTask_.
 */
function isCommandStaffSoldier_(soldier, config) {
  const cfg = config || SHABTZAK_REC_CONFIG;
  if (!soldier) return false;
  if (soldier.isCommandStaff !== undefined) return !!soldier.isCommandStaff;
  return containsAny_(soldier.platoon, cfg.commandStaffPlatoonKeywords || []);
}

function isHafakTask_(task, config) {
  const cfg = config || SHABTZAK_REC_CONFIG;
  if (!task) return false;
  return containsAny_(cleanText_(task.position + ' ' + task.type), cfg.hafakKeywords || []);
}

function isCommandStaffSeat_(task, group, config) {
  const cfg = config || SHABTZAK_REC_CONFIG;
  const seats = cfg.hafakCommandStaffSeats || 0;
  if (!seats || !isHafakTask_(task, cfg)) return false;

  const tasks = getGroupTasksSortedByRow_(group);
  // בלי קבוצה (למשל שורת חפ"ק בודדת) המשבצת עצמה היא הראשונה.
  if (!tasks.length) return true;
  for (let i = 0; i < Math.min(seats, tasks.length); i++) {
    if (task.rowNumber === tasks[i].rowNumber) return true;
  }
  return false;
}

function soldierIsDriverFor_(soldier, rule) {
  return !!(soldier && rule && soldier[rule.flag]);
}

function isDriverSeat_(task, group, config) {
  if (!driverSeatRuleForTask_(task, config)) return false;
  const tasks = getGroupTasksSortedByRow_(group);
  if (tasks.length < 2) return false;
  const last = tasks[tasks.length - 1];
  return !!(task && last && task.rowNumber === last.rowNumber);
}

function getDriverSeatStatus_(task, group, soldiersByName, config) {
  const rule = driverSeatRuleForTask_(task, config);
  if (!rule) return { required: false, status: 'not_required', text: '' };

  const tasks = getGroupTasksSortedByRow_(group);
  if (tasks.length < 2) return { required: false, status: 'not_required', text: '' };

  const lastTask = tasks[tasks.length - 1];
  if (!lastTask.assigned) return { required: true, status: 'missing', text: rule.label + ' צריך להיות במשבצת האחרונה' };

  const lastSoldier = soldiersByName[normalizeNameKey_(lastTask.assigned)];
  if (!lastSoldier) return { required: true, status: 'unknown', text: 'משבצת אחרונה לא מזוהה כ' + rule.label };
  if (soldierIsDriverFor_(lastSoldier, rule)) return { required: true, status: 'ok', text: rule.label + ' במשבצת האחרונה' };
  return { required: true, status: 'wrong', text: '⚠ המשבצת האחרונה אינה ' + rule.label };
}

/**
 * משבצות הנהג בסיורים שעדיין אין בהן נהג דוד - ריקות או מאוישות במישהו
 * אחר. אלה המשבצות שבגללן שומרים נהגים משאר העמדות.
 */
function getUncoveredDriverSeats_(context) {
  if (context.uncoveredDriverSeats) return context.uncoveredDriverSeats;

  const config = context.config;
  const seats = [];
  const groups = context.taskGroups || {};

  Object.keys(groups).forEach(function(key) {
    const group = groups[key];
    const last = getLastTaskInGroup_(group);
    if (!last || !isDriverSeat_(last, group, config)) return;

    const rule = driverSeatRuleForTask_(last, config);
    const assigned = last.assigned ? context.soldiersByName[normalizeNameKey_(last.assigned)] : null;
    if (soldierIsDriverFor_(assigned, rule)) return;
    seats.push({ task: last, group: group, rule: rule });
  });

  context.uncoveredDriverSeats = seats;
  return seats;
}

/**
 * v3.6: לכל נהג דוד - רשימת משבצות-הנהג הפנויות שהוא באמת יכול לקחת
 * (זמין, מנוחה, בלי התנגשות). כל עוד יש לו כזו, הוא שמור לה ולא מומלץ
 * לעמדות אחרות. אם אין - הוא משוחרר, ולכן אין קיפאון ביום שבו אין מספיק
 * נהגים לכל הסיורים.
 */
function computeDriverReservations_(soldiers, context) {
  const reservations = {};
  const seats = getUncoveredDriverSeats_(context);
  if (!seats.length) return reservations;

  soldiers.forEach(function(soldier) {
    const takeable = [];
    seats.forEach(function(seat) {
      // v3.20: רק מושבים מסוג הנהג שלו - נהג דוד אינו שמור למושב הטיגריס.
      if (!soldierIsDriverFor_(soldier, seat.rule)) return;
      if (canDriverTakeSeat_(soldier, seat, context)) takeable.push(seat.task.rowNumber);
    });
    if (takeable.length) reservations[soldier.nameKey] = takeable;
  });

  return reservations;
}

function canDriverTakeSeat_(soldier, seat, context) {
  const savedGroup = context.group;
  const savedIgnoreSameRow = context.ignoreSameRow;
  // מונע רקורסיה: בבדיקה הזו כלל השמירה עצמו מושבת.
  context.skipDriverReservation = true;
  context.group = seat.group;
  context.ignoreSameRow = false;
  try {
    return !evaluateCandidateForTask_(soldier, seat.task, context).rejected;
  } finally {
    context.skipDriverReservation = false;
    context.group = savedGroup;
    context.ignoreSameRow = savedIgnoreSameRow;
  }
}

function driverReservedElsewhere_(soldier, task, context) {
  if (context.skipDriverReservation) return false;
  if (!soldier || !(soldier.isDudDriver || soldier.isTigerDriver)) return false;
  if (isDriverSeat_(task, context.group, context.config)) return false;

  const reserved = (context.driverReservations || {})[soldier.nameKey];
  if (!reserved || !reserved.length) return false;
  // המשבצת שמעריכים כרגע היא בעצמה אחת מהמשבצות השמורות - לא חוסמים.
  return reserved.some(function(rowNumber) { return rowNumber !== task.rowNumber; });
}

/**
 * v3.11: רף אחד לכל המשימות הפיקודיות - כל מי שיכול לפקד על סיור
 * (מ״מ / סמל / מ״כ / מ״ח) יכול גם להיות קצין מוצב. עד כאן קצין מוצב
 * נדרש סמל או מ״מ בלבד, וזה חסם מ״כים בלי סיבה.
 */
function soldierCanCommandTask_(soldier, task) {
  if (!soldier) return false;
  return soldier.isCommander;
}

function getFirstSlotCommanderStatus_(task, group, soldiersByName, config) {
  if (!requiresCommanderFirstSlot_(task, config)) {
    return { required: false, status: 'not_required', text: '' };
  }
  const firstTask = getFirstTaskInGroup_(group);
  if (!firstTask) return { required: true, status: 'missing', text: 'חסר מפקד במשבצת הראשונה' };
  if (!firstTask.assigned) return { required: true, status: 'missing', text: 'מפקד צריך להיות במשבצת הראשונה' };

  const firstSoldier = soldiersByName[normalizeNameKey_(firstTask.assigned)];
  if (!firstSoldier) return { required: true, status: 'unknown', text: 'משבצת ראשונה לא מזוהה כמפקד' };
  if (soldierCanCommandTask_(firstSoldier, task)) return { required: true, status: 'ok', text: 'מפקד במשבצת הראשונה' };
  return { required: true, status: 'wrong', text: '⚠ המשבצת הראשונה אינה מפקד' };
}

/**
 * v3.7: התקפי יוצא בכמה צוותים באותה קבוצה - כל attackTeamSize משבצות
 * רצופות הן צוות, והמשבצת הראשונה של כל צוות היא המפקד שלו (1 ו-5
 * בקבוצה בת 8). לשאר הקטגוריות אין חלוקה כזו והצוות הוא כל הקבוצה.
 */
function getTeamSizeForTask_(task, config) {
  if (task && task.category === 'attack') return config.attackTeamSize || 0;
  return 0;
}

function getTeamTasksForTask_(task, group, config) {
  const tasks = getGroupTasksSortedByRow_(group);
  const size = getTeamSizeForTask_(task, config);
  if (!size || tasks.length <= size) return tasks;

  let index = -1;
  for (let i = 0; i < tasks.length; i++) {
    if (task && tasks[i].rowNumber === task.rowNumber) { index = i; break; }
  }
  if (index === -1) return tasks;

  const start = Math.floor(index / size) * size;
  return tasks.slice(start, start + size);
}

function isTaskInSplitTeam_(task, group, config) {
  const size = getTeamSizeForTask_(task, config);
  return !!size && getGroupTasksSortedByRow_(group).length > size;
}

function findCommanderInTasks_(tasks, task, soldiersByName) {
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || !t.assigned) continue;
    const s = soldiersByName[normalizeNameKey_(t.assigned)];
    if (s && soldierCanCommandTask_(s, task)) return s;
  }
  return null;
}

/**
 * המפקד שאליו מיוחסת המשבצת, לפי סדר העדיפות:
 * 1. מפקד הצוות של המשבצת - המשבצת הראשונה של הצוות, ואם אין בה מפקד
 *    אז המפקד הראשון בתוך אותו צוות (בהתקפי: 1-4 מול משבצת 1,
 *    5-8 מול משבצת 5).
 * 2. מפקד הקבוצה - אם לצוות אין מפקד משלו (למשל אין מפקד במשבצת 5),
 *    נופלים למפקד של הקבוצה כולה, כדי שגם המשבצות האלה יעדיפו חיילים
 *    מאותה מחלקה.
 *
 * fromTeam אומר אם העוגן הוא מפקד הצוות עצמו - רק לצורך ניסוח ההסבר.
 */
function resolveCommanderForTask_(task, group, soldiersByName, config) {
  if (!group || !group.tasks) return { commander: null, fromTeam: false };

  const teamTasks = getTeamTasksForTask_(task, group, config);
  const teamCommander = findCommanderInTasks_(teamTasks, task, soldiersByName);
  if (teamCommander) {
    return { commander: teamCommander, fromTeam: isTaskInSplitTeam_(task, group, config) };
  }

  const groupTasks = getGroupTasksSortedByRow_(group);
  return { commander: findCommanderInTasks_(groupTasks, task, soldiersByName), fromTeam: false };
}

function getAssignedGroupCommander_(task, group, soldiersByName, config) {
  return resolveCommanderForTask_(task, group, soldiersByName, config).commander;
}

function isSamePlatoon_(a, b) {
  if (!a || !b) return false;
  const ap = normalizeForSearch_(a.platoon);
  const bp = normalizeForSearch_(b.platoon);
  return !!ap && !!bp && ap === bp;
}

function findCurrentSameDayAssignmentForRecommendations_(currentAssignmentsForSoldier, task) {
  if (!currentAssignmentsForSoldier || !task || !task.start) return null;
  return currentAssignmentsForSoldier.find(function(a) {
    if (!a || !a.start) return false;
    if (a.category === 'ignored' || isKonenutAssignment_(a)) return false;
    // v2.8: התקפי + התקפי באותו יום מותר (כל עוד אין חפיפת זמנים).
    if (task.category === 'attack' && a.category === 'attack') return false;
    // v3.2: כונן גשש חוסם רק את משמרתו בזמן (נבדק בחפיפות), אבל
    // מותר לו לעשות משימות אחרות באותו יום. לכן צמד גשש<->כל דבר
    // אינו נחסם ברמת "כבר משובץ היום"; חפיפת הזמן בפועל תיתפס בהמשך.
    if (task.category === 'tracker' || a.category === 'tracker') return false;
    return sameOperationalDay_(a.start, task.start);
  }) || null;
}

/* ============================================================
 * סטטוס קבוצה
 * ============================================================ */

function getGroupStatusText_(task, group, soldiersByName, config, currentTasks) {
  const assignedTasks = group.tasks.filter(function(t) { return !!t.assigned; });
  const assignedCount = assignedTasks.length;
  const totalSlots = group.tasks.length;
  const assignedSoldiers = assignedTasks
    .map(function(t) { return soldiersByName[normalizeNameKey_(t.assigned)]; })
    .filter(Boolean);

  const hasTigerDriver = assignedSoldiers.some(function(s) { return s.isTigerDriver; });

  const parts = [];
  parts.push(assignedCount + '/' + totalSlots + ' משובצים');

  if (task.category === 'carmel') {
    parts.push(task.isDailyKonenut
      ? 'כוננות יומית (14:00-14:00): חוסמת את היממה למשימות רגילות, פתוחה לפעילויות התקפיות'
      : 'כוננות: חוסמת רק את משבצת הזמן שלה');
    return parts.join(' | ');
  }

  if (task.category === 'tracker') {
    parts.push('כונן גשש (משמרת ' + formatTimeOnly_(task.start) + '-' + formatTimeOnly_(task.end) +
      '): שמור ליורדי הסיור התואם, לפי מי שעשה הכי מעט גשש | 0 שעות עבודה, שקוף למנוחת ההמשך');
    return parts.join(' | ');
  }

  if (task.category === 'tour' || task.category === 'tagbatz') {
    const firstSlotStatus = getFirstSlotCommanderStatus_(task, group, soldiersByName, config);
    parts.push(firstSlotStatus.text);
    // v3.6: כל סיור צריך נהג דוד במשבצת האחרונה, לא רק סיור הלילה.
    const dudSlotStatus = getDriverSeatStatus_(task, group, soldiersByName, config);
    if (dudSlotStatus.required) parts.push(dudSlotStatus.text);
  }

  if (task.category === 'attack') {
    const firstSlotStatus = getFirstSlotCommanderStatus_(task, group, soldiersByName, config);
    parts.push(firstSlotStatus.text);
    // v3.20: הכלל הוא *היכן* יושב הטיגריס, לא רק אם יש אחד בקבוצה.
    // כשהמשבצת האחרונה מדברת, היא הקובעת - אחרת שתי ההודעות סותרות.
    const tigerSeatStatus = getDriverSeatStatus_(task, group, soldiersByName, config);
    if (tigerSeatStatus.required) parts.push(tigerSeatStatus.text);
    else parts.push(hasTigerDriver ? 'יש נהג טיגריס' : 'חסר נהג טיגריס');
  }

  if (task.category === 'post_officer') {
    const hasCommander = assignedSoldiers.some(function(s) { return soldierCanCommandTask_(s, task); });
    parts.push(hasCommander ? 'יש מפקד' : 'חסר מפקד');
    parts.push('חוסם להמלצות עד סוף יום השבצ״ק');
  }

  if (isFullDayBlockingAssignment_(task, config) && task.category !== 'post_officer') {
    parts.push('יומי בעמודת שעה - חוסם המשך שיבוץ');
  }

  if (task.category === 'static') {
    const staticCommandersSameStart = countStaticCommandersAtStart_(task.start, currentTasks || group.tasks, soldiersByName, null);
    if (staticCommandersSameStart > 1) parts.push('ריבוי מפקדים באותה שעה');
  }

  return parts.join(' | ');
}

function countStaticCommandersAtStart_(start, tasks, soldiersByName, excludeRowNumber) {
  return tasks.filter(function(t) {
    if (!t || t.category !== 'static') return false;
    if (!t.assigned) return false;
    if (excludeRowNumber && t.rowNumber === excludeRowNumber) return false;
    const soldier = soldiersByName[normalizeNameKey_(t.assigned)];
    return soldier && soldier.isStaticCommander && sameMinute_(t.start, start);
  }).length;
}

/* ============================================================
 * דירוג מועמדים - מעבר יחיד
 * ============================================================ */

/**
 * v2.2: מעבר אחד מחזיר מדורגים תקינים + מועמדי "בדוחק" + סיכום נדחים.
 * מועמדי דוחק מצורפים אחרי התקינים כדי שתמיד תהיה המלצה
 * כל עוד יש חייל שאפשר פיזית לשבץ.
 */
function rankCandidatesForTask_(task, soldiers, context) {
  const primary = [];
  const fallbacks = [];
  const rejectedCounts = {};

  const rankingContext = Object.create(context);
  rankingContext.excludeAssignedSameOperationalDay = true;
  rankingContext.ignoreSameRow = context.ignoreSameRow;

  soldiers.forEach(function(soldier) {
    const ev = evaluateCandidateForTask_(soldier, task, rankingContext);
    if (ev.rejected) {
      rejectedCounts[ev.rejectReason] = (rejectedCounts[ev.rejectReason] || 0) + 1;
    } else if (ev.fallback) {
      fallbacks.push(ev);
    } else {
      primary.push(ev);
    }
  });

  const byScore = function(a, b) {
    if (a.score !== b.score) return a.score - b.score;
    return a.soldier.name.localeCompare(b.soldier.name, 'he');
  };
  primary.sort(byScore);
  fallbacks.sort(byScore);

  const reasons = Object.keys(rejectedCounts).sort(function(a, b) {
    return rejectedCounts[b] - rejectedCounts[a];
  });
  const rejectedSummary = reasons.slice(0, 4)
    .map(function(k) { return k + ' (' + rejectedCounts[k] + ')'; })
    .join(' | ');

  return {
    ranked: primary.concat(fallbacks),
    primaryCount: primary.length,
    rejectedSummary: rejectedSummary
  };
}

/* ============================================================
 * הערכת מועמד
 * ============================================================ */

function evaluateCandidateForTask_(soldier, task, context) {
  const config = context.config;
  const result = {
    soldier: soldier,
    score: 0,
    reasons: [],
    warnings: [],
    rejected: false,
    rejectReason: '',
    restBeforeHours: null,
    restAfterHours: null,
    restBeforeFromAttackReadiness: false,
    previousAssignment: null,
    previousAwayLabel: '',
    previousDayMatch: null,
    samePlatoonAsGroupCommander: false,
    samePlatoonCommanderLabel: '',
    toranutHistoryCount: 0,
    trackerHistoryCount: 0,
    stats: null,
    sameDayMissionHours: 0,
    sameDayKonenutHours: 0
  };

  // --- זמינות (עם cache לכל הריצה) ---
  // v3.4: מפתח הקאש כולל את היום הקלנדרי של המשבצת, כי הזמינות
  // יכולה להשתנות בין החלק של "היום" לחלק של "מחר" באותו יום שבצ"ק.
  const slotDayKey = task && task.start
    ? (dateOnly_(task.start).getTime() > dateOnly_(context.baseDate).getTime() ? 'next' :
       (dateOnly_(task.start).getTime() < dateOnly_(context.baseDate).getTime() ? 'prev' : 'today'))
    : 'today';
  const availKey = soldier.nameKey + '|' + slotDayKey;
  let statusCheck = context.availabilityCache[availKey];
  if (!statusCheck) {
    statusCheck = getAvailabilityStatus_(soldier, task, config, context.baseDate);
    context.availabilityCache[availKey] = statusCheck;
  }
  if (!statusCheck.available) return reject_(result, statusCheck.reason);

  // v3.20: המפל"ג מול משבצת החפ"ק הראשונה - שני הכיוונים.
  // בכוונה *מחוץ* ל-availabilityCache: התשובה תלויה במשבצת, והמפתח שם
  // ברזולוציית יום בלבד, בדיוק כמו היציאה הקצרה ב-v3.6.
  const commandStaffSeat = isCommandStaffSeat_(task, context.group, config);
  if (isCommandStaffSoldier_(soldier, config)) {
    if (!commandStaffSeat) return reject_(result, 'מפל״ג - רק למשבצת החפ״ק הראשונה');
  } else if (commandStaffSeat) {
    return reject_(result, 'משבצת החפ״ק הראשונה שמורה למפל״ג');
  }

  // v3.6: יציאה קצרה מאושרת חוסמת רק את חלון הזמן שלה.
  // בכוונה *מחוץ* ל-availabilityCache: המפתח שם הוא ברזולוציית יום,
  // ואילו יציאה תלויה בשעות המשבצת - שתי משבצות באותו יום יכולות
  // לקבל תשובות שונות.
  const exitConflict = findExitConflict_(soldier, task, context.baseDate);
  if (exitConflict) return reject_(result, 'ביציאה מאושרת (' + exitConflict.text + ')');

  // v3.18: יום היציאה לחופש / החזרה ממנו חוסם רק את חלק היום שאחרי או
  // לפני שעת ההחלפה. גם זה מחוץ ל-availabilityCache, מאותה סיבה.
  const vacationConflict = findVacationChangeConflict_(soldier, task, context.baseDate);
  if (vacationConflict) return reject_(result, vacationConflict);

  if (task.category === 'static' && config.scoring.seniorCommanderStaticBlock && soldier.isSeniorCommander) {
    return reject_(result, 'מ״מ/סמל לא עולים עמדות הגנה');
  }

  if (task.category === 'post_officer' && !soldierCanCommandTask_(soldier, task)) {
    return reject_(result, 'קצין מוצב יכול להיות רק מפקד');
  }

  if (requiresCommanderFirstSlot_(task, config) && isFirstTaskInGroup_(task, context.group) && !soldierCanCommandTask_(soldier, task)) {
    return reject_(result, 'משבצת ראשונה שמורה למפקד');
  }

  // v3.6: המשבצת האחרונה בסיור שמורה לנהג דוד, בדיוק כמו המשבצת
  // הראשונה למפקד. v3.20: וכך גם המשבצת האחרונה בהתקפי, לנהג טיגריס.
  // אם אין נהג פנוי המשבצת תישאר בלי מועמד - זו החלטה מודעת: עדיף
  // שיהיה גלוי שחסר נהג.
  const driverSeatRule = isDriverSeat_(task, context.group, config)
    ? driverSeatRuleForTask_(task, config)
    : null;
  if (driverSeatRule && !soldierIsDriverFor_(soldier, driverSeatRule)) {
    return reject_(result, 'משבצת אחרונה ב' + driverSeatRule.groupLabel + ' שמורה ל' + driverSeatRule.label);
  }

  // v3.6: נהג שיכול עדיין לאייש משבצת-נהג פנויה לא מומלץ לשום עמדה
  // אחרת, כדי שלא "יבוזבז". ברגע שכל המשבצות שהוא יכול לקחת מאוישות -
  // הוא משוחרר לשאר העמדות.
  if (driverReservedElsewhere_(soldier, task, context)) {
    return reject_(result, 'נהג שמור למשבצת הנהג');
  }

  // --- שיבוצים נוכחיים של החייל (מהאינדקס, לא סינון כללי) ---
  const rawCurrent = context.currentBySoldier[soldier.nameKey] || [];
  const currentAssignmentsForSoldier = context.ignoreSameRow
    ? rawCurrent.filter(function(a) { return a.rowNumber !== task.rowNumber; })
    : rawCurrent;

  if (context.excludeAssignedSameOperationalDay) {
    const sameDayAssignment = findCurrentSameDayAssignmentForRecommendations_(currentAssignmentsForSoldier, task);
    if (sameDayAssignment) {
      return reject_(result, 'כבר משובץ היום: ' + shortAssignmentText_(sameDayAssignment));
    }
  }

  if (hasMagenTagbatzPackageForTask_(currentAssignmentsForSoldier, task)) {
    return reject_(result, 'כבר משובץ למגן+תגב״צ');
  }

  // --- כוננות יומית (התקפי): חוסמת משימות רגילות, פתוחה למשימות התקפיות ---
  const dailyKonenut = currentAssignmentsForSoldier.find(function(a) {
    return a.isDailyKonenut && sameOperationalDay_(a.start, task.start);
  });
  if (dailyKonenut && task.category !== 'attack') {
    return reject_(result, 'בכוננות התקפית היום');
  }

  // --- חסימת "משימה יומית" (יומי רגיל / קצין מוצב) ---
  const currentDayBlock = currentAssignmentsForSoldier.find(function(a) {
    return isFullDayBlockingAssignment_(a, config);
  });
  if (currentDayBlock) {
    return reject_(result, 'כבר משובץ למשימה יומית: ' + shortAssignmentText_(currentDayBlock));
  }

  if (isFullDayBlockingAssignment_(task, config)) {
    const otherCurrentTask = currentAssignmentsForSoldier.find(function(a) {
      return !!a && a.category !== 'ignored' && !isKonenutAssignment_(a);
    });
    if (otherCurrentTask) {
      return reject_(result, 'כבר משובץ ביום של משימה יומית: ' + shortAssignmentText_(otherCurrentTask));
    }
  }

  const duplicateInGroup = currentAssignmentsForSoldier.some(function(a) {
    if (!a.rowNumber) return false;
    const sameGroupTask = context.group.tasks.some(function(gt) { return gt.rowNumber === a.rowNumber; });
    return sameGroupTask && a.rowNumber !== task.rowNumber;
  });
  if (duplicateInGroup) return reject_(result, 'כבר נמצא באותה משימה/צוות');

  // --- חפיפות ---
  for (let i = 0; i < currentAssignmentsForSoldier.length; i++) {
    const a = currentAssignmentsForSoldier[i];
    if (a.category === 'ignored') continue;
    if (isMagenTagbatzComplement_(task, a)) continue;
    if (hasOperationalConflict_(task, a, config)) {
      return reject_(result, 'חפיפה עם ' + shortAssignmentText_(a));
    }
  }

  // v2.8: הוסרו החסימות הגורפות של "התקפי תופס את כל היום".
  // פעילויות התקפיות שאינן חופפות בזמן מותרות לאותו חייל;
  // בדיקת החפיפה למעלה + מגבלת העומס היומי למטה מכסות את השאר.

  // --- היסטוריית משימות של החייל (מהאינדקס) ---
  const rawAll = context.assignmentsBySoldier[soldier.nameKey] || [];
  const assignmentsForSoldier = [];
  for (let i = 0; i < rawAll.length; i++) {
    const a = rawAll[i];
    if (a.category === 'ignored') continue;
    if (context.ignoreSameRow && a.rowNumber === task.rowNumber) continue;
    assignmentsForSoldier.push(a);
  }

  const restRelevantAssignmentsForSoldier = assignmentsForSoldier.filter(isRestRelevantAssignment_);
  const currentRestAssignmentsForSoldier = currentAssignmentsForSoldier.filter(isRestRelevantAssignment_);

  // --- מנוחה ---
  const prev = findPreviousAssignment_(restRelevantAssignmentsForSoldier, task.start);
  const next = findNextCurrentAssignment_(currentRestAssignmentsForSoldier, task.end);
  const prevRestRaw = prev ? hoursBetween_(prev.end, task.start) : config.rest.maxDisplayedRestHours;
  const nextRestRaw = next ? hoursBetween_(task.end, next.start) : config.rest.maxDisplayedRestHours;

  // v3.9: אחרי התקפי יומי (ומיד לפני התקפי יומי) מזכים שעות מנוחה -
  // הכוננות היא ברובה המתנה, ולכן מי שירד ממנה ב-14:00 כשיר מיד
  // לעמדה סטטית. השעות "האמיתיות" נשמרות לבונוס הזמינות בלבד.
  // v3.14: הזיכוי פועל גם בכיוון ההפוך - הכוננות "מתחילה בפועל" ב-18:00,
  // ולכן היורד מעמדה סטטית ב-10:00 נחשב כמי שנח 8 שעות לפניה.
  // max ולא סכום - שתי כוננויות צמודות לא יזכו ל-8 שעות זיכוי ויעברו
  // את בדיקת המנוחה בלי שאיש יראה אותן.
  // בצד ה"אחרי" אין צורך בזיכוי מקביל: מי שכבר משובץ לכוננות יומית
  // נדחה קודם לכן ("כבר משובץ למשימה יומית"), ולכן היא לעולם אינה
  // מגיעה לכאן כמשימה הבאה.
  const prevCreditAfterPrev = prev ? restCreditAfter_(prev, config) : 0;
  const prevCreditBeforeTask = prev ? restCreditBefore_(task, config) : 0;
  const prevRestCredit = Math.max(prevCreditAfterPrev, prevCreditBeforeTask);
  const nextRestCredit = next ? restCreditAfter_(task, config) : 0;
  const prevRest = prevRestRaw + prevRestCredit;
  const nextRest = nextRestRaw + nextRestCredit;
  result.previousAssignment = prev;
  result.previousAssignmentIsToday = !!(prev && sameOperationalDay_(prev.start, task.start));
  // v3.21: אם מאז המשמרת ההיא הוא היה בבית - זה מה שהעמודה תציג.
  result.previousAwayLabel = previousAwayLabelForSlot_(soldier, prev, task, context.baseDate, config);
  // v3.14: עמודת "מנוחה" מציגה את הפער האמיתי בין המשמרות, בלי הזיכוי.
  // הזיכוי פותח כשירות בלבד, והוא מוסבר בעמודת ההתאמה - כך שמספר
  // השעות שרואים על המסך תמיד תואם את מה שכתוב בשבצ"ק.
  result.restBeforeHours = prevRestRaw;
  result.restAfterHours = nextRestRaw;
  // v3.20: המספר נשאר הפער האמיתי, אבל עמודת המנוחה מסמנת שהוא בא
  // אחרי כוננות התקפית יומית - אחרת "4 שעות" נראה שם כמנוחה קצרה
  // בלי שום רמז לכך שהזיכוי הוא מה שהכשיר אותה.
  result.restBeforeFromAttackReadiness = prevCreditAfterPrev > 0;

  // v3.0: משמרת גשש מיועדת ליורד סיור - סיור שמסתיים עד שעה וחצי
  // לפני תחילת המשמרת (14->14:00, 22->22:00, 06->07:00).
  // המיועד מקבל בונוס גדול ופטור מבדיקת מנוחה (ישן בכוננות).
  const trackerDescentGap = config.scoring.trackerTourDescentMaxGapHours || 1.5;
  const isTrackerTourDescent = task.category === 'tracker' && prev && prev.category === 'tour' &&
    prevRest >= -0.01 && prevRest <= trackerDescentGap + 0.01;

  if (isTrackerTourDescent) {
    result.score += config.scoring.trackerAfterTourBonus || -35;
    result.reasons.push('✓ ירד מסיור ' + formatTimeOnly_(prev.end) + ' - מיועד לכונן גשש');
  } else {
    // v3.15: הגשש שמור ליורדי הסיור שהסתיים זה עתה. מי שלא ירד מסיור
    // יורד ל"בדוחק" ולא נחסם - כך המשמרת מתאיישת גם ביום שבו הסיור
    // עדיין לא שובץ, אבל כל יורד סיור זמין תמיד מעליו.
    if (task.category === 'tracker' && config.scoring.trackerRequireTourDescent !== false) {
      markFallback_(result, 'לא ירד מהסיור - כונן גשש שמור ליורדי הסיור', config, 'לא יורד סיור');
    }

    // לגשש בודקים את המנוחה מול חלון הפעילות בפועל, לא מול כל המשמרת.
    const restCheckDuration = task.category === 'tracker'
      ? (config.rest.trackerEffectiveDurationHours || 1.5)
      : task.durationHours;

    const restEvalBefore = evaluateRestWindow_(prevRest, restCheckDuration, config);
    if (restEvalBefore.reject) {
      // כשל מנוחה הוא לא חסימה קשיחה - המועמד יוצג "בדוחק"
      // רק אם אין מספיק מועמדים תקינים.
      markFallback_(result, restEvalBefore.reason, config, 'מנוחה ' + formatHours_(prevRest));
    } else if (restEvalBefore.warning) {
      result.warnings.push(restEvalBefore.warning);
      result.score += config.scoring.shortRestPenalty;
    }
  }

  if (prevCreditAfterPrev > 0) {
    result.reasons.push('ירד מכוננות התקפית ' + formatTimeOnly_(prev.end) +
      ' - נחשב כ־' + formatHours_(prevCreditAfterPrev) + ' מנוחה');
  } else if (prevCreditBeforeTask > 0) {
    result.reasons.push('הכוננות ההתקפית מתחילה בפועל מאוחר יותר - נחשב כ־' +
      formatHours_(prevCreditBeforeTask) + ' מנוחה נוספת');
  }

  const restEvalAfter = evaluateRestWindow_(nextRest, next ? next.durationHours : 4, config);
  if (restEvalAfter.reject) {
    markFallback_(result, 'אחר כך ' + restEvalAfter.reason, config,
      'מנוחה אחרי ' + formatHours_(nextRest));
  } else if (restEvalAfter.warning) {
    result.warnings.push('אחר כך ' + restEvalAfter.warning);
    result.score += config.scoring.shortRestPenalty / 2;
  }

  // --- סטטיסטיקות 7 ימים (עם cache לפי חייל+נקודת זמן) ---
  const statsKey = soldier.nameKey + '|' + task.start.getTime();
  let stats = context.statsCache[statsKey];
  if (!stats) {
    stats = calculateStats_(assignmentsForSoldier, task.start, config);
    context.statsCache[statsKey] = stats;
  }
  result.stats = stats;

  const sameDayHours = calculateSameOperationalDayHours_(assignmentsForSoldier, task, config);
  result.sameDayMissionHours = sameDayHours.missionHours;
  result.sameDayKonenutHours = sameDayHours.konenutHours;
  result.sameDayHours = sameDayHours.missionHours;

  applySameDayWorkloadScoring_(result, sameDayHours.missionHours, task, config);
  applyExitPackageScoring_(result, soldier, task, sameDayHours.missionHours, context, config);

  result.score += stats.totalHours * config.scoring.totalHourWeight;
  result.score += stats.nightCount * config.scoring.nightWeight;
  result.score += stats.staticMissionClassCount * config.scoring.staticWeight;
  result.score += stats.tourCount * config.scoring.tourWeight;
  result.score += stats.attackCount * config.scoring.attackWeight;
  result.score += stats.commanderTaskCount * config.scoring.commandTaskWeight;
  // בונוס הזמינות נמדד על המנוחה בפועל, בלי זיכוי ההתקפי:
  // הזיכוי פותח את הכשירות, אבל לא הופך מועמד לרענן יותר משהוא.
  result.score += Math.min(prevRestRaw, 24) * config.scoring.availableRestBonusPerHour;

  if (prev) {
    if (normalizeForSearch_(prev.position) && normalizeForSearch_(prev.position) === normalizeForSearch_(task.position)) {
      result.score += config.scoring.samePositionPenalty;
      result.warnings.push('עשה לאחרונה אותה עמדה');
    } else if (prev.category && prev.category === task.category) {
      result.score += config.scoring.sameCategoryPenalty;
    }
  }

  // --- אתמול: אותה משימה / אותה מחלקה / רוטציה ---
  const previousDayMatch = findPreviousOperationalDayTaskMatch_(assignmentsForSoldier, task, config);
  result.previousDayMatch = previousDayMatch;
  if (previousDayMatch.sameTask) {
    result.score += config.scoring.sameTaskPreviousDayPenalty;
    result.warnings.push('עשה את אותה משימה ביום הקודם');
  } else if (previousDayMatch.sameMissionClass) {
    result.score += config.scoring.sameMissionClassPreviousDayPenalty || config.scoring.sameCategoryPreviousDayPenalty;
    result.warnings.push('עשה משימה ' + missionClassDisplayName_(previousDayMatch.missionClass, config) + ' ביום הקודם');
  } else if (previousDayMatch.sameCategory) {
    result.score += config.scoring.sameCategoryPreviousDayPenalty;
    result.warnings.push('עשה סוג דומה ביום הקודם');
  } else if (previousDayMatch.oppositeMissionClass) {
    // בונוס רוטציה: אתמול סטטית -> היום דינמית (או להפך).
    result.score += config.scoring.rotationAlternationBonus || 0;
    result.reasons.push('רוטציה: אתמול ' + missionClassDisplayName_(previousDayMatch.yesterdayClass, config));
  }

  // --- רצף סטטיות: יומיים+ ברצף של משימות סטטיות בלבד ---
  const targetMissionClass = getMissionClass_(task.category, config, task);
  const staticStreak = countConsecutiveStaticClassDays_(assignmentsForSoldier, task.start, config);
  result.staticStreakDays = staticStreak;
  if (staticStreak >= 2) {
    if (targetMissionClass === 'static') {
      result.score += config.scoring.twoDayStaticStreakPenalty || 55;
      result.warnings.push(staticStreak + ' ימים סטטיות ברצף - חייב דינמית');
    } else if (targetMissionClass === 'dynamic') {
      result.score += config.scoring.twoDayStaticStreakBreakBonus || -25;
      result.reasons.push('✓ שובר רצף של ' + staticStreak + ' ימי סטטיות');
    }
  }

  applyMagenTagbatzPackageScoring_(result, task, currentAssignmentsForSoldier, config);
  applyRoleScoring_(result, soldier, task, context.group, context.soldiersByName, context.currentTasks, config);
  applySamePlatoonAsGroupCommanderScoring_(result, soldier, task, context.group, context.soldiersByName, config);
  applyToranutFairnessScoring_(result, soldier, task, context, config);
  applyTrackerFairnessScoring_(result, soldier, task, context, config);

  result.reasons.push('נח ' + formatHours_(prevRestRaw));
  result.reasons.push(Math.round(stats.totalHours) + ' שעות משימה ב־7 ימים');
  if (stats.konenutHours) result.reasons.push(formatHours_(stats.konenutHours) + ' כוננות ב־7 ימים');
  if (stats.nightCount) result.reasons.push(stats.nightCount + ' לילות');

  return result;
}

function reject_(result, reason) {
  result.rejected = true;
  result.rejectReason = reason;
  return result;
}

/**
 * v2.2: סימון מועמד "בדוחק" - נכשל בכללי מנוחה אבל לא בחסימה קשיחה
 * (חפיפה/סטטוס/תפקיד). מקבל קנס ענק כך שתמיד ידורג אחרון,
 * ומוצג רק כשאין מספיק מועמדים תקינים.
 */
function markFallback_(result, reason, config, shortLabel) {
  result.fallback = true;
  if (!result.fallbackReason) result.fallbackReason = reason;
  // v3.19: תווית קצרה לתא המועמדים. ארבעה כללים שונים מייצרים את אותה
  // מילה "בדוחק", ושלושה מהם אינם נראים בשום עמודה - עומס יומי, מנוחה
  // *אחרי* המשבצת, וייעוד הגשש. בלי התווית הזאת המפקד רואה סימון בלי סיבה.
  if (!result.fallbackShort) result.fallbackShort = shortLabel || '';
  result.score += config.scoring.fallbackBasePenalty || 400;
  result.warnings.push('⚠ ' + reason);
  return result;
}

function evaluateRestWindow_(restHours, targetDurationHours, config) {
  if (restHours === null || restHours === undefined) return { reject: false, warning: '' };
  if (restHours < config.rest.minimumHours - 0.01) {
    return { reject: true, reason: 'פחות מ־' + config.rest.minimumHours + ' שעות מנוחה' };
  }
  if (restHours < config.rest.idealHours - 0.01) {
    if (targetDurationHours > 4.25) {
      return { reject: true, reason: 'פחות מ־8 שעות מנוחה למשימה מעל 4 שעות' };
    }
    return { reject: false, warning: 'מנוחה קצרה: ' + formatHours_(restHours) };
  }
  return { reject: false, warning: '' };
}

function applyMagenTagbatzPackageScoring_(result, task, currentAssignmentsForSoldier, config) {
  if (!task || (task.category !== 'magen' && task.category !== 'tagbatz')) return;

  const sameDayAssignments = currentAssignmentsForSoldier.filter(function(a) {
    return a && a.start && sameOperationalDay_(a.start, task.start);
  });
  const hasComplement = task.category === 'magen'
    ? sameDayAssignments.some(isTagbatzCategory_)
    : sameDayAssignments.some(isMagenCategory_);

  if (hasComplement) {
    result.score += config.scoring.magenTagbatzPackageBonus || 0;
    result.reasons.push('משלים מגן+תגב״צ');
  }
}

/**
 * v3.9: הוגנות תורנויות. בשונה משאר המשקלים, שנמדדים על חלון של 7-10
 * ימים, כאן סופרים את *כל* ההיסטוריה ב"כל השבצק": תורנות היא תורנות גם
 * אם הייתה לפני חודש, ומי שעשה פחות צריך להיות ראשון בתור.
 *
 * הקנס לינארי בכמות התורנויות הקודמות ומוגבל בתקרה, כדי שחייל עם
 * היסטוריה חריגה (18 תורנויות מול חציון 0) לא ייחסם לתמיד.
 */
function applyToranutFairnessScoring_(result, soldier, task, context, config) {
  if (!task || task.category !== 'daily_duty') return;

  const count = (context.toranutHistoryCounts || {})[soldier.nameKey] || 0;
  result.toranutHistoryCount = count;

  if (!count) {
    result.reasons.push('✓ לא עשה תורנות עד היום');
    return;
  }

  const cap = config.scoring.toranutHistoryCap || 6;
  const weight = config.scoring.toranutHistoryWeight || 8;
  result.score += Math.min(count, cap) * weight;
  result.reasons.push(count + ' תורנויות בעבר');
}

/**
 * v3.15: הוגנות כונן גשש - אותו כלל תור כמו התורנויות, על תור אחר.
 * כל המועמדים הרלוונטיים ירדו מאותו סיור, ולכן זה המדד שקובע ביניהם:
 * מי שעשה הכי פחות משמרות גשש בכל ההיסטוריה עולה לראש הרשימה.
 * הקנס לינארי ומוגבל בתקרה, כדי שוותיק גשש לא ייחסם לתמיד.
 */
function applyTrackerFairnessScoring_(result, soldier, task, context, config) {
  if (!task || task.category !== 'tracker') return;

  const count = (context.trackerHistoryCounts || {})[soldier.nameKey] || 0;
  result.trackerHistoryCount = count;

  if (!count) {
    result.reasons.push('✓ לא היה כונן גשש עד היום');
    return;
  }

  const cap = config.scoring.trackerHistoryCap || 6;
  const weight = config.scoring.trackerHistoryWeight || 8;
  result.score += Math.min(count, cap) * weight;
  result.reasons.push(count + ' משמרות כונן גשש בעבר');
}

function applySamePlatoonAsGroupCommanderScoring_(result, soldier, task, group, soldiersByName, config) {
  // v3.8: בהתקפי מפוצל העוגן הוא מפקד הצוות של המשבצת; אם לצוות אין
  // מפקד משלו חוזרים למפקד הקבוצה.
  const resolved = resolveCommanderForTask_(task, group, soldiersByName, config);
  const commander = resolved.commander;
  if (!commander) return;
  if (commander.nameKey === soldier.nameKey) return;
  if (!isSamePlatoon_(soldier, commander)) return;

  result.score += config.scoring.samePlatoonAsGroupCommanderBonus || -7;
  result.samePlatoonAsGroupCommander = true;
  result.samePlatoonCommanderLabel = resolved.fromTeam
    ? 'אותה מחלקה כמו מפקד הצוות'
    : 'אותה מחלקה כמו המפקד';
  result.reasons.push(result.samePlatoonCommanderLabel);
}

function applyRoleScoring_(result, soldier, task, group, soldiersByName, currentTasks, config) {
  const groupSoldiers = group.tasks
    .filter(function(t) { return !!t.assigned; })
    .map(function(t) { return soldiersByName[normalizeNameKey_(t.assigned)]; })
    .filter(Boolean);

  const hasDudDriver = groupSoldiers.some(function(s) { return s.isDudDriver; });
  const hasTigerDriver = groupSoldiers.some(function(s) { return s.isTigerDriver; });
  const firstSlotRequired = requiresCommanderFirstSlot_(task, config);
  const isFirstCommanderSlot = firstSlotRequired && isFirstTaskInGroup_(task, group);
  const firstSlotStatus = getFirstSlotCommanderStatus_(task, group, soldiersByName, config);

  if (task.category === 'tour' || task.category === 'tagbatz') {
    if (isFirstCommanderSlot) {
      if (soldier.isCommander) result.score += config.scoring.commanderNeededBonus;
      else {
        result.score += config.scoring.commanderMissingPenalty;
        result.warnings.push('משבצת ראשונה שמורה למפקד');
      }
    } else if (firstSlotStatus.status !== 'ok') {
      if (soldier.isCommander) result.score += config.scoring.commanderInNonFirstSlotPenalty || 0;
      result.warnings.push('המפקד צריך להיות במשבצת הראשונה');
    }

    // v3.6: משבצת הנהג עצמה כבר חסומה לנהגי דוד בלבד, ולכן הבונוס נשאר
    // רק כדי לתעדף נהג בסיור לילה גם במשבצת רגילה, כשאין נהג בקבוצה.
    if (task.category === 'tour' && task.start.getHours() === 22 && !hasDudDriver) {
      if (soldier.isDudDriver) result.score += config.scoring.dudDriverNightBonus;
      else result.score += 10;
    }

    if (isDriverSeat_(task, group, config) && soldier.isDudDriver) {
      result.score += config.scoring.dudDriverSeatBonus;
    }
  }

  if (task.category === 'attack') {
    if (isFirstCommanderSlot) {
      if (soldier.isCommander) result.score += config.scoring.commanderNeededBonus;
      else {
        result.score += config.scoring.commanderMissingPenalty;
        result.warnings.push('משבצת ראשונה שמורה למפקד');
      }
      if (!hasTigerDriver && soldier.isTigerDriver) result.score += config.scoring.tigerDriverNeededBonus;
    } else {
      if (firstSlotStatus.status !== 'ok') {
        if (soldier.isCommander) result.score += config.scoring.commanderInNonFirstSlotPenalty || 0;
        result.warnings.push('המפקד צריך להיות במשבצת הראשונה');
      }
      if (!hasTigerDriver) {
        if (soldier.isTigerDriver) result.score += config.scoring.tigerDriverNeededBonus;
        else {
          result.score += config.scoring.tigerDriverMissingPenalty;
          result.warnings.push('לא נהג טיגריס');
        }
      }
    }
  }

  if (task.category === 'post_officer') {
    result.score -= 18;
  }

  if (task.category === 'static') {
    const commandersAtThisStart = countStaticCommandersAtStart_(task.start, currentTasks || group.tasks, soldiersByName, task.rowNumber);
    if (soldier.isStaticCommander && commandersAtThisStart > 0) {
      result.score += config.scoring.staticCommanderCrowdingPenalty;
      result.warnings.push('כבר יש מ״כ/מ״ח בשעה הזו');
    }
  }
}

/* ============================================================
 * יציאה קצרה מאושרת
 * הפורמט נפרס ב-parseExitStatus_ (מוגדר ב-ShabtzakOps, אותו פרויקט).
 * היציאה אינה משימה: היא לא נספרת בשעות עבודה ולא דורשת מנוחה
 * סביבה - היא רק תופסת את חלון הזמן שלה.
 * ============================================================ */

// כל חלונות היציאה הרלוונטיים ליממה, כתאריכים מלאים.
// נבדקות שלוש עמודות (אתמול/היום/מחר) כי יציאה באותו יום קלנדרי
// עשויה לחצות את 14:00 ולכן ליפול בשתי יממות מבצעיות.
function exitWindowsForSoldier_(soldier, baseDate) {
  if (!soldier || !baseDate) return [];

  const base = dateOnly_(baseDate);
  const columns = [
    { status: soldier.statusYesterday, offset: -1 },
    { status: soldier.statusToday, offset: 0 },
    { status: soldier.statusTomorrow, offset: 1 }
  ];

  const windows = [];
  columns.forEach(function(c) {
    const exit = parseExitStatus_(c.status);
    if (!exit) return;
    const day = addDays_(base, c.offset);
    windows.push({
      start: new Date(day.getTime() + exit.startMin * 60000),
      end: new Date(day.getTime() + exit.endMin * 60000),
      text: exit.text
    });
  });
  return windows;
}

// חפיפה בפועל בין המשבצת ליציאה. חצי-פתוח: יציאה שמסתיימת ב-22:00
// ומשימה שמתחילה ב-22:00 אינן חופפות.
function findExitConflict_(soldier, task, baseDate) {
  if (!task || !task.start || !task.end) return null;

  const windows = exitWindowsForSoldier_(soldier, baseDate);
  for (let i = 0; i < windows.length; i++) {
    if (task.start < windows[i].end && windows[i].start < task.end) return windows[i];
  }
  return null;
}

/**
 * v3.6: לחייל עם יציאה מאושרת - עדיפות למשימה שסוגרת לו את היום
 * במקטע אחד. משימה חלקית (למשל עמדת הגנה של 4 שעות) תדרוש משמרת
 * משלימה בהמשך היממה; אם היציאה לא מותירה חלון רצוף בגודל המתאים,
 * החייל ייחסם מהמשלימה - ייווצר חור בשבצ"ק והוא יישאר מתחת לתקרה.
 *
 * זהו קנס רך בלבד, ורק כשהמשימה באמת לא מסתדרת: כשהיציאה מתאימה גם
 * לסיור וגם לסטטיות, אף אחד מהם לא נקנס והבחירה נשארת בידי שאר
 * השיקולים (רוטציה, אותה משימה אתמול, עומס, מנוחה).
 */
function applyExitPackageScoring_(result, soldier, task, sameDayMissionHours, context, config) {
  if (!task || !task.start || !task.end) return;

  const windows = exitWindowsForSoldier_(soldier, context.baseDate);
  if (!windows.length) return;

  const target = config.scoring.exitDailyTargetHours || 8;
  const residual = target - (sameDayMissionHours || 0) - (task.durationHours || 0);
  if (residual <= 0.01) return; // המשימה סוגרת את היום - אין משלימה

  const dayStart = makeDateWithTime_(
    getOperationalBaseDateForDate_(task.start), opDayStartHour_(), opDayStartMinute_(), 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // תפוס = המשימה הנבדקת + חלונות היציאה, חתוכים לגבולות היממה.
  const busy = [{ start: task.start, end: task.end }].concat(windows);
  const clipped = [];
  busy.forEach(function(b) {
    const s = Math.max(b.start.getTime(), dayStart.getTime());
    const e = Math.min(b.end.getTime(), dayEnd.getTime());
    if (e > s) clipped.push({ s: s, e: e });
  });
  clipped.sort(function(a, b) { return a.s - b.s; });

  let cursor = dayStart.getTime();
  let largestGapHours = 0;
  clipped.forEach(function(b) {
    if (b.s > cursor) {
      largestGapHours = Math.max(largestGapHours, (b.s - cursor) / 3600000);
    }
    cursor = Math.max(cursor, b.e);
  });
  largestGapHours = Math.max(largestGapHours, (dayEnd.getTime() - cursor) / 3600000);

  if (largestGapHours + 0.01 >= residual) return;

  result.score += config.scoring.exitPackageMisfitPenalty || 45;
  result.warnings.push(
    'היציאה לא מותירה חלון למשמרת המשלימה (' + formatHours_(residual) + ')');
}

/* ============================================================
 * v3.21: "בבית" - מה שקרה בין המשימה הקודמת למשבצת
 * ============================================================ */

/**
 * v3.21: חלונות החופש של החייל כתאריכים מלאים, בדיוק כמו
 * exitWindowsForSoldier_ עושה ליציאות. שלוש עמודות בלבד קיימות
 * במצבת החיילים (אתמול/היום/מחר), ולכן זה כל מה שאפשר לראות אחורה.
 *
 * יום מעבר הוא יום חלקי: ביום היציאה החייל בבית *מ*שעת ההחלפה, וביום
 * החזרה *עד* שעת ההחלפה - אותה חלוקה שלפיה v3.18 חוסמת משבצות.
 * ליום שלפני "אתמול" אין עמודה, ולכן הסטטוס הקודם שלו ריק - בדיוק כמו
 * ב-getStatusForSlot_, ואז חופש נחשב יום שלם.
 */
function vacationWindowsForSoldier_(soldier, baseDate) {
  if (!soldier || !baseDate) return [];

  const base = dateOnly_(baseDate);
  const days = [
    { status: soldier.statusYesterday, previousStatus: '', offset: -1 },
    { status: soldier.statusToday, previousStatus: soldier.statusYesterday, offset: 0 },
    { status: soldier.statusTomorrow, previousStatus: soldier.statusToday, offset: 1 }
  ];

  const windows = [];
  days.forEach(function(d) {
    const transition = vacationTransitionForDay_(d.previousStatus, d.status);
    if (!transition) return;

    const day = addDays_(base, d.offset);
    const changeMin = vacationChangeMinutesForDate_(day);
    const startMin = transition === 'start' ? changeMin : 0;
    const endMin = transition === 'end' ? changeMin : 24 * 60;
    if (endMin <= startMin) return;

    windows.push({
      start: new Date(day.getTime() + startMin * 60000),
      end: new Date(day.getTime() + endMin * 60000)
    });
  });
  return windows;
}

/**
 * v3.21: רק יציאה *ארוכה* מספרת משהו על מה שהחייל עשה לאחרונה.
 * הסף הוא config.previousColumn.longExitMinHours, והשוואה ממש-גדול:
 * "יציאה מ10 עד 22" (12 שעות) נכנסת, "יציאה מ20" (4 שעות) לא.
 */
function longExitWindowsForSoldier_(soldier, baseDate, config) {
  const minHours = (config && config.previousColumn && config.previousColumn.longExitMinHours) || 8;
  return exitWindowsForSoldier_(soldier, baseDate).filter(function(w) {
    return (w.end.getTime() - w.start.getTime()) / 3600000 > minHours + 1e-6;
  });
}

/**
 * v3.21: מה שהחייל עשה בפער שבין סוף המשימה הקודמת לתחילת המשבצת.
 * הקצין קורא את העמודה כדי לדעת "במה האיש עסוק לאחרונה", ו"סיור 22:00"
 * מטעה כשמאז הוא היה בבית.
 *
 * רק הפער עצמו נבדק: חופש שנגמר *לפני* המשימה הקודמת אינו רלוונטי.
 * חלון שחופף לפער מסתיים בהכרח אחרי סוף המשימה הקודמת, ולכן הוא תמיד
 * העדכני מבין השניים. כשאין משימה קודמת כלל הפער פתוח אחורה.
 *
 * כששניהם חלים - בוחרים את המאוחר (מה שקרה לאחרונה), ובתיקו החופש קודם.
 */
function previousAwayLabelForSlot_(soldier, previousAssignment, task, baseDate, config) {
  if (!task || !task.start) return '';

  const gapStart = previousAssignment && previousAssignment.end
    ? previousAssignment.end.getTime()
    : -Infinity;
  const gapEnd = task.start.getTime();
  if (!(gapEnd > gapStart)) return '';

  const candidates = [];
  vacationWindowsForSoldier_(soldier, baseDate).forEach(function(w) {
    candidates.push({ label: 'חופש', start: w.start.getTime(), end: w.end.getTime(), rank: 0 });
  });
  longExitWindowsForSoldier_(soldier, baseDate, config).forEach(function(w) {
    candidates.push({
      label: 'יציאה ' + formatTimeOnly_(w.start) + '-' + formatTimeOnly_(w.end),
      start: w.start.getTime(),
      end: w.end.getTime(),
      rank: 1
    });
  });

  let best = null;
  candidates.forEach(function(c) {
    if (!(c.start < gapEnd && c.end > gapStart)) return;
    const endInGap = Math.min(c.end, gapEnd);
    if (!best || endInGap > best.endInGap || (endInGap === best.endInGap && c.rank < best.rank)) {
      best = { endInGap: endInGap, rank: c.rank, label: c.label };
    }
  });
  return best ? best.label : '';
}

function getAvailabilityStatus_(soldier, task, config, scheduleBaseDate) {
  const unitText = cleanText_(soldier.platoon + ' ' + soldier.role);
  if (containsAny_(unitText, config.excludedPlatoonOrRoleKeywords)) {
    return { available: false, reason: 'לא לוקחים מהחמ״ל' };
  }

  // v3.4: תחת שעון 14:00 יום השבצ"ק חוצה שני ימים קלנדריים.
  // בוחרים את עמודת הסטטוס לפי היום הקלנדרי של המשבצת עצמה:
  // - משבצת מתאריך השבצ"ק (14:00 והלאה) -> "היום" (statusToday).
  // - משבצת שגולשת ליום הקלנדרי הבא (00:00-14:00, למשל עמדות 06:00) -> "מחר".
  const slotStatus = getStatusForSlot_(soldier, task, scheduleBaseDate);

  // v3.18: ביום היציאה לחופש וביום החזרה ממנו החייל זמין בחלק מהיום,
  // ולכן ברזולוציית יום התשובה היא "זמין" - השעות עצמן נבדקות מחוץ
  // לקאש הזה, ב-findVacationChangeConflict_.
  if (isVacationTransitionDay_(soldier, task, scheduleBaseDate)) {
    return { available: true, reason: '' };
  }

  if (containsAny_(slotStatus.status, config.unavailableStatusKeywords)) {
    return {
      available: false,
      reason: 'סטטוס לא זמין (' + slotStatus.label + '): ' + slotStatus.status
    };
  }
  return { available: true, reason: '' };
}

/**
 * v3.18: שעות המשבצת בדקות מחצות היום הקלנדרי שבו היא *מתחילה*.
 * משבצת שגולשת אחרי חצות (או משימה יומית 14:00-14:00) מקבלת end מעל
 * 24 שעות, וכך "מסתיימת עד 06:00" נכשל אצלה כמצופה.
 */
function slotMinutesOnItsOwnDay_(task) {
  const dayStart = dateOnly_(task.start).getTime();
  return {
    start: Math.round((task.start.getTime() - dayStart) / 60000),
    end: Math.round((task.end.getTime() - dayStart) / 60000)
  };
}

/**
 * v3.18: האם היום הקלנדרי של המשבצת הוא יום החלפה - יציאה לחופש או
 * חזרה ממנו. vacationTransitionForDay_ ו-vacationChangeMinutesForDate_
 * מוגדרות ב-ShabtzakOps.js ומשמשות את שני הקבצים, כמו parseExitStatus_.
 */
function vacationTransitionForSlot_(soldier, task, scheduleBaseDate) {
  const slotStatus = getStatusForSlot_(soldier, task, scheduleBaseDate);
  return vacationTransitionForDay_(slotStatus.previousStatus, slotStatus.status);
}

function isVacationTransitionDay_(soldier, task, scheduleBaseDate) {
  const t = vacationTransitionForSlot_(soldier, task, scheduleBaseDate);
  return t === 'start' || t === 'end';
}

/**
 * v3.18: החופש מתחלף ב-06:00, וביום ראשון ב-09:00. ביום היציאה החייל
 * זמין *עד* אז, וביום החזרה *ממנה*. בכוונה מחוץ ל-availabilityCache -
 * המפתח שם הוא ברזולוציית יום, ואילו התשובה כאן תלויה בשעות המשבצת,
 * בדיוק כמו ביציאה קצרה מאושרת.
 * חצי-פתוח: משמרת שנגמרת ב-06:00 ומשמרת שמתחילה ב-06:00 שתיהן תקינות.
 */
function findVacationChangeConflict_(soldier, task, scheduleBaseDate) {
  if (!task || !task.start || !task.end) return '';

  const transition = vacationTransitionForSlot_(soldier, task, scheduleBaseDate);
  if (transition !== 'start' && transition !== 'end') return '';

  const changeMin = vacationChangeMinutesForDate_(dateOnly_(task.start));
  const slot = slotMinutesOnItsOwnDay_(task);
  const changeLabel = minutesToTimeLabel_(changeMin);

  if (transition === 'start') {
    if (slot.end <= changeMin) return '';
    return 'יוצא לחופש ב־' + changeLabel;
  }

  if (slot.start >= changeMin) return '';
  return 'חוזר מחופש ב־' + changeLabel;
}

/**
 * v3.4: מחזיר את הסטטוס הרלוונטי למשבצת, לפי היום הקלנדרי שלה.
 * אם אין scheduleBaseDate (למשל בדיקות ישנות) - נופלים ל-statusToday.
 */
function getStatusForSlot_(soldier, task, scheduleBaseDate) {
  // v3.18: previousStatus = הסטטוס של היום הקלנדרי שלפני המשבצת, כדי
  // לזהות יום ראשון של חופש מול יום חזרה. ליום שלפני "אתמול" אין
  // עמודה, ולכן הוא נשאר ריק - כלומר "לא ידוע", וההתנהגות שם נשארת
  // כמו לפני v3.18.
  if (!scheduleBaseDate || !task || !task.start) {
    return { status: soldier.statusToday, previousStatus: soldier.statusYesterday, label: 'היום' };
  }
  const slotDay = dateOnly_(task.start);
  const baseDay = dateOnly_(scheduleBaseDate);
  const diffDays = Math.round((slotDay.getTime() - baseDay.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays <= -1) return { status: soldier.statusYesterday, previousStatus: '', label: 'אתמול' };
  if (diffDays >= 1) return { status: soldier.statusTomorrow, previousStatus: soldier.statusToday, label: 'מחר' };
  return { status: soldier.statusToday, previousStatus: soldier.statusYesterday, label: 'היום' };
}

/* ============================================================
 * חפיפות וזמנים מבצעיים
 * ============================================================ */

function hasOperationalConflict_(targetTask, assignment, config) {
  // v2.8: כוננות (כרמל) לא מתנגשת עם משימות התקפיות -
  // צוות הכוננות הוא זה שמבצע אותן.
  if (isKonenutAssignment_(assignment) && targetTask.category === 'attack') return false;
  if (targetTask.category && isKonenutCategory_(targetTask.category) && assignment.category === 'attack') return false;

  // v2.8: משימות התקפיות חוסמות רק את הזמן האמיתי שלהן.
  // כמה פעילויות התקפי שלא חופפות בזמן - לגיטימי לאותו חייל
  // (מגבלת העומס היומי מטופלת בנפרד).
  const targetInterval = getOperationalBlockingInterval_(targetTask);
  const assignmentInterval = getOperationalBlockingInterval_(assignment);
  return intervalsOverlap_(targetInterval.start, targetInterval.end, assignmentInterval.start, assignmentInterval.end);
}

function getOperationalBlockingInterval_(taskOrAssignment) {
  // כרמל: חוסם לפי הזמן האמיתי שלו.
  if (isKonenutCategory_(taskOrAssignment.category)) {
    return { start: taskOrAssignment.start, end: taskOrAssignment.end };
  }

  // v3.2: כונן גשש חוסם רק את משמרתו בפועל - גם אם נרשם "יומי".
  if (taskOrAssignment.category === 'tracker') {
    return { start: taskOrAssignment.start, end: taskOrAssignment.end };
  }

  if (taskOrAssignment.category === 'day_blocking' ||
      isDailyTimeValue_(taskOrAssignment.timeText || taskOrAssignment.timeValue || '', SHABTZAK_REC_CONFIG)) {
    return getOperationalDayIntervalFromTask_(taskOrAssignment);
  }

  // v2.8: התקפי חוסם רק את משבצת הזמן שלו (לא את כל היממה).

  if (taskOrAssignment.category === 'post_officer') {
    return getPostOfficerBlockingIntervalFromTask_(taskOrAssignment);
  }

  return { start: taskOrAssignment.start, end: taskOrAssignment.end };
}

function getOperationalDayIntervalFromTask_(taskOrAssignment) {
  const base = getOperationalBaseDateForDate_(taskOrAssignment.start);
  return {
    start: makeDateWithTime_(base, opDayStartHour_(), opDayStartMinute_(), 0),
    end: makeDateWithTime_(addDays_(base, 1), opDayStartHour_(), opDayStartMinute_(), 0)
  };
}

function getPostOfficerBlockingIntervalFromTask_(taskOrAssignment) {
  // v3.0: קצין מוצב הוא משימה יומית - חוסם את כל היממה המבצעית.
  return getOperationalDayIntervalFromTask_(taskOrAssignment);
}

function findPreviousOperationalDayTaskMatch_(assignments, task, config) {
  const base = getOperationalBaseDateForDate_(task.start);
  const prevStart = makeDateWithTime_(addDays_(base, -1), opDayStartHour_(), opDayStartMinute_(), 0);
  const prevEnd = makeDateWithTime_(base, opDayStartHour_(), opDayStartMinute_(), 0);
  const targetIdentity = makeTaskIdentity_(task);
  const targetMissionClass = getMissionClass_(task.category, config, task);
  let sameTask = null;
  let sameMissionClass = null;
  let sameCategory = null;
  let oppositeMissionClass = null;

  assignments.forEach(function(a) {
    if (!a || !a.start || !a.end) return;
    if (!intervalsOverlap_(a.start, a.end, prevStart, prevEnd)) return;
    if (a.category === 'ignored' || isKonenutAssignment_(a)) return;

    // חפיפה של שעה+ עם חלון האתמול - מונע דימום של משימות שחוצות
    // את גבול 06:00 (כמו גשש שמתחיל 05:30) ליום הלא-נכון.
    const overlapStart = a.start > prevStart ? a.start : prevStart;
    const overlapEnd = a.end < prevEnd ? a.end : prevEnd;
    if (hoursBetween_(overlapStart, overlapEnd) < 1) return;

    const assignmentMissionClass = getMissionClass_(a.category, config, a);

    if (makeTaskIdentity_(a) === targetIdentity) {
      if (!sameTask || a.end > sameTask.end) sameTask = a;
    } else if (targetMissionClass && assignmentMissionClass === targetMissionClass) {
      if (!sameMissionClass || a.end > sameMissionClass.end) sameMissionClass = a;
    } else if (a.category && a.category === task.category && task.category !== 'regular') {
      if (!sameCategory || a.end > sameCategory.end) sameCategory = a;
    } else if (targetMissionClass && assignmentMissionClass && assignmentMissionClass !== targetMissionClass) {
      if (!oppositeMissionClass || a.end > oppositeMissionClass.end) oppositeMissionClass = a;
    }
  });

  return {
    sameTask: sameTask,
    sameMissionClass: sameMissionClass,
    missionClass: targetMissionClass,
    sameCategory: sameCategory,
    oppositeMissionClass: oppositeMissionClass,
    yesterdayClass: oppositeMissionClass ? getMissionClass_(oppositeMissionClass.category, config, oppositeMissionClass) : ''
  };
}

// שעת תחילת היממה המבצעית (שעון לחימה). ברירת מחדל 14:00.
function opDayStartHour_() {
  const od = SHABTZAK_REC_CONFIG.operationalDay;
  return od && od.startHour != null ? od.startHour : 14;
}

function opDayStartMinute_() {
  const od = SHABTZAK_REC_CONFIG.operationalDay;
  return od && od.startMinute != null ? od.startMinute : 0;
}

function getOperationalBaseDateForDate_(date) {
  let base = dateOnly_(date);
  if (date.getHours() < opDayStartHour_() ||
      (date.getHours() === opDayStartHour_() && date.getMinutes() < opDayStartMinute_())) {
    base = addDays_(base, -1);
  }
  return base;
}

/**
 * v2.2: כמה ימים מבצעיים רצופים (אחורה מאתמול) החייל עשה
 * *רק* משימות מהמחלקה הסטטית. יום עם משימה דינמית, יום מנוחה
 * או יום כוננות-בלבד שוברים את הרצף.
 */
function countConsecutiveStaticClassDays_(assignmentsForSoldier, taskStart, config) {
  const base = getOperationalBaseDateForDate_(taskStart);
  let streak = 0;

  for (let d = 1; d <= config.scoreLookbackDays; d++) {
    const dayStart = makeDateWithTime_(addDays_(base, -d), opDayStartHour_(), opDayStartMinute_(), 0);
    const dayEnd = makeDateWithTime_(addDays_(base, -d + 1), opDayStartHour_(), opDayStartMinute_(), 0);

    let hasStatic = false;
    let hasDynamic = false;

    for (let i = 0; i < assignmentsForSoldier.length; i++) {
      const a = assignmentsForSoldier[i];
      if (!a || !a.start || !a.end) continue;
      if (a.category === 'ignored' || isKonenutAssignment_(a)) continue;
      if (!intervalsOverlap_(a.start, a.end, dayStart, dayEnd)) continue;

      // דרישת חפיפה של שעה+ עם חלון היום: מונע "דימום" של משימות
      // שחוצות את גבול 06:00 (למשל גשש שמתחיל 05:30) לספירת היום הקודם.
      const overlapStart = a.start > dayStart ? a.start : dayStart;
      const overlapEnd = a.end < dayEnd ? a.end : dayEnd;
      if (hoursBetween_(overlapStart, overlapEnd) < 1) continue;

      const cls = getMissionClass_(a.category, config, a);
      if (cls === 'static') hasStatic = true;
      else if (cls === 'dynamic') hasDynamic = true;
    }

    if (hasStatic && !hasDynamic) streak++;
    else break;
  }

  return streak;
}

function makeTaskIdentity_(taskOrAssignment) {
  if (!taskOrAssignment) return '';
  const category = taskOrAssignment.category || '';
  const position = normalizeForSearch_(taskOrAssignment.position);
  const type = normalizeForSearch_(taskOrAssignment.type);

  if (category === 'static') return 'static:' + (position || type || 'עמדה');
  if (category === 'tour') return 'tour';
  if (category === 'attack') return 'attack';
  if (category === 'tracker') return 'tracker';
  if (category === 'daily_duty') return 'daily_duty';
  if (category === 'post_officer') return 'post_officer';
  if (category === 'tagbatz') return 'tagbatz';
  if (category === 'magen') return 'magen';
  if (category === 'day_blocking') return 'day_blocking';

  return category + ':' + (position || type || '');
}

function findPreviousAssignment_(assignments, beforeTime) {
  let best = null;
  assignments.forEach(function(a) {
    if (a.end <= beforeTime && (!best || a.end > best.end)) best = a;
  });
  return best;
}

function findNextCurrentAssignment_(assignments, afterTime) {
  let best = null;
  assignments.forEach(function(a) {
    if (a.start >= afterTime && (!best || a.start < best.start)) best = a;
  });
  return best;
}

/* ============================================================
 * סטטיסטיקות ועומס
 * ============================================================ */

/**
 * v2.0: מקבל את רשימת המשימות של החייל בלבד (מהאינדקס), לא את כולן.
 */
function calculateStats_(assignmentsForSoldier, beforeTime, config) {
  const since = addDays_(beforeTime, -config.scoreLookbackDays);
  const stats = {
    totalHours: 0,
    konenutHours: 0,
    nightCount: 0,
    staticCount: 0,
    staticMissionClassCount: 0,
    dynamicMissionClassCount: 0,
    tourCount: 0,
    attackCount: 0,
    postOfficerCount: 0,
    commanderTaskCount: 0
  };

  assignmentsForSoldier.forEach(function(a) {
    if (a.category === 'ignored') return;
    if (!(a.start < beforeTime && a.end > since)) return;

    const countedStart = a.start < since ? since : a.start;
    const countedEnd = a.end > beforeTime ? beforeTime : a.end;
    const hours = Math.max(0, hoursBetween_(countedStart, countedEnd));

    if (isKonenutAssignment_(a)) {
      stats.konenutHours += hours;
      return;
    }

    // v3.0: משימה יומית (14:00-14:00) נספרת עד 16 שעות עומס, לא 24,
    // ולא כלילה (מניחים שינה).
    // v3.16: כונן גשש = 0 שעות עבודה, בדיוק כמו כרמל - הוא כוננות שינה
    // המוחזקת *על גבי* משימה אמיתית. השעות נרשמות ככוננות ולא כמשימה.
    // הקטגוריה עצמה עדיין נספרת למטה (סטטית לרוטציה) - זו ספירת משימות,
    // לא שעות.
    // v3.19: כוננות התקפית מצטרפת לגשש - 0 שעות עבודה, ככוננות, בדיוק
    // כמו שהוולידציה סופרת אותה מאז ומתמיד.
    const countsAsKonenut = a.category === 'tracker' || isAttackReadinessAssignment_(a);
    const isDailyBlock = isFullDayBlockingAssignment_(a, config);
    if (countsAsKonenut) {
      stats.konenutHours += hours;
    } else {
      stats.totalHours += isDailyBlock
        ? Math.min(hours, config.scoring.dailyMissionWorkloadHours || 8)
        : hours;
    }
    if (!countsAsKonenut && !isDailyBlock && intervalTouchesNight_(a.start, a.end)) stats.nightCount += 1;
    if (a.category === 'static') stats.staticCount += 1;
    if (getMissionClass_(a.category, config, a) === 'static') stats.staticMissionClassCount += 1;
    if (getMissionClass_(a.category, config, a) === 'dynamic') stats.dynamicMissionClassCount += 1;
    if (a.category === 'tour' || a.category === 'tagbatz') stats.tourCount += 1;
    if (a.category === 'attack') stats.attackCount += 1;
    if (a.category === 'post_officer') stats.postOfficerCount += 1;
    if (a.category === 'tour' || a.category === 'tagbatz' || a.category === 'attack' || a.category === 'post_officer') stats.commanderTaskCount += 1;
  });

  return stats;
}

function calculateSameOperationalDayHours_(assignmentsForSoldier, task, config) {
  const result = { missionHours: 0, konenutHours: 0 };
  if (!task || !task.start || !assignmentsForSoldier || !assignmentsForSoldier.length) return result;

  const day = getOperationalDayIntervalFromTask_(task);
  const seen = {};

  assignmentsForSoldier.forEach(function(a) {
    if (!a || !a.start || !a.end) return;
    if (a.category === 'ignored') return;
    if (!intervalsOverlap_(a.start, a.end, day.start, day.end)) return;

    const key = [a.source || '', a.rowNumber || '', a.category || '', a.position || '', a.type || '', a.start.getTime(), a.end.getTime()].join('|');
    if (seen[key]) return;
    seen[key] = true;

    const start = a.start < day.start ? day.start : a.start;
    const end = a.end > day.end ? day.end : a.end;
    const hours = Math.max(0, hoursBetween_(start, end));

    if (isKonenutAssignment_(a) || a.category === 'tracker' || isAttackReadinessAssignment_(a)) {
      // v3.16: הגשש נספר ככוננות, לא כשעות משימה - ראה calculateStats_.
      // v3.19: וכך גם כוננות התקפית, בדיוק כמו בוולידציה
      // (hoursForDailyTotal = 0 ב-ShabtzakOps).
      result.konenutHours += hours;
    } else if (isFullDayBlockingAssignment_(a, config)) {
      // v3.19: משימה יומית - עומס אפקטיבי כמו בוולידציה (8), לא 16.
      result.missionHours += Math.min(hours, config.scoring.dailyMissionWorkloadHours || 8);
    } else {
      result.missionHours += hours;
    }
  });

  return result;
}

function applySameDayWorkloadScoring_(result, sameDayMissionHours, task, config) {
  const threshold = Number(config.scoring.currentDayHighLoadHours || 8);
  if (!sameDayMissionHours || sameDayMissionHours <= 0) return;

  // v3.16: משמרת גשש שווה 0 שעות עבודה (כמו כרמל), ולכן אינה מוסיפה
  // לעומס היומי הנבדק - וגם לא מופיעה ב-sameDayMissionHours כשיבוץ קיים.
  // התקרה עדיין נחצית אם *שאר* היום כבר מלא, וזו בדיוק ההתנהגות הרצויה:
  // 8ש׳ סיור + גשש הם 8ש׳ עבודה, לא 16.
  const taskHours = task.category === 'tracker' ? 0 : task.durationHours;

  // v2.8: תקרה יומית - חצייה שלה מורידה את המועמד ל"בדוחק".
  const maxHours = Number(config.scoring.maxSameDayMissionHours || 10);
  if (sameDayMissionHours + taskHours > maxHours + 0.01) {
    markFallback_(result, 'יעבור ' + maxHours + 'ש׳ משימה היום (' +
      formatHours_(sameDayMissionHours + taskHours) + ')', config,
      'עומס ' + formatHours_(sameDayMissionHours + taskHours));
    return;
  }

  if (sameDayMissionHours >= threshold - 0.01) {
    const extra = Math.max(0, sameDayMissionHours - threshold);
    result.score += (config.scoring.currentDayHighLoadPenalty || 60) + extra * (config.scoring.currentDayExtraHourPenalty || 6);
    result.warnings.push('כבר ' + formatHours_(sameDayMissionHours) + ' היום בלי כוננות');
    return;
  }

  if (sameDayMissionHours + taskHours > threshold + 0.01) {
    result.score += config.scoring.currentDayWouldExceedPenalty || 25;
    result.warnings.push('יעבור 8ש׳ היום בלי כוננות');
  }
}

/* ============================================================
 * פורמט פלט
 * ============================================================ */

function makeBlankOutputRow_(config) {
  const row = [];
  for (let i = 0; i < config.output.width; i++) row.push('');
  return row;
}

function makeBackgroundRow_(color, width) {
  const row = [];
  for (let i = 0; i < width; i++) row.push(color);
  return row;
}

function formatRecommendationsOutputRow_(evaluations, groupStatus, taskWarnings, config) {
  return [
    formatRecommendationNamesColumn_(evaluations),
    formatRecommendationPreviousColumn_(evaluations),
    formatRecommendationRestColumn_(evaluations),
    formatRecommendationWorkloadColumn_(evaluations),
    formatRecommendationFitColumn_(evaluations),
    formatStatusColumn_(groupStatus, taskWarnings)
  ];
}

function formatAssignedOutputRow_(assignedEval, alternatives, groupStatus, warnings, config) {
  const fitParts = [];
  if (warnings) fitParts.push(warnings);
  const fitText = formatCandidateFit_(assignedEval);
  if (fitText && !assignedEval.rejected) fitParts.push(fitText);
  if (alternatives && alternatives.length) {
    fitParts.push('חלופות: ' + alternatives.map(function(ev) { return ev.soldier.name; }).join(', '));
  }
  return [
    'משובץ: ' + assignedEval.soldier.name,
    formatPreviousAssignmentForCell_(assignedEval),
    formatRestCell_(assignedEval),
    formatWorkloadSummary_(assignedEval),
    fitParts.join('\n'),
    groupStatus
  ];
}

function formatRecommendationNamesColumn_(evaluations) {
  return evaluations.map(function(ev, idx) {
    let mark = '';
    if (ev.fallback) mark = ev.fallbackShort ? ' (בדוחק: ' + ev.fallbackShort + ')' : ' (בדוחק)';
    return (idx + 1) + '. ' + ev.soldier.name + mark;
  }).join('\n');
}

function formatRecommendationRestColumn_(evaluations) {
  return evaluations.map(function(ev, idx) {
    return (idx + 1) + '. ' + formatRestCell_(ev);
  }).join('\n');
}

function formatRecommendationPreviousColumn_(evaluations) {
  return evaluations.map(function(ev, idx) {
    return (idx + 1) + '. ' + formatPreviousAssignmentForCell_(ev);
  }).join('\n');
}

function formatRecommendationWorkloadColumn_(evaluations) {
  return evaluations.map(function(ev, idx) {
    return (idx + 1) + '. ' + formatWorkloadSummary_(ev);
  }).join('\n');
}

function formatRecommendationFitColumn_(evaluations) {
  return evaluations.map(function(ev, idx) {
    return (idx + 1) + '. ' + formatCandidateFit_(ev);
  }).join('\n');
}

function formatStatusColumn_(groupStatus, taskWarnings) {
  const parts = [];
  if (groupStatus) parts.push(groupStatus);
  // v3.6: סטטוס הקבוצה כבר מכיל חלק מהאזהרות (משבצת ראשונה / משבצת
  // הנהג). בלי הסינון הזה אותה שורה הופיעה פעמיים, השנייה עם "⚠ ⚠".
  const extra = dropWarningsAlreadyInStatus_(groupStatus, taskWarnings);
  if (extra) parts.push('⚠ ' + extra);
  return parts.join('\n');
}

function dropWarningsAlreadyInStatus_(groupStatus, taskWarnings) {
  if (!taskWarnings) return '';
  if (!groupStatus) return taskWarnings;

  const statusKey = normalizeForSearch_(String(groupStatus).replace(/⚠/g, ' '));
  const kept = String(taskWarnings).split(' | ').filter(function(warning) {
    const key = normalizeForSearch_(String(warning).replace(/⚠/g, ' '));
    return key && statusKey.indexOf(key) === -1;
  });
  return kept.join(' | ');
}

function formatCandidateFit_(ev) {
  if (!ev || !ev.soldier) return '';
  const parts = [];
  const soldier = ev.soldier;

  if (soldier.isSeniorCommander) parts.push('סמל/מ״מ');
  else if (soldier.isStaticCommander) parts.push('מ״כ/מ״ח');
  else if (soldier.isCommander) parts.push('מפקד');

  if (soldier.isDudDriver) parts.push('נהג דוד');
  if (soldier.isTigerDriver) parts.push('נהג טיגריס');
  if (ev.samePlatoonAsGroupCommander) parts.push(ev.samePlatoonCommanderLabel || 'אותה מחלקה כמו המפקד');

  if (ev.previousDayMatch && ev.previousDayMatch.sameTask) {
    parts.push('⚠ אותה משימה אתמול');
  } else if (ev.previousDayMatch && ev.previousDayMatch.sameMissionClass) {
    parts.push('⚠ ' + missionClassDisplayName_(ev.previousDayMatch.missionClass, SHABTZAK_REC_CONFIG) + ' אתמול');
  } else if (ev.previousDayMatch && ev.previousDayMatch.sameCategory) {
    parts.push('סוג דומה אתמול');
  } else if (ev.previousDayMatch && ev.previousDayMatch.oppositeMissionClass) {
    parts.push('✓ רוטציה טובה (אתמול ' + missionClassDisplayName_(ev.previousDayMatch.yesterdayClass, SHABTZAK_REC_CONFIG) + ')');
  } else {
    parts.push('לא אותו אופי אתמול');
  }

  if (ev.warnings && ev.warnings.length) {
    ev.warnings.forEach(function(w) {
      if (w.indexOf('ביום הקודם') !== -1) return;
      parts.push('⚠ ' + w);
    });
  }

  return parts.join(' | ');
}

/**
 * v3.20: תא עמודת "מנוחה" - הפער האמיתי, ואחריו מקור המנוחה כשהוא
 * כוננות התקפית יומית ("4 שעות (מהתקפי)"). המספר לא משתנה: הזיכוי
 * מוסבר, לא מוסתר בתוך הספרה.
 */
function formatRestCell_(ev) {
  if (!ev) return '';
  const text = formatRestShort_(ev.restBeforeHours);
  if (!text || !ev.restBeforeFromAttackReadiness) return text;
  return text + ' (מהתקפי)';
}

function formatRestShort_(hours) {
  if (hours === null || hours === undefined) return '';
  if (hours >= SHABTZAK_REC_CONFIG.rest.maxDisplayedRestHours) return 'אין קודמת';
  return formatHours_(hours);
}

function formatWorkloadSummary_(ev) {
  if (!ev || !ev.stats) return '';
  const stats = ev.stats;
  const parts = [Math.round(stats.totalHours) + 'ש׳ משימה'];
  if (stats.konenutHours && stats.konenutHours > 0.01) parts.push(formatHours_(stats.konenutHours) + ' כוננות');
  if (ev.sameDayMissionHours && ev.sameDayMissionHours > 0.01) parts.push('היום משימה ' + formatHours_(ev.sameDayMissionHours));
  if (ev.sameDayKonenutHours && ev.sameDayKonenutHours > 0.01) parts.push('היום כוננות ' + formatHours_(ev.sameDayKonenutHours));
  if (stats.nightCount) parts.push(stats.nightCount + ' לילה');
  if (stats.staticMissionClassCount) parts.push(stats.staticMissionClassCount + ' סטטי');
  if (stats.tourCount) parts.push(stats.tourCount + ' סיור');
  if (stats.attackCount) parts.push(stats.attackCount + ' התקפי');
  if (stats.postOfficerCount) parts.push(stats.postOfficerCount + ' קצין מוצב');
  // v3.9: בשורות תורנות מציגים את הספירה ההיסטורית המלאה - היא מה
  // שקובע את סדר העדיפות שם, ובלעדיה הדירוג נראה שרירותי.
  if (ev.toranutHistoryCount) parts.push('סה״כ ' + ev.toranutHistoryCount + ' תורנויות');
  return parts.join(', ');
}

function formatPreviousAssignmentForCell_(ev) {
  if (!ev || !ev.soldier) return '';
  // v3.21: חופש/יציאה ארוכה שקרו *אחרי* המשמרת הקודמת גוברים עליה -
  // הם עדכניים ממנה בהגדרה, והמשמרת הישנה כבר לא מתארת את החייל.
  if (ev.previousAwayLabel) return ev.previousAwayLabel;
  if (ev.previousAssignment) {
    const text = shortAssignmentForColumn_(ev.previousAssignment);
    // סימון מפורש כשה"משימה הקודמת" היא מהיום המבצעי הנוכחי -
    // מצב שמעיד על נתון כפול/חריג ושווה בדיקה ידנית.
    return ev.previousAssignmentIsToday ? '⚠ היום: ' + text : text;
  }
  if (ev.soldier.previousDayText) return limitText_(ev.soldier.previousDayText, 34);
  return 'אין';
}

function shortAssignmentForColumn_(assignment) {
  if (!assignment) return 'אין';
  const title = limitText_(assignment.position || assignment.type || categoryDisplayName_(assignment.category), 22);
  return title + ' ' + formatTimeOnly_(assignment.start) + '-' + formatTimeOnly_(assignment.end);
}

function categoryDisplayName_(category) {
  const names = {
    tour: 'סיור',
    static: 'עמדת הגנה',
    attack: 'התקפי',
    tagbatz: 'תגב״צ',
    magen: 'מגן',
    daily_duty: 'תורנות',
    tracker: 'כונן גשש',
    post_officer: 'קצין מוצב',
    carmel: 'כוננות',
    day_blocking: 'יומי',
    regular: 'משימה'
  };
  return names[category] || 'משימה';
}

function limitText_(text, maxLength) {
  const s = cleanText_(text);
  if (s.length <= maxLength) return s;
  return s.slice(0, Math.max(0, maxLength - 1)) + '…';
}

function formatTaskSoftWarnings_(task, group, soldiersByName, config) {
  const warnings = [];
  const assignedSoldiers = group.tasks
    .filter(function(t) { return !!t.assigned; })
    .map(function(t) { return soldiersByName[normalizeNameKey_(t.assigned)]; })
    .filter(Boolean);

  if (task.category === 'tour' || task.category === 'tagbatz') {
    const firstSlotStatus = getFirstSlotCommanderStatus_(task, group, soldiersByName, config);
    if (firstSlotStatus.status !== 'ok') warnings.push(firstSlotStatus.text);
    // v3.6: חסר נהג דוד במשבצת האחרונה - בכל סיור, לא רק בלילה.
    const dudSlotStatus = getDriverSeatStatus_(task, group, soldiersByName, config);
    if (dudSlotStatus.required && dudSlotStatus.status !== 'ok') warnings.push(dudSlotStatus.text);
  }
  if (task.category === 'attack') {
    const firstSlotStatus = getFirstSlotCommanderStatus_(task, group, soldiersByName, config);
    if (firstSlotStatus.status !== 'ok') warnings.push(firstSlotStatus.text);
    // v3.20: אותה אזהרה כמו בסיור - הטיגריס במשבצת האחרונה.
    const tigerSeatStatus = getDriverSeatStatus_(task, group, soldiersByName, config);
    if (tigerSeatStatus.required) {
      if (tigerSeatStatus.status !== 'ok') warnings.push(tigerSeatStatus.text);
    } else if (!assignedSoldiers.some(function(s) { return s.isTigerDriver; })) {
      warnings.push('חסר נהג טיגריס');
    }
  }
  if (task.category === 'post_officer') {
    if (!assignedSoldiers.some(function(s) { return soldierCanCommandTask_(s, task); })) warnings.push('קצין מוצב צריך מפקד');
    warnings.push('קצין מוצב חוסם את החייל להמשך השבצ״ק');
  } else if (isFullDayBlockingAssignment_(task, config)) {
    warnings.push('יומי בעמודת שעה: מי שמשובץ כאן לא יופיע בהמלצות נוספות');
  }
  return warnings.join(' | ');
}

function buildCandidatesNote_(evaluations) {
  return evaluations.map(function(ev, idx) {
    return (idx + 1) + '. ' + ev.soldier.name + '\n' +
      'ניקוד: ' + Math.round(ev.score) + ' (נמוך יותר = עדיף)' + '\n' +
      'תפקיד: ' + ev.soldier.role + '\n' +
      'משימה קודמת: ' + formatPreviousAssignmentForCell_(ev) + '\n' +
      'עומס 7 ימים: ' + formatWorkloadSummary_(ev) + '\n' +
      'התאמה: ' + formatCandidateFit_(ev) + '\n' +
      (ev.reasons.length ? 'סיבות מפורטות: ' + ev.reasons.join(' | ') + '\n' : '') +
      (ev.warnings.length ? 'אזהרות: ' + ev.warnings.join(' | ') + '\n' : '') +
      '---';
  }).join('\n');
}

function buildCandidateNote_(assignedEval, alternatives) {
  const lines = [];
  lines.push('בדיקת משובץ: ' + assignedEval.soldier.name);
  lines.push('ניקוד: ' + Math.round(assignedEval.score) + ' (נמוך יותר = עדיף)');
  lines.push('משימה קודמת: ' + formatPreviousAssignmentForCell_(assignedEval));
  lines.push('עומס 7 ימים: ' + formatWorkloadSummary_(assignedEval));
  if (assignedEval.rejected) lines.push('בעיה: ' + assignedEval.rejectReason);
  if (assignedEval.reasons.length) lines.push('סיבות: ' + assignedEval.reasons.join(' | '));
  if (assignedEval.warnings.length) lines.push('אזהרות: ' + assignedEval.warnings.join(' | '));
  if (alternatives && alternatives.length) {
    lines.push('');
    lines.push('חלופות מובילות:');
    alternatives.forEach(function(ev, idx) {
      lines.push((idx + 1) + '. ' + ev.soldier.name + ' — ' + Math.round(ev.score) + ' — ' + formatPreviousAssignmentForCell_(ev) + ' — ' + formatCandidateFit_(ev));
    });
  }
  return lines.join('\n');
}

function shortAssignmentText_(a) {
  return [a.position || a.type || 'משימה', formatDateTime_(a.start), '-', formatTimeOnly_(a.end)].join(' ');
}

/* ============================================================
 * פרסינג זמנים ותאריכים
 * ============================================================ */

function parseTimeValue_(value) {
  if (value instanceof Date) {
    return { hour: value.getHours(), minute: value.getMinutes() };
  }
  if (typeof value === 'number' && !isNaN(value)) {
    const normalized = value % 1;
    const totalMinutes = Math.round(normalized * 24 * 60);
    return { hour: Math.floor(totalMinutes / 60) % 24, minute: totalMinutes % 60 };
  }
  return parseSingleTime_(cleanText_(value));
}

function parseSingleTime_(text) {
  const s = cleanText_(text);
  if (!s) return null;
  let m = s.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour: hour, minute: minute };
  }
  m = s.match(/^\s*(\d{1,2})\s*$/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return { hour: h, minute: 0 };
  }
  return null;
}

function parseTimeRange_(value) {
  if (value instanceof Date || typeof value === 'number') return null;
  const s = cleanText_(value);
  if (!s) return null;
  const m = s.match(/(\d{1,2}(?::|\.)\d{2}|\d{1,2})\s*[-–—]\s*(\d{1,2}(?::|\.)\d{2}|\d{1,2})/);
  if (!m) return null;
  const start = parseSingleTime_(m[1]);
  const end = parseSingleTime_(m[2]);
  if (!start || !end) return null;
  return { start: start, end: end };
}

function parseDateOnly_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const s = cleanText_(value);
  if (!s) return null;

  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    return new Date(year, month - 1, day);
  }

  m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return null;
}

/* ============================================================
 * טקסט (עם cache) וכלי עזר
 * ============================================================ */

let NORMALIZE_CACHE_ = {};

function resetNormalizeCache_() {
  NORMALIZE_CACHE_ = {};
}

function cleanText_(value) {
  if (value === null || value === undefined) return '';
  // v2.3: תאי שעה ב-Sheets הם אובייקטי Date - פורמט JS טהור במקום API.
  if (value instanceof Date) return pad2_(value.getHours()) + ':' + pad2_(value.getMinutes());
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeForSearch_(value) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : cleanText_(value);
  const cached = NORMALIZE_CACHE_[raw];
  if (cached !== undefined) return cached;

  const result = cleanText_(raw)
    .replace(/[״״\"']/g, '')
    .replace(/[׳`]/g, '')
    .replace(/\u05F4/g, '')
    .replace(/\u05F3/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  NORMALIZE_CACHE_[raw] = result;
  return result;
}

function normalizeNameKey_(name) {
  return normalizeForSearch_(name);
}

function containsAny_(text, keywords) {
  const haystack = normalizeForSearch_(text);
  if (!haystack) return false;
  for (let i = 0; i < keywords.length; i++) {
    if (haystack.indexOf(normalizeForSearch_(keywords[i])) !== -1) return true;
  }
  return false;
}

function addHours_(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDays_(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function dateOnly_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function makeDateWithTime_(baseDate, hour, minute, addDaysCount) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0, 0);
  if (addDaysCount) d.setDate(d.getDate() + addDaysCount);
  return d;
}

function hoursBetween_(start, end) {
  return (end.getTime() - start.getTime()) / (60 * 60 * 1000);
}

function intervalsOverlap_(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function intervalTouchesNight_(start, end) {
  let cursor = dateOnly_(addDays_(start, -1));
  const limit = addDays_(dateOnly_(end), 1);
  while (cursor <= limit) {
    const nightEarlyStart = makeDateWithTime_(cursor, 0, 0, 0);
    const nightEarlyEnd = makeDateWithTime_(cursor, 6, 0, 0);
    const nightLateStart = makeDateWithTime_(cursor, 22, 0, 0);
    const nightLateEnd = makeDateWithTime_(addDays_(cursor, 1), 0, 0, 0);
    if (intervalsOverlap_(start, end, nightEarlyStart, nightEarlyEnd)) return true;
    if (intervalsOverlap_(start, end, nightLateStart, nightLateEnd)) return true;
    cursor = addDays_(cursor, 1);
  }
  return false;
}

function sameMinute_(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes();
}

function formatHours_(hours) {
  if (hours === null || hours === undefined) return 'לא ידוע';
  if (hours >= SHABTZAK_REC_CONFIG.rest.maxDisplayedRestHours) return 'אין משימה קודמת';
  const rounded = Math.round(hours * 10) / 10;
  return rounded + 'ש׳';
}

/**
 * v2.3: פורמט זמנים ב-JS טהור. Utilities.formatDate היא קריאת API
 * (לא JS) שנקראה אלפי פעמים בריצה - זה היה מקור ה-30+ שניות.
 */
function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function formatDateTime_(date) {
  return pad2_(date.getDate()) + '/' + pad2_(date.getMonth() + 1) + ' ' +
    pad2_(date.getHours()) + ':' + pad2_(date.getMinutes());
}

function formatTimeOnly_(date) {
  return pad2_(date.getHours()) + ':' + pad2_(date.getMinutes());
}
