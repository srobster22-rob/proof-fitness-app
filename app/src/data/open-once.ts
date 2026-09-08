/**
 * Open-once-and-remember, including remembering failure.
 *
 * Lives apart from `db.ts` purely so it can be tested: `db.ts` imports
 * expo-sqlite at module scope, which no test runner on a laptop can load. The
 * rules worth pinning are all here and none of them are about SQLite.
 */

export type OpenResult<T> = { value: T; error: null } | { value: null; error: Error };

export interface OpenOnce<T> {
  get(): OpenResult<T>;
  reset(): void;
  /** How many times the opener has actually been invoked. */
  attempts(): number;
}

/**
 * @param open called at most once per reset, even if it throws.
 *
 * Caching the FAILURE is the point. `get()` is called from inside component
 * bodies, so an opener that throws would otherwise be re-invoked on every
 * render — and an expensive or locking failure (a busy database file) would spin
 * the UI thread instead of showing a message.
 */
export function openOnce<T>(open: () => T): OpenOnce<T> {
  let value: T | null = null;
  let error: Error | null = null;
  let attempts = 0;

  return {
    get(): OpenResult<T> {
      if (value !== null) return { value, error: null };
      if (error !== null) return { value: null, error };
      attempts++;
      try {
        value = open();
        // An opener that legitimately returns null/undefined would be retried
        // forever by the checks above, so refuse it loudly instead.
        if (value == null) throw new Error('opener returned no value');
        return { value, error: null };
      } catch (e) {
        error = e instanceof Error ? e : new Error(String(e));
        return { value: null, error };
      }
    },
    reset() {
      value = null;
      error = null;
    },
    attempts() {
      return attempts;
    }
  };
}
