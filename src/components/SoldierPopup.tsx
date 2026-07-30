export interface PopupState { name: string; phone: string }

export function SoldierPopup({ info, onClose }: { info: PopupState; onClose: () => void }) {
  const clean = info.phone.replace(/\D/g, '');
  const waNum = clean.startsWith('0') ? '972' + clean.slice(1) : clean;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-6 sm:pb-0 print:hidden"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs bg-white rounded-2xl shadow-2xl p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center">
          <p className="text-lg font-bold text-gray-800">{info.name}</p>
        </div>
        {clean ? (
          <>
            <p className="text-center text-gray-500 text-sm font-medium">{info.phone}</p>
            <div className="flex gap-3">
              <a
                href={`tel:${clean}`}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-600 active:bg-green-700 text-white px-4 py-3 text-base font-semibold transition-colors"
              >
                <span>📞</span>התקשר
              </a>
              <a
                href={`https://wa.me/${waNum}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#17a84f] text-white px-4 py-3 text-base font-semibold transition-colors"
              >
                <span>💬</span>וואטסאפ
              </a>
            </div>
          </>
        ) : (
          <p className="text-center text-gray-400 text-sm">אין מספר טלפון</p>
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
