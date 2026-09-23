import { dateLocale, type Language } from '../domain/i18n.ts';

/**
 * "Sep 14", or "Sat, Sep 14" with the weekday, as Progress names a day.
 *
 * The year appears only when it is not this one (R327). Two sessions two years
 * apart sat side by side in RECENT WORKOUTS reading "Sat, Sep 14" and
 * "Sat, Aug 15", which a lifter reads as ten months apart in one year. Lists
 * capped by count rather than by time put old and new days together, and a
 * lift's own history (R680) is one of them. One function, so the two lists
 * cannot name one day two ways.
 */
export function shortDate(at: number, lang: Language, { weekday = false } = {}): string {
  const d = new Date(at);
  return d.toLocaleDateString(dateLocale(lang), {
    ...(weekday ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {})
  });
}
