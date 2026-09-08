import { getLocales } from 'expo-localization';

/**
 * The device's locale tag, or null if the platform will not say.
 *
 * Isolated in its own module so the unit-inference logic stays testable:
 * `inferUnit` takes a plain string, and this is the only file that touches a
 * native module to obtain one — still true, checked in R490: nothing else in
 * `src/` or `app/` imports `expo-localization`.
 *
 * "Used solely to choose lb vs kg for a first-ever session (§8)" was the rest
 * of this note and is no longer true. There are two callers now, and the second
 * is deliberate: `RepoGate.tsx` picks the LANGUAGE of the database-error screen
 * from here, because that screen renders exactly when the stored preferences
 * may be unreadable — its own comment says so. The unit rule is unchanged: a
 * returning user's stored unit always wins.
 */
export function deviceLocale(): string | null {
  try {
    const first = getLocales()[0];
    // languageTag is the full BCP-47 tag; regionCode alone is the fallback,
    // since inferUnit accepts a bare region.
    return first?.languageTag ?? first?.regionCode ?? null;
  } catch {
    // Never let a locale lookup take down the logging screen.
    return null;
  }
}
