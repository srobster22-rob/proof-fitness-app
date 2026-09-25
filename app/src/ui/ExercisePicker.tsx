/**
 * The exercise picker on the Now screen.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import { useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { splitPickerGroups } from './now-model.ts';
import type { NowState } from './now-state.ts';
import { type Exercise } from '../domain/types.ts';
import { ScreenModal, useExitOnce } from './ScreenModal.tsx';
import { pressStyle, useReducedMotion, slop, onState } from './press.ts';
import { fill, DAY_TITLE_KEY } from '../domain/i18n.ts';
import { T } from './now-kit.ts';
import { s } from './now-styles.ts';

export function ExercisePicker({
  state, onPick, search, onAdd, onClose, onRemove
}: {
  state: NowState;
  onPick: (id: string) => void;
  search: (query: string) => Exercise[];
  onAdd: (name: string) => boolean;
  onClose: () => void;
  onRemove: (id: string) => boolean;
}) {
  const [adding, setAdding] = useState(false);
  // Set only on a refused removal (a lift with sets already logged against
  // it) — a successful one just makes the row disappear, which says enough.
  const [removeError, setRemoveError] = useState<string | null>(null);
  /*
   * Ids already removed this sheet-open. Measured live: two real
   * pointerdown/mousedown/pointerup/mouseup/click sequences at the × button's
   * exact screen coordinates, with no gap between them, land on the same
   * pre-render DOM node — the row has not yet disappeared to take the second
   * tap's target away. `onRemove`'s own repo-level guard makes the second
   * call harmless to the DATA (it correctly finds the row already gone and
   * returns false), but the UI could not tell "already gone" from "refused
   * because it has sets" and showed 'Can't remove it — it already has sets
   * logged' for an exercise that had, in fact, just been removed
   * successfully by the first tap. A `useRef` set, checked before either
   * call reaches `onRemove` at all, so the second tap is a no-op rather than
   * a false alarm.
   */
  const removedIds = useRef(new Set<string>());
  const [name, setName] = useState('');
  /*
   * The sheet opens on the day being trained. `pickerGroups` is already ordered
   * with that day first (R33), so "this day" is simply the groups that belong
   * to it — plus the day-less YOURS group, which is the user's own movements
   * and never something to hide from them.
   */
  const [allDays, setAllDays] = useState(false);
  const { thisDay, others: hidden } = splitPickerGroups(state.pickerGroups, state.planDay);
  const shown = allDays ? state.pickerGroups : thisDay;
  const still = useReducedMotion();
  const { closing, leave: exitLeave } = useExitOnce(still);
  // The extra reset (closing the inline "add a movement" field, if it was
  // open) still runs synchronously, exactly as before — only `fire` itself
  // is deferred to the exit animation's timer. Gated on exitLeave's own
  // return value so it only runs on the call that actually starts closing,
  // not on a same-tick repeat that the shared guard already rejected.
  const leave = (fire: () => void) => {
    if (exitLeave(fire)) { setAdding(false); setName(''); }
  };
  const close = () => leave(onClose);
  const pick = (id: string) => leave(() => onPick(id));
  /*
   * `onAdd` returns false only for a blank name — `addCustomExercise` returns
   * null for exactly that case and nothing else (a DUPLICATE name selects the
   * existing exercise and still succeeds). The submit button below is
   * already `disabled={!name.trim()}`, so the only way to reach a false here
   * is the return key on an empty field. Guarding on the same condition
   * BEFORE deferring means the deferred call can be unconditional — this
   * sheet never needs `onAdd`'s answer back synchronously, which is what
   * kept it out of the exit-animation pass everywhere else.
   */
  const submit = () => { if (name.trim()) leave(() => onAdd(name)); };
  // What the typed name matches, anywhere in the library (R683).
  const matches = adding ? search(name) : [];

  return (
    // `animationType="none"`, and it is not a style preference.
    //
    // On react-native-web the "slide" animation is a 0.3s keyframe with
    // `animation-fill-mode: none`, so when it finishes the element REVERTS to
    // its base transform — `translateY(100%)`. The whole sheet then sits one
    // full viewport below the screen: measured `transform: matrix(1,0,0,1,0,812)`
    // on an 812px window, with `inset: 0` and nothing visible.
    //
    // It had been that way since the picker was built, because every check ran
    // on synthetic pointer events, and those hit an element whether or not a
    // human could see it. Thirty rounds of "verified live" never once looked.
    <ScreenModal visible animationType="none" transparent aria-label={state.loggedThisSession.length === 0 ? T('startWith') : T('switchTo')} exiting={closing} onRequestClose={close}>
      <Pressable style={s.backdrop} tabIndex={-1} onPress={close}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>
              {state.loggedThisSession.length === 0 ? T('startWith') : T('switchTo')}
            </Text>
            {/* Naming the day is the app showing its work: the order of this
                sheet and the UP NEXT suggestion both follow from it, and an
                unexplained reordering is just a list that moved. */}
            {state.day && <Text style={s.sheetDay}>{T(DAY_TITLE_KEY[state.day])}</Text>}
          </View>

          {/* The indicator is ON here, alone in this screen, and it is not a
              style slip. This list genuinely outgrows the sheet — `pickerFor`
              returns up to twelve ranked movements plus every one the user
              invented, and four split headings on top — so it will always be
              able to run past any cap. A list cut off with no indicator does
              not read as "scroll me", it reads as the whole library, which is
              how an entire day's lifts went missing. §15 bans nav chrome
              competing with content; this is the content telling the truth
              about its own size. */}
          <ScrollView showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {/* Grouped by split day, the day being trained first. This is the
                whole of "show me what goes with what": a beginner opening the
                sheet mid-push-day sees the push movements together and at the
                top, instead of twelve names in an order with no reason behind
                it. The other days stay visible below — hiding them would make
                this a filter, and a filter is a mode to get stuck in. */}
            {shown.map(group => (
              <View key={group.label}>
                <Text style={[s.groupLabel, group.day === state.day && s.groupLabelLead]}>
                  {group.label}
                </Text>
                {group.exercises.map(ex => {
                  const current = ex.id === state.exercise.id;
                  // Only YOURS (day === null) ever offers removal — a
                  // built-in is not this user's to remove, and the current
                  // lift is excluded so this sheet never has to decide what
                  // to show in its place (see `removeCustomExercise`).
                  const removable = group.day === null && !current;
                  return (
                    <Pressable accessibilityRole="button"
                      key={ex.id}
                      accessibilityLabel={ex.name}
                      {...onState(current)}
                      onPress={() => pick(ex.id)}
                      style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}
                    >
                      <Text style={[s.pickName, current && s.pickCurrent]} numberOfLines={1}>
                        {ex.name}
                      </Text>
                      {current && <Text style={s.pickDot}>●</Text>}
                      {removable && (
                        <Pressable accessibilityRole="button"
                          // §4's 56px floor (`HIT`/`TARGET`) — the same rule
                          // `touch-targets.test.ts` measured six other controls
                          // against. Drawn at ~26pt (18pt line height + 8pt
                          // vertical padding); alone on the row's trailing
                          // edge like the equipment tag, so no neighbour gap
                          // to respect.
                          hitSlop={slop(26)}
                          accessibilityLabel={fill(T('removeExerciseA11y'), { name: ex.name })}
                          onPress={e => {
                            e.stopPropagation();
                            if (removedIds.current.has(ex.id)) return;
                            const ok = onRemove(ex.id);
                            if (ok) removedIds.current.add(ex.id);
                            setRemoveError(ok ? null : T('cannotRemoveExercise'));
                          }}
                          style={({ pressed }) => [s.pickRemove, pressed && { opacity: 0.5 }]}
                        >
                          <Text style={s.pickRemoveText}>×</Text>
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            {/* The other days, behind one deliberate tap.
                §7 makes selection a prediction problem, and the prediction is
                the DAY: on push day, leg movements are not near-misses, they
                are noise — twelve rows to scroll past to reach the four that
                could plausibly be next. Hiding them is not hiding the library;
                it is refusing to ask the user to filter it themselves every
                time they switch a lift mid-workout.

                Movements the user invented have no day and are never hidden:
                they are already "going out of your way to add". */}
            {hidden.length > 0 && (
              <Pressable
                onPress={() => setAllDays(v => !v)}
                style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}
                accessibilityRole="button"
                accessibilityLabel={allDays
                  ? T('onlyThisDay')
                  : fill(T('otherDaysCount'), { n: hidden.reduce((n, g) => n + g.exercises.length, 0) })}
              >
                <Text style={s.otherDays}>
                  {allDays
                    ? T('onlyThisDay')
                    : fill(T('otherDaysCount'), { n: hidden.reduce((n, g) => n + g.exercises.length, 0) })}
                </Text>
              </Pressable>
            )}

          </ScrollView>

          {/* §7 — the ONLY place a keyboard appears in this app, and it is
              behind a tap on the least-used control on the least-used sheet.
              Adding a movement is rare; logging is not.

              It sits BELOW the scroll rather than at the end of it. Inside the
              list it was the nineteenth row, measured at y 1068 on an 812px
              screen: to add a movement you first had to scroll past every
              movement you were not looking for. Grouping the list by split day
              added three headings and pushed it further down still. Pinned
              here it costs no space, never moves as the library grows, and
              stays as quiet as §7 wants it to be.
              */}
            {removeError && <Text style={s.removeError} accessibilityRole="alert">{removeError}</Text>}
            {/* The movements the typed name matches, right above the field,
                where a lifter looks while typing. A tap picks one; ADD is left
                for a movement the library does not have (R683). The sheet has
                no keyboard avoidance yet, which a native build will need. */}
            {matches.length > 0 && <Text style={s.groupLabel}>{T('matchesHeading')}</Text>}
            {matches.map(ex => (
              <Pressable accessibilityRole="button" key={`match-${ex.id}`} accessibilityLabel={ex.name}
                {...onState(ex.id === state.exercise.id)}
                onPress={() => pick(ex.id)}
                style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}>
                <Text style={[s.pickName, ex.id === state.exercise.id && s.pickCurrent]} numberOfLines={1}>
                  {ex.name}
                </Text>
              </Pressable>
            ))}
            {adding ? (
              <View style={s.addRow}>
                <TextInput
                  style={s.addInput}
                  value={name}
                  onChangeText={setName}
                  placeholder={T('movementNamePlaceholder')}
                  placeholderTextColor="#7C8792"
                  autoFocus
                  autoCapitalize="words"
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
                <Pressable accessibilityRole="button" onPress={submit}
                  accessibilityLabel={T('addLabel')}
                  style={pressStyle(s.addGo, 'quiet', still)} disabled={!name.trim()}>
                  <Text style={[s.addGoText, !name.trim() && { color: '#7C8792' }]}>{T('addLabel')}</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setAdding(true)}
                accessibilityLabel={T('somethingElse')}
                style={({ pressed }) => [s.pickRow, pressed && { backgroundColor: '#12161A' }]}>
                <Text style={s.addPrompt}>{T('somethingElse')}</Text>
              </Pressable>
            )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}
