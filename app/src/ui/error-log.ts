/**
 * Every error the app catches, with the screen it happened on (AGENT_LOOP §3a
 * item 6: errors surface with context).
 *
 * A screen's error boundary records what broke it, and `watchGlobalErrors`
 * records what no boundary sees on the web: a throw in an event handler, a
 * rejected promise. Each is logged to the console with the screen's name, and
 * the last `ERROR_RING` are kept so a playtest can fail on any error the app
 * swallowed while it looked fine. In a development build they are readable as
 * `__PROOF_ERRORS__()`; the shipped build has no such hook.
 */
export interface RecordedError {
  screen: string;
  message: string;
  stack: string | null;
  at: number;
}

/** How many are kept: enough to see a burst, few enough to read. */
export const ERROR_RING = 50;

const ring: RecordedError[] = [];

/** Record one error against the screen it broke, and log it with that name. */
export function recordError(screen: string, error: unknown, at: number = Date.now()): RecordedError {
  const e = error instanceof Error ? error : new Error(String(error));
  const entry: RecordedError = { screen, message: e.message, stack: e.stack ?? null, at };
  ring.push(entry);
  if (ring.length > ERROR_RING) ring.shift();
  console.error(`[PROOF ${screen}] ${e.message}`);
  return entry;
}

/** The errors recorded since launch (or the last `clearErrors`), oldest first. */
export function recentErrors(): readonly RecordedError[] {
  return [...ring];
}

export function clearErrors(): void {
  ring.length = 0;
}

type Listening = { addEventListener(type: string, f: (e: Event) => void): void; removeEventListener(type: string, f: (e: Event) => void): void };

/**
 * Record the errors no boundary catches, as screen "app". Returns the undo, so
 * the root layout can stop listening when it unmounts.
 */
export function watchGlobalErrors(target: Listening | undefined = globalThis as unknown as Listening): () => void {
  if (!target?.addEventListener) return () => {};
  const onError = (e: Event) => { recordError('app', (e as ErrorEvent).error ?? (e as ErrorEvent).message); };
  const onRejection = (e: Event) => { recordError('app', (e as PromiseRejectionEvent).reason); };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

// The development build's read hook for playtests (behind the dev flag, §3a item 5).
declare const __DEV__: boolean | undefined;
if (typeof __DEV__ !== 'undefined' && __DEV__) {
  (globalThis as { __PROOF_ERRORS__?: () => readonly RecordedError[] }).__PROOF_ERRORS__ = recentErrors;
}
