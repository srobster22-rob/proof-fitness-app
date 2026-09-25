/**
 * The day chooser on the Now screen.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { NowState } from './now-state.ts';
import { SPLIT_PLANS, PLAN_DAYS, type SplitPlan, type PlanDay } from '../domain/split.ts';
import { ScreenModal, useExitOnce } from './ScreenModal.tsx';
import { pressStyle, useReducedMotion, onState } from './press.ts';
import { fill, PLAN_KEY, PLAN_BLURB_KEY, DAY_KEY } from '../domain/i18n.ts';
import { T } from './now-kit.ts';
import { s } from './now-styles.ts';

/**
 * What are you training today?
 *
 * Asked once per workout, before anything is logged, and never again once a set
 * is in. The app used to infer the day from what you happened to train, which
 * works but is backwards for the thing it drives: the picker narrows to the
 * day, so it needs the answer BEFORE you choose a movement, not after.
 *
 * On a first-ever launch it asks the split first — offering "PUSH / PULL /
 * LEGS" days to somebody running upper/lower is the app imposing a routine
 * §5 says it must not. Afterwards the plan is remembered and only the day is
 * asked; changing the plan lives in Settings.
 *
 * SKIP is deliberate. §4 says the app never asks a question it could answer,
 * and it CAN answer this one badly-but-usefully by inference — so somebody who
 * does not think in splits can wave it away and the old behaviour takes over.
 */
export function DayChooser({ state, firstEver, onPickPlan, onPickDay, onSkip }: {
  state: NowState;
  firstEver: boolean;
  onPickPlan: (plan: SplitPlan) => void;
  onPickDay: (day: PlanDay) => void;
  onSkip: () => void;
}) {
  const [choosingPlan, setChoosingPlan] = useState(firstEver);
  const still = useReducedMotion();
  // Whether the sheet is on its way out. `dayOpen` at the call site is
  // derived straight from `state.dayAsked`/`state.dayChosen`, so deferring
  // the CALL to `onSkip`/`onPickDay` — rather than deferring some local
  // "visible" flag — is what keeps this mounted for the animation: the
  // model does not change, so the derived flag does not either, until the
  // timer actually lands. See useExitOnce for why this is a shared hook now.
  const { closing, leave } = useExitOnce(still);
  const skip = () => leave(onSkip);
  const pickDay = (d: PlanDay) => leave(() => onPickDay(d));

  return (
    <ScreenModal visible animationType="none" transparent aria-label={choosingPlan ? T('howSplit') : T('todayIs')} exiting={closing} onRequestClose={skip}>
      <Pressable style={s.backdrop} tabIndex={-1} onPress={skip}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />

          {choosingPlan ? (
            <>
              <Text style={s.sheetTitle}>{T('howSplit')}</Text>
              {SPLIT_PLANS.map(p => {
                /*
                 * Nothing is selected on a first-ever launch.
                 *
                 * `state.plan` always has a value — it falls back to push/pull/
                 * legs — so the very first screen of the app rendered that row
                 * with a volt border, the same treatment a real choice gets. On
                 * the one launch where the user has chosen NOTHING, the app was
                 * showing them an answer and implying they had given it. The
                 * default is still the default; it just stops claiming to be a
                 * decision.
                 */
                const chosen = !firstEver && p === state.plan;
                return (
                <Pressable
                  key={p}
                  style={pressStyle([s.planRow, chosen && s.planRowOn], 'surface', still)}
                  onPress={() => { onPickPlan(p); setChoosingPlan(false); }}
                  accessibilityRole="button"
                  {...onState(chosen)}
                  accessibilityLabel={`${T(PLAN_KEY[p])}. ${T(PLAN_BLURB_KEY[p])}`}
                >
                  <View style={s.planHead}>
                    <Text style={[s.planText, chosen && s.planTextOn]}>
                      {T(PLAN_KEY[p])}
                    </Text>
                    {/* Selection said with a mark as well as a colour. Colour
                        alone is the one signal a colour-blind reader does not
                        get, and it was the ONLY signal here. */}
                    {chosen && <Text style={s.planTick}>{'✓'}</Text>}
                  </View>
                  {/* What it means, for someone who has never heard it called
                      a split. Without this the first screen of the app is a
                      vocabulary test. */}
                  <Text style={s.planBlurb}>{T(PLAN_BLURB_KEY[p])}</Text>
                </Pressable>
                );
              })}
              {/* A way past the question for someone who cannot answer it. The
                  day step has always had one; the split step did not, so a
                  beginner's only options were to guess or to close the app. */}
              <Pressable onPress={skip} hitSlop={12} style={pressStyle(s.skip, 'quiet', still)}
                accessibilityRole="button" accessibilityLabel={T('skipWorkItOutA11y')}>
                <Text style={s.skipText}>{T('notSureYet')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={s.dayHead}>
                <Text style={s.sheetTitle}>{T('todayIs')}</Text>
                <Pressable accessibilityRole="button" onPress={() => setChoosingPlan(true)} hitSlop={12}
                  style={pressStyle(null, 'quiet', still)}
                  accessibilityLabel={fill(T('changeSplitA11y'), { name: T(PLAN_KEY[state.plan]) })}>
                  <Text style={s.planSwap}>{T(PLAN_KEY[state.plan])}</Text>
                </Pressable>
              </View>
              <View style={s.dayRow}>
                {PLAN_DAYS[state.plan].map(d => (
                  <Pressable
                    key={d}
                    style={pressState => [
                      s.dayChip, PLAN_DAYS[state.plan].length === 1 && s.dayChipWide,
                      ...pressStyle(null, 'surface', still)(pressState)
                    ]}
                    onPress={() => pickDay(d)}
                    accessibilityRole="button"
                    accessibilityLabel={T(DAY_KEY[d])}
                  >
                    <Text style={s.dayChipText} numberOfLines={1}>{T(DAY_KEY[d])}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={skip} hitSlop={12} style={pressStyle(s.skip, 'quiet', still)}
                accessibilityRole="button" accessibilityLabel={T('skipWorkItOutA11y')}>
                <Text style={s.skipText}>{T('skipDay')}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}
