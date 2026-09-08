/**
 * Rest timing. PROMPT.md §5 / §8b.
 *
 * §8b specifies that logging a set restarts a rest timer on the Live Activity —
 * so one has to exist, and it has to be the same one in the app.
 *
 * Deliberately NOT a countdown to a target. A prescribed rest interval is a
 * programming opinion, and §5 says the app does not force a programming model on
 * someone running their own. This counts UP from the last set: it answers "how
 * long have I been sitting here", which is the question a lifter actually has,
 * and it needs no configuration.
 */

export interface RestState {
  /** Seconds since the last logged set. Null when no set has been logged yet. */
  seconds: number | null;
  /** mm:ss, or null. */
  label: string | null;
  /** Past the point where the set stops counting as part of the same effort. */
  cold: boolean;
}

/**
 * Beyond this the rest is long enough that the next set is a different effort —
 * useful as a display hint, never as a nag. Five minutes is generous on purpose:
 * heavy singles genuinely want it, and an app that starts scolding at ninety
 * seconds is an app that has an opinion nobody asked for.
 */
export const COLD_AFTER_SECONDS = 300;

export function restSince(lastSetAt: number | null, now: number): RestState {
  if (lastSetAt == null) return { seconds: null, label: null, cold: false };
  const seconds = Math.max(0, Math.floor((now - lastSetAt) / 1000));
  return { seconds, label: formatRest(seconds), cold: seconds >= COLD_AFTER_SECONDS };
}

/**
 * mm:ss below an hour, h:mm:ss above it.
 *
 * The hour case is not hypothetical: the §8 idle rule allows 90 minutes before a
 * session auto-ends, so a phone left on a bench genuinely reaches it — and
 * "127:04" reads like a bug.
 */
export function formatRest(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
