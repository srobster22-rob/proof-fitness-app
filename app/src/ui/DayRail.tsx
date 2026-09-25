/**
 * The day's lifts as a row of chips under NEXT / SET n; tap one to train it.
 * It appears with the first logged set and stays until the workout is finished.
 */
import type { RefObject } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fill, DAY_HEADING_KEY } from '../domain/i18n.ts';
import { pressStyle, onState } from './press.ts';
import { RAIL_FADE, T, feedback, type NowSection } from './now-kit.ts';
import { s } from './now-styles.ts';

export function DayRail({ L, state, still, model, sync, railDrag }: NowSection & { railDrag: RefObject<any> }) {
  return (
    <>
      {/*
        The rail that replaced NEXT LIFT.

        NEXT LIFT earned its place by appearing only once a set was logged, and
        that rule was right — but it offered exactly ONE guess, in a small button
        sharing a row with CLEAR and FINISH. Between exercises the question is
        not "what does the app think is next", it is "what else is on push day",
        and the answer to that is a list. Tricep extensions and chest flys were
        always in the library and always reachable through the picker; nothing on
        the logging screen said so, so the honest report was that it "isn't clear
        what to click next".

        Same earning rule, same lifetime: it appears with the first logged set
        and stays until the workout is finished. The predictor's pick is still
        here — it is the chip tagged NEXT — so nothing that button did was lost.

        It sits directly under NEXT / SET n, not above the footer where it
        started. That header is the one place on the screen already answering
        "what now", so the day's other lifts belong with it rather than a
        block away next to CLEAR and FINISH — which is where the eye goes to
        END a workout, not to continue one.
      */}
      {/* The rail gets its own band, with a rule under it: flush against the
          set list — which is a SCROLLER, so its top row is routinely half-cut
          — a half-cut row immediately below the chips read as two things drawn
          on top of each other. The rule makes the boundary explicit and the
          clipping legible as scrolling rather than as breakage. */}
      {/*
        The band has NO explicit height.
        It used to be pinned to `L.railHeight + 10`, a number the model
        computed and the stylesheet had to match exactly — and it was wrong
        twice. Once when a line was added inside without the model being told,
        and once because the band's own margin, padding and rule are not in
        the model's arithmetic at all, so the chips ran past the bottom and
        came out with their lower edge shaved off. Sizing to content cannot be
        wrong: the band is exactly as tall as what is in it. `railHeight`
        stays in the model as the RESERVE the fit math budgets for, which only
        has to be generous, never exact.
      */}
      {state.canFinish && state.dayRail.length > 0 && L.railHeight > 0 && (
        <View style={s.railBand}>
          {/* Always shown, on every screen size.

              It was dropped on short viewports to buy back 14px, on the
              reasoning that the day chooser had already named the day. That
              was the wrong thing to cut: this line is what tells you the row
              beneath it is what comes NEXT, and without it the chips are just
              a row of lift names with no stated purpose. The 14px comes out
              of TODAY instead, which scrolls. */}
          <Text style={s.railLabel}>
            {T(state.planDay ? DAY_HEADING_KEY[state.planDay] : 'nextUpToday')}
          </Text>
          {/*
            The chips scroll, and until R514 nothing said so: the row simply
            stopped mid-word at the screen edge — 'DB Shoul' — which reads as
            broken rather than as more-to-come. A fade is the standard answer
            and a gradient is a dependency §12 does not allow, so this is a
            ramp of solid background slices instead: five Views of BG at
            rising opacity, absolutely positioned, `pointerEvents` none.

            Absolute on purpose. R512 established that this column has no
            vertical slack — the 568px phone was already 56px over budget —
            so anything added here has to cost zero layout height, and an
            overlay does.

            It needs no is-it-overflowing check: the slices are the SAME
            colour as the background, so when the chips do not reach the edge
            the fade is background drawn over background and cannot be seen.
          */}
          <View style={s.railScroller}>
          <ScrollView
            ref={railDrag}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.railRow}
          >
            {state.dayRail.map(lift => (
              <Pressable
                key={lift.id}
                style={pressState => [
                  s.railChip,
                  lift.current && s.railChipOn,
                  lift.done && !lift.current && s.railChipDone,
                  ...pressStyle(null, 'surface', still)(pressState)
                ]}
                {...onState(lift.current)}
                onPress={() => {
                  model.selectExercise(lift.id);
                  sync();
                  feedback(() => Haptics.selectionAsync());
                }}
                accessibilityRole="button"
                /* The reason the recommendation exists lives here rather
                   than on screen. It had its own line under the heading and
                   it was too much text on the one path §4 keeps bare — the
                   rail already answers "what next" by putting the chip
                   first, and a sentence explaining the ranking is a thing to
                   read mid-set. As an accessible name it costs no pixels and
                   is still there for anyone who cannot see the order. */
                accessibilityLabel={
                  `${lift.name}${lift.done ? T('alreadyTrainedTodayA11y') : ''}` +
                  `${lift.suggested ? T('suggestedNextA11y') : ''}` +
                  `${lift.suggested && lift.reason ? fill(T('reasonColonA11y'), { reason: lift.reason }) : ''}`
                }
              >
                <Text
                  style={[
                    s.railText,
                    lift.current && s.railTextOn,
                    lift.done && !lift.current && s.railTextDone
                  ]}
                  numberOfLines={1}
                >
                  {lift.name}
                </Text>
                {/* The old button's one job, kept as a tag rather than a screen
                    of its own. */}
                {lift.suggested && <Text style={s.railNext}>{T('suggested')}</Text>}
              </Pressable>
            ))}
          </ScrollView>
            <View style={s.railFade} pointerEvents="none">
              {RAIL_FADE.map((opacity, i) => (
                <View key={i} style={[s.railFadeSlice, { opacity }]} />
              ))}
            </View>
          </View>
        </View>
      )}
    </>
  );
}
