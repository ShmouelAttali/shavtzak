import { useEffect, useRef } from 'react';
import { shouldIdleReload } from '../lib/idleReload';

/**
 * Reloads the page after `minutes` without user interaction, so a screen left
 * open on a wall/phone keeps showing live sheet data instead of a stale render.
 *
 * Deliberately a timestamp + poll rather than one long timeout: background tabs
 * throttle timers and a sleeping device fires them late, so we compare the
 * clock — and re-check the moment the tab becomes visible again, which is when
 * a stale view actually gets read.
 *
 * `canReload` lets the app veto (unsaved edits behind the tab leave guard).
 * A vetoed tick doesn't reset the idle clock; it retries on the next one.
 */
export function useIdleReload(minutes = 15, canReload?: () => boolean) {
  const lastActive = useRef(Date.now());
  const canReloadRef = useRef(canReload);
  canReloadRef.current = canReload;

  useEffect(() => {
    const idleMs = minutes * 60_000;
    const touch = () => { lastActive.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true, capture: true });

    const check = () => {
      const ok = shouldIdleReload({
        now: Date.now(),
        lastActive: lastActive.current,
        idleMs,
        hidden: document.hidden,
        canReload: canReloadRef.current ? canReloadRef.current() : true,
      });
      if (ok) window.location.reload();
    };
    const id = setInterval(check, 30_000);
    document.addEventListener('visibilitychange', check);

    return () => {
      for (const e of events) window.removeEventListener(e, touch, { capture: true });
      document.removeEventListener('visibilitychange', check);
      clearInterval(id);
    };
  }, [minutes]);
}
