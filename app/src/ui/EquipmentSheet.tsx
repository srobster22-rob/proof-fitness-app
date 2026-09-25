/**
 * The equipment sheet on the Now screen.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import { useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import type { NowState } from './now-state.ts';
import { EQUIPMENT, type Equipment } from '../domain/types.ts';
import { ScreenModal, useExitOnce } from './ScreenModal.tsx';
import { pressStyle, useReducedMotion, onState } from './press.ts';
import { KIT_KEY } from '../domain/i18n.ts';
import { T } from './now-kit.ts';
import { s } from './now-styles.ts';

/**
 * Choose the equipment, and for a machine, which one.
 *
 * The machine field is free text because the machines in one gym are not the
 * machines in another — a fixed list would be wrong everywhere. Names already
 * used for THIS lift appear as chips, which is the whole of "save it for easy
 * access": the machines someone knows about are the ones they have logged, so
 * the list is the history rather than a second thing to maintain.
 */
/**
 * How this lift is done. No SAVE button.
 *
 * Tapping BARBELL or DUMBBELL is the whole answer, so it commits and the sheet
 * goes down — a confirm step after an unambiguous single choice is a tap spent
 * agreeing with yourself, which is exactly what §4's budget is about.
 *
 * MACHINE is the one answer that has a second half: the user asked to record
 * WHICH machine, "aka arsenal lateral raise", and to have it offered again next
 * time. So machine commits the kit immediately — the sheet is already correct at
 * that point — and stays up to offer the names it knows. Picking one, or typing
 * a new one and hitting return, closes it. Dismissing without naming one leaves
 * the kit set, which is a complete and truthful answer on its own.
 */
export function EquipmentSheet({ state, onPick, onApply, onClose, skipMachine, onSkipMachine }: {
  state: NowState;
  /** Record it and close. */
  onPick: (kit: Equipment | null, machine?: string) => void;
  /** Record it and stay up — the machine-name step. */
  onApply: (kit: Equipment | null, machine?: string) => void;
  onClose: () => void;
  /** Whether the "which one" step is switched off — see PREF_SKIP_MACHINE. */
  skipMachine: boolean;
  onSkipMachine: (skip: boolean) => void;
}) {
  const [kit, setKit] = useState<Equipment | null>(state.equipment);
  const [machine, setMachine] = useState(state.machine ?? '');
  const still = useReducedMotion();
  // `onApply` and `onSkipMachine` never close the sheet — they land a value
  // and keep the machine-name step up — so only `onClose` and `onPick`
  // (every chip that is a COMPLETE answer) need the deferred leave.
  const { closing, leave } = useExitOnce(still);
  /*
   * A typed machine name is an answer, and an answer given and then abandoned
   * is an answer thrown away -- the rule the kit chips above already follow.
   * Owner, 2026-09-10: "save the machine name on tap away". Return was the only
   * commit, so typing "Arsenal" and dismissing the keyboard or tapping outside
   * kept MACHINE and silently dropped the name. Only when it changed, so an
   * untouched field neither re-records nor buzzes.
   */
  const keepName = () => {
    if (kit === 'machine' && machine.trim() !== (state.machine ?? '')) onApply('machine', machine);
  };
  const close = () => { keepName(); leave(onClose); };
  const pick = (k: Equipment | null, m?: string) => leave(() => onPick(k, m));

  return (
    <ScreenModal visible animationType="none" transparent aria-label={T('doneOn')} exiting={closing} onRequestClose={close}>
      <Pressable style={s.backdrop} tabIndex={-1} onPress={close}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{T('doneOn')}</Text>

          <View style={s.kitRow}>
            {EQUIPMENT.map(e => (
              <Pressable
                key={e}
                // Barbell and dumbbell are complete answers, so they land and
                // close. Machine lands too, then asks which one.
                /*
                 * Barbell and dumbbell are complete answers, so they land and
                 * close. Machine lands too, then asks which one — unless the
                 * user has said not to, in which case it behaves like the other
                 * two. Tapping MACHINE a second time when it is already the
                 * chosen kit turns the question back on: the control that
                 * silenced the step is the same one that restores it, which is
                 * the only place somebody would think to look.
                 */
                onPress={() => {
                  const already = kit === e;
                  setKit(e);
                  if (e !== 'machine') return pick(e);
                  if (already && skipMachine) { onSkipMachine(false); return; }
                  if (skipMachine) return pick(e, machine);
                  onApply(e, machine);
                }}
                style={pressState => [
                  s.kitChip, kit === e && s.kitChipOn, ...pressStyle(null, 'surface', still)(pressState)
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  e === 'machine' && skipMachine
                    ? T('machineTapAgain')
                    : T(KIT_KEY[e])
                }
                {...onState(kit === e)}
              >
                <Text style={[s.kitChipText, kit === e && s.kitChipTextOn]}>
                  {T(KIT_KEY[e])}
                </Text>
              </Pressable>
            ))}
          </View>

          {kit === 'machine' && skipMachine && (
            <Text style={s.kitHint}>
              {T('notAskingMachine')}
            </Text>
          )}

          {kit === 'machine' && !skipMachine && (
            <>
              <Text style={s.kitLabel}>{T('whichOne')}</Text>
              {state.knownMachines.length > 0 && (
                <View style={s.kitRow}>
                  {state.knownMachines.map(m => (
                    <Pressable
                      key={m}
                      accessibilityLabel={m}
                      // A machine you have used before is a finished answer.
                      onPress={() => { setMachine(m); pick('machine', m); }}
                      style={pressState => [
                        s.kitChip, machine === m && s.kitChipOn,
                        ...pressStyle(null, 'surface', still)(pressState)
                      ]}
                      accessibilityRole="button"
                      {...onState(machine === m)}
                    >
                      <Text style={[s.kitChipText, machine === m && s.kitChipTextOn]}>{m}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <TextInput
                style={s.kitInput}
                value={machine}
                onChangeText={setMachine}
                // Return commits and closes; losing focus (the keyboard
                // dismissed, a tap elsewhere on the sheet) commits and stays.
                onSubmitEditing={() => pick('machine', machine)}
                onBlur={keepName}
                returnKeyType="done"
                placeholder={T('machineNamePlaceholder')}
                placeholderTextColor="#7C8792"
                autoCapitalize="words"
                accessibilityLabel={T('machineNameA11y')}
              />

              {/* Offered where the cost is being paid, not buried in settings —
                  though it is in settings too, because a preference you can only
                  reach through a sheet you are trying to stop seeing is a
                  preference you cannot undo. */}
              <Pressable accessibilityRole="checkbox"
                aria-checked={skipMachine}
                accessibilityLabel={T('dontAskAgain')}
                style={pressStyle(s.kitCheck, 'quiet', still)}
                hitSlop={8}
                onPress={() => { onSkipMachine(true); pick('machine', machine); }}
              >
                <View style={s.kitBox} />
                <Text style={s.kitCheckText}>{T('dontAskAgain')}</Text>
              </Pressable>
            </>
          )}

          {/* CLEAR survives because it is the one thing tapping a chip cannot
              say: that this lift has no equipment recorded at all. SAVE does not
              — every chip above already saved. */}
          {state.equipment !== null && (
            <View style={s.kitActions}>
              <Pressable style={pressStyle(s.kitClear, 'surface', still)} onPress={() => pick(null)} accessibilityRole="button"
                accessibilityLabel={T('clearEquipmentA11y')}>
                <Text style={s.kitClearText}>{T('clear')}</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}
