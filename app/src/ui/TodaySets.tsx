/**
 * The workout so far, one block per lift: its sets as chips (tap one to edit
 * it), and beside the latest set of each lift its UNDO and its +. Each block
 * reports where it sits, so `useTodayReveal` can keep the current lift in view.
 */
import { View, Text, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import { fill } from '../domain/i18n.ts';
import { loadLabel, type LoggedSet } from '../domain/types.ts';
import { Arrive } from './Arrive.tsx';
import { pressStyle, slop } from './press.ts';
import { T, feedback, type NowSection } from './now-kit.ts';
import { s } from './now-styles.ts';

export function TodaySets({
  state, still, model, sync, blockLayouts, revealCurrent, undoingRef, setEditingSet, setAddingTo
}: NowSection & {
  blockLayouts: { current: Map<string, { y: number; h: number }> };
  revealCurrent: () => void;
  undoingRef: { current: boolean };
  setEditingSet: (set: LoggedSet) => void;
  setAddingTo: (exerciseId: string) => void;
}) {
  return (
    <>
      {/*
        Nothing at all until the first set lands.

        `state.today` always contains the lift you are ON, so before a
        single set existed this block rendered its name and the words "no
        sets yet" — a container, a heading and a sentence, all describing
        nothing, on the first screen a new user ever sees. The comment above
        already claimed "the slot is empty and the screen is about the set
        in front of you"; the code just did not do it.

        `todayWrap` keeps its `minHeight` either way, so the first set drops
        into reserved space rather than pushing the screen around.
      */}
      {(state.totalSets === 0 ? [] : state.today).map(lift => (
        <View
          key={lift.exerciseId}
          style={s.liftBlock}
          onLayout={e => {
            const { y, height } = e.nativeEvent.layout;
            blockLayouts.current.set(lift.exerciseId, { y, h: height });
            revealCurrent();
          }}
        >
          <View style={s.liftHead}>
            {lift.current && <View style={s.liftDot} />}
            <Text style={[s.liftName, lift.current && s.liftNameCurrent]} numberOfLines={1}>
              {lift.name}
            </Text>
            {lift.sets.length > 0 && (
              <Text style={s.liftCount}>{lift.sets.length}</Text>
            )}
          </View>

          {lift.sets.length === 0 ? (
            <Text style={s.liftEmpty}>{T('noSetsYet')}</Text>
          ) : (
            <View style={s.liftSets}>
              {lift.sets.map((set, i) => (
                /* Keyed on the set's id, so only a NEW chip mounts and
                   animates — the ones already on screen are reused and stay
                   put, which is what stops one arrival becoming a flock.

                   The LATEST set's slot also holds UNDO and +, and the list
                   wraps slots, never inside one: so the set just logged and
                   its two buttons always share a line. Wrapped apart, the
                   list's one-line window at 375x812 showed UNDO and + with no
                   set beside them after three sets (R685's blind re-score). */
                <View key={set.id} style={i === lift.sets.length - 1 ? s.lastSetGroup : undefined}>
                <Arrive>
                <Pressable
                  /* Tapping a set now EDITS it. It used to arm it for
                     destruction, so the only way to fix a mistyped weight
                     was to destroy the set and log another — which moved it
                     to the end of the session and changed its time. Removal
                     still exists, inside the editor, where it is a choice
                     rather than the only door. */
                  onPress={() => setEditingSet(set)}
                  accessibilityRole="button"
                  hitSlop={slop(36, 14)}
                  accessibilityLabel={
                    fill(T('setByRepsA11y'), { n: i + 1, weight: loadLabel(set.weight), reps: set.reps }) +
                    (state.prSetIds.includes(set.id) ? T('personalRecordA11y') : '') +
                    `${set.note ? fill(T('notedA11y'), { note: set.note }) : ''}` +
                    T('tapToEditA11y')
                  }
                  style={pressStyle(
                    [s.chip, state.prSetIds.includes(set.id) && s.chipPR],
                    'surface', still)}
                >
                  <Text style={s.chipIndex}>{i + 1}</Text>
                  <Text style={[s.chipText, state.prSetIds.includes(set.id) && s.chipTextPR]}>
                    {loadLabel(set.weight)} × {set.reps}
                  </Text>
                  {/* OWNER.md #5: the moment a best is hit, marked where it
                      happens. One glyph and the accent, not a banner — §8
                      calls the PR the emotional payload and also forbids
                      crying wolf, and the recap is where it gets a sentence. */}
                  {state.prSetIds.includes(set.id)
                    ? <Text style={s.chipPRMark}>★</Text> : null}
                  {/* A note is worth nothing if the list does not admit it
                      is there. One glyph, so a whole session of notes does
                      not turn the list into prose. */}
                  {set.note ? <Text style={s.chipNote}>✎</Text> : null}
                </Pressable>
                </Arrive>
                {i === lift.sets.length - 1 && (<>
              {/* Every lift with sets in it, not just the one being
                  trained. A set logged wrong and then moved on from used to
                  be stranded — visible in this list, with the only fix
                  three taps away behind realising you had to switch back to
                  it. The mistake is shown here, so the undo belongs here. */}
              <Pressable accessibilityRole="button"
                onPress={() => {
                  if (undoingRef.current) return;
                  undoingRef.current = true;
                  setTimeout(() => { undoingRef.current = false; }, 50);
                  model.undo(lift.exerciseId);
                  sync();
                  feedback(() => Haptics.selectionAsync());
                }}
                accessibilityLabel={fill(T('undoLastSetA11y'), { lift: lift.name })}
                hitSlop={slop(36, 6)}
                style={pressStyle(s.undo, 'quiet', still)}
              >
                <Text style={s.undoText}>{T('undo')}</Text>
              </Pressable>
              {/* Another set of THIS lift, without leaving the lift you are
                  on. Repeating a set further up the session used to mean
                  switching to it, checking the steppers, logging, and
                  switching back. It copies that lift's own last set, so it
                  repeats what happened rather than what the hero shows. */}
              <Pressable accessibilityRole="button"
                /* Asks before it logs. Copying the last set outright was
                   fast and wrong: the commonest reason to add a set to a
                   lift further up the session is that it was DIFFERENT, so
                   a silent copy recorded something that never happened. The
                   sheet opens on those numbers as a starting point. */
                onPress={() => setAddingTo(lift.exerciseId)}
                hitSlop={slop(34, 6)}
                accessibilityLabel={fill(T('addAnotherSetA11y'), { lift: lift.name })}
                style={pressStyle(s.addSet, 'surface', still)}
              >
                <Text style={s.addSetText}>+</Text>
              </Pressable>
                </>)}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </>
  );
}
