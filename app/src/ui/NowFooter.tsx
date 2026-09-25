/**
 * CLEAR and FINISH, once there is something to finish. CLEAR only asks (the
 * sheet is NowScreen's); FINISH ends the workout and opens the recap, once.
 */
import { View, Text, Pressable } from 'react-native';
import { pressStyle, slop } from './press.ts';
import { T, type NowSection } from './now-kit.ts';
import { s } from './now-styles.ts';

export function NowFooter({ L, state, still, model, sync, setConfirmClear, finishedRef, onFinish }: NowSection & {
  setConfirmClear: (open: boolean) => void;
  finishedRef: { current: boolean };
  onFinish?: () => void;
}) {
  return (
    <View style={[s.footer, { marginTop: L.restGap }]}>
      {state.canFinish && (
        <Pressable
          style={pressStyle(s.clear, 'quiet', still)}
          onPress={() => setConfirmClear(true)}
          accessibilityRole="button"
          hitSlop={slop(40, 12)}
          accessibilityLabel={T('clearWorkoutA11y')}
        >
          <Text style={s.clearText}>{T('clear')}</Text>
        </Pressable>
      )}

      {/* Only once there is something to finish. It used to be offered from
          the moment the app opened, and tapping it with nothing logged was a
          round trip to a recap reading "Nothing logged yet". */}
      {state.canFinish && (
        <Pressable accessibilityRole="button"
          style={pressStyle(s.finish, 'primary', still)}
          hitSlop={slop(40, 12)}
          accessibilityLabel={T('finishA11y')}
          onPress={() => {
            /*
             * `onFinish` pushes a new route — `router.push('/recap')` — and a
             * router push has no guard of its own against being called twice
             * in the same tick. Measured on the running app: two real
             * pointerdown/mouseup/click sequences dispatched at the exact same
             * screen coordinates both land on this SAME pre-render DOM node
             * (React had not yet repainted between them), so a check against
             * `state.canFinish` — a snapshot from the LAST render — cannot see
             * the second call coming any more than the first one could. Two
             * pushes landed two recaps on the stack, and DONE needed two taps
             * to actually leave, the second one dropping onto a screen that
             * had rolled a THIRD session over underneath. A `useRef`, not
             * state, because it has to be checked and set synchronously,
             * outside any render.
             */
            if (finishedRef.current) return;
            finishedRef.current = true;
            model.finish(); sync(); onFinish?.();
          }}
        >
          <Text style={s.finishText}>{T('finish')}</Text>
        </Pressable>
      )}
    </View>
  );
}
