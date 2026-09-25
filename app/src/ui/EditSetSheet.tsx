/**
 * The sheet that edits a logged set, on the Now screen.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { MAX_TYPED_WEIGHT } from './now-steppers.ts';
import { type LoggedSet, type Unit } from '../domain/types.ts';
import { ScreenModal, useExitOnce } from './ScreenModal.tsx';
import { pressStyle, useReducedMotion } from './press.ts';
import { t, fill, number } from '../domain/i18n.ts';
import { T } from './now-kit.ts';
import { s } from './now-styles.ts';

/**
 * The picker. §7: never a 200-item library on the logging path — `pickerFor()`
 * hands back their own lifts, ranked, or the starting twelve before there is
 * history. Search is the "add a new exercise" path and is deliberately not here.
 */
/**
 * Fixing a set that is already logged, and saying something about it.
 *
 * Two things live here because they are the same moment: you look back at a set
 * either because a number is wrong or because you want to record something the
 * numbers do not hold — which notch the machine was on, what the RIR felt like,
 * the tempo. Splitting them into two sheets would mean two ways in for one
 * intention.
 *
 * The note is one free-text field rather than fields for RIR, tempo and the
 * rest. The app cannot know what a lifter needs to write down, and guessing
 * gets three inputs that are empty 95% of the time plus the one thing they
 * actually wanted to say with nowhere to go.
 *
 * REMOVE is here and nowhere else now. Tapping a set used to arm it for
 * destruction, which made "I typed 145 instead of 155" cost the set its place
 * in the session — it came back at the END, with a new time.
 */
export function EditSetSheet({
  set, unit, onClose, onSave, onRemove, adding
}: {
  set: LoggedSet;
  unit: Unit;
  onClose: () => void;
  onSave: (patch: { weight: number; reps: number; note: string | null }) => void;
  /** Absent when adding — a set that does not exist yet cannot be removed. */
  onRemove?: () => void;
  /** Collecting a NEW set rather than fixing one that is already logged. */
  adding?: boolean;
}) {
  const [weight, setWeight] = useState(String(set.weight));
  const [reps, setReps] = useState(String(set.reps));
  /* A new set starts with a blank note. Carrying the last one forward would
     put "RIR 2" on a set nobody has done yet, which is a made-up fact (§16). */
  const [note, setNote] = useState(adding ? '' : (set.note ?? ''));
  const still = useReducedMotion();
  const { closing, leave } = useExitOnce(still);
  const close = () => leave(onClose);
  const save = (patch: { weight: number; reps: number; note: string | null }) => leave(() => onSave(patch));
  const remove = onRemove ? () => leave(onRemove) : undefined;

  const w = Number(weight);
  const r = Number(reps);
  // A blank weight is legal — it is a bodyweight set. A blank rep count is not.
  // The ceiling matches the hero field's own typed-weight guard (§ typo
  // guard, not a judgement) — this field had none of its own, despite being
  // the one used to CORRECT a set, and a 6-character text cap alone still
  // allows "999999" to save.
  const ok = Number.isFinite(w) && w >= 0 && w <= MAX_TYPED_WEIGHT && Number.isInteger(r) && r >= 1;

  return (
    <ScreenModal visible animationType="none" transparent aria-label={T(adding ? 'addASet' : 'editSet')} exiting={closing} onRequestClose={close}>
      <Pressable style={s.backdrop} tabIndex={-1} onPress={close}>
        <Pressable style={s.editSheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <Text style={s.editTitle}>{T(adding ? 'addASet' : 'editSet')}</Text>

          <View style={s.editRow}>
            <View style={s.editField}>
              <Text style={s.editLabel}>{fill(T('weightUnitLabel'), { unit: unit.toUpperCase() })}</Text>
              <TextInput
                style={s.editInput}
                value={weight}
                onChangeText={t => setWeight(t.replace(/[^0-9.]/g, '').slice(0, 6))}
                keyboardType="decimal-pad"
                selectTextOnFocus
                accessibilityLabel={T('weight')}
              />
            </View>
            <View style={s.editField}>
              <Text style={s.editLabel}>{T('repsLabel')}</Text>
              <TextInput
                style={s.editInput}
                value={reps}
                /* Three digits here too — see the hero's rep field. */
                onChangeText={t => setReps(t.replace(/[^0-9]/g, '').slice(0, 3))}
                keyboardType="number-pad"
                selectTextOnFocus
                accessibilityLabel={T('reps')}
              />
            </View>
          </View>

          <Text style={s.editLabel}>{T('note')}</Text>
          <TextInput
            style={s.editNote}
            value={note}
            onChangeText={setNote}
            placeholder={T('notePlaceholderSet')}
            placeholderTextColor="#7C8792"
            multiline
            maxLength={280}
            accessibilityLabel={T('noteForSetA11y')}
          />

          <Pressable
            accessibilityRole="button"
            style={pressState => [
              s.editSave, !ok && s.editSaveOff, ...pressStyle(null, 'primary', still)(pressState)
            ]}
            disabled={!ok}
            accessibilityLabel={T(adding ? 'logIt' : 'saveSet')}
            onPress={() => save({ weight: w, reps: r, note: note.trim() || null })}
          >
            <Text style={s.editSaveText}>{T(adding ? 'logIt' : 'saveSet')}</Text>
          </Pressable>

          {/* Destructive, so it is the quiet one and it is last. Absent when
              adding: there is nothing yet to remove. */}
          {remove && (
            <Pressable accessibilityRole="button" style={pressStyle(s.editRemove, 'quiet', still)}
              onPress={remove}
              accessibilityLabel={T('removeSet')}>
              <Text style={s.editRemoveText}>{T('removeSet')}</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}
