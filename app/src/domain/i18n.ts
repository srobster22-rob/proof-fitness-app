/**
 * The app's visible strings, in the languages it speaks.
 *
 * ## Why a table and not a library
 *
 * §12 bans dependencies that are not carrying their weight. An i18n library
 * brings a plural engine, an ICU message parser, a locale negotiator and a
 * bundle loader; this app has one screen of settings, four screens total, and
 * no user-generated plurals in its chrome. A record of records does the whole
 * job, is typed, and fails at compile time when a key is added to one language
 * and forgotten in the other — which is the failure mode that actually happens.
 *
 * ## What is translated, and what is deliberately not
 *
 * Chrome is translated: labels, buttons, headings, the settings screen. Numbers
 * are not — a weight is a weight — and neither are the movement NAMES. Renaming
 * "Bench Press" to "Press de Banca" would rewrite the label on every set the
 * user has already logged, and the exercise ids and any movement they invented
 * themselves stay exactly as typed. A lifter switching language should see the
 * app change, not their own history.
 *
 * Coverage is honest rather than complete: `t()` falls back to English for any
 * key a language has not translated yet, so a missing string is the English one
 * rather than a blank or a raw key.
 */

export const LANGUAGES = ['en', 'es'] as const;
export type Language = typeof LANGUAGES[number];

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  es: 'Español'
};

/** The keys, defined by the English table — see `t`. */
const EN = {
  // nav + screens
  progress: 'PROGRESS',
  goals: 'GOALS',
  settings: 'SETTINGS',
  done: 'DONE',

  // logging
  logSet: 'LOG SET',
  reps: 'reps',
  finish: 'FINISH',
  clear: 'CLEAR',
  undo: 'UNDO',
  editSet: 'EDIT SET',
  saveSet: 'SAVE SET',
  removeSet: 'REMOVE THIS SET',
  note: 'NOTE',
  weight: 'WEIGHT',
  lastTime: 'Last time',
  justDid: 'Just did',
  firstTime: 'First time',
  equipment: '+ EQUIPMENT',
  resting: 'RESTING',
  // The tag on the rail's suggested lift. Its own key rather than `next`,
  // because that one is the "NEXT / SET 2" heading and Spanish wants a shorter
  // word here — a chip is not a heading.
  suggested: 'NEXT',
  nextOn: 'NEXT ON',
  thisWorkout: 'THIS WORKOUT',
  todayIs: 'TODAY IS',
  skipDay: 'SKIP — WORK IT OUT AS I GO',
  notSureYet: 'NOT SURE YET — JUST LET ME LIFT',
  howSplit: 'HOW DO YOU SPLIT YOUR WEEK?',
  set: 'SET',
  next: 'NEXT',
  addASet: 'ADD A SET',
  logIt: 'LOG IT',
  goalHit: 'goal hit',
  goalShort: 'goal',
  to: 'to',
  sets: 'sets',
  setOne: 'set',

  // goals
  addGoal: '+ ADD A GOAL',
  setGoal: 'SET GOAL',
  saveChanges: 'SAVE CHANGES',
  change: 'CHANGE',
  wipe: 'WIPE',
  wipeAll: 'WIPE ALL',
  target: 'TARGET',
  forReps: 'FOR (REPS)',
  by: 'BY',
  lift: 'LIFT',
  yourLifts: 'YOUR LIFTS',
  daysLeft: 'days left',
  onPace: 'on pace',
  behindPace: 'behind pace',
  pastDate: 'Past the date',
  notTrained: 'Not trained yet',

  // settings
  split: 'SPLIT',
  units: 'UNITS',
  language: 'LANGUAGE',
  jumps: 'JUMP AMOUNTS',
  asking: 'WHAT TO ASK',
  skipMachine: "Don't ask which machine",
  skipMachineHelp: 'Choosing MACHINE records it and closes, like barbell and dumbbell do.',
  yourData: 'YOUR DATA',
  recentWorkouts: 'RECENT WORKOUTS',
  viewRecapA11y: 'View the recap for {title}, {when}',
  changeLast: 'CHANGE, LAST',
  sessionsWord: 'SESSIONS',
  youCard: 'YOU',
  bodyHeight: 'BODYWEIGHT & HEIGHT',
  emptyProgress: 'Log a few sessions and this fills in.',
  exportData: 'EXPORT MY DATA',
  restore: 'RESTORE',
  eraseAll: 'ERASE EVERYTHING',
  splitHelp: 'Which days you train. The picker narrows to the day you pick.',
  unitsHelp: 'Weights already logged keep the unit they were logged in, and are converted for display.',
  languageHelp: 'Movement names and your own notes are never translated.',

  // splits
  ppl: 'PUSH / PULL / LEGS',
  upperLower: 'UPPER / LOWER',
  fullBody: 'FULL BODY',
  planBlurbPpl: 'Three days. Chest and shoulders, then back and arms, then legs.',
  planBlurbUpperLower: 'Two days. Everything above the waist, then everything below.',
  planBlurbFull: 'One day. A bit of everything, every time you train.',
  push: 'PUSH',
  pull: 'PULL',
  legs: 'LEGS',
  upper: 'UPPER',
  lower: 'LOWER',
  full: 'FULL BODY',

  // The day rail's heading. Written out per day rather than composed, because
  // the English does not compose: nobody says "LEGS DAY" or "FULL BODY DAY".
  nextOnPush: 'NEXT ON PUSH DAY',
  nextOnPull: 'NEXT ON PULL DAY',
  nextOnLegs: 'NEXT ON LEG DAY',
  nextOnUpper: 'NEXT ON UPPER DAY',
  nextOnLower: 'NEXT ON LOWER DAY',
  nextOnFull: 'NEXT IN FULL BODY TODAY',
  nextUpToday: 'NEXT UP TODAY',

  // Progress
  /*
   * The coach line (OWNER.md #2). Keys, not sentences, because `coach.ts` is
   * not allowed to produce English — see the note on `Suggestion.key`.
   *
   * Each one names what you DID before what to try, because the evidence is
   * what makes the advice worth reading: '185 lb for 3 sessions' is checkable
   * against the list further down the same screen, and 'try 190' on its own is
   * not.
   */
  coachIncrease: '{weight} for {n} sessions — try {suggest}',
  coachPlateau: 'Stuck at {weight} for {n} — try {suggest}',
  coachDeload: '{weight} is grinding — back off to {suggest}',
  coachSettle: 'First time at {weight}×{reps} — repeat it before adding',
  coachHold: '{weight} last {n} — stay here and add a rep',
  goalTagWord: 'GOAL',
  toWord: 'TO',
  pushDay: 'PUSH DAY',
  pullDay: 'PULL DAY',
  // "LEGS DAY", not "LEG DAY": this is what `sessionTitle` has always composed
  // and it reaches the recap card and the share message. The rail heading says
  // "NEXT ON LEG DAY", which reads correctly there and would not here.
  legsDay: 'LEGS DAY',
  upperDay: 'UPPER DAY',
  lowerDay: 'LOWER DAY',
  fullDay: 'FULL BODY',
  workoutWord: 'WORKOUT',

  /*
   * The goal sentence §5 makes the whole screen earn its place with.
   *
   * A PATTERN rather than a set of fragments, because the two languages order
   * the pieces differently — "30 lb from a 225 squat" against "30 lb para un
   * squat de 225" — and fragments would need an empty separator in one
   * language to paper over it. An empty string in this table is indistinguishable
   * from a forgotten translation and renders as a missing word; `{}` slots
   * cannot be empty by accident.
   */
  goalGap: '{gap} {unit} from a {target} {lift}',
  goalStalled: '{gap} {unit} to go, from {current}',
  goalDone: 'Done.',

  /*
   * The recap. §5 judges the whole product on this card, and it is the one
   * surface that LEAVES the app — a lifter who set the language to Spanish and
   * shares a workout is sharing it with people who read Spanish.
   */
  /*
   * §10's rest-day line: "your squat is up 15 lb since four weeks ago".
   * Weeks rather than days because that is how the spec words it and how a
   * lifter thinks about a training block.
   */
  weeklyUp: '{lift} is up {gain} {unit} since {weeks} weeks ago',
  bestSetValueA11y: '{name}, best {weight} {unit} by {reps}',
  bestSetNoneA11y: '{name}, not trained at this rep range yet',
  bestSetOnA11y: 'set {when}',
  trendChangeA11y: '{name}, {sign}{trend} {unit} change',
  trendFlatA11y: '{name}, no change',
  trendSinceA11y: 'since {when}',
  goalBarA11y: '{pct} percent there, goal set {when}',
  lastTrainedA11y: 'last trained {when}',
  trainedCountA11y: 'trained {n} times, last trained {when}',
  trainedOnceA11y: 'trained once, last trained {when}',
  weeklyUpOneWeek: '{lift} is up {gain} {unit} since last week',
  weeklyHeading: 'SINCE LAST MONTH',
  streakA11y: '{n} week training streak',
  bestStreakLine: 'BEST · {n} WEEKS',
  bestStreakA11y: 'Personal best, a {n} week streak',
  totalVolume: 'TOTAL VOLUME',
  needsBodyweight: 'Add your bodyweight on YOU to count these sets.',
  setsLabel: 'SETS',
  timeLabel: 'TIME',
  streakLabel: 'STREAK',
  minShort: 'MIN',
  weekShort: 'WK',
  newPR: 'NEW PERSONAL RECORD',
  bestYet: 'BEST YET',
  sessionOne: 'SESSION ONE',
  oneToBeat: 'THE ONE TO BEAT',
  upFromPrev: 'UP FROM {prev}',
  share: 'SHARE',
  editWorkout: '← EDIT THIS WORKOUT',
  reopenA11y: 'Reopen this workout to edit it',

  // The share message, which is prose rather than chrome.
  heaviestEverWord: 'heaviest ever',
  bestSetYet: 'best set yet',
  upFrom: 'up from',
  volumeAcross: '{volume} {unit} across {sets} {setWord}.',
  setsOnly: '{sets} {setWord}.',
  weeksRunning: '{n} weeks running.',
  weeksRunningRecord: '{n} weeks running — the longest yet.',

  /*
   * Destructive confirmations, and the measurements screen.
   *
   * The confirmations matter most of any prose in the app: a sentence somebody
   * cannot read is a sentence they tap through, and everything behind these is
   * irreversible. `cancel`/`confirm` labels are per-action on purpose — §4's
   * "a confirm you can dismiss by reflex is not a confirm" applies in every
   * language.
   */
  clearWorkoutTitle: 'Clear this workout?',
  clearWorkoutBody: '{n} {setWord} logged today will be removed. Your history, streak and goals are not touched.',
  clearLabel: 'CLEAR',

  eraseTitle: 'Erase everything?',
  eraseBody: '{what} will be deleted from this device. There is no backup but the one you export yourself, and this cannot be undone.',
  /*
   * Byte-identical to `eraseBody` on purpose: English does not inflect the verb
   * for number, so both cases read the same. The key exists because SPANISH
   * does — "Se eliminara 1 meta" against "Se eliminaran 36 entrenamientos" —
   * and a language cannot have a key the table does not define. The two English
   * strings are asserted equal in `test/erase-language.test.ts`, so editing one
   * and not the other fails rather than shipping a quiet inconsistency.
   */
  eraseBodyOne: '{what} will be deleted from this device. There is no backup but the one you export yourself, and this cannot be undone.',
  eraseLabel: 'ERASE',

  /*
   * RepoGate's storage-error screen. Rendered before any screen mounts, at
   * the point where the database itself may have failed to open — so unlike
   * every other translated string, this one cannot read the language
   * preference through `repo.getPref`, because the repo is exactly what
   * failed. `RepoGate.tsx` picks the language from the device locale
   * directly instead.
   */
  repoGateTitle: "Couldn't open your training log",
  repoGateBody1: "Your sets are still on this device — nothing has been deleted. The app just can't read the file right now.",
  repoGateBody2Early: 'Closing and reopening usually clears it. If it keeps happening, the message below is the useful part.',
  repoGateBody2Late: 'It has not cleared, so this is probably not temporary. If you have exported a backup, reinstalling and restoring it will get everything back. If you have not, send the message below before reinstalling — reinstalling clears the file this app cannot read, and the log with it.',
  repoGateRetry: 'TRY AGAIN',
  repoGateSend: 'SEND THIS MESSAGE',
  repoGateSendA11y: 'Send this diagnostic',
  repoGateTriedOnce: 'Tried once more.',
  repoGateTried: 'Tried {n} more times.',

  wipeGoalTitle: 'Wipe the {lift} goal?',
  wipeGoalHit: 'already hit.',
  wipeGoalLeft: '{n} days left.',
  wipeGoalLeftOne: '1 day left.',
  wipeGoalUndo: 'You can undo this.',
  wipeItLabel: 'WIPE IT',
  wipeAllTitle: 'Wipe all {n} goals?',
  wipeAllTitleOne: 'Wipe your 1 goal?',
  wipeAllBody: 'Every target on every lift, including the ones you have already hit.',
  wipeAllLabel: 'YES, WIPE ALL',
  wipeAll2Title: 'Really all of them?',
  wipeAll2Body: '{open} still open, {done} already hit. Your sets, sessions and history are not touched — only the targets.',
  wipeAll2Label: 'YES, ALL OF THEM',
  wipeAll3Title: 'Last chance.',
  wipeAll3Body: 'One tap of UNDO puts them straight back, and it stays on screen until you dismiss it. After that they are gone.',
  wipeAll3Label: 'WIPE EVERYTHING',

  // The YOU screen.
  you: 'YOU',
  bodyweight: 'BODYWEIGHT',
  /*
   * Strings that reach the SHARED CARD but are produced app-side, so R221's
   * LABELS table in spike/recap.js could not translate them (R482).
   *
   * The weekly card's date tile is built by `weeklyCard`, not by the renderer,
   * so a Spanish rest-day card carried a Spanish label ("SUBIO") above an
   * English date ("4 WEEKS") — the exact defect R221 fixed, in the one field it
   * could not reach.
   */
  cardWeeks: 'WEEKS',
  cardWeekOne: 'WEEK',
  /** The word in "1.75x bodyweight", which rides the card and the message. */
  bodyweightWord: 'bodyweight',
  height: 'HEIGHT',
  notRecorded: 'Not recorded yet',
  readings: 'READINGS',
  hide: 'HIDE',
  whyBodyweight: 'Bodyweight is what a pull-up, chin-up, dip or push-up actually weighs. Without it those sets are recorded as only the weight you added.',
  recordIt: 'RECORD IT',
  setATarget: 'SET A TARGET',
  changeTarget: 'CHANGE TARGET',
  clearTarget: 'CLEAR',
  setTarget: 'SET TARGET',
  targetSuffix: 'TARGET',
  days: 'days',
  removeReadingTitle: 'Remove this reading?',
  removeReadingBody: '{value}. The rest of the history is untouched.',
  removeItLabel: 'REMOVE IT',
  clearTargetTitle: 'Clear this target?',
  clearTargetBody: 'The target goes; every reading stays exactly where it is.',
  clearItLabel: 'CLEAR IT',
  monthsShort: 'MO',

  // The trend under a measurement, and the target beside it. Patterns, because
  // "Down 4.2 lb since Jun" and "Bajó 4.2 lb desde jun" put the verb and the
  // preposition in different places.
  trendUp: 'Up {change} since {when}',
  trendDown: 'Down {change} since {when}',
  trendFlat: 'Steady since {when}',
  targetToGo: '{gap} to {target}',
  targetThere: '{target} — you are there',
  // The reached-it-then-left-it case: `achieved` is false today but `reachedAt`
  // is set, which "X to go" alone throws away — it re-baselines someone who
  // has already done this once to someone who never has.
  targetReachedThenLeft: 'Hit {target} on {when} — {gap} back to it',
  cancel: 'CANCEL',

  // The stragglers, found by a sweep of every rendered <Text> rather than by
  // reading the screens — which is how twenty of them survived the first pass.
  noSetsYet: 'no sets yet',
  repsLabel: 'REPS',
  addLabel: 'ADD',
  doneOn: 'DONE ON',
  whichOne: 'WHICH ONE',
  dontAskAgain: "Don't ask again",
  notAskingMachine: 'Not asking which machine. Tap MACHINE again to start asking.',
  jumpButtons: 'JUMP BUTTONS',
  repsPerTap: 'reps per tap',
  save: 'SAVE',
  everyLiftHasGoal: 'Every lift already has a goal.',
  hitOrRemove: 'Hit one or remove one to set another — or add a movement from the',
  nothingLogged: 'Nothing logged yet.',
  back: 'BACK',
  shortOne: 'Short one. It still counts — the streak holds.',
  /*
   * The same reassurance, for the workout that has no streak behind it.
   *
   * On a first-ever session `streakWorthShowing` hides the streak cell, so the
   * card said "the streak holds" while showing no streak — and nothing was
   * held: it started. §6 makes this exact frame the hook, the first recap a
   * user ever sees, so it is the worst place to reference something that is
   * neither true nor on screen (§16).
   */
  shortOneFirst: 'Short one. It still counts — this is session one.',
  gotIt: 'GOT IT',
  changing: 'CHANGING',
  other: 'OTHER',

  // Equipment, from the domain's own ids. Rendered as `{e.toUpperCase()}`,
  // which is an expression rather than a literal — so the sweep that found the
  // other twenty could not see these. Anything drawn from an id needs a key.
  barbell: 'BARBELL',
  dumbbell: 'DUMBBELL',
  machine: 'MACHINE',
  bodyweightKit: 'BODYWEIGHT',

  /*
   * Export and restore (§11). The rest of the app got a language pass and this
   * corner did not — `summarise()` and the messages in `backup.ts` are plain
   * prose reaching the one screen whose whole job is reassuring somebody about
   * their data, and they stayed English regardless of the setting.
   */
  sessionOneLower: 'session',
  sessionsLower: 'sessions',
  goalLower: 'goal',
  goalsLower: 'goals',
  measurementLower: 'measurement',
  measurementsLower: 'measurements',
  settingLower: 'setting',
  settingsLower: 'settings',
  skippedWord: 'skipped',
  restoredLine: 'Restored {parts}.',
  // A pattern rather than a standalone "across", because word order is not
  // guaranteed to survive translation — see `goalGap` above for the same
  // reasoning applied to a different sentence.
  exportSummary: '{sets} across {sessions}',
  exportedLine: 'Exported {summary}.',
  exportFailed: 'Export failed: {err}',
  sharingUnavailable: "Sharing isn't available. The file is at {uri}",
  restoreFailedErr: 'Restore failed: {err}',
  restoreFailedPlain: 'Restore failed.',
  couldntRead: "Couldn't read that file: {err}",
  trainingLogTitle: 'Your training log',

  // Why a measurement or a target was refused. Dynamic strings, returned from
  // a function rather than written as a `<Text>` literal — the same shape that
  // let `backup.ts` escape the earlier sweep.
  notAMeasurement: 'That does not look like a {kind} in {unit}.',
  mgImplausible: 'That is outside what this can record. Check the unit.',
  mgAlreadyThere: 'That is where you are now. Pick a number to move toward.',
  mgNoReading: 'Record where you are first, so there is something to measure from.',
  mgPastDate: 'Pick a date ahead of today.',
  mgDuplicate: 'You already have a target for this. Edit that one instead.',

  /*
   * Accessibility labels on the YOU screen — invisible on screen, so they
   * escaped both the earlier `<Text>` sweep and today's pass over dynamic
   * error messages, and stayed English for a VoiceOver or TalkBack user
   * regardless of the LANGUAGE setting.
   */
  recordKind: 'Record a {kind}',
  changeKindTarget: 'Change the {kind} target',
  clearKindTarget: 'Clear the {kind} target',
  setKindTarget: 'Set a {kind} target',
  hideReadingsA11y: 'Hide the readings',
  showAllReadingsA11y: 'Show all {n} readings',
  removeReadingA11y: 'Remove the {value} reading',
  noteForReadingA11y: 'Note for this reading',
  kindTargetA11y: '{kind} target',
  nMonthsA11y: '{n} months',
  notePlaceholder: 'morning, before food — anything',
  couldNotSave: 'Could not save that.',
  removeExerciseA11y: 'Remove {name}',
  cannotRemoveExercise: "Can't remove it — it already has sets logged.",

  /*
   * Goals. Three DIFFERENT ways an English string escaped every earlier sweep,
   * all found by widening the same search that found the YOU screen's
   * accessibility labels: `FILTER_LABEL`/`SORT_LABEL` are id-keyed records
   * rendered as `{expr}`, invisible to a sweep that only matches `<Text>foo`;
   * "Pick the lifts... Up to {n} at once." mixes literal text with an
   * interpolation, which the sweep's `[^<>{}]*` pattern cannot span; and
   * "reps" / "days" are bare lowercase words the sweep's own `/[A-Z]/`-or-space
   * filter was written to IGNORE, on the assumption a lowercase single word is
   * always a unit suffix rather than prose.
   */
  filterOpenWord: 'OPEN',
  sortClosest: 'CLOSEST',
  sortSoonest: 'SOONEST',
  sortNewest: 'NEWEST',
  sortedByTapChange: 'Sorted by {sort}. Tap to change.',
  filterCountA11y: '{label}, {n} goals',
  filterCountA11yOne: '{label}, {n} goal',
  goalsAchievedLine: '{n} GOALS ACHIEVED',
  goalsAchievedLineOne: '1 GOAL ACHIEVED',
  pickLiftsUpTo: 'Pick the lifts you want to move. Up to {n} at once.',
  goalErrTooMany: 'That is {n} on the go. Finish or drop one first.',
  goalErrDuplicate: 'You already have a goal for this lift.',
  goalErrTargetBelow: 'You have already beaten that. Aim higher.',
  goalErrBadReps: 'Pick between 1 and 12 reps.',
  goalErrDateInPast: 'Pick a date in the future.',
  goalErrGone: 'That goal is no longer there.',
  wipeAllA11y: 'Wipe all {n} goals',
  wipeAllA11yOne: 'Wipe the 1 goal',
  dismissA11y: 'Dismiss',
  changeExGoal: 'Change the {lift} goal',
  wipeExGoal: 'Wipe the {lift} goal',
  takeOffUnit: 'Take off {n} {unit}',
  addUnit: 'Add {n} {unit}',
  repsA11y: 'Reps',
  howLongA11y: 'How long',
  /*
   * R473. A `<Text>` child does NOT give a control an accessible name here:
   * react-native-web renders it as a `<div>`, and Chrome's name-from-content
   * does not cross that — measured against a planted probe, where a bare
   * `<button>TEXT</button>` was named and `<button><div>TEXT</div></button>`
   * was anonymous. So every control needs an explicit label, and these three
   * keys are what the chips and steppers that had none now say.
   */
  repsCountA11y: '{n} reps',
  repsCountA11yOne: '1 rep',

  /*
   * What ERASE EVERYTHING is about to destroy, named one category at a time.
   *
   * `erasureLine` built this sentence from English literals until R480, so a
   * Spanish user read "Se eliminará 700 workouts, 14,000 sets and 3
   * measurements" — the app's most destructive dialog, in a language they did
   * not choose, on the one screen where misreading it is unrecoverable (§11:
   * the export file is the only backup, and there is no server).
   *
   * `sets`/`setOne` already existed and are reused rather than duplicated.
   */
  eraseWorkouts: 'workouts',
  eraseWorkoutOne: 'workout',
  eraseGoals: 'goals',
  eraseGoalOne: 'goal',
  eraseMeasurements: 'measurements',
  eraseMeasurementOne: 'measurement',
  eraseCustomExercises: 'custom exercises',
  eraseCustomExerciseOne: 'custom exercise',
  eraseSettings: 'settings',
  eraseSettingOne: 'setting',
  /** The conjunction closing that list — "a, b and c". */
  andWord: 'and',
  /** When there is genuinely nothing to erase. */
  nothingWord: 'Nothing',
  useUnitA11y: 'Use {unit}',
  targetWord: 'target',
  repsWord: 'reps',
  daysWord: 'days',
  weeksWord: 'weeks',
  monthsWord: 'months',
  yearsWord: 'years',
  unitTapChange: 'Unit: {unit}. Tap to change.',
  upToUnitDot: 'Up to {n} {unit}.',
  inDaysDash: '{n} days — {date}',
  inDaysDashOne: '1 day — {date}',
  goalWiped: '{lift} goal wiped.',
  goalsWiped: '{n} goals wiped.',
  goalsWipedOne: '1 goal wiped.',
  cappedComeBack: '{back} of {total} came back — the rest hit the cap.',
  orAnythingElse: 'OR ANYTHING ELSE',
  onlyThisDay: 'ONLY THIS DAY',
  otherDaysCount: 'OTHER DAYS  ·  {n}',
  startWith: 'START WITH',
  switchTo: 'SWITCH TO',
  somethingElse: '+ Something else',
  machineTapAgain: 'Machine. Tap again to be asked which one.',
  increaseWord: 'Increase {what}',
  decreaseWord: 'Decrease {what}',

  /*
   * The rest of NowScreen's accessibility labels — the full sweep R156
   * deferred. Most of the visible-text equivalents already have keys
   * (`progress`, `goals`, `settings`, `reps`, `weight`, `logSet`, `removeSet`);
   * reused directly here, because case does not carry meaning for a screen
   * reader the way it does on a rendered chip.
   */
  changeExerciseA11y: 'Change exercise. Currently {name}',
  changeEquipmentA11y: 'Change equipment',
  changeSplitA11y: 'Change split. Currently {name}',
  clearEquipmentA11y: 'Clear equipment for this lift',
  typeWeightA11y: 'Type weight',
  typeRepsA11y: 'Type reps',
  undoLastSetA11y: 'Undo last {lift} set',
  addAnotherSetA11y: 'Add another {lift} set, same as the last',
  clearWorkoutA11y: 'Clear this workout',
  finishA11y: 'Finish this workout',
  skipWorkItOutA11y: 'Skip. Work it out as I go',
  noteForSetA11y: 'Note for this set',
  machineNameA11y: 'Machine name',

  // `recommendNext`'s reasons — domain prose, translated the same way the
  // goal and recap sentences are. Reaches the screen only as an accessible
  // name (§4 cut the visible reason line as "too much text"), which is why it
  // stayed English through every earlier sweep: it never renders as `<Text>`.
  reasonHeavyOverlap: 'same muscles as your last lift — heavy overlap',
  reasonNotFatigued: 'nothing you have just fatigued',
  reasonFinishesCompound: 'finishes what your compound started',
  reasonAfterHeavyWork: 'better after the heavy work, not before it',
  reasonFreshMuscle: 'a muscle you have not trained yet today',
  alreadyTrainedTodayA11y: ', already trained today',
  suggestedNextA11y: ', suggested next',
  reasonColonA11y: ': {reason}',
  setByRepsA11y: 'Set {n}, {weight} by {reps}',
  notedA11y: ', noted: {note}',
  tapToEditA11y: '. Tap to edit.',

  everythingErased: 'Everything erased.',
  workingEllipsis: 'Working…',
  plainJsonFile: 'A plain JSON file. Yours to keep, readable without this app.',
  yourMeasurementsA11y: 'Your measurements',
  settingsA11y: 'Settings',
  eraseEverythingA11y: 'Erase everything on this device',
  hiddenLiftsNote: '{n} {lift}, not shown — the most active are here, and anything with a goal on it.',
  hiddenLiftWord: 'more lift trained',
  hiddenLiftsWord: 'more lifts trained',

  jumpButtonsNote: 'What the big +/− buttons add on the logging screen. A plate is {plate} {unit} and five reps by default; microplates and fixed-dumbbell racks are not.',
  weightJumpA11y: 'Weight jump',
  repJumpA11y: 'Rep jump',
  perTap: '{unit} per tap',
  jumpMustBeWeight: 'A jump has to be a real weight in {unit}.',
  repJumpRange: 'A rep jump has to be between 1 and 12.',

  notePlaceholderSet: 'RIR 2 · tempo 3-1-1 · machine 4 · anything',
  movementNamePlaceholder: 'Movement name',
  machineNamePlaceholder: 'Arsenal, Hammer Strength…',
  weightUnitLabel: 'WEIGHT ({unit})',
  pounds: 'Pounds',
  kilograms: 'Kilograms',
  notFoundTitle: 'Nothing here',
  notFoundBody: "That link doesn't go anywhere in this app.",
  goToWorkout: 'GO TO YOUR WORKOUT',
  weightJumpUnitA11y: 'Weight jump in {unit}'
};

/** Equipment names, keyed off `EQUIPMENT` in types.ts. */
export const KIT_KEY = {
  barbell: 'barbell', dumbbell: 'dumbbell',
  machine: 'machine', bodyweight: 'bodyweightKit'
} as const;

/** A measurement kind's own name, keyed off `MeasurementKind` in measure.ts. */
export const KIND_KEY = { bodyweight: 'bodyweight', height: 'height' } as const;

/** Goals filter chips, keyed off `GoalFilter` in goal-filters.ts. */
export const FILTER_KEY = {
  open: 'filterOpenWord', done: 'done',
  // The day chips are the lifter's own plan days now, not always push/pull/legs
  // — `goalFilters`. Same words `DAY_KEY` uses, so a chip and the rail heading
  // on the Now screen cannot call the same day two different things.
  push: 'push', pull: 'pull', legs: 'legs',
  upper: 'upper', lower: 'lower', full: 'full'
} as const;

/** Goals sort order, keyed off `GoalSort` in goal-filters.ts. */
export const SORT_KEY = {
  closest: 'sortClosest', soonest: 'sortSoonest', newest: 'sortNewest'
} as const;

/** A target's time horizon, keyed off `HorizonUnit` in goals-model.ts. */
export const HORIZON_KEY = {
  days: 'daysWord', weeks: 'weeksWord', months: 'monthsWord', years: 'yearsWord'
} as const;

/** Month names as the trend line says them: short, sentence case, in-line. */
export const MONTHS_TREND: Record<Language, readonly string[]> = {
  en: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  es: ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
};

/** Month and weekday names for the recap's date, which is drawn not formatted. */
export const MONTHS_SHORT: Record<Language, readonly string[]> = {
  en: ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'],
  es: ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']
};
export const DAYS_SHORT: Record<Language, readonly string[]> = {
  en: ['SUN','MON','TUE','WED','THU','FRI','SAT'],
  es: ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB']
};

/** A session's name, per day. `null` day means the lifts did not agree on one. */
export const DAY_TITLE_KEY = {
  push: 'pushDay', pull: 'pullDay', legs: 'legsDay',
  upper: 'upperDay', lower: 'lowerDay', full: 'fullDay'
} as const;

/**
 * The plan and day names, which live in `domain/split.ts` as English constants
 * because the domain has no opinion about language.
 *
 * Keyed off the domain's own ids so a plan added there fails to compile here
 * rather than silently rendering in English on one screen and Spanish on
 * another — which is precisely what happened while `PLAN_LABEL` was read
 * directly by the day chooser and through `t()` by Settings.
 */
export const PLAN_KEY = { ppl: 'ppl', 'upper-lower': 'upperLower', full: 'fullBody' } as const;
export const PLAN_BLURB_KEY = {
  ppl: 'planBlurbPpl', 'upper-lower': 'planBlurbUpperLower', full: 'planBlurbFull'
} as const;
export const DAY_KEY = {
  push: 'push', pull: 'pull', legs: 'legs',
  upper: 'upper', lower: 'lower', full: 'full'
} as const;
export const DAY_HEADING_KEY = {
  push: 'nextOnPush', pull: 'nextOnPull', legs: 'nextOnLegs',
  upper: 'nextOnUpper', lower: 'nextOnLower', full: 'nextOnFull'
} as const;

export type Key = keyof typeof EN;

/**
 * Spanish.
 *
 * Written to be read by a lifter, not by a dictionary: "SERIE" for a set,
 * "REGISTRAR" for logging one, "REPS" left as-is because that is what Spanish
 * gyms say. Where a phrase would be longer than the English and break a fixed
 * chip width, the shorter true phrasing wins over the literal one.
 */
const ES: Partial<Record<Key, string>> = {
  progress: 'PROGRESO',
  goals: 'METAS',
  settings: 'AJUSTES',
  done: 'LISTO',

  logSet: 'REGISTRAR',
  reps: 'reps',
  thisWorkout: 'ESTE ENTRENO',
  todayIs: 'HOY TOCA',
  skipDay: 'OMITIR — YA VERÉ SOBRE LA MARCHA',
  notSureYet: 'AÚN NO LO SÉ — SOLO QUIERO ENTRENAR',
  howSplit: '¿CÓMO DIVIDES TU SEMANA?',
  set: 'SERIE',
  next: 'SIGUIENTE',
  addASet: 'AÑADIR SERIE',
  logIt: 'REGISTRAR',
  goalHit: 'meta lograda',
  goalShort: 'meta',
  to: 'a',
  sets: 'series',
  setOne: 'serie',
  finish: 'TERMINAR',
  clear: 'BORRAR',
  undo: 'DESHACER',
  editSet: 'EDITAR SERIE',
  saveSet: 'GUARDAR SERIE',
  removeSet: 'ELIMINAR ESTA SERIE',
  note: 'NOTA',
  weight: 'PESO',
  lastTime: 'La última vez',
  justDid: 'Acabas de hacer',
  firstTime: 'Primera vez',
  equipment: '+ EQUIPO',
  resting: 'DESCANSO',
  suggested: 'SIGUE',
  nextOn: 'SIGUIENTE EN',

  addGoal: '+ AÑADIR META',
  setGoal: 'FIJAR META',
  saveChanges: 'GUARDAR CAMBIOS',
  change: 'CAMBIAR',
  wipe: 'BORRAR',
  wipeAll: 'BORRAR TODAS',
  target: 'OBJETIVO',
  forReps: 'PARA (REPS)',
  by: 'PARA EL',
  lift: 'EJERCICIO',
  yourLifts: 'TUS EJERCICIOS',
  daysLeft: 'días restantes',
  onPace: 'a buen ritmo',
  behindPace: 'por detrás',
  pastDate: 'Fecha pasada',
  notTrained: 'Aún sin entrenar',

  split: 'RUTINA',
  units: 'UNIDADES',
  recentWorkouts: 'ENTRENOS RECIENTES',
  viewRecapA11y: 'Ver el resumen de {title}, {when}',
  changeLast: 'CAMBIO, ÚLTIMAS',
  sessionsWord: 'SESIONES',
  youCard: 'TÚ',
  bodyHeight: 'PESO Y ALTURA',
  emptyProgress: 'Registra unas sesiones y esto se llena.',
  language: 'IDIOMA',
  jumps: 'INCREMENTOS',
  asking: 'QUÉ PREGUNTAR',
  skipMachine: 'No preguntar qué máquina',
  skipMachineHelp: 'Elegir MÁQUINA la registra y cierra, igual que barra y mancuerna.',
  yourData: 'TUS DATOS',
  exportData: 'EXPORTAR MIS DATOS',
  restore: 'RESTAURAR',
  eraseAll: 'BORRAR TODO',
  splitHelp: 'Qué días entrenas. El selector se ajusta al día que elijas.',
  unitsHelp: 'Las series ya registradas conservan su unidad original y se convierten al mostrarse.',
  languageHelp: 'Los nombres de los ejercicios y tus notas nunca se traducen.',

  ppl: 'EMPUJE / TIRÓN / PIERNA',
  upperLower: 'TREN SUPERIOR / INFERIOR',
  fullBody: 'CUERPO COMPLETO',
  planBlurbPpl: 'Tres días. Pecho y hombros, luego espalda y brazos, luego piernas.',
  planBlurbUpperLower: 'Dos días. Todo por encima de la cintura, luego todo por debajo.',
  planBlurbFull: 'Un día. Un poco de todo, cada vez que entrenas.',
  push: 'EMPUJE',
  pull: 'TIRÓN',
  legs: 'PIERNA',
  upper: 'SUPERIOR',
  lower: 'INFERIOR',
  full: 'CUERPO COMPLETO',

  nextOnPush: 'SIGUE EN DÍA DE EMPUJE',
  nextOnPull: 'SIGUE EN DÍA DE TIRÓN',
  nextOnLegs: 'SIGUE EN DÍA DE PIERNA',
  nextOnUpper: 'SIGUE EN TREN SUPERIOR',
  nextOnLower: 'SIGUE EN TREN INFERIOR',
  nextOnFull: 'SIGUE HOY EN CUERPO COMPLETO',
  nextUpToday: 'LO SIGUIENTE HOY',

  coachIncrease: '{weight} en {n} sesiones — prueba {suggest}',
  coachPlateau: 'Atascado en {weight} durante {n} — prueba {suggest}',
  coachDeload: '{weight} te cuesta — baja a {suggest}',
  coachSettle: 'Primera vez con {weight}×{reps} — repítelo antes de subir',
  coachHold: '{weight} las últimas {n} — quédate y suma una repetición',
  goalTagWord: 'META',
  toWord: 'A',
  pushDay: 'DÍA DE EMPUJE',
  pullDay: 'DÍA DE TIRÓN',
  legsDay: 'DÍA DE PIERNA',
  upperDay: 'TREN SUPERIOR',
  lowerDay: 'TREN INFERIOR',
  fullDay: 'CUERPO COMPLETO',
  workoutWord: 'ENTRENO',

  // Spanish puts the number AFTER the lift: "para un squat de 225".
  goalGap: '{gap} {unit} para un {lift} de {target}',
  goalStalled: 'faltan {gap} {unit}, desde {current}',
  goalDone: 'Hecho.',

  weeklyUp: '{lift} subió {gain} {unit} en {weeks} semanas',
  bestSetValueA11y: '{name}, mejor marca {weight} {unit} por {reps}',
  bestSetNoneA11y: '{name}, aún sin entrenar en este rango de repeticiones',
  bestSetOnA11y: 'el {when}',
  trendChangeA11y: '{name}, cambio de {sign}{trend} {unit}',
  trendFlatA11y: '{name}, sin cambio',
  trendSinceA11y: 'desde el {when}',
  goalBarA11y: '{pct} por ciento, meta fijada el {when}',
  lastTrainedA11y: 'entrenado por última vez el {when}',
  trainedCountA11y: 'entrenado {n} veces, por última vez el {when}',
  trainedOnceA11y: 'entrenado una vez, por última vez el {when}',
  weeklyUpOneWeek: '{lift} subió {gain} {unit} desde la semana pasada',
  weeklyHeading: 'DESDE EL MES PASADO',
  streakA11y: 'Racha de {n} semanas entrenando',
  bestStreakLine: 'RÉCORD · {n} SEMANAS',
  bestStreakA11y: 'Récord personal, racha de {n} semanas',
  totalVolume: 'VOLUMEN TOTAL',
  needsBodyweight: 'Añade tu peso corporal en TÚ para contar estas series.',
  setsLabel: 'SERIES',
  timeLabel: 'TIEMPO',
  streakLabel: 'RACHA',
  minShort: 'MIN',
  weekShort: 'SEM',
  newPR: 'NUEVO RÉCORD PERSONAL',
  bestYet: 'LO MEJOR HASTA AHORA',
  sessionOne: 'SESIÓN UNO',
  oneToBeat: 'LA MARCA A BATIR',
  upFromPrev: 'ANTES {prev}',
  share: 'COMPARTIR',
  editWorkout: '← EDITAR ESTE ENTRENO',
  reopenA11y: 'Reabrir este entreno para editarlo',

  heaviestEverWord: 'lo más pesado hasta ahora',
  bestSetYet: 'la mejor serie hasta ahora',
  upFrom: 'antes',
  volumeAcross: '{volume} {unit} en {sets} {setWord}.',
  setsOnly: '{sets} {setWord}.',
  weeksRunning: '{n} semanas seguidas.',
  weeksRunningRecord: '{n} semanas seguidas — la racha más larga hasta ahora.',

  clearWorkoutTitle: '¿Borrar este entreno?',
  clearWorkoutBody: 'Se eliminarán {n} {setWord} de hoy. Tu historial, tu racha y tus metas no se tocan.',
  clearLabel: 'BORRAR',

  eraseTitle: '¿Borrar todo?',
  eraseBody: 'Se eliminarán {what} de este dispositivo. No hay más copia que la que exportes tú, y esto no se puede deshacer.',
  eraseBodyOne: 'Se eliminará {what} de este dispositivo. No hay más copia que la que exportes tú, y esto no se puede deshacer.',
  eraseLabel: 'BORRAR',

  repoGateTitle: 'No se pudo abrir tu historial de entreno',
  repoGateBody1: 'Tus series siguen en este dispositivo — no se ha borrado nada. La app simplemente no puede leer el archivo ahora mismo.',
  repoGateBody2Early: 'Cerrar y volver a abrir suele solucionarlo. Si sigue pasando, el mensaje de abajo es la parte útil.',
  repoGateBody2Late: 'No se ha solucionado, así que probablemente no sea algo temporal. Si has exportado una copia, reinstalar y restaurarla lo recuperará todo. Si no lo has hecho, envía el mensaje de abajo antes de reinstalar — reinstalar borra el archivo que esta app no puede leer, y el historial con él.',
  repoGateRetry: 'REINTENTAR',
  repoGateSend: 'ENVIAR ESTE MENSAJE',
  repoGateSendA11y: 'Enviar este diagnóstico',
  repoGateTriedOnce: 'Se intentó una vez más.',
  repoGateTried: 'Se intentó {n} veces más.',

  wipeGoalTitle: '¿Borrar la meta de {lift}?',
  wipeGoalHit: 'ya lograda.',
  wipeGoalLeft: 'quedan {n} días.',
  wipeGoalLeftOne: 'queda 1 día.',
  wipeGoalUndo: 'Puedes deshacerlo.',
  wipeItLabel: 'BORRARLA',
  wipeAllTitle: '¿Borrar las {n} metas?',
  wipeAllTitleOne: '¿Borrar tu única meta?',
  wipeAllBody: 'Todas las metas de todos los ejercicios, incluidas las ya logradas.',
  wipeAllLabel: 'SÍ, BORRAR TODAS',
  wipeAll2Title: '¿En serio todas?',
  wipeAll2Body: '{open} siguen abiertas, {done} ya logradas. Tus series, sesiones e historial no se tocan — solo las metas.',
  wipeAll2Label: 'SÍ, TODAS',
  wipeAll3Title: 'Última oportunidad.',
  wipeAll3Body: 'Un toque en DESHACER las devuelve, y sigue en pantalla hasta que lo cierres. Después ya no están.',
  wipeAll3Label: 'BORRAR TODO',

  you: 'TÚ',
  bodyweight: 'PESO CORPORAL',
  cardWeeks: 'SEMANAS',
  cardWeekOne: 'SEMANA',
  bodyweightWord: 'peso corporal',
  height: 'ALTURA',
  notRecorded: 'Aún sin registrar',
  readings: 'REGISTROS',
  hide: 'OCULTAR',
  whyBodyweight: 'Tu peso corporal es lo que realmente pesa una dominada, un fondo o una flexión. Sin él, esas series solo cuentan el peso que añadiste.',
  recordIt: 'REGISTRARLO',
  setATarget: 'FIJAR UNA META',
  changeTarget: 'CAMBIAR META',
  clearTarget: 'BORRAR',
  setTarget: 'FIJAR META',
  targetSuffix: 'META',
  days: 'días',
  removeReadingTitle: '¿Eliminar este registro?',
  removeReadingBody: '{value}. El resto del historial no se toca.',
  removeItLabel: 'ELIMINARLO',
  clearTargetTitle: '¿Borrar esta meta?',
  clearTargetBody: 'La meta desaparece; todos los registros se quedan tal cual.',
  clearItLabel: 'BORRARLA',
  monthsShort: 'MES',

  trendUp: 'Subió {change} desde {when}',
  trendDown: 'Bajó {change} desde {when}',
  trendFlat: 'Estable desde {when}',
  targetToGo: '{gap} para {target}',
  targetThere: '{target} — ya estás',
  targetReachedThenLeft: 'Llegaste a {target} el {when} — {gap} para volver',
  cancel: 'CANCELAR',

  noSetsYet: 'aún sin series',
  repsLabel: 'REPS',
  addLabel: 'AÑADIR',
  doneOn: 'HECHO EN',
  whichOne: 'CUÁL',
  dontAskAgain: 'No preguntar más',
  notAskingMachine: 'Ya no se pregunta cuál máquina. Toca MÁQUINA otra vez para volver a preguntar.',
  jumpButtons: 'BOTONES DE SALTO',
  repsPerTap: 'reps por toque',
  save: 'GUARDAR',
  everyLiftHasGoal: 'Todos los ejercicios ya tienen meta.',
  hitOrRemove: 'Logra una o quita una para fijar otra — o añade un movimiento desde el',
  nothingLogged: 'Aún no has registrado nada.',
  back: 'ATRÁS',
  shortOne: 'Corto. Cuenta igual — la racha sigue.',
  shortOneFirst: 'Corto. Cuenta igual — esta es la sesión uno.',
  gotIt: 'ENTENDIDO',
  changing: 'CAMBIANDO',
  other: 'OTRO',

  barbell: 'BARRA',
  dumbbell: 'MANCUERNA',
  machine: 'MÁQUINA',
  bodyweightKit: 'PESO CORPORAL',

  sessionOneLower: 'sesión',
  sessionsLower: 'sesiones',
  goalLower: 'meta',
  goalsLower: 'metas',
  measurementLower: 'medición',
  measurementsLower: 'mediciones',
  settingLower: 'ajuste',
  settingsLower: 'ajustes',
  skippedWord: 'omitidos',
  restoredLine: 'Restaurado: {parts}.',
  exportSummary: '{sets} en {sessions}',
  exportedLine: 'Exportado: {summary}.',
  exportFailed: 'Error al exportar: {err}',
  sharingUnavailable: 'Compartir no está disponible. El archivo está en {uri}',
  restoreFailedErr: 'Error al restaurar: {err}',
  restoreFailedPlain: 'Error al restaurar.',
  couldntRead: 'No se pudo leer ese archivo: {err}',
  trainingLogTitle: 'Tu registro de entrenamiento',

  notAMeasurement: 'Eso no parece un valor de {kind} en {unit}.',
  mgImplausible: 'Eso está fuera de lo que se puede registrar. Revisa la unidad.',
  mgAlreadyThere: 'Ya estás ahí. Elige un número hacia el que avanzar.',
  mgNoReading: 'Registra primero dónde estás, para tener algo con qué medir.',
  mgPastDate: 'Elige una fecha posterior a hoy.',
  mgDuplicate: 'Ya tienes una meta para esto. Edita esa en su lugar.',

  recordKind: 'Registrar un valor de {kind}',
  changeKindTarget: 'Cambiar la meta de {kind}',
  clearKindTarget: 'Borrar la meta de {kind}',
  setKindTarget: 'Fijar una meta de {kind}',
  hideReadingsA11y: 'Ocultar los registros',
  showAllReadingsA11y: 'Mostrar los {n} registros',
  removeReadingA11y: 'Eliminar el registro de {value}',
  noteForReadingA11y: 'Nota para este registro',
  kindTargetA11y: 'meta de {kind}',
  nMonthsA11y: '{n} meses',
  notePlaceholder: 'por la mañana, en ayunas — lo que sea',
  couldNotSave: 'No se pudo guardar.',
  removeExerciseA11y: 'Quitar {name}',
  cannotRemoveExercise: 'No se puede quitar — ya tiene series registradas.',

  filterOpenWord: 'ABIERTAS',
  sortClosest: 'MÁS CERCA',
  sortSoonest: 'MÁS PRONTO',
  sortNewest: 'MÁS RECIENTE',
  sortedByTapChange: 'Orden: {sort}. Toca para cambiar.',
  filterCountA11y: '{label}, {n} metas',
  filterCountA11yOne: '{label}, {n} meta',
  goalsAchievedLine: '{n} METAS LOGRADAS',
  goalsAchievedLineOne: '1 META LOGRADA',
  pickLiftsUpTo: 'Elige los ejercicios que quieres mejorar. Hasta {n} a la vez.',
  goalErrTooMany: 'Ya tienes {n} activas. Termina o elimina una primero.',
  goalErrDuplicate: 'Ya tienes una meta para este ejercicio.',
  goalErrTargetBelow: 'Ya superaste eso. Apunta más alto.',
  goalErrBadReps: 'Elige entre 1 y 12 repeticiones.',
  goalErrDateInPast: 'Elige una fecha futura.',
  goalErrGone: 'Esa meta ya no está.',
  wipeAllA11y: 'Borrar las {n} metas',
  wipeAllA11yOne: 'Borrar la única meta',
  dismissA11y: 'Descartar',
  changeExGoal: 'Cambiar la meta de {lift}',
  wipeExGoal: 'Borrar la meta de {lift}',
  takeOffUnit: 'Quitar {n} {unit}',
  addUnit: 'Añadir {n} {unit}',
  repsA11y: 'Repeticiones',
  howLongA11y: 'Cuánto tiempo',
  repsCountA11y: '{n} repeticiones',
  repsCountA11yOne: '1 repetición',

  eraseWorkouts: 'entrenamientos',
  eraseWorkoutOne: 'entrenamiento',
  eraseGoals: 'metas',
  eraseGoalOne: 'meta',
  eraseMeasurements: 'mediciones',
  eraseMeasurementOne: 'medición',
  eraseCustomExercises: 'ejercicios personalizados',
  eraseCustomExerciseOne: 'ejercicio personalizado',
  eraseSettings: 'ajustes',
  eraseSettingOne: 'ajuste',
  /*
   * Spanish turns this into "e" before a word beginning with an i- or hi-
   * sound ("metas e informes"). None of the ten category words above start
   * that way, and `test/erase-language.test.ts` asserts that stays true rather
   * than leaving a rule nobody would remember — a dead branch here would be
   * worse than the check, since `tools/orphan-scan.cjs` would only report it
   * as unreachable and nothing would say why.
   */
  andWord: 'y',
  nothingWord: 'Nada',
  useUnitA11y: 'Usar {unit}',
  targetWord: 'objetivo',
  repsWord: 'reps',
  daysWord: 'días',
  weeksWord: 'semanas',
  monthsWord: 'meses',
  yearsWord: 'años',
  unitTapChange: 'Unidad: {unit}. Toca para cambiar.',
  upToUnitDot: 'Hasta {n} {unit}.',
  inDaysDash: '{n} días — {date}',
  inDaysDashOne: '1 día — {date}',
  goalWiped: 'Meta de {lift} borrada.',
  goalsWiped: '{n} metas borradas.',
  goalsWipedOne: '1 meta borrada.',
  cappedComeBack: 'Volvieron {back} de {total} — el resto llegó al límite.',
  orAnythingElse: 'O CUALQUIER OTRO',
  onlyThisDay: 'SOLO ESTE DÍA',
  otherDaysCount: 'OTROS DÍAS  ·  {n}',
  startWith: 'EMPEZAR CON',
  switchTo: 'CAMBIAR A',
  somethingElse: '+ Otra cosa',
  machineTapAgain: 'Máquina. Toca otra vez para que vuelva a preguntar cuál.',
  increaseWord: 'Aumentar {what}',
  decreaseWord: 'Reducir {what}',

  changeExerciseA11y: 'Cambiar de ejercicio. Ahora: {name}',
  changeEquipmentA11y: 'Cambiar el equipo',
  changeSplitA11y: 'Cambiar la rutina. Ahora: {name}',
  clearEquipmentA11y: 'Borrar el equipo de este ejercicio',
  typeWeightA11y: 'Escribir el peso',
  typeRepsA11y: 'Escribir las repeticiones',
  undoLastSetA11y: 'Deshacer la última serie de {lift}',
  addAnotherSetA11y: 'Añadir otra serie de {lift}, igual que la última',
  clearWorkoutA11y: 'Borrar este entreno',
  finishA11y: 'Terminar este entreno',
  skipWorkItOutA11y: 'Omitir. Ya veré sobre la marcha',
  noteForSetA11y: 'Nota para esta serie',
  machineNameA11y: 'Nombre de la máquina',

  reasonHeavyOverlap: 'los mismos músculos que tu último ejercicio — mucho solapamiento',
  reasonNotFatigued: 'nada que acabes de fatigar',
  reasonFinishesCompound: 'termina lo que empezó tu ejercicio compuesto',
  reasonAfterHeavyWork: 'mejor después del trabajo pesado, no antes',
  reasonFreshMuscle: 'un músculo que aún no has trabajado hoy',
  alreadyTrainedTodayA11y: ', ya entrenado hoy',
  suggestedNextA11y: ', sugerido a continuación',
  reasonColonA11y: ': {reason}',
  setByRepsA11y: 'Serie {n}, {weight} por {reps}',
  notedA11y: ', con nota: {note}',
  tapToEditA11y: '. Toca para editar.',

  everythingErased: 'Todo borrado.',
  workingEllipsis: 'Procesando…',
  plainJsonFile: 'Un archivo JSON sencillo. Tuyo para conservar, legible sin esta app.',
  yourMeasurementsA11y: 'Tus medidas',
  settingsA11y: 'Ajustes',
  eraseEverythingA11y: 'Borrar todo en este dispositivo',
  hiddenLiftsNote: '{n} {lift}, sin mostrar — aquí están los más activos, y cualquiera con una meta.',
  hiddenLiftWord: 'ejercicio más entrenado',
  hiddenLiftsWord: 'ejercicios más entrenados',

  jumpButtonsNote: 'Lo que añaden los botones grandes +/− en la pantalla de registro. Un disco es {plate} {unit} y cinco repeticiones por defecto; las microplacas y las mancuernas fijas no lo son.',
  weightJumpA11y: 'Salto de peso',
  repJumpA11y: 'Salto de repeticiones',
  perTap: '{unit} por toque',
  jumpMustBeWeight: 'Un salto tiene que ser un peso real en {unit}.',
  repJumpRange: 'Un salto de repeticiones tiene que estar entre 1 y 12.',

  notePlaceholderSet: 'RIR 2 · tempo 3-1-1 · máquina 4 · lo que sea',
  movementNamePlaceholder: 'Nombre del ejercicio',
  machineNamePlaceholder: 'Arsenal, Hammer Strength…',
  weightUnitLabel: 'PESO ({unit})',
  pounds: 'Libras',
  kilograms: 'Kilos',
  notFoundTitle: 'Nada por aquí',
  notFoundBody: 'Ese enlace no lleva a ningún sitio de esta app.',
  goToWorkout: 'IR A TU ENTRENO',
  weightJumpUnitA11y: 'Salto de peso en {unit}'
};

const TABLES: Record<Language, Partial<Record<Key, string>>> = { en: EN, es: ES };

/**
 * One string, in the chosen language.
 *
 * Falls back to English rather than to the key. A missing translation showing
 * "goals.addGoal" on a button is a bug the user has to live with; showing
 * "+ ADD A GOAL" is merely untranslated, and every language starts out mostly
 * untranslated.
 */
export function t(lang: Language, key: Key): string {
  return TABLES[lang][key] ?? EN[key];
}

/** Whether a language has a translation for every key, for the tests to check. */
export function missingKeys(lang: Language): Key[] {
  return (Object.keys(EN) as Key[]).filter(k => TABLES[lang][k] === undefined);
}

/**
 * The language to start in, from the device locale.
 *
 * §4 — never ask a question the app can answer. A phone set to Spanish gets
 * Spanish without being asked; anything else gets English, because a half-
 * matched locale is a worse guess than the default.
 */
export function languageFor(locale: string | null | undefined): Language {
  const tag = (locale ?? '').toLowerCase();
  return tag.startsWith('es') ? 'es' : 'en';
}

/**
 * The language this device is in, from the stored choice or the locale.
 *
 * Every screen needs this and only Settings had it, which is exactly how the
 * setting came to translate nothing but itself: the LANGUAGE control wrote
 * `pref.language`, the Settings screen read it, and the four screens the user
 * actually spends their time on hardcoded English — so choosing Español gave
 * you AJUSTES / RUTINA / UNIDADES and then a logging screen reading LOG SET,
 * FINISH and CLEAR, every one of which had a Spanish string sitting unused in
 * the table above.
 *
 * Takes the narrowest shape it can rather than `Repo`, so this file stays
 * importable by anything and depends on no storage.
 */
/**
 * The key the language is stored under.
 *
 * `'pref.language'`, and `Repo.setPref` prefixes with `pref.` again — so the row
 * is really `pref.pref.language`. That is ugly and it is CONSISTENT, which is
 * what matters: every reader and writer goes through this constant. It is here
 * rather than in `app/settings.tsx` because that file is one caller among
 * several now, and the first version of `languageOf` guessed `'language'`,
 * looked in the wrong row, and silently returned English for a user who had
 * chosen Español — the exact bug it was written to fix, one layer down.
 */
export const PREF_LANG = 'pref.language';

export function languageOf(
  repo: { getPref(key: string): string | null },
  locale?: string | null
): Language {
  const saved = repo.getPref(PREF_LANG);
  if (saved === 'en' || saved === 'es') return saved;
  return languageFor(
    locale ?? (typeof navigator !== 'undefined' ? navigator.language : null)
  );
}

/**
 * The locale dates are formatted in.
 *
 * The app's own language wins over the device's. `toLocaleDateString(undefined)`
 * follows the OS, which left "Mon, Aug 24" sitting under "ENTRENOS RECIENTES"
 * on a screen that was otherwise entirely Spanish — the language setting is a
 * statement about what the user wants to READ, and a date is something they
 * read. Falls back to the device for anything the table has no locale for.
 */
export function dateLocale(lang: Language): string | undefined {
  return lang === 'es' ? 'es' : undefined;
}

/**
 * A number, grouped the way the card's own language groups numbers.
 *
 * The same fix `dateLocale` above is, for the other half of the problem, and it
 * took until R479 to notice the halves were separable: dates followed the app's
 * language while every number beside them called a bare `toLocaleString()`,
 * which follows the DEVICE. Measured in the running app with the language set
 * to Spanish and the browser at en-US — Progress read "dom, 30 ago" and
 * "10,125 lb" on the same row. Spanish groups with dots: that is "10.125".
 *
 * Unlike `dateLocale` this never returns undefined, because a number here is
 * not only read on the device that produced it. `spike/recap.js` renders the
 * shared card on the RECIPIENT's machine from a payload that carries `lang`
 * (which is why R221 put the card's LABELS on the payload), so a
 * device-dependent grouping means the sender and the receiver see different
 * numbers for the same workout — the app showing "1.284.600" while the card it
 * just produced says "1,284,600". The card is one artifact; it has to render
 * the same everywhere, so the grouping is a function of the language it was
 * written in and of nothing else.
 */
export function number(n: number, lang: Language): string {
  return n.toLocaleString(lang === 'es' ? 'es' : 'en-US');
}

/**
 * Fill a pattern's `{slots}`.
 *
 * The whole templating engine, and deliberately the whole of it: §12 bans a
 * dependency that is not carrying its weight, and this app's longest sentence
 * has four slots and no plurals in it. A missing key throws nothing and renders
 * the slot name, which is visible in a screenshot rather than silent.
 */
export function fill(pattern: string, values: Record<string, string | number>): string {
  return pattern.replace(/\{(\w+)\}/g, (whole, k) =>
    k in values ? String(values[k]) : whole);
}

