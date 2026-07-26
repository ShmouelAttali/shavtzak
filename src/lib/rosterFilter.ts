import { normalizeName, hasQualification } from '../../scheduler/src/text';
import { isCommanderRole } from '../../scheduler/src/crewOrder';
import type { RosterSoldier } from '../../api/_handlers/roster';

// Pure filtering for the מצבת חיילים tab — no DB, no React, unit-tested in
// tests/roster-filter.test.ts.

/** Pseudo-value of the תפקיד filter: any role in DEFAULT_COMMANDER_ROLES. */
export const ROLE_COMMANDERS = '__commanders__';
/** Pseudo-value of the הסמכה filter: the soldier has an H6c whitelist. */
export const QUAL_RESTRICTED = '__restricted__';
/** Prefix of the הסמכה filter's closed-list options: `__pool__<positionId>`. */
export const QUAL_POOL_PREFIX = '__pool__';

export interface RosterFilters {
  /** free text over שם מלא / מספר אישי / email */
  text: string;
  /** exact role, ROLE_COMMANDERS, or '' for all */
  role: string;
  /** qualification, QUAL_RESTRICTED, `${QUAL_POOL_PREFIX}<id>`, or '' for all */
  qual: string;
  /** true = show removed soldiers instead of active ones */
  archived: boolean;
}

export const EMPTY_FILTERS: RosterFilters = { text: '', role: '', qual: '', archived: false };

function matchesText(s: RosterSoldier, text: string): boolean {
  const q = normalizeName(text);
  if (!q) return true;
  return normalizeName(s.fullName).includes(q)
    || s.personalNumber.includes(text.trim())
    || s.email.toLowerCase().includes(text.trim().toLowerCase());
}

function matchesQual(s: RosterSoldier, qual: string): boolean {
  if (!qual) return true;
  if (qual === QUAL_RESTRICTED) return s.allowedPositionIds.length > 0;
  if (qual.startsWith(QUAL_POOL_PREFIX)) {
    const pid = Number(qual.slice(QUAL_POOL_PREFIX.length));
    return s.candidacies.some((c) => c.positionId === pid);
  }
  // Same rule the generator uses (H6b / P5): a qualification counts when it is
  // in soldier_qualifications OR contained in the free-text תפקיד.
  return hasQualification(s.quals, s.role, qual);
}

export function filterRoster(soldiers: RosterSoldier[], f: RosterFilters): RosterSoldier[] {
  return soldiers.filter((s) =>
    (f.archived ? s.archivedAt != null : s.archivedAt == null)
    && matchesText(s, f.text)
    && (!f.role
      || (f.role === ROLE_COMMANDERS ? isCommanderRole(s.role) : s.role === f.role))
    && matchesQual(s, f.qual));
}

/** True when unchecking `qual` would have no effect: the keyword is still
 *  inside the soldier's free-text תפקיד, which hasQualification also reads. */
export function qualStuckInRole(role: string, qual: string): boolean {
  return normalizeName(role).includes(normalizeName(qual));
}
