import React, { useCallback, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useGuardedLeave } from '../src/ui/guarded-push.ts';
import { TabBar } from '../src/ui/TabBar.tsx';
import { goTab } from '../src/ui/tab-bar.ts';
import { getRepo } from '../src/data/db.ts';
import { COLUMN } from '../src/ui/column.ts';
import { displayUnit } from '../src/ui/display-unit.ts';
import { trainingGoal, TRAINING_GOALS, PREF_GOAL } from '../src/ui/training-goal.ts';
import type { TrainingGoal } from '../src/domain/coach.ts';

/** The label for each goal, so the chip and its accessible name cannot drift. */
const GOAL_KEY: Record<TrainingGoal, 'goalStrength' | 'goalSize' | 'goalConsistency'> = {
  strength: 'goalStrength', size: 'goalSize', consistency: 'goalConsistency'
};
import {
  customJump, customRepJump, PLATE, REP_JUMP, PREF_SKIP_MACHINE, PREF_UNIT } from '../src/ui/now-model.ts';
import { SPLIT_PLANS } from '../src/domain/split.ts';
import type { SplitPlan } from '../src/domain/split.ts';
import { convertWeight, type Unit } from '../src/domain/types.ts';
import {
  LANGUAGES, LANGUAGE_LABEL, t, fill, languageFor, PREF_LANG, PLAN_KEY, type Language
} from '../src/domain/i18n.ts';
import { TYPE, SPACING } from '../src/ui/type.ts';
import { buzz } from '../src/ui/haptics.ts';
import { pressStyle, useReducedMotion, onState, SELECTED, SELECTED_TEXT } from '../src/ui/press.ts';

/**
 * Screen 4 — Settings.
 *
 * §9 banned a settings SCREEN and the preferences lived in a sheet on Progress
 * because of it. The product owner has overruled that: they asked for a
 * settings tab holding the split, unit conversion, language "and everything
 * else the user might need". The ban's real intent was that a settings screen
 * becomes the drawer every unmade decision gets swept into, so the guard that
 * replaces it is a rule rather than a location — everything here is something
 * the user has ASKED to control, and anything the app can infer it still infers
 * (§4). The unit and the language start from the device; the split starts from
 * what gets trained. This screen is where you overrule those, not where you are
 * first asked.
 *
 * Everything writes through on tap. There is no SAVE button because there is
 * nothing to save: a preference the app has already applied does not need
 * confirming, and a settings screen with a commit step is a screen you can
 * leave in a state you did not mean.
 */
// Defined in i18n.ts, which is where every screen reads it from. Re-exported
// so existing importers keep working and there is still one definition.
export { PREF_LANG };
export const PREF_PLAN = 'split.plan';
// PREF_UNIT is defined in now-model, which is the file that acts on it — see
// the note there. Re-exported so nothing that already imports it from here
// breaks, and so there is still exactly one definition.
export { PREF_UNIT };


export default function Settings() {
  const repo = getRepo();
  const router = useRouter();
  const leave = useGuardedLeave(router);
  const [, setTick] = useState(0);
  const refresh = useCallback(() => setTick(n => n + 1), []);

  const lang: Language = (repo.getPref(PREF_LANG) as Language | null)
    ?? languageFor(typeof navigator !== 'undefined' ? navigator.language : null);
  // The same one definition every other surface uses — see display-unit.ts.
  const unit: Unit = displayUnit(repo);
  const plan = (repo.getPref(PREF_PLAN) as SplitPlan | null) ?? 'ppl';
  const goal = trainingGoal(repo);

  const skipMachine = repo.getPref(PREF_SKIP_MACHINE) === '1';
  // Honour the system's reduced-motion setting — see `useReducedMotion`.
  const still = useReducedMotion();
  /*
   * The jump field is per-unit, so it has to be re-read when the unit changes.
   *
   * `useState` seeds once. Switching LB to KG re-rendered the label, the
   * placeholder and the error text into kilos while the VALUE stayed the pound
   * number it was seeded with — so a custom 50 lb jump displayed as "50 kg",
   * against an actual kg jump of 20. Worse, editing from there wrote the
   * lb-derived number into `jump.kg`, committing a value the user never chose.
   *
   * Keyed on the unit, so switching remounts the field with the right one. The
   * alternative — an effect that overwrites state — races a user mid-keystroke;
   * a remount cannot.
   */
  /*
   * Seeded with the value in force, never blank — §4: an empty number field is
   * a bug. Unset means "the default", and the default is a real number the app
   * is really using; showing it greyed as a placeholder made it look like
   * nothing was set, on the one screen whose job is telling you what is.
   */
  const [jump, setJump] = useState(repo.getPref(`jump.${unit}`) ?? String(PLATE[unit]));
  const [repJump, setRepJump] = useState(repo.getPref('jump.reps') ?? String(REP_JUMP));
  const [error, setError] = useState<string | null>(null);
  const jumpKey = useRef(unit);
  if (jumpKey.current !== unit) {
    jumpKey.current = unit;
    // Safe during render: this is the `useState` "adjusting state when props
    // change" pattern, and it re-renders immediately without committing the
    // wrong value to the screen.
    setJump(repo.getPref(`jump.${unit}`) ?? String(PLATE[unit]));
    setError(null);
  }


  // Every control on this screen is a selection, and a preference that
  // changes with no sound and no movement leaves you tapping it twice.
  const set = (k: string, v: string) => { repo.setPref(k, v); buzz.chose(); refresh(); };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Text style={s.title}>{t(lang, 'settings')}</Text>
        <Pressable accessibilityRole="button" onPress={leave} hitSlop={16}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={t(lang, 'done')}>
          <Text style={s.close}>{t(lang, 'done')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {/* ---- split ---------------------------------------------------- */}
        <Text style={s.label}>{t(lang, 'split')}</Text>
        <View style={s.row}>
          {SPLIT_PLANS.map(p => (
            <Pressable accessibilityRole="button"
              key={p}
              onPress={() => set(PREF_PLAN, p)}
              style={pressStyle([s.chip, p === plan && s.chipOn], 'surface', still)}
              accessibilityLabel={t(lang, PLAN_KEY[p])}
              {...onState(p === plan)}
            >
              {/* From the translation table, not from `PLAN_LABEL` — the split
                  names are chrome, so they translate. The movement names inside
                  the split do not, because those label the user's own history. */}
              <Text style={[s.chipText, p === plan && s.chipTextOn]} numberOfLines={2}>
                {t(lang, p === 'ppl' ? 'ppl' : p === 'upper-lower' ? 'upperLower' : 'fullBody')}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.help}>{t(lang, 'splitHelp')}</Text>

        {/* ---- coaching --------------------------------------------------- */}
        {/*
          The half of OWNER.md #2 that was missing. The rule engine has taken a
          goal since R517 and nothing passed one, so every lifter got the
          default and "tuned to the person's stated goal" was not yet true.

          Three chips, exactly like UNITS and SPLIT above, because a fourth
          shape of control on one screen is a thing to learn for no reason. The
          help line describes what each does to the SUGGESTION rather than
          naming a training philosophy — OWNER.md's rule is that if it needs
          explaining it is wrong, and "adds weight in bigger steps" needs no
          explaining while "hypertrophy" does.
        */}
        <Text style={s.label}>{t(lang, 'trainingGoal')}</Text>
        <View style={s.row}>
          {TRAINING_GOALS.map(g => (
            <Pressable accessibilityRole="button"
              key={g}
              onPress={() => set(PREF_GOAL, g)}
              style={pressStyle([s.chip, g === goal && s.chipOn], 'surface', still)}
              accessibilityLabel={t(lang, GOAL_KEY[g])}
              {...onState(g === goal)}
            >
              <Text style={[s.chipText, g === goal && s.chipTextOn]} numberOfLines={2}>
                {t(lang, GOAL_KEY[g])}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.help}>{t(lang, 'trainingGoalHelp')}</Text>

        {/* ---- units ---------------------------------------------------- */}
        <Text style={s.label}>{t(lang, 'units')}</Text>
        <View style={s.row}>
          {(['lb', 'kg'] as Unit[]).map(u => (
            <Pressable accessibilityRole="button"
              key={u}
              onPress={() => set(PREF_UNIT, u)}
              style={pressStyle([s.chip, u === unit && s.chipOn], 'surface', still)}
              accessibilityLabel={t(lang, u === 'lb' ? 'pounds' : 'kilograms')}
              {...onState(u === unit)}
            >
              <Text style={[s.chipText, u === unit && s.chipTextOn]}>{u.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
        {/* The conversion, shown rather than described. A preference whose
            effect you cannot see until you leave the screen is one you have to
            take on trust — §16. */}
        <Text style={s.help}>
          {t(lang, 'unitsHelp')}
          {'\n'}
          {unit === 'kg'
            ? `225 lb → ${convertWeight(225, 'lb', 'kg')} kg`
            : `100 kg → ${convertWeight(100, 'kg', 'lb')} lb`}
        </Text>

        {/* ---- language -------------------------------------------------- */}
        <Text style={s.label}>{t(lang, 'language')}</Text>
        <View style={s.row}>
          {LANGUAGES.map(l => (
            <Pressable accessibilityRole="button"
              key={l}
              onPress={() => set(PREF_LANG, l)}
              style={pressStyle([s.chip, l === lang && s.chipOn], 'surface', still)}
              accessibilityLabel={LANGUAGE_LABEL[l]}
              {...onState(l === lang)}
            >
              <Text style={[s.chipText, l === lang && s.chipTextOn]}>{LANGUAGE_LABEL[l]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={s.help}>{t(lang, 'languageHelp')}</Text>

        {/* ---- asking ------------------------------------------------------ */}
        <Text style={s.label}>{t(lang, 'asking')}</Text>
        {/* The same switch the equipment sheet offers, because a preference you
            can only reach through the sheet you are trying to stop seeing is a
            preference you cannot undo. */}
        <Pressable accessibilityRole="checkbox"
          aria-checked={skipMachine}
          accessibilityLabel={t(lang, 'skipMachine')}
          style={pressStyle(s.check, 'quiet', still)}
          onPress={() => set(PREF_SKIP_MACHINE, skipMachine ? '0' : '1')}
        >
          <View style={[s.box, skipMachine && s.boxOn]}>
            {skipMachine && <Text style={s.tick}>✓</Text>}
          </View>
          <Text style={s.checkText}>{t(lang, 'skipMachine')}</Text>
        </Pressable>
        <Text style={s.help}>{t(lang, 'skipMachineHelp')}</Text>

        {/* ---- jump amounts ---------------------------------------------- */}
        <Text style={s.label}>{t(lang, 'jumps')}</Text>
        <View style={s.row}>
          <View style={s.field}>
            <TextInput
              style={s.input}
              value={jump}
              onChangeText={v => {
                setJump(v);
                setError(null);
                /*
                 * Emptying the field means "no preference", so the row goes.
                 * It used to just `return`, which left the old custom jump in
                 * force while the placeholder advertised the default — cleared
                 * a 50 back to blank and the app kept stepping by 50.
                 */
                if (!v.trim()) return repo.clearPref(`jump.${unit}`);
                const n = customJump(v, unit);
                if (n === null) return setError(fill(t(lang, 'jumpMustBeWeight'), { unit }));
                repo.setPref(`jump.${unit}`, String(n));
              }}
              // Leaving the field blank is how you ask for the default, so on
              // the way out we show what that default actually is (§4). The
              // pref row is already gone by now; this only refills the display.
              onBlur={() => { if (!jump.trim()) setJump(String(PLATE[unit])); }}
              placeholder={String(PLATE[unit])}
              placeholderTextColor="#7C8792"
              keyboardType="decimal-pad"
              accessibilityLabel={fill(t(lang, 'weightJumpUnitA11y'), { unit })}
            />
            <Text style={s.fieldUnit}>{unit}</Text>
          </View>
          <View style={s.field}>
            <TextInput
              style={s.input}
              value={repJump}
              onChangeText={v => {
                setRepJump(v);
                setError(null);
                if (!v.trim()) return repo.clearPref('jump.reps');
                const n = customRepJump(v);
                if (n === null) return setError(t(lang, 'repJumpRange'));
                repo.setPref('jump.reps', String(n));
              }}
              onBlur={() => { if (!repJump.trim()) setRepJump(String(REP_JUMP)); }}
              placeholder={String(REP_JUMP)}
              placeholderTextColor="#7C8792"
              keyboardType="number-pad"
              accessibilityLabel={t(lang, 'repJumpA11y')}
            />
            <Text style={s.fieldUnit}>{t(lang, 'repsWord')}</Text>
          </View>
        </View>
        {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}

        {/* ---- data ------------------------------------------------------- */}
        <Text style={s.label}>{t(lang, 'yourData')}</Text>
        {/* Deliberately a pointer rather than a copy. Export, restore and erase
            live on Progress next to the history they act on, and a second set
            of buttons here would be a second place for the same thing to go
            wrong. */}
        <Pressable accessibilityRole="button" style={pressStyle(s.link, 'quiet', still)}
          onPress={() => goTab(router, 'progress')}
          accessibilityLabel={`${t(lang, 'exportData')}. ${t(lang, 'restore')}`}>
          <Text style={s.linkText}>{t(lang, 'exportData')} · {t(lang, 'restore')}  →</Text>
        </Pressable>
      </ScrollView>
      <TabBar current="settings" go={tab => goTab(router, tab)} />
    </SafeAreaView>
  );
}

const VOLT = '#CCFF00';
const MUTED = '#7C8792';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  // R341: found at 2.35x Dynamic Type — DONE's right edge ran to x348.9 on
  // a 320px phone, the title having pushed it past the screen entirely.
  // Same low-risk fix as every other overflow found tonight.
  header: {
    ...COLUMN,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18, flexWrap: 'wrap'
  },
  title: { color: '#fff', fontSize: TYPE.title, fontWeight: '900', letterSpacing: SPACING.micro },
  close: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  body: { ...COLUMN, paddingHorizontal: 24, paddingBottom: 40 },

  label: { color: MUTED, fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro, marginTop: 26, marginBottom: 10 },
  // Wraps, for the same reason the goal filters do: three split names at two
  // words each will not sit on one line of a 390px phone.
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 46, maxWidth: '100%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, borderColor: '#232A31', alignItems: 'center', justifyContent: 'center'
  },
  chipOn: SELECTED,
  chipText: { color: '#C3CBD2', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  chipTextOn: SELECTED_TEXT,
  help: { color: '#9AA5AF', fontSize: TYPE.meta, lineHeight: 19, marginTop: 10 },

  field: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    width: 92, height: 52, paddingHorizontal: 14,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', color: '#fff', fontSize: 18, fontWeight: '800'
  },
  fieldUnit: { color: MUTED, fontSize: TYPE.body, fontWeight: '600' },
  error: { color: '#FF8A8A', fontSize: TYPE.body, marginTop: 12, fontWeight: '600' },

  check: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  box: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#7C8792',
    alignItems: 'center', justifyContent: 'center'
  },
  /*
   * The one control still allowed to fill with the accent, against the rule
   * `SELECTED` sets everywhere else. A 20px checkbox is not a block, a tick
   * inside a filled box is the least ambiguous affordance there is, and drawn
   * as an outline the checked and unchecked states would differ by a glyph
   * alone. Exempt on purpose; `accent.test.ts` names it so the next audit does
   * not "fix" it.
   */
  boxOn: { backgroundColor: VOLT, borderColor: VOLT },
  tick: { color: '#000', fontSize: 14, fontWeight: '900', marginTop: -1 },
  checkText: { color: '#C3CBD2', fontSize: TYPE.body, fontWeight: '600', flexShrink: 1 },

  link: { paddingVertical: 16 },
  linkText: { color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '700', letterSpacing: SPACING.label }
});
