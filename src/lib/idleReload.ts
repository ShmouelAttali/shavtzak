// The decision behind the "screen left alone reloads itself" behaviour, kept
// pure so it can be tested without a DOM. The hook (src/hooks/useIdleReload.ts)
// only wires listeners and a timer around this.

export interface IdleReloadInput {
  /** now, ms */
  now: number;
  /** timestamp of the last user interaction, ms */
  lastActive: number;
  /** idle threshold, ms */
  idleMs: number;
  /** document.hidden — a screen nobody is looking at is not worth reloading */
  hidden: boolean;
  /** false when a tab holds unsaved edits (the tab leave guard) */
  canReload: boolean;
}

export function shouldIdleReload({ now, lastActive, idleMs, hidden, canReload }: IdleReloadInput): boolean {
  if (now - lastActive < idleMs) return false;
  if (hidden) return false;
  return canReload;
}
