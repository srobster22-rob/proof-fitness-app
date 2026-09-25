/**
 * The Now screen's small controls: a jump button, a column wrapper, a stepper.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { pressStyle, useReducedMotion, slop } from './press.ts';
import { fill } from '../domain/i18n.ts';
import { T } from './now-kit.ts';
import { s } from './now-styles.ts';

export function Jump({ label, onPress, hint }: { label: string; onPress: () => void; hint: string }) {
  const still = useReducedMotion();
  return (
    <Pressable
      onPress={onPress}
      /*
       * Was a flat 14 on every side, which is generous vertically and wrong
       * horizontally: the −45 and +45 buttons are drawn 14px apart, so 14 of
       * slop on each of them made their touchable regions OVERLAP across that
       * whole gap. An overlapped region is not a bigger target, it is an
       * ambiguous one — a tap in the middle goes to whichever the responder
       * resolves first, and on this row the two answers are "take 45 off" and
       * "put 45 on".
       *
       * `slop` splits the two axes: 8 above and below to reach the app's own
       * 56px minimum from a 40px box, and 6 either side, which is as much as
       * a 14px gap allows while leaving 2px between the two regions.
       */
      hitSlop={slop(40, 14)}
      accessibilityRole="button"
      accessibilityLabel={hint}
      style={pressStyle(s.jump, 'surface', still)}
    >
      {/* R339: same exemption as the steppers — a short label in a fixed-size
          chip, sized to the row it shares with them. */}
      <Text style={s.jumpText} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}

/**
 * The logging column: a plain View on a phone, a ScrollView on a window that
 * cannot hold it.
 *
 * Split out rather than branched inline because the two need different props —
 * a ScrollView positions its children through `contentContainerStyle`, and
 * putting `flex: 1` on the ScrollView itself instead would collapse the column
 * to its content and break `todayWrap`'s ability to absorb slack.
 */
export function ColumnWrap({ scrolls, tight, children }: {
  scrolls: boolean;
  tight: boolean;
  children: React.ReactNode;
}) {
  if (!scrolls) {
    return <View style={[s.content, tight && s.contentTight]}>{children}</View>;
  }
  return (
    <ScrollView
      style={s.contentScroll}
      contentContainerStyle={[s.content, s.contentTight, { flexGrow: 1 }]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

export function Stepper({ label, onPress, small, what }: {
  label: string;
  onPress: () => void;
  small?: boolean;
  /** What is being stepped, so the four of them are not all "Increase". */
  what: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      // Without an explicit role these read as plain text to VoiceOver — the
      // a11y tree showed "generic" for every stepper, the typed-entry targets
      // and LOG SET itself.
      accessibilityRole="button"
      accessibilityLabel={fill(T(label === '+' ? 'increaseWord' : 'decreaseWord'), {
        what: (what === 'weight' ? T('weight') : T('reps')).toLowerCase()
      })}
      style={({ pressed }) => [
        s.stepper,
        small && s.stepperSmall,
        pressed && { backgroundColor: '#191D21' }
      ]}
    >
      {/* R339: a glyph in a fixed-size circular button, not paragraph text —
          the same exemption as the hero number, for the same reason: Dynamic
          Type has nowhere to put a bigger + or − than the button drawn
          around it. */}
      <Text style={[s.stepperText, small && { fontSize: 26 }]} allowFontScaling={false}>{label}</Text>
    </Pressable>
  );
}
