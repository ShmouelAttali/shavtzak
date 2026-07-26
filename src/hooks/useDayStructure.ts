import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DsResponse, DsShift } from '../../api/day-structure';

// ── מבנה יומי draft state (EXPLICIT save — no autosave, no cross-shift validation) ──
// The tab edits ONE schedule day's shift structure locally, then PUTs the whole
// day at once (declarative replace). Draft items carry a stable `uid` (React key
// + mutation target) and, for persisted rows, an `originalName` so a rename is
// detected → buildPayload sends id=null (server does day-scoped delete+create).

export type ShiftOrigin = DsShift['origin'] | 'new';
export interface DraftShift { uid: string; templateId: number | null; start: string; end: string; seats: number; origin: ShiftOrigin }
export interface DraftPosition { uid: string; subId: number | null; name: string | null; originalName: string | null; shifts: DraftShift[] }
export interface DraftGroup { uid: string; positionId: number | null; name: string; originalName: string | null; positions: DraftPosition[] }

let uidSeq = 0;
const uid = () => `u${++uidSeq}`;

function toDraft(res: DsResponse): DraftGroup[] {
  return res.groups.map((g) => ({
    uid: uid(), positionId: g.positionId, name: g.name, originalName: g.name,
    positions: g.positions.map((p) => ({
      uid: uid(), subId: p.subId, name: p.name, originalName: p.name,
      shifts: p.shifts.map((s) => ({ uid: uid(), templateId: s.templateId, start: s.start, end: s.end, seats: s.seats, origin: s.origin })),
    })),
  }));
}

/** Canonical, uid/origin-free view of the structure for dirty comparison — a
 *  rename shows up because names are included. */
function canonical(groups: DraftGroup[]): string {
  const norm = groups.map((g) => ({
    n: g.name,
    p: g.positions.map((p) => ({
      s: p.name ?? '',
      sh: p.shifts.map((x) => `${x.start}|${x.end}|${x.seats}`).sort(),
    })).sort((a, b) => a.s.localeCompare(b.s)),
  })).sort((a, b) => a.n.localeCompare(b.n));
  return JSON.stringify(norm);
}

/** Whole-day payload. A persisted item whose name changed → id null (the server
 *  creates it fresh and cancels the old one). A group that resolves to a NEW id
 *  (created or renamed) forces its positions to null subIds (their old sub ids
 *  belong to the old position). */
function buildPayload(groups: DraftGroup[]) {
  return groups.map((g) => {
    const gid = g.positionId != null && g.name === g.originalName ? g.positionId : null;
    return {
      positionId: gid,
      name: g.name,
      positions: g.positions.map((p) => ({
        subId: gid != null && p.subId != null && p.name === p.originalName ? p.subId : null,
        name: p.name,
        shifts: p.shifts.map((s) => ({ start: s.start, end: s.end, seats: s.seats })),
      })),
    };
  });
}

export function useDayStructure(day: string) {
  const [baseline, setBaseline] = useState<string>('');           // canonical of the saved structure
  const [draft, setDraft] = useState<DraftGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!day) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/day-structure?day=${day}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      const groups = toDraft(body as DsResponse);
      setDraft(groups);
      setBaseline(canonical(groups));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת מבנה יומי');
    } finally {
      setLoading(false);
    }
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  const isDirty = useMemo(() => baseline !== '' && canonical(draft) !== baseline, [draft, baseline]);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/day-structure', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, groups: buildPayload(draft) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      const groups = toDraft(body as DsResponse);
      setDraft(groups);
      setBaseline(canonical(groups));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירת מבנה יומי');
      return false;
    } finally {
      setSaving(false);
    }
  }, [day, draft]);

  const reset = useCallback(async (): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/day-structure?day=${day}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      const groups = toDraft(body as DsResponse);
      setDraft(groups);
      setBaseline(canonical(groups));
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה באיפוס');
      return false;
    } finally {
      setSaving(false);
    }
  }, [day]);

  // ── local mutators (no cross-shift validation) ─────────────────────────────
  const mapGroups = (fn: (g: DraftGroup) => DraftGroup) => setDraft((prev) => prev.map(fn));
  const mapGroup = (guid: string, fn: (g: DraftGroup) => DraftGroup) =>
    mapGroups((g) => (g.uid === guid ? fn(g) : g));
  const mapPos = (guid: string, puid: string, fn: (p: DraftPosition) => DraftPosition) =>
    mapGroup(guid, (g) => ({ ...g, positions: g.positions.map((p) => (p.uid === puid ? fn(p) : p)) }));

  const renameGroup = (guid: string, name: string) => mapGroup(guid, (g) => ({ ...g, name }));
  const removeGroup = (guid: string) => setDraft((prev) => prev.filter((g) => g.uid !== guid));
  const addGroup = () => setDraft((prev) => [...prev, {
    uid: uid(), positionId: null, name: '', originalName: null,
    positions: [{ uid: uid(), subId: null, name: null, originalName: null,
      shifts: [{ uid: uid(), templateId: null, start: '14:00', end: '22:00', seats: 1, origin: 'new' }] }],
  }]);

  const renamePosition = (guid: string, puid: string, name: string) =>
    mapPos(guid, puid, (p) => ({ ...p, name: name.trim() === '' ? null : name }));
  const removePosition = (guid: string, puid: string) =>
    mapGroup(guid, (g) => ({ ...g, positions: g.positions.filter((p) => p.uid !== puid) }));
  const addPosition = (guid: string) => mapGroup(guid, (g) => ({
    ...g, positions: [...g.positions, {
      uid: uid(), subId: null, name: 'תפקיד חדש', originalName: null,
      shifts: [{ uid: uid(), templateId: null, start: '14:00', end: '22:00', seats: 1, origin: 'new' }],
    }],
  }));

  const addShift = (guid: string, puid: string) => mapPos(guid, puid, (p) => ({
    ...p, shifts: [...p.shifts, { uid: uid(), templateId: null, start: '14:00', end: '22:00', seats: 1, origin: 'new' }],
  }));
  const removeShift = (guid: string, puid: string, suid: string) =>
    mapPos(guid, puid, (p) => ({ ...p, shifts: p.shifts.filter((s) => s.uid !== suid) }));
  const updateShift = (guid: string, puid: string, suid: string, patch: Partial<Pick<DraftShift, 'start' | 'end' | 'seats'>>) =>
    mapPos(guid, puid, (p) => ({ ...p, shifts: p.shifts.map((s) => (s.uid === suid ? { ...s, ...patch } : s)) }));

  return {
    draft, loading, saving, error, isDirty, reload: load, save, reset,
    renameGroup, removeGroup, addGroup,
    renamePosition, removePosition, addPosition,
    addShift, removeShift, updateShift,
  };
}
