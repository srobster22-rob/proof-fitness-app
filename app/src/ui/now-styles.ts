/**
 * The Now screen's stylesheet, shared by the screen and its sheets.
 *
 * Moved verbatim out of NowScreen.tsx (R698).
 */
import { StyleSheet } from 'react-native';
import { HIT, RAIL_CHIP } from './now-layout.ts';
import { COLUMN } from './column.ts';
import { TYPE, SPACING } from './type.ts';
import { SELECTED, SELECTED_TEXT } from './press.ts';
import { BG, LAST_TIME_LINE, MUTED, VOLT } from './now-kit.ts';

export const s = StyleSheet.create({
  root: {                                                 // maxWidth from layoutFor
    flex: 1, width: '100%', alignSelf: 'center',
    // 8, not more. R511 raised this to 16 for the breathing room OWNER.md asks
    // for, and R512 found what that cost: the shortest shipping phone (568px)
    // has no 8px to give — the unshrinkable column came to 624 against 568 and
    // LOG SET went below the fold. Air at the top has to come from layoutFor's
    // scaled gaps, which shrink on a short screen, not from a fixed padding
    // that does not.
    backgroundColor: BG, paddingHorizontal: 20, paddingTop: 8
  },
  /*
   * R339: found at 2.35x Dynamic Type (iOS's largest accessibility size) —
   * this row has no flexShrink and no wrap, so PROGRESS / GOALS / the streak
   * / the gear simply overflow the screen's right edge once their own text
   * grows past what `space-between` has room for. Nothing errors; the gear
   * — the only route to Settings from this screen — just renders off-screen
   * and becomes unreachable. `flexWrap` costs nothing at normal scale
   * (unchanged, still one line, still the exact spacing the comment above
   * measured) and turns "unreachable" into "a second line" at extreme scale.
   */
  /*
   * `flex-start`, not `center`.
   *
   * Centring was inert in the good case and actively harmful in the bad one.
   * `todayWrap` below is `flex: 1`, so it already absorbs every spare pixel —
   * there is never any free space left for `justifyContent` to distribute, and
   * centring changed nothing on a screen that fits.
   *
   * On a screen that does NOT fit, it decided where the overflow went, and it
   * split it both ways. Measured at 281x460: the column came to 401px in a 391px
   * container, and the 10px difference put the exercise name at y34 — above the
   * container's own top at y39 — drawing it straight over the PROGRESS / GOALS
   * links. Ten pixels of overflow produced overlapping text at the very top of
   * the screen, which is what "it doesn't fit" looks like.
   *
   * So the alignment follows whether there is room: centred while there is, and
   * top-aligned once there is not, where overflow can only go DOWNWARD into
   * `todayWrap`'s `overflow: hidden` and the footer — the two parts designed to
   * give. `flex-start` unconditionally was the first attempt and it was wrong in
   * the other direction: on a 375x812 phone the column collapsed to the top and
   * left 340px of dead space under it.
   *
   * `todayMin === 0` is the signal, and it is the model's own: `layoutFor`
   * hands TODAY whatever space remains after everything that cannot shrink, so
   * zero means the screen is already out of room.
   */
  content: { flex: 1, justifyContent: 'center' },
  contentTight: { justifyContent: 'flex-start' },
  contentScroll: { flex: 1 },
  header: { alignItems: 'center' },                       // marginBottom from layoutFor
  // The stretch has to be on the PRESSABLE, not on the Text inside it.
  // `numberOfLines={1}` can only ellipsize against a definite width, and the
  // header's `alignItems: center` sizes the Pressable to its content — so the
  // Text was measured inside an unbounded parent whatever was set on it.
  // "Romanian Deadlift From A Deficit" came out 491px wide on a 375px screen,
  // hanging off BOTH edges. `maxWidth: '100%'` on the Text did not bind either.
  exerciseTap: { flex: 1, minWidth: 0 },
  // The name keeps the width it had and the streak takes only what its own
  // text needs, so a long lift still ellipsizes instead of pushing it off.
  exerciseLine: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12 },
  exerciseRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Sized off the name rather than the label scale: it belongs to the
  // heading it marks, not to the chrome around it.
  exerciseCaret: { color: '#7C8792', fontSize: 15, fontWeight: '700', marginTop: 2 },
  /*
   * R511, on the owner's note that the screen 'looks a little sloppy and
   * AI-generated'. This was 22px with letterSpacing 2 -- the exact treatment
   * used by `railLabel` and every other CHROME label on the screen,
   * only bigger. Wide tracking on a short all-caps string reads as a category
   * heading, so the one thing the screen is actually about was dressed as
   * furniture, and nothing on the page claimed the top of the hierarchy.
   *
   * A name, now: tracked at 0.6 rather than 2, which is where a title sits in
   * every fitness app worth comparing against. The labels around it keep their
   * wide tracking, so 'this is the thing' and 'this is a label' are told apart
   * by the TYPE rather than by size.
   *
   * The size deliberately does not move. 26 was tried and is wrong: `L.hero`
   * floors at 24, so on the smallest viewport a 26px name would outgrow the
   * weight itself and take the top of the hierarchy from the number §4 puts at
   * the centre of the screen. Anything at or above 24 is the same bug.
   */
  exercise: {
    color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.6,
    textAlign: 'center'
  , flexShrink: 1},
  // `alignSelf: 'stretch'` for the same reason `exerciseTap` needs it:
  // numberOfLines can only ellipsize against a DEFINITE width, and a
  // shrink-to-fit Text in a centred column has none. `textAlign` keeps it
  // looking exactly as it did while it was shrink-to-fit and centred.
  /*
   * Volt, because a streak is the one thing on this screen that is news, and
   * small, because §15 spends the accent without letting it compete with the
   * hero. Sized at `label` so the row's height is still set by the gear.
   */
  streak: {
    color: VOLT, fontSize: TYPE.label, fontWeight: '900', letterSpacing: SPACING.label
  },
  // One 20px row (the line's measured height, which the fit math counts):
  // what does not fit on it wraps below and is clipped (R684).
  lastTime: {
    marginTop: 8, height: LAST_TIME_LINE, overflow: 'hidden', alignSelf: 'stretch',
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center'
  },
  lastTimeText: {
    color: MUTED, fontSize: TYPE.lead, lineHeight: LAST_TIME_LINE, fontWeight: '500', flexShrink: 1
  },
  // The "   ·   " the model puts before the goal, as a margin: a line's leading
  // spaces vanish on web, and its own Text starts one.
  lastTimeTail: { marginLeft: 5 },
  lastTimeHit: { color: VOLT, fontWeight: '800' },

  heroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  /*
   * `flexShrink: 1, minWidth: 0` — the same fix, the fourth time this exact
   * bug has appeared (measure.tsx's entry field, goals.tsx's filterScroll,
   * and now here). `L.hero`'s font size is computed in layoutFor to fit the
   * COMMITTED weight's digit count, which is capped at 4 by domain rules
   * (MAX_TYPED_WEIGHT caps a committed value at 1500) — but the TYPED text
   * while the user is mid-entry can run to 6 raw digits (TYPED_MAX) before
   * `typedWeight` ever validates it, at the SAME large font size. Measured
   * live at a real 390px width: typing '999999' pushed the '+' weight
   * stepper to x944 — off the visible screen and completely untappable,
   * not merely visually wrong.
   */
  heroNumbers: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, minWidth: 0 },
  weight: { color: '#fff', fontWeight: '900', letterSpacing: -3 },
  unit: { color: VOLT, fontSize: 24, fontWeight: '900', marginLeft: 6 },
  unitFloat: { position: 'absolute', left: '100%', bottom: 0 },
  // A word, not a unit: smaller, and left to wrap in the space the unit had.
  unitWord: { fontSize: 11, letterSpacing: 1, width: 62, marginLeft: 8 },
  stepHint: { color: '#7C8792', fontSize: 12, textAlign: 'center', marginTop: -4, letterSpacing: 1 },
  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  /** Fixed-width slot, so each row stays symmetrical about its number. */
  jumpSlot: { width: 40, alignItems: 'center' },
  jump: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center'
  },
  jumpText: { color: MUTED, fontSize: 12, fontWeight: '800' },
  planRow: {
    paddingVertical: 18, paddingHorizontal: 16, borderRadius: 12, marginTop: 10,
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417'
  },
  planRowOn: { borderColor: VOLT },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  planTick: { color: VOLT, fontSize: 15, fontWeight: '900' },
  planText: { color: '#E8EAED', fontSize: 15, fontWeight: '800', letterSpacing: 1.2 },
  /*
   * Two lines of room, always.
   *
   * Measured at 390px: the push/pull/legs and upper/lower blurbs wrap to two
   * lines and FULL BODY's fits on one, so the three options came out 100, 100
   * and 82px — a set of three choices where the last one looks like it did not
   * finish loading. Trimming the copy to one line each was the other option and
   * a worse one: these sentences exist so a beginner is not given a vocabulary
   * test, and "push, then pull, then legs" cannot explain push/pull/legs.
   *
   * So the blurb keeps its own height rather than the text deciding it. The
   * shortest option gets a little air under it, which reads as spacing; the
   * ragged set read as a bug.
   */
  planBlurb: {
    color: '#7C8792', fontSize: 12, lineHeight: 18, marginTop: 6, fontWeight: '500',
    minHeight: 36
  },
  planTextOn: { color: VOLT },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  planSwap: { color: '#9AA5AF', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  dayRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  dayChip: {
    flex: 1, height: 84, borderRadius: 14,
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6
  },
  dayChipWide: { height: 72 },
  dayChipText: { color: '#E8EAED', fontSize: 14, fontWeight: '900', letterSpacing: 1.2 },
  skip: { alignSelf: 'center', marginTop: 20, paddingVertical: 8 },
  skipText: { color: '#9AA5AF', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },

  kitTag: {
    color: '#9AA5AF', fontSize: 11, fontWeight: '800', letterSpacing: 1.6, marginTop: 7
  },
  kitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  kitChip: {
    paddingHorizontal: 14, height: 42, borderRadius: 12, justifyContent: 'center',
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#111417'
  },
  kitChipOn: SELECTED,
  kitChipText: { color: '#C3CBD2', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  kitChipTextOn: SELECTED_TEXT,
  kitHint: { color: '#9AA5AF', fontSize: TYPE.meta, marginTop: 16, lineHeight: 18 },
  kitCheck: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  kitBox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: '#7C8792'
  },
  kitCheckText: { color: '#9AA5AF', fontSize: TYPE.body, fontWeight: '600' },
  kitLabel: {
    color: MUTED, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginTop: 20
  },
  kitInput: {
    height: 48, paddingHorizontal: 14, marginTop: 12,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 15, fontWeight: '600'
  },
  kitActions: { flexDirection: 'row', gap: 12, marginTop: 22, alignItems: 'stretch' },
  kitClear: {
    paddingHorizontal: 20, height: 54, borderRadius: 14,
    borderWidth: 1, borderColor: '#2A323A', alignItems: 'center', justifyContent: 'center'
  },
  kitClearText: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },

  jumpEditRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  jumpInput: {
    width: 96, height: 48, paddingHorizontal: 14,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A',
    color: '#fff', fontSize: 18, fontWeight: '800'
  },
  jumpEditUnit: { color: MUTED, fontSize: 14, fontWeight: '600' },
  save: {
    height: 54, borderRadius: 14, backgroundColor: VOLT,
    alignItems: 'center', justifyContent: 'center', marginTop: 22
  },
  saveText: { color: '#000', fontSize: 14, fontWeight: '900', letterSpacing: 2 },

  repsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 14                                   // 22 before the jump joined the row
  },
  reps: { color: '#fff', fontSize: 40, fontWeight: '800' },
  repsLabel: { color: MUTED, fontSize: 12, fontWeight: '600' },
  repsInput: { minWidth: 92, textAlign: 'center', padding: 0 },

  stepper: {
    width: HIT, height: HIT, borderRadius: HIT / 2, borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center'
  },
  stepperSmall: { width: 48, height: 48, borderRadius: 24 },
  stepperText: { color: '#fff', fontSize: 30, fontWeight: '600', marginTop: -3 },

  clear: {
    paddingHorizontal: 16, height: 40, borderRadius: 12,
    borderWidth: 1, borderColor: '#242A30',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end'
  },
  clearText: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },

  logButton: {                                            // height + marginTop from layoutFor
    backgroundColor: VOLT, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center'
  },
  logText: { color: '#000', fontSize: 20, fontWeight: '900', letterSpacing: 2 },

  weightInput: { padding: 0, minWidth: 120, flexShrink: 1, textAlign: 'center' },

  restRow: { minHeight: 20, alignItems: 'center' },       // marginTop from layoutFor
  restText: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.6 },
  // Past the cold threshold it stops being neutral information and starts being
  // worth noticing. Still not a nag — a colour change, no alert, no sound.
  restCold: { color: '#7C8792' },

  // `overflow: hidden` and `minHeight: 0` are load-bearing, not tidiness. A
  // flex child's implicit min-height is its CONTENT, so on a short viewport
  // this refused to shrink and the set chips painted straight over UP NEXT and
  // FINISH. Clipping here is safe because the list inside scrolls.
  todayWrap: { flex: 1, overflow: 'hidden' },             // marginTop + minHeight from layoutFor
  // Scroll mode only (R652): natural height, so the column grows and scrolls
  // to TODAY instead of TODAY shrinking to nothing inside a scrolling column.
  todayWrapScroll: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  todayHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
    paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#161B20'
  },
  todayLabel: { color: '#7C8792', fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  nextGroup: { flexDirection: 'row', alignItems: 'baseline', gap: 9 },
  /** The one forward-looking thing in this block, so it gets the weight. */
  nextSet: { color: '#E8EAED', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },
  todayTotals: { color: MUTED, fontSize: 12, fontWeight: '700' },
  todayScroll: { flex: 1, minHeight: 0 },

  liftBlock: { paddingVertical: 12 },
  liftHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liftDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: VOLT },
  liftName: { color: '#C7CED6', fontSize: 14, fontWeight: '800', letterSpacing: .2, flexShrink: 1 },
  liftNameCurrent: { color: '#E8EAED' },
  liftCount: { color: '#7C8792', fontSize: 11, fontWeight: '700', marginLeft: 'auto' },
  liftEmpty: { color: '#7C8792', fontSize: 12, marginTop: 5, fontStyle: 'italic' },
  liftSets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' },
  // The latest set with its UNDO and +: one unit the wrap cannot split (R686).
  lastSetGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0F1113', borderRadius: 9, paddingVertical: 8, paddingHorizontal: 12, marginRight: 8
  },
  // Armed, not deleted: one tap lights the set, the second removes it. A chip
  // is small and sits beside four others, so a control that destroyed a real
  // set on a single stray tap would trade one mistake for another.
  chipArmed: { borderColor: '#FF6B6B', backgroundColor: '#2A1416' },
  chipArmedText: { color: '#FF6B6B' },
  /*
   * A set that broke a record. Volt on the border and the number, which is the
   * accent §15 allows one use of — and this is what it is for: not the loudest
   * thing on the screen, the truest.
   *
   * The chip already ARRIVES with motion (see `Arrive`), so a PR needs no
   * separate animation; it inherits the one the app already had and differs in
   * colour. That also keeps §12's rule intact — the resting style is the
   * visible one, so a chip that never animates is still marked.
   */
  chipPR: { borderWidth: 1, borderColor: VOLT, backgroundColor: '#14170D' },
  chipTextPR: { color: VOLT },
  chipPRMark: { color: VOLT, fontSize: 11, fontWeight: '900' },
  chipIndex: { color: '#7C8792', fontSize: 12, fontWeight: '700' },
  chipText: { color: '#E8EAED', fontSize: 15, fontWeight: '700' },
  undo: { paddingHorizontal: 12, paddingVertical: 10 },
  addSet: {
    // Same height as UNDO so the row reads as one strip of controls rather
    // than two things that happen to be adjacent.
    minWidth: 44, height: 34, paddingHorizontal: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#243039', backgroundColor: '#101519',
    alignItems: 'center', justifyContent: 'center'
  },
  addSetText: { color: VOLT, fontSize: 18, fontWeight: '900', marginTop: -2 },
  chipNote: { color: '#9AA5AF', fontSize: 11, marginLeft: 6 },

  editSheet: {
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 28, maxHeight: '86%'
  },
  editTitle: { color: '#7C8792', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label, marginBottom: 14 },
  editRow: { flexDirection: 'row', gap: 12 },
  editField: { flex: 1 },
  editLabel: { color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro, marginTop: 14, marginBottom: 8 },
  editInput: {
    height: 56, paddingHorizontal: 14, backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', color: '#fff', fontSize: 22, fontWeight: '800'
  },
  editNote: {
    minHeight: 72, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    backgroundColor: '#111417', borderRadius: 12,
    borderWidth: 1, borderColor: '#2A323A', color: '#E8EAED', fontSize: 15, fontWeight: '500'
  },
  editSave: {
    backgroundColor: VOLT, borderRadius: 16, height: 58,
    alignItems: 'center', justifyContent: 'center', marginTop: 20
  },
  editSaveOff: { opacity: 0.35 },
  editSaveText: { color: '#000', fontSize: TYPE.lead, fontWeight: '900', letterSpacing: SPACING.micro },
  editRemove: { alignItems: 'center', paddingVertical: 16 },
  editRemoveText: { color: '#B87A7A', fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },

  undoText: { color: MUTED, fontSize: 12, fontWeight: '700', letterSpacing: 1 },

  footer: {
    flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'center', gap: 12
  },  // marginTop from layoutFor
  railBand: {
    marginTop: 6, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: '#161B20'
  },
  railLabel: { color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro },
  // Same tier as `railLabel`, because they are the same kind of thing: the
  // name of the block beneath. Anything louder would compete with the lift
  // names it is introducing.
  todayHeading: {
    color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800',
    // 4, not 8. See TODAY_HEADING in now-model: the extra four pixels put a
    // 568px SE over §4's no-scroll budget, and a heading sitting close to the
    // list it names is not a worse heading.
    letterSpacing: SPACING.micro, marginBottom: 4
  },
  railRow: { flexDirection: 'row', gap: 8, paddingTop: 8, paddingRight: 20 },
  // A plain wrapper so the fade has something to be absolute inside. It sets
  // no size of its own, so the band is still exactly as tall as its content —
  // the property the railBand comment insists on.
  // Positioning context only. No size of its own, so the rows inside stack
  // exactly as they did and `fixedHeight`'s arithmetic is untouched.
  logPanel: { position: 'relative' },
  /*
   * Negative insets, so it reads as padding and costs none. `bottom` is short
   * of `top` because LOG SET sits directly beneath with its own `logGap`, and
   * a panel that reached all the way down would crowd it.
   */
  logPanelSurface: {
    position: 'absolute', left: -10, right: -10, top: -14, bottom: -10,
    borderRadius: 18, backgroundColor: '#0D1014',
    borderWidth: 1, borderColor: '#181D23'
  },
  railScroller: { position: 'relative' },
  railFade: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 32, flexDirection: 'row' },
  railFadeSlice: { flex: 1, backgroundColor: BG },
  railChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    height: RAIL_CHIP, paddingHorizontal: 14, borderRadius: RAIL_CHIP / 2,
    borderWidth: 1, borderColor: '#242A30', backgroundColor: '#101316'
  },
  // The original of the treatment `SELECTED` now standardises.
  railChipOn: SELECTED,
  // Dimmed by colour alone. Stacking an opacity on top of an already-muted
  // label put the text near 2:1 against the chip — legible to nobody.
  railChipDone: { borderColor: '#1B2026', backgroundColor: '#0C0F12' },
  railText: { color: '#C7CED6', fontSize: 14, fontWeight: '700' },
  railTextOn: { color: VOLT },
  railTextDone: { color: '#79838D' },
  railNext: { color: VOLT, fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  /*
   * The bottom bar -- shipped R640 on the owner's word (2026-09-10), replacing
   * the PROGRESS / GOALS / gear row that used to sit above the lift.
   *
   * A real bar rather than a mock — 56px, so each destination keeps a 44pt
   * target with a label under its glyph, which is what makes it a tab bar and
   * not a row of icons. Measuring the current screen against a fake would
   * answer nothing.
   *
   * `marginHorizontal: -20` cancels the root padding so the bar reaches both
   * edges, which is what makes it read as chrome rather than as content.
   */
  // TabBar is COLUMN-capped (width 100%). Inside Now's padded column that
  // 100% is the padded width, so the bleed only shifted it: measured 335px at
  // left 20 on a 375px phone (R650). Stretch restores the full-bleed width;
  // COLUMN's maxWidth still caps it at 430 on a wide window.
  tabBleed: { marginHorizontal: -20, alignSelf: 'stretch', width: 'auto' },
  finish: { paddingVertical: 12, paddingHorizontal: 16 },
  finishText: { color: MUTED, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    // Capped and centred, like every other surface. A bottom sheet that
    // spans a 1024px window over a 430px app is not the same product.
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28,
    // 86%, the same cap R35 chose for the Goals sheet. This one was 72% and had
    // simply never been revisited: with the list grouped by split day (R33) and
    // one movement the user added, 174px of a 624px list was below the cut —
    // the whole LEGS group, with a 7px sliver of Deadlift as the only clue.
    // The extra 14% is free; it is backdrop nobody was using.
    maxHeight: '86%'
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: '#2A323A',
    alignSelf: 'center', marginBottom: 16
  },
  sheetHead: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6
  },
  sheetTitle: { color: MUTED, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  sheetDay: { color: VOLT, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  otherDays: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  groupLabel: {
    color: '#7C8792', fontSize: 10, fontWeight: '800', letterSpacing: 1.8,
    marginTop: 14, marginBottom: 2, paddingHorizontal: 6
  },
  // The day being trained is the reason the sheet is in this order, so it is
  // the one label that is allowed to be loud.
  groupLabelLead: { color: VOLT },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: HIT, paddingHorizontal: 6, borderRadius: 10
  },
  pickName: { color: '#E8EAED', fontSize: 15, fontWeight: '600' },
  addPrompt: { color: MUTED, fontSize: 15, fontWeight: '600' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: HIT },
  addInput: {
    flex: 1, color: '#fff', fontSize: 15, fontWeight: '600',
    borderBottomWidth: 1, borderBottomColor: '#242A30', paddingVertical: 10, paddingHorizontal: 6
  },
  addGo: { paddingHorizontal: 12, paddingVertical: 12 },
  addGoText: { color: VOLT, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  pickCurrent: { color: VOLT },
  pickDot: { color: VOLT, fontSize: 10 },
  pickRemove: { paddingHorizontal: 10, paddingVertical: 4 },
  pickRemoveText: { color: MUTED, fontSize: 18, fontWeight: '600', lineHeight: 18 },
  // Same red as Progress's own inline error (`weeklyShareError`) — this app's
  // one established colour for "that didn't work", not a bespoke grey.
  removeError: { color: '#FF8A8A', fontSize: TYPE.meta, paddingHorizontal: 6, paddingTop: 6 }
});
