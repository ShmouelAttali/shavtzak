import type {DraftAssignmentMeta} from '../../api/_handlers/draft';
import {isCaveat, renderRationale, violationCoveredByRationale} from '../../scheduler/src/rationale';

export interface RationalePopupState {
    name: string;
    time: string;
    meta: DraftAssignmentMeta;
}

const SOURCE_LABEL: Record<string, string> = {
    auto: 'אוטומטי',
    chain: 'שרשור',
    manual: 'ידני',
    import: 'ייבוא',
};

/** Popup explaining why the generator picked this soldier for this shift.
 *  Same fixed-overlay shell as SoldierPopup (click-based — mobile friendly). */
export function RationalePopup({info, onClose}: { info: RationalePopupState; onClose: () => void }) {
    const {meta} = info;
    const reasons = meta.rationale.filter(e => !isCaveat(e));
    const caveats = meta.rationale.filter(isCaveat);
    const codes = new Set(meta.rationale.map(e => e.code));
    // raw generator violations already represented by a structured entry
    // (shared with the report's cells — scheduler/src/rationale.ts)
    const extraViolations = meta.violations.filter(v => !violationCoveredByRationale(v, codes));
    const badge = meta.locked ? 'נעול' : (SOURCE_LABEL[meta.source] ?? meta.source);
    const notGenerated = meta.rationale.length === 0;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-6 sm:pb-0"
            onClick={onClose}
        >
            <div
                className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-5 space-y-3"
                onClick={e => e.stopPropagation()}
                dir="rtl"
            >
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <p className="text-base font-bold text-gray-800">{info.name}</p>
                        <p className="text-xs text-gray-400" dir="ltr">{info.time}</p>
                    </div>
                    <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.locked ? 'bg-gray-200 text-gray-700' : meta.source === 'manual' ? 'bg-amber-100 text-amber-700' : meta.source === 'chain' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
            {badge}
          </span>
                </div>

                {notGenerated ? (
                    <p className="text-sm text-gray-500">
                        {meta.locked || meta.source === 'manual'
                            ? 'שיבוץ ידני/נעול — לא נבחר על ידי המחולל'
                            : 'אין הסבר שמור לשיבוץ זה (נוצר לפני עדכון המערכת)'}
                    </p>
                ) : (
                    <div className="space-y-1">
                        {reasons.map((e, i) => (
                            <p key={`r${i}`} className="text-sm text-gray-700 flex gap-1.5">
                                <span className="text-green-600 shrink-0">✓</span>
                                <span>{renderRationale(e)}</span>
                            </p>
                        ))}
                        {caveats.map((e, i) => (
                            <p key={`c${i}`} className="text-sm text-orange-700 flex gap-1.5">
                                <span className="shrink-0">⚠</span>
                                <span>{renderRationale(e)}</span>
                            </p>
                        ))}
                    </div>
                )}

                {extraViolations.length > 0 && (
                    <div className="space-y-1 border-t border-gray-100 pt-2">
                        {extraViolations.map((v, i) => (
                            <p key={i} className="text-sm text-orange-700 flex gap-1.5">
                                <span className="shrink-0">⚠</span>
                                <span>{v}</span>
                            </p>
                        ))}
                    </div>
                )}

                <button
                    onClick={onClose}
                    className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50"
                >
                    סגור
                </button>
            </div>
        </div>
    );
}
