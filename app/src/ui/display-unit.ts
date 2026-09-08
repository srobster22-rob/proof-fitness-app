import type { Unit } from '../domain/types.ts';

/** Where the Settings UNITS choice is stored. */
export const PREF_UNIT = 'pref.unit';

/**
 * The unit to SHOW a weight in, anywhere outside a live session.
 *
 * There were two answers to this and they disagreed on screen. `now-model`
 * asked `unitForNewSession(lastUsedUnit(), locale, chosen)` and honoured the
 * Settings choice; Progress, Goals and the weekly comparison each read
 * `lastUsedUnit() ?? 'lb'` and ignored it. So a lifter with twelve weeks of
 * pounds who switched to kilograms saw the Now screen say **79.5 KG** and
 * Progress say **175 lb** for the same lift, at the same moment, until they
 * happened to log a kilogram session — while the Settings sheet promised, in
 * words, that "weights already logged keep the unit they were logged in, and
 * are converted for display".
 *
 * The choice wins because it is an answer the app asked for, and §4's rule is
 * that the app does not argue with one. `lastUsedUnit` remains the fallback,
 * so a user who has never opened Settings still sees what they have been
 * lifting in, and the locale guess below that is `unitForNewSession`'s job on
 * a genuinely cold start.
 *
 * One definition, in one file that both sides import, because two of them is
 * exactly how this happened.
 */
export function displayUnit(
  repo: { getPref(key: string): string | null; lastUsedUnit(): Unit | null }
): Unit {
  return (repo.getPref(PREF_UNIT) as Unit | null) ?? repo.lastUsedUnit() ?? 'lb';
}
