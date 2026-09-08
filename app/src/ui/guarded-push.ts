import { useCallback, useRef } from 'react';

/**
 * A `router.push` that a same-tick double tap cannot fire twice.
 *
 * Found on FINISH (R383), then confirmed again on a past-workout card
 * (R384): two real pointerdown/mousedown/pointerup/mouseup/click sequences
 * dispatched at the exact same screen coordinates, with no gap between them,
 * land on the SAME pre-render DOM node — React has not repainted between the
 * two dispatches — so the handler runs twice. Two pushes landed two copies
 * of the same route on the stack; the screen's own DONE/close control only
 * pops one, so it took two taps to actually leave, and the second one
 * dropped onto whatever had rolled over underneath in the meantime.
 *
 * A check against component STATE cannot catch this: state is a snapshot
 * from the last render, and the second call arrives before the first one's
 * state update has ever been committed. A `useRef`, checked and set
 * synchronously outside any render, is the only thing fast enough — this is
 * the corrected understanding from R380's WIPE ALL trace, which is what
 * pointed at the right primitive here.
 *
 * The cooldown clears on a short timer rather than on a specific app event,
 * unlike NowScreen's own FINISH guard (which resets when a fresh workout
 * rolls over — a real "this is now a new situation" moment that exists
 * because FINISH stays on the same mounted screen). Every other push this
 * wraps has no equivalent moment to reset on: nothing legitimate needs to
 * push the same route twice inside half a second, so a plain cooldown is the
 * honest general-purpose answer.
 *
 * Takes the ROUTER, not `router.push` directly — expo-router's methods are
 * not guaranteed to survive being torn off their object, and a rebinding
 * mistake here would fail silently (a push that quietly never fires) rather
 * than loudly, which is worse than the bug this exists to fix.
 */
export function useGuardedPush(router: { push: (...args: any[]) => void }) {
  const blockedUntil = useRef(0);
  return useCallback((...args: any[]) => {
    const now = Date.now();
    if (now < blockedUntil.current) return;
    blockedUntil.current = now + 600;
    router.push(...args);
  }, [router]);
}

/**
 * `leave` (every screen's DONE/close button) had the same shape duplicated
 * identically in five files (`progress.tsx`, `goals.tsx`, `settings.tsx`,
 * `measure.tsx`, `recap.tsx`) — five places the fix below would have had to
 * be re-applied by hand, and the exact "second implementation was not
 * wrong, it was unverifiable from the call site" trap.
 *
 * Found live (R387): double-clicking DONE at the same screen coordinates —
 * same real pointerdown/mousedown/pointerup/mouseup/click technique as
 * every other guard in this file — produced a genuine "GO_BACK was not
 * handled by any navigator" console error on a fresh tab (so not stale Fast
 * Refresh): the first tap's `router.back()` had not yet updated the
 * navigator's own state by the time the second tap's `canGoBack()` ran, so
 * it read stale-true and called `back()` again with nowhere left to go.
 * React Navigation swallows the resulting error as a dev-only warning
 * rather than crashing, so this was never user-visible — but the same
 * cooldown already proven on `useGuardedPush` closes it for free.
 */
export function useGuardedLeave(
  router: { back: () => void; canGoBack: () => boolean; replace: (h: never) => void },
  fallback: string = '/'
) {
  const blockedUntil = useRef(0);
  return useCallback(() => {
    const now = Date.now();
    if (now < blockedUntil.current) return;
    blockedUntil.current = now + 600;
    if (router.canGoBack()) router.back();
    else router.replace(fallback as never);
  }, [router, fallback]);
}
