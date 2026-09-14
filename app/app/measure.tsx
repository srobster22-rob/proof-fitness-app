import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useGuardedLeave } from '../src/ui/guarded-push.ts';
import { getRepo } from '../src/data/db.ts';
import { COLUMN } from '../src/ui/column.ts';
import { TYPE, SPACING } from '../src/ui/type.ts';
import { pressStyle, useReducedMotion, onState, SELECTED, SELECTED_TEXT } from '../src/ui/press.ts';
import { buzz } from '../src/ui/haptics.ts';
import { t, fill, languageOf, dateLocale, KIND_KEY } from '../src/domain/i18n.ts';

/**
 * Every visible string on this screen, in the chosen language.
 *
 * Module scope like the other routes: the card, the two sheets and the
 * confirmations are separate components, and a `T` prop threaded through four
 * of them is how the fifth gets forgotten.
 */
const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);
import { ConfirmSheet } from '../src/ui/ConfirmSheet.tsx';
import { Spark } from '../src/ui/Spark.tsx';
import { ScreenModal } from '../src/ui/ScreenModal.tsx';
import { Arrive } from '../src/ui/Arrive.tsx';
import {
  measureRows, readingsFor, recordMeasurement, prefillFor,
  saveMeasureGoal, clearMeasureGoal, suggestTarget, monthsFrom, TARGETABLE, type KindRow
} from '../src/ui/measure-model.ts';
import {
  KINDS, formatMeasure, convertMeasure,
  type MeasurementKind, type MeasureUnit } from '../src/domain/measure.ts';

/**
 * Measurements — of the lifter, rather than of a lift.
 *
 * Reached from Progress, because it answers the same question that screen
 * does: where am I, compared with where I started. It is not a fifth
 * destination on the logging path (§5) — nothing here is needed mid-set.
 *
 * Two kinds today, bodyweight and height, and the screen is written so a third
 * is a row rather than a rewrite: everything is driven from `KINDS`.
 */
export default function Measure() {
  const repo = getRepo();
  const router = useRouter();
  const leave = useGuardedLeave(router, '/progress');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  const still = useReducedMotion();

  /*
   * R584, the same fix R581/R583 gave Goals — both halves at once, since here
   * they land in one round rather than two. `rows` below only recomputes when
   * `tick` changes, and `tick` only ever changed through this screen's own
   * actions — nothing refreshed it on ARRIVAL. `adding`/`open`/`removing`/
   * `targeting`/`clearing` are the sheet-visibility and confirm state, each
   * one closed by its own action but never by simply LEAVING and RETURNING.
   *
   * Safe today only because `leave` (`useGuardedLeave`, a pop) always
   * destroys this component on the way out, so a fresh mount always starts
   * from nothing and calls `measureRows` from scratch. Becomes real the
   * moment anything keeps this screen mounted while blurred — the tab bar
   * OWNER.md has open — the same way it would have for Goals: a restore or
   * an erase done on Progress would leave this screen showing readings that
   * no longer exist, or a confirm sheet open over one of them.
   *
   * The setters referenced here are declared further down this function
   * (`adding` through `clearing`); safe despite the textual order because the
   * closure below is not invoked until `useFocusEffect` fires, well after
   * this render pass has finished and every const in the function is
   * initialized — the same reasoning that let Goals' equivalent guard
   * reference `setTick` correctly.
   */
  useFocusEffect(useCallback(() => {
    refresh();
    setAdding(null);
    setOpen(null);
    setRemoving(null);
    setTargeting(null);
    setClearing(null);
  }, [refresh]));

  const now = Date.now();
  const rows = useMemo(() => measureRows(repo, now), [repo, tick]);
  const [adding, setAdding] = useState<MeasurementKind | null>(null);
  const [open, setOpen] = useState<MeasurementKind | null>(null);
  const [removing, setRemoving] = useState<{ id: string; label: string } | null>(null);
  const [targeting, setTargeting] = useState<MeasurementKind | null>(null);
  const [clearing, setClearing] = useState<MeasurementKind | null>(null);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Text style={s.title}>{T('you')}</Text>
        <Pressable accessibilityRole="button" onPress={leave} hitSlop={16}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('done')}>
          <Text style={s.close}>{T('done')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body}>
        {rows.map(row => (
          <KindCard
            key={row.kind}
            row={row}
            expanded={open === row.kind}
            onToggle={() => { setOpen(open === row.kind ? null : row.kind); buzz.chose(); }}
            onAdd={() => setAdding(row.kind)}
            onRemove={(id, label) => setRemoving({ id, label })}
            onTarget={() => setTargeting(row.kind)}
            onClearTarget={() => setClearing(row.kind)}
            repo={repo}
            still={still}
          />
        ))}

        {/*
          Said once, at the bottom, rather than as a badge on the bodyweight
          card. It is the reason bodyweight is worth recording at all, and a
          lifter who has never logged one has no way to know their pull-ups are
          being counted wrong.
        */}
        <Text style={s.why}>{T('whyBodyweight')}</Text>
      </ScrollView>

      {adding && (
        <AddReading
          kind={adding}
          repo={repo}
          onClose={() => setAdding(null)}
          onSaved={() => { setAdding(null); buzz.did(); refresh(); }}
        />
      )}

      {removing && (
        <ConfirmSheet
          title={T('removeReadingTitle')}
          body={fill(T('removeReadingBody'), { value: removing.label })}
          confirmLabel={T('removeItLabel')}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            repo.deleteMeasurement(removing.id);
            setRemoving(null);
            buzz.destroyed();
            refresh();
          }}
        />
      )}

      {targeting && (
        <TargetSheet
          kind={targeting}
          repo={repo}
          onClose={() => setTargeting(null)}
          onSaved={() => { setTargeting(null); buzz.did(); refresh(); }}
        />
      )}

      {clearing && (
        <ConfirmSheet
          title={T('clearTargetTitle')}
          body={T('clearTargetBody')}
          confirmLabel={T('clearItLabel')}
          onCancel={() => setClearing(null)}
          onConfirm={() => {
            clearMeasureGoal(repo, clearing);
            setClearing(null);
            buzz.destroyed();
            refresh();
          }}
        />
      )}
    </SafeAreaView>
  );
}

function KindCard({ row, expanded, onToggle, onAdd, onRemove, onTarget, onClearTarget, repo, still }: {
  row: KindRow;
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onRemove: (id: string, label: string) => void;
  onTarget: () => void;
  onClearTarget: () => void;
  repo: ReturnType<typeof getRepo>;
  still: boolean;
}) {
  const history = expanded ? readingsFor(repo, row.kind) : [];

  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <Text style={s.kindLabel} numberOfLines={1}>{T(KIND_KEY[row.kind])}</Text>
        <Pressable accessibilityRole="button" onPress={onAdd} hitSlop={12}
          style={pressStyle(s.add, 'surface', still)}
          accessibilityLabel={fill(T('recordKind'), { kind: T(KIND_KEY[row.kind]).toLowerCase() })}>
          <Text style={s.addText}>+</Text>
        </Pressable>
      </View>

      {/* Never blank: a kind with no readings says so plainly rather than
          showing a dash, which reads as a value that failed to load. */}
      <Text style={[s.value, !row.current && s.valueEmpty]}>
        {row.current ?? T('notRecorded')}
      </Text>
      {row.line && <Text style={s.line}>{row.line}</Text>}

      {/* Same shape Progress already draws for a lift's own history — a
          bodyweight's trend earns the same glance-comparable form the
          NUMBER above it cannot be. Needs two readings to draw a line
          between; a single entry has nothing to compare it against yet. */}
      {row.spark.length > 0 && (
        <View style={s.sparkRow}><Spark values={row.spark} /></View>
      )}

      {/*
        The target, when there is one: the same grammar as the Goals screen —
        a hairline of progress and a sentence with a direction. "10 lb to 175"
        is a story; a bar alone is just a shape.

        The hairline stays volt under the accent rules: it is data, not a
        control, and at 6px it cannot be mistaken for one.
      */}
      {row.goal && row.goal.fraction !== null && !row.goal.achieved && (
        <View style={s.track}>
          <View style={[s.fill, { width: `${Math.round(row.goal.fraction * 100)}%` }]} />
        </View>
      )}
      {row.goalLine && (
        <View style={s.goalRow}>
          <Text style={[s.goalText, row.goal?.achieved && s.goalDone]}>
            {row.goalLine}
          </Text>
          {row.goal && !row.goal.achieved && row.goal.daysLeft > 0 && (
            <Text style={s.goalDays}>{row.goal.daysLeft} {T('days')}</Text>
          )}
        </View>
      )}

      {/*
        SET A TARGET only appears once there is a reading, because a target
        with nothing to measure from is a number with nothing to say — the
        validator would refuse it anyway, and a door that is always locked
        should not be on the wall. Recording the first reading IS the first
        step of setting a target, and the empty card already asks for it.
      */}
      {TARGETABLE.has(row.kind) && row.current && (
        <View style={s.targetActions}>
          {row.goal ? (
            <>
              <Pressable accessibilityRole="button" onPress={onTarget} hitSlop={12}
                style={pressStyle(null, 'quiet', still)}
                accessibilityLabel={fill(T('changeKindTarget'), { kind: T(KIND_KEY[row.kind]).toLowerCase() })}>
                <Text style={s.targetAction}>{T('changeTarget')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onClearTarget} hitSlop={12}
                style={pressStyle(null, 'quiet', still)}
                accessibilityLabel={fill(T('clearKindTarget'), { kind: T(KIND_KEY[row.kind]).toLowerCase() })}>
                <Text style={s.targetAction}>{T('clearTarget')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="button" onPress={onTarget} hitSlop={12}
              style={pressStyle(null, 'quiet', still)}
              accessibilityLabel={fill(T('setKindTarget'), { kind: T(KIND_KEY[row.kind]).toLowerCase() })}>
              <Text style={s.targetAction}>{T('setATarget')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {row.trend.count > 1 && (
        <Pressable accessibilityRole="button" onPress={onToggle} hitSlop={10}
          style={pressStyle(s.historyTap, 'quiet', still)}
          accessibilityLabel={expanded
            ? T('hideReadingsA11y')
            : fill(T('showAllReadingsA11y'), { n: row.trend.count })}
          aria-expanded={expanded}>
          <Text style={s.historyText}>
            {expanded ? T('hide') : `${row.trend.count} ${T('readings')}`} {expanded ? '▴' : '▾'}
          </Text>
        </Pressable>
      )}

      {expanded && history.map(m => (
        <Arrive key={m.id}>
          <View style={s.reading}>
            <Text style={s.readingWhen}>
              {new Date(m.at).toLocaleDateString(dateLocale(languageOf(repo)),
                { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
            <Text style={s.readingValue}>{formatMeasure(m.value, m.unit)}</Text>
            <Pressable accessibilityRole="button" hitSlop={12}
              style={pressStyle(null, 'quiet', still)}
              onPress={() => onRemove(m.id, formatMeasure(m.value, m.unit))}
              accessibilityLabel={fill(T('removeReadingA11y'), { value: formatMeasure(m.value, m.unit) })}>
              <Text style={s.readingRemove}>×</Text>
            </Pressable>
          </View>
        </Arrive>
      ))}
    </View>
  );
}

function AddReading({ kind, repo, onClose, onSaved }: {
  kind: MeasurementKind;
  repo: ReturnType<typeof getRepo>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const still = useReducedMotion();
  const profile = KINDS[kind];
  const now = Date.now();
  const [unit, setUnit] = useState<MeasureUnit>(
    measureRows(repo, now).find(r => r.kind === kind)!.unit
  );
  // §4 — an empty number field is a bug. Opens on the last reading, converted
  // if the unit differs, because "about what it was" is the commonest entry.
  const [value, setValue] = useState(() => prefillFor(repo, kind, unit, now));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Same-tick double-fire guard, same shape and same reason as NowScreen's
  // loggingRef/undoingRef: recordMeasurement's id is derived from Date.now(),
  // which looked collision-safe on paper (a same-tick duplicate would upsert
  // onto its own row) but wasn't in practice — two real dispatches from one
  // physical tap took long enough in wall-clock JS execution to land in
  // different milliseconds, producing two distinct rows. Measured live:
  // "2 READINGS" after one same-tick double-click on RECORD IT.
  const savingRef = useRef(false);

  return (
    <ScreenModal visible animationType="none" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{T(KIND_KEY[kind])}</Text>

          <View style={s.entryRow}>
            <TextInput
              style={s.entry}
              value={value}
              onChangeText={t => { setValue(t.replace(/[^0-9.]/g, '').slice(0, 6)); setError(null); }}
              keyboardType="decimal-pad"
              selectTextOnFocus
              autoFocus
              accessibilityLabel={T(KIND_KEY[kind])}
            />
            {/* Both units always visible rather than a toggle that hides one:
                the choice is part of what the number MEANS, and a unit you
                have to discover is a unit somebody records in wrongly. */}
            <View style={s.units}>
              {profile.units.map(u => (
                <Pressable accessibilityRole="button"
                  key={u}
                  accessibilityLabel={fill(T('useUnitA11y'), { unit: u })}
                  {...onState(u === unit)}
                  onPress={() => {
                    // Convert what is typed, so switching units does not silently
                    // reinterpret 185 lb as 185 kg.
                    const n = Number(value);
                    if (Number.isFinite(n) && n > 0) {
                      setValue(String(convertMeasure(kind, n, unit, u)));
                    }
                    setUnit(u);
                    setError(null);
                    buzz.chose();
                  }}
                  style={pressStyle([s.unitChip, u === unit && s.unitChipOn], 'surface', still)}
                >
                  <Text style={[s.unitText, u === unit && s.unitTextOn]}>{u.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Text style={s.sheetLabel}>{T('note')}</Text>
          <TextInput
            style={s.note}
            value={note}
            onChangeText={setNote}
            placeholder={T('notePlaceholder')}
            placeholderTextColor="#7C8792"
            maxLength={140}
            accessibilityLabel={T('noteForReadingA11y')}
          />

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable accessibilityRole="button" style={pressStyle(s.save, 'primary', still)}
            accessibilityLabel={T('recordIt')}
            onPress={() => {
              if (savingRef.current) return;
              savingRef.current = true;
              setTimeout(() => { savingRef.current = false; }, 50);
              const r = recordMeasurement(repo, kind, value, unit, Date.now(), note);
              if (!r.ok) { savingRef.current = false; return setError(r.error ?? T('couldNotSave')); }
              onSaved();
            }}
          >
            <Text style={s.saveText}>{T('recordIt')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

const DAY = 86_400_000;
const HORIZONS = [3, 6, 12] as const;

/**
 * Setting or changing a target. Same bones as `AddReading` on purpose — one
 * number, the same unit chips, one primary action — so the second sheet on
 * this screen costs nothing to learn.
 *
 * The horizon is three chips rather than a date picker: a bodyweight target is
 * a season-scale intention, and offering day-level precision would imply the
 * app can hold anyone to a Tuesday. The date it resolves to is printed, so the
 * choice is still concrete (§16).
 */
function TargetSheet({ kind, repo, onClose, onSaved }: {
  kind: MeasurementKind;
  repo: ReturnType<typeof getRepo>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const profile = KINDS[kind];
  const now = Date.now();
  const [unit, setUnit] = useState<MeasureUnit>(
    measureRows(repo, now).find(r => r.kind === kind)!.unit
  );
  // §4 — opens on the existing target, or a round number a short step from
  // where they are. A starting point for the stepper, never advice.
  const [value, setValue] = useState(() => suggestTarget(repo, kind, unit, now));
  const [months, setMonths] = useState<number>(6);
  const [error, setError] = useState<string | null>(null);
  const still = useReducedMotion();
  // Real calendar months, so the date agrees with the chip that chose it.
  // See `monthsFrom` for what the arithmetic used to be and why it changed.
  const targetDate = monthsFrom(now, months);

  return (
    <ScreenModal visible animationType="none" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{T(KIND_KEY[kind])} {T('targetSuffix')}</Text>

          <View style={s.entryRow}>
            <TextInput
              style={s.entry}
              value={value}
              onChangeText={t => { setValue(t.replace(/[^0-9.]/g, '').slice(0, 6)); setError(null); }}
              keyboardType="decimal-pad"
              selectTextOnFocus
              autoFocus
              accessibilityLabel={fill(T('kindTargetA11y'), { kind: T(KIND_KEY[kind]) })}
            />
            <View style={s.units}>
              {profile.units.map(u => (
                <Pressable accessibilityRole="button"
                  key={u}
                  accessibilityLabel={fill(T('useUnitA11y'), { unit: u })}
                  {...onState(u === unit)}
                  onPress={() => {
                    const n = Number(value);
                    if (Number.isFinite(n) && n > 0) {
                      setValue(String(convertMeasure(kind, n, unit, u)));
                    }
                    setUnit(u);
                    setError(null);
                    buzz.chose();
                  }}
                  style={pressStyle([s.unitChip, u === unit && s.unitChipOn], 'surface', still)}
                >
                  <Text style={[s.unitText, u === unit && s.unitTextOn]}>{u.toUpperCase()}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Text style={s.sheetLabel}>{T('by')}</Text>
          <View style={s.horizons}>
            {HORIZONS.map(m => (
              <Pressable accessibilityRole="button"
                key={m}
                onPress={() => { setMonths(m); buzz.chose(); }}
                style={pressStyle([s.horizonChip, m === months && s.unitChipOn], 'surface', still)}
                accessibilityLabel={fill(T('nMonthsA11y'), { n: m })}
                {...onState(m === months)}
              >
                <Text style={[s.unitText, m === months && s.unitTextOn]}>{m} {T('monthsShort')}</Text>
              </Pressable>
            ))}
            <Text style={s.horizonDate}>
              {new Date(targetDate).toLocaleDateString(dateLocale(languageOf(repo)), { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
          </View>

          {error && <Text style={s.error}>{error}</Text>}

          <Pressable accessibilityRole="button" style={pressStyle(s.save, 'primary', still)}
            accessibilityLabel={T('setTarget')}
            onPress={() => {
              const r = saveMeasureGoal(repo, kind, value, unit, targetDate, Date.now());
              if (!r.ok) return setError(r.error ?? T('couldNotSave'));
              onSaved();
            }}
          >
            <Text style={s.saveText}>{T('setTarget')}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

const VOLT = '#CCFF00';
const MUTED = '#7C8792';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  // R341: same header idiom found overflowing on Settings at 2.35x Dynamic
  // Type — DONE pushed past the screen's right edge by the title. Same fix.
  header: {
    ...COLUMN,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18, flexWrap: 'wrap'
  },
  title: { color: '#fff', fontSize: TYPE.title, fontWeight: '900', letterSpacing: SPACING.micro },
  close: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  body: { ...COLUMN, paddingHorizontal: 24, paddingBottom: 40 },

  card: {
    backgroundColor: '#0E1114', borderRadius: 16, padding: 18, marginBottom: 14,
    borderWidth: 1, borderColor: '#181D22'
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kindLabel: {
    color: MUTED, fontSize: TYPE.label, fontWeight: '800',
    letterSpacing: SPACING.micro, flexShrink: 1
  },
  add: {
    minWidth: 44, height: 34, borderRadius: 10, flexShrink: 0,
    borderWidth: 1, borderColor: '#243039', backgroundColor: '#101519',
    alignItems: 'center', justifyContent: 'center'
  },
  addText: { color: VOLT, fontSize: 18, fontWeight: '900', marginTop: -2 },

  value: { color: '#fff', fontSize: 38, fontWeight: '900', marginTop: 10 },
  // Smaller when it is a sentence rather than a number, so an empty card does
  // not shout a non-answer at the size a real reading gets.
  valueEmpty: { fontSize: TYPE.lead, fontWeight: '600', color: MUTED, marginTop: 12 },
  line: { color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '600', marginTop: 8 },
  sparkRow: { marginTop: 14 },

  historyTap: { alignSelf: 'flex-start', paddingVertical: 12, marginTop: 4 },
  historyText: { color: MUTED, fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro },

  reading: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#161B20'
  },
  readingWhen: { color: MUTED, fontSize: TYPE.meta, flexGrow: 1, flexShrink: 1 },
  readingValue: { color: '#E8EAED', fontSize: TYPE.body, fontWeight: '700' },
  readingRemove: { color: MUTED, fontSize: TYPE.lead, fontWeight: '700', paddingHorizontal: 4 },

  why: { color: MUTED, fontSize: TYPE.meta, lineHeight: 19, marginTop: 10 },

  track: {
    height: 6, borderRadius: 3, backgroundColor: '#1A2026',
    marginTop: 14, overflow: 'hidden'
  },
  fill: { height: '100%', backgroundColor: VOLT, borderRadius: 3 },
  goalRow: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', gap: 10, marginTop: 8
  },
  goalText: { color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '600', flexShrink: 1 },
  goalDone: { color: VOLT, fontWeight: '800' },
  goalDays: { color: MUTED, fontSize: TYPE.meta, fontWeight: '700', flexShrink: 0 },
  // R341: found at 2.35x Dynamic Type — CHANGE TARGET and CLEAR/SET A
  // TARGET have no shrink or wrap, so the second action overflows the
  // screen's right edge once its own label grows (measured: CLEAR's right
  // edge past x375 on a 320px phone). Same fix as the Now/Progress rows —
  // costs nothing at normal scale, degrades to a second line at extreme.
  targetActions: { flexDirection: 'row', gap: 22, marginTop: 6, flexWrap: 'wrap' },
  targetAction: {
    color: MUTED, fontSize: TYPE.micro, fontWeight: '800',
    letterSpacing: SPACING.micro, paddingVertical: 10
  },

  horizons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  horizonChip: {
    minWidth: 64, height: 48, borderRadius: 12, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#232A31',
    alignItems: 'center', justifyContent: 'center'
  },
  // The date the chips resolve to — the concrete answer beside the round one.
  horizonDate: { color: MUTED, fontSize: TYPE.meta, fontWeight: '600', marginLeft: 6 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 30, maxHeight: '86%'
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: '#2A323A',
    alignSelf: 'center', marginBottom: 18
  },
  sheetTitle: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  sheetLabel: {
    color: MUTED, fontSize: TYPE.micro, fontWeight: '800',
    letterSpacing: SPACING.micro, marginTop: 20, marginBottom: 8
  },

  entryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  entry: {
    /*
     * `minWidth: 0` is the whole fix. A flex item will not shrink below its
     * own content width unless told it may, and a TextInput's intrinsic
     * width is generous — so on a 390px sheet the LB and KG chips were
     * pushed to x554, entirely off the screen, with the input claiming the
     * space.
     *
     * This is a RECURRING PATTERN, not a single incident — goals.tsx's
     * filterScroll and NowScreen.tsx's hero weight input (R448) needed the
     * identical fix, the second of those found only by rendering at a real
     * phone width and measuring where the sibling button actually landed.
     * An earlier version of this comment counted instances ("the third
     * time") and the count went stale the moment a fourth one was found
     * elsewhere — the number is not maintainable, the RULE is: any
     * `TextInput` whose box is not explicitly bounded (a fixed `width`, or
     * `flexShrink: 1` + `minWidth: 0` on both the input and any wrapper
     * between it and the row) is a candidate, especially at a large font
     * size where "generous intrinsic width" becomes hundreds of real
     * pixels. Check by typing a realistic worst-case value at 390px and
     * measuring the sibling's `getBoundingClientRect()` — reading the
     * layout code is not sufficient, because RN's default flex-shrink is 0
     * and small-font inputs can look safe on paper while a large-font one
     * with the identical structure is not.
     */
    flexGrow: 1, flexShrink: 1, minWidth: 0, height: 68, paddingHorizontal: 16,
    backgroundColor: '#111417', borderRadius: 14,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 34, fontWeight: '900'
  },
  units: { flexDirection: 'row', gap: 8, flexShrink: 0 },
  unitChip: {
    minWidth: 52, height: 68, borderRadius: 14, paddingHorizontal: 12,
    borderWidth: 1, borderColor: '#232A31',
    alignItems: 'center', justifyContent: 'center'
  },
  unitChipOn: SELECTED,
  unitText: { color: '#C3CBD2', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  unitTextOn: SELECTED_TEXT,

  note: {
    height: 52, paddingHorizontal: 14,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', color: '#E8EAED', fontSize: TYPE.lead
  },
  error: { color: '#FF8A8A', fontSize: TYPE.body, marginTop: 14, fontWeight: '600' },
  save: {
    backgroundColor: VOLT, borderRadius: 16, height: 60,
    alignItems: 'center', justifyContent: 'center', marginTop: 22
  },
  saveText: { color: '#000', fontSize: TYPE.lead, fontWeight: '900', letterSpacing: SPACING.micro }
});
