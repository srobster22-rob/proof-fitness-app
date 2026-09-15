import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ScreenModal, exitMs } from './ScreenModal.tsx';
import { getRepo } from '../data/db.ts';
import { t, languageOf } from '../domain/i18n.ts';
import { useReducedMotion, pressStyle, dangerPressStyle } from './press.ts';

/**
 * A confirmation the user has to mean.
 *
 * The app has almost no dialogs on purpose — §4's whole posture is direct
 * action with a visible undo, and R48's set chips arm before they fire rather
 * than asking a question. This exists for the two actions that cannot be
 * undone: clearing the workout you are in the middle of, and erasing every
 * thing on the device. §11 has no server copy, so for the second one the only
 * thing standing behind a mis-tap is the user's own export.
 *
 * Two rules it enforces by construction:
 *
 *   - **The destructive button is never the one under your thumb by default.**
 *     Cancel takes the left, wider position; confirm sits right and is styled
 *     as the exception rather than the primary.
 *   - **The body says what will actually go**, in counts, not "are you sure?".
 *     "Delete all 210 sessions and 1,680 sets" is a fact the user can check
 *     against the screen behind them; "are you sure" is a question with no
 *     information in it.
 *
 * `animationType="none"` for the reason recorded twice already in this project:
 * on react-native-web "slide" is a keyframe with `animation-fill-mode: none`,
 * so the sheet reverts to `translateY(100%)` when it ends and sits one full
 * viewport below the screen, invisible but perfectly tappable by a synthetic
 * pointer event.
 *
 * ## The exit
 *
 * `ScreenModal`'s entrance fades and rises the sheet in; the same is true in
 * reverse here, and it is a LOCAL delay rather than something the caller has
 * to know about. Tapping cancel or confirm does not call the real prop
 * immediately — it sets `closing`, which flips `ScreenModal`'s `exiting` prop
 * and starts the CSS transition, and only after `exitMs` does the real
 * `onCancel`/`onConfirm` fire. The caller's own state still flips
 * synchronously with THAT call, exactly as it always did, so nothing outside
 * this file has to change: a confirm sheet stops teleporting away without any
 * of its eight call sites knowing the difference. The one visible cost is the
 * delay itself — up to 220ms between the tap and the actual wipe/erase/clear —
 * which is the animation's whole point: the user sees the sheet leave before
 * the thing it warned them about happens.
 *
 * The delay opens a small window this component owns the closing of: if the
 * screen underneath unmounts before the timer lands — leaving mid-animation
 * by navigating away right after the tap — the pending `onConfirm` is
 * cancelled rather than firing late into a screen nobody is looking at.
 * `eraseAll`/`wipe` are exactly the two actions this component exists to
 * guard, so a destructive tap either completes while its confirmation was
 * still visible or does not happen at all — never silently, afterward.
 */
export function ConfirmSheet({
  title, body, confirmLabel, onConfirm, onCancel
}: {
  title: string;
  /** What will actually happen, in specifics. */
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const still = useReducedMotion();
  // null = open. Otherwise which action the exit will fire once it lands.
  // Drives the `exiting` prop below, so it stays state — but state is a
  // snapshot from the last render, and two real pointerdown/mouseup/click
  // sequences dispatched at the same screen coordinates with no gap between
  // them (measured live on FINISH, a past-workout card, and here) land on
  // the same pre-render DOM node before React ever commits the FIRST tap's
  // update. Both calls to `close` then read the same stale `closing === null`
  // and both pass `if (closing) return` — this component's own comment
  // claiming that check stops a second tap was wrong the same way R373's
  // WIPE ALL claim was, just never traced. A `useRef`, checked and set
  // synchronously outside any render, is the thing actually fast enough.
  const [closing, setClosing] = useState<null | 'cancel' | 'confirm'>(null);
  const closingRef = useRef<null | 'cancel' | 'confirm'>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Unmounting mid-exit — the screen underneath went away before the timer
  // landed — cancels rather than firing late. See the file comment: a
  // destructive action must not run after nobody can see it happen.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const close = (which: 'cancel' | 'confirm') => {
    if (closingRef.current) return; // a second tap mid-exit must not double-fire or restart the clock
    closingRef.current = which;
    setClosing(which);
    // A stray still-pending timer here would mean the ref guard above did
    // its job and state's own stale check let a second `close` through
    // anyway — belt and braces, not a normal path, but an unfired timer
    // firing late is exactly the "never silently, afterward" failure this
    // component exists to prevent.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => (which === 'cancel' ? onCancel() : onConfirm()), exitMs(still));
  };

  return (
    <ScreenModal visible animationType="none" transparent aria-label={title}
      exiting={closing !== null}
      onRequestClose={() => close('cancel')}>
      {/* Tapping outside cancels — the safe outcome is always the easy one. */}
      <Pressable style={s.backdrop} tabIndex={-1} onPress={() => close('cancel')}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.body}>{body}</Text>
          <View style={s.row}>
            <Pressable style={pressStyle(s.cancel, 'surface', still)}
              onPress={() => close('cancel')} accessibilityRole="button"
              accessibilityLabel={t(languageOf(getRepo()), 'cancel')}>
              <Text style={s.cancelText}>{t(languageOf(getRepo()), 'cancel')}</Text>
            </Pressable>
            <Pressable
              style={dangerPressStyle(s.confirm, CONFIRM_HELD, still)}
              onPress={() => close('confirm')}
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
            >
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

const DANGER = '#FF6B6B';
// A step deeper than the resting fill (#2A1416) — see `dangerPressStyle`.
const CONFIRM_HELD = '#3A1418';

const s = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 24
  },
  sheet: {
    width: '100%', maxWidth: 380,
    backgroundColor: '#0C0E10', borderRadius: 20, padding: 22,
    borderWidth: 1, borderColor: '#242A30'
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 0.2 },
  body: { color: '#9AA5AF', fontSize: 14, lineHeight: 21, marginTop: 10 },
  row: { flexDirection: 'row', gap: 12, marginTop: 22 },
  // Cancel is wider and first. The safe way out should be the easy one.
  cancel: {
    flex: 1.3, height: 52, borderRadius: 14,
    borderWidth: 1, borderColor: '#2A323A',
    alignItems: 'center', justifyContent: 'center'
  },
  cancelText: { color: '#E8EAED', fontSize: 14, fontWeight: '800', letterSpacing: 1.4 },
  confirm: {
    flex: 1, height: 52, borderRadius: 14,
    borderWidth: 1, borderColor: DANGER, backgroundColor: '#2A1416',
    alignItems: 'center', justifyContent: 'center'
  },
  confirmText: { color: DANGER, fontSize: 14, fontWeight: '800', letterSpacing: 1.2 }
});
