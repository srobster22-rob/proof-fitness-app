/**
 * The top of the Now screen: the lift's name, which opens the picker, the
 * streak, last time's numbers with the goal, and the equipment tag.
 */
import { View, Text, Pressable } from 'react-native';
import { fill, KIT_KEY } from '../domain/i18n.ts';
import { streakWorthShowing } from './recap-model.ts';
import { pressStyle, slop } from './press.ts';
import { T, type NowSection } from './now-kit.ts';
import { s } from './now-styles.ts';

export function NowHeader({ L, state, still, setPickerOpen, setEditKit }: NowSection & {
  setPickerOpen: (open: boolean) => void;
  setEditKit: (open: boolean) => void;
}) {
  return (
    <View style={[s.header, { marginBottom: L.headerGap }]}>
      {/* Tapping the name opens the picker. It is not DRAWN as a button
          because it must not look like one — §7 makes selection a prediction
          problem, so the common case is never touching this at all.
          
          It is announced as one, though. `accessibilityRole` changes what
          assistive technology says, not what is painted, and the a11y tree
          was reporting the only way to change exercise as an unlabelled
          "generic" — invisible to VoiceOver rather than merely quiet. */}
      <View style={s.exerciseLine}>
      <Pressable
        onPress={() => setPickerOpen(true)}
        hitSlop={14}
        style={pressStyle(s.exerciseTap, 'quiet', still)}
        accessibilityRole="button"
        accessibilityLabel={fill(T('changeExerciseA11y'), { name: state.exercise.name })}
      >
        {/*
          The caret is the whole point of this change.

          Tapping the lift's name opens the picker, and nothing said so — the
          name looked exactly like the screen's heading, because it IS the
          screen's heading. The app already has a word for "this opens
          something": the ▾ on the goal sheet's unit control. Reusing that mark
          rather than inventing a hint line keeps §4's no-tutorial rule and
          costs one glyph.

          The name keeps `flexShrink` and `numberOfLines`, so a long movement
          still ellipsizes rather than pushing the caret off the screen — the
          mark has to survive exactly the case that makes it worth having.
        */}
        <View style={s.exerciseRow}>
          <Text style={s.exercise} numberOfLines={1}>{state.exercise.name.toUpperCase()}</Text>
          <Text style={s.exerciseCaret}>▾</Text>
        </View>
      </Pressable>
        {/*
          The streak, moved here when the tab bar took the top row it used to
          share with the gear (owner, 2026-09-10: "move the streak to the
          exercise line"). Still a STATUS -- outside the pressable, no role --
          so it cannot read as part of the control that opens the picker
          (§15). Still `streakWorthShowing`, so this screen and the recap agree.
        */}
        {streakWorthShowing(state.streak) && (
          <Text style={s.streak}
            accessibilityLabel={fill(T('streakA11y'), { n: state.streak })}>
            {state.streak} {T('weekShort')}
          </Text>
        )}
      </View>
      {/* §4: last session's numbers are visible with no interaction at all.
          The label only says "Last time" when the numbers really are theirs —
          and it is never blank. Composed in `lastTimeLine()` rather than here,
          because the branch that mattered was the one that rendered a space
          and nothing in a .tsx could have caught it. */}
      {/* One line, always. R104 gave this line a second clause — the goal on
          the lift being trained — and the column's height model treats it as
          exactly one row: wrapping on a narrow phone would push the hero down
          by 18px with nothing in the fit math expecting it.

          So the row is one line tall and wraps: the goal fits beside the
          numbers or drops whole onto a second line nobody sees. It used to
          be cut mid-number instead, "try 200 · 30 to 2…", which reads as a
          wrong number (PT1). The goal still goes before the numbers do. */}
      <View style={s.lastTime} role="status" aria-live="polite">
        {/* A made call (R682) in volt, for the rest of the workout. */}
        <Text style={[s.lastTimeText, state.lastTime.made && s.lastTimeHit]} numberOfLines={1}>
          {state.lastTime.head}
        </Text>
        {/* Volt only for the set that just hit the goal. §15 spends the accent
            on what matters right now, and for the length of one set that is
            this — it is a different size class from the hero, so it draws the
            eye without competing with the number. A gap still to close stays
            grey: it is information, not news. */}
        {state.lastTime.tail !== '' && (
          <Text style={[s.lastTimeText, s.lastTimeTail, state.lastTime.hit && s.lastTimeHit]} numberOfLines={1}>
            {state.lastTime.tail.trimStart()}
          </Text>
        )}
      </View>

      {/* Equipment, under the numbers rather than over them. It changes maybe
          once a month — carried over from the last set of this lift — so it
          reads as a label until you need it, and never competes with the
          weight. Unanswered shows a prompt rather than guessing "barbell":
          a default here would put a fact into the record that nobody chose. */}
      <Pressable
        onPress={() => setEditKit(true)}
        /*
         * `slop`, not a flat 10. Measured on the running app: this tag draws
         * **22pt** tall, so a flat 10 gave it a 42pt target — under §4's
         * ≥44pt floor and far under the app's own TARGET of 56, on a control
         * that sits on the logging path. It was the one small control
         * `touch-targets.test.ts` never named; that file's own comment says
         * its five sites are "the five that were found", and this was the
         * sixth. It sits alone on its row, so it can grow in both directions
         * without reaching a neighbour.
         */
        hitSlop={slop(22)}
        style={pressStyle(null, 'quiet', still)}
        accessibilityRole="button"
        accessibilityLabel={T('changeEquipmentA11y')}
      >
        <Text style={s.kitTag}>
          {state.equipment === 'machine' && state.machine
            ? state.machine.toUpperCase()
            : state.equipment
              ? T(KIT_KEY[state.equipment])
              : T('equipment')}
        </Text>
      </Pressable>
    </View>
  );
}
