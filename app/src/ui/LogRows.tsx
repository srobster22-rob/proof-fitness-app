/**
 * The log panel's rows. The weight: a stepper either side of the number, which
 * opens a typed field when tapped, and the plate jumps under it. The reps: the
 * same order, steppers outside and jumps inside, with the count between.
 */
import { View, Text, Pressable, TextInput } from 'react-native';
import { fill } from '../domain/i18n.ts';
import { loadLabel } from '../domain/types.ts';
import { pressStyle } from './press.ts';
import { T, type NowSection } from './now-kit.ts';
import { s } from './now-styles.ts';
import { Jump, Stepper } from './NowControls.tsx';

export function WeightRows({ L, state, still, model, bump, typing, setTyping, typeWeight }: NowSection & {
  bump: (fn: () => void) => void;
  typing: string | null;
  setTyping: (text: string | null) => void;
  typeWeight: (raw: string) => void;
}) {
  return (
    <>
      <View style={[s.heroRow, { gap: L.rowGap }]}>
        <Stepper label="−" what="weight" onPress={() => bump(() => model.bumpWeight(-1))} />
        <View style={s.heroNumbers}>
          {typing !== null ? (
            <TextInput
              style={[s.weight, s.weightInput, { fontSize: L.hero }]}
              value={typing}
              onChangeText={typeWeight}
              onBlur={() => setTyping(null)}
              onSubmitEditing={() => setTyping(null)}
              keyboardType="decimal-pad"
              returnKeyType="done"
              selectTextOnFocus
              autoFocus
              accessibilityLabel={T('weight')}
              /*
               * R569 found this ALREADY HAD the exemption below and, not
               * having checked, added a second one above — a JSX element with
               * the same attribute twice, which `tsc --noEmit` flags but
               * nothing in this suite runs it, so it shipped. The Dynamic
               * Type reasoning R569 wrote is still correct and belongs on the
               * prop that was already here: L.hero is the same already-fitted
               * value the resting <Text> exempts a few lines below — Dynamic
               * Type multiplies on top of a fontSize regardless of which
               * element carries it, and this is not paragraph text, it is the
               * same dial in its editable form.
               */
              allowFontScaling={false}
            />
          ) : (
            <Pressable onPress={() => setTyping(String(state.weight))}
              style={pressStyle(null, 'quiet', still)}
              accessibilityRole="button" accessibilityLabel={T('typeWeightA11y')}>
              {/*
                R339: `L.hero` is `layoutFor`'s OWN answer to "how big can this
                number be and still fit" — it already solves for the screen's
                width. Dynamic Type's system font scale multiplies on TOP of
                whatever fontSize a Text is given, so at 2.35x it was
                multiplying an already-fitted value again, on a number with
                nowhere left to grow into: measured overflowing the column by
                over 80pt, taking the +/- steppers off the right edge of the
                phone with it. `allowFontScaling={false}` is the standard
                exemption for a control that already has its own sizing
                logic — this number is not paragraph text a Dynamic Type user
                is reading, it is a dial layoutFor already made as large as
                the screen allows.
              */}
              <Text style={[s.weight, { fontSize: L.hero }]} allowFontScaling={false}>
                {loadLabel(state.weight)}
              </Text>
            </Pressable>
          )}
          {/* Out of flow, so `heroNumbers` measures the DIGITS alone and the
              row centres them. In flow it dragged the number 17.8px left of
              every other element on the screen. `HERO_CHROME` still reserves
              its width once, so there is always clear space for it to hang in. */}
          {/* "LB" beside a hero reading BW said the set weighed nothing in
              pounds, which is the opposite of what a bodyweight set is. When
              there is no added weight the label names the load instead of its
              unit — and it is set smaller, because it is a word rather than a
              two-letter unit and would otherwise crowd the number. */}
          {/* R339: `position: absolute` from a fixed anchor — the reserved
              space around it (`HERO_CHROME`) does not grow with Dynamic
              Type, only the text itself would, so a scaled "LB" grew into
              the "+" stepper beside it. Same exemption as the number it is
              anchored to; the two have to scale together or not at all. */}
          <Text style={[s.unit, s.unitFloat, state.weight === 0 && s.unitWord]} allowFontScaling={false}>
            {state.weight === 0 ? T('bodyweight') : state.session.unit.toUpperCase()}
          </Text>
        </View>
        <Stepper label="+" what="weight" onPress={() => bump(() => model.bumpWeight(1))} />
      </View>
      {/* The plate jump lives on the hint line rather than in the hero row on
          purpose: `layoutFor` solves the hero's font size against HERO_CHROME,
          which budgets for exactly two steppers. Adding a third control up
          there would shrink the number on every screen, and §15 makes the
          number the hero. */}
      <View style={s.hintRow}>
        <View style={s.jumpSlot}>
          <Jump
            label={`−${state.plateJump}`}
            hint={fill(T('takeOffUnit'), { n: state.plateJump, unit: state.session.unit })}
            onPress={() => bump(() => model.bumpPlate(-1))}
          />
        </View>
        {/* Nothing in the middle. The numbers themselves are the way in: tap
            the weight or the reps to type either directly. A separate control
            for it was a third thing to explain on the row that already has
            two. */}
        <View style={s.jumpSlot}>
          <Jump
            label={`+${state.plateJump}`}
            hint={fill(T('addUnit'), { n: state.plateJump, unit: state.session.unit })}
            onPress={() => bump(() => model.bumpPlate(1))}
          />
        </View>
      </View>
    </>
  );
}

export function RepsRow({ L, state, still, model, sync, bump, typingReps, setTypingReps }: NowSection & {
  bump: (fn: () => void) => void;
  typingReps: string | null;
  setTypingReps: (text: string | null) => void;
}) {
  return (
    <View style={[s.repsRow, { marginTop: L.repsGap, gap: L.rowGap }]}>
      <Stepper label="−" small what="reps" onPress={() => bump(() => model.bumpReps(-1))} />
      <View style={s.jumpSlot}>
        <Jump
          label={`−${state.repJump}`}
          hint={fill(T('takeOffUnit'), { n: state.repJump, unit: T('reps') })}
          onPress={() => bump(() => model.jumpReps(-1))}
        />
      </View>
      {typingReps !== null ? (
        <TextInput
          style={[s.reps, s.repsInput]}
          allowFontScaling={false}
          value={typingReps}
          onChangeText={t => {
            // Three digits, not two. Two capped the field at 99, which is
            // fine for sets and wrong for the people who count a whole
            // conditioning block, a run of bodyweight reps, or a timed carry
            // as one entry — they simply could not record what they did.
            const digits = t.replace(/[^0-9]/g, '').slice(0, 3);
            setTypingReps(digits);
            const n = Number(digits);
            if (Number.isInteger(n) && n >= 1) { model.setReps(n); sync(); }
          }}
          onBlur={() => setTypingReps(null)}
          onSubmitEditing={() => setTypingReps(null)}
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          autoFocus
          accessibilityLabel={T('reps')}
        />
      ) : (
        <Pressable onPress={() => setTypingReps(String(state.reps))}
          style={pressStyle(null, 'quiet', still)}
          accessibilityRole="button" accessibilityLabel={T('typeRepsA11y')}>
          <Text style={s.reps} allowFontScaling={false}>{state.reps}<Text style={s.repsLabel}>  {T('reps')}</Text></Text>
        </Pressable>
      )}
      <View style={s.jumpSlot}>
        <Jump
          label={`+${state.repJump}`}
          hint={fill(T('addUnit'), { n: state.repJump, unit: T('reps') })}
          onPress={() => bump(() => model.jumpReps(1))}
        />
      </View>
      <Stepper label="+" small what="reps" onPress={() => bump(() => model.bumpReps(1))} />
    </View>
  );
}
