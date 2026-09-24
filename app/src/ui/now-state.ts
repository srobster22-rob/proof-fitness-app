/**
 * The shape of what the Now screen renders: `NowModel.state()` and its parts.
 *
 * Moved verbatim out of now-model.ts (R697); the model imports it from here.
 */
import type { LoggedSet, Session, Exercise, Equipment } from '../domain/types.ts';
import { type Prefill } from '../domain/coldstart.ts';
import { justFinished } from '../domain/session.ts';
import { type RestState } from '../domain/rest.ts';
import { type SplitDay, type SplitGroup, type SplitPlan, type PlanDay } from '../domain/split.ts';
import { type Language } from '../domain/i18n.ts';

/** One lift on the day's rail. */
export interface RailLift {
  id: string;
  name: string;
  /** Already trained in this session — dimmed, but still reachable. */
  done: boolean;
  /** The lift on screen right now. */
  current: boolean;
  /** The one the predictor would have put in the old NEXT LIFT button. */
  suggested: boolean;
  /**
   * Why this one, in the app's own words — "finishes what your compound
   * started", "same muscles as your last lift". Empty for movements the app
   * has no profile for, and for chips it has nothing to say about.
   */
  reason: string;
}

export interface NowState {
  session: Session;
  exercise: Exercise;
  /** What the steppers currently show — never blank (§4). */
  weight: number;
  reps: number;
  /**
   * Where last time's numbers came from, so the UI can only claim "last time"
   * truthfully. For a lift with a coach's call the steppers open on the call
   * instead (R692, D8), and the line under the lift names it, never "last time".
   */
  prefillSource: Prefill['source'];
  /**
   * The line under the lift name, split at the point the colour changes.
   * Never blank — see `lastTimeParts`.
   */
  lastTime: { head: string; tail: string; hit: boolean; made: boolean; justMade: boolean };
  /** What language to draw the chrome in. See `NowModel.lang`. */
  lang: Language;
  /** Which routine they are running. Chosen once, changed in Settings. */
  plan: SplitPlan;
  /** The day of that plan in force — chosen if they said, inferred otherwise. */
  planDay: PlanDay | null;
  /**
   * Whether they actually SAID which day it is.
   *
   * Separate from `planDay` because the app can infer a day from the lift it
   * happens to be showing, and that inference must not count as an answer —
   * gating the question on `planDay` meant it was never asked at all.
   */
  dayChosen: boolean;
  /** Whether they have been put in front of the day question for this workout. */
  dayAsked: boolean;
  /**
   * A workout ended moments ago and the next has not started (`justFinished` in
   * session.ts). The day question for the next workout waits until then.
   */
  justFinished: boolean;
  /** What this lift is being done on, carried over from last time. */
  equipment: Equipment | null;
  /** Which machine, when `equipment` is 'machine'. */
  machine: string | null;
  /** Machines already logged for THIS lift, most recent first. */
  knownMachines: string[];
  /** What the +/- jump buttons add, in this session's unit. User-settable. */
  plateJump: number;
  /** What the +/- rep jump buttons add. User-settable. */
  repJump: number;
  /** Sets logged for this exercise in this session. */
  /** Sets logged in this workout that are personal records — see state(). */
  prSetIds: string[];
  loggedThisExercise: LoggedSet[];
  /** Every set in the session, in order. */
  loggedThisSession: LoggedSet[];
  /** The lift after this one, or null at the end of the predicted session. */
  upNext: Exercise | null;
  /**
   * Every lift belonging to today, in the order you are likely to want them.
   *
   * NEXT LIFT offered exactly one guess, in a small button sharing a row with
   * CLEAR and FINISH. That answers "what does the app think is next" but not the
   * question a lifter actually has between exercises, which is "what else is on
   * push day" — and the answer to that is a list, not a guess. Tricep
   * extensions and chest flys were always in the library and always one tap
   * away through the picker; nothing on screen said so.
   */
  dayRail: RailLift[];
  /** What the picker offers right now — their lifts, or the starting twelve. */
  picker: Exercise[];
  /** The same list, grouped by split day, with the day being trained first. */
  pickerGroups: SplitGroup[];
  /** Which day this workout is, judged by what has been logged. Null until it is knowable. */
  day: SplitDay | null;
  /**
   * Whether there is a workout to finish.
   *
   * FINISH used to be offered from the moment the app opened. Tapping it with
   * nothing logged pushed a recap reading "Nothing logged yet" with a BACK
   * button — a round trip to a dead end — and ended a session containing no
   * sets, leaving a phantom row behind for every launch someone opened and did
   * not train. You cannot finish a workout you have not started.
   */
  canFinish: boolean;
  /** Time since the last set in this session (§8b). Null before the first one. */
  rest: RestState;
  /**
   * §10: "a streak, visible on launch, that counts training days not app
   * opens". It reached the recap and the shared card and never the screen the
   * app actually opens on, which is the one place §10 asks for it — an app
   * opened only mid-workout has no habit hook, and this is half of what §10
   * offers as one.
   *
   * The raw count. Whether it is worth SHOWING is `streakWorthShowing`'s call
   * (>= 2), and it stays the recap's call so the two surfaces cannot start
   * disagreeing about what counts as a streak.
   */
  streak: number;
  /**
   * Nothing has ever been logged on this device.
   *
   * §6 requires that first launch *show the twelve* rather than silently pick
   * one — a beginner who came to squat should not have to discover that the
   * exercise name is tappable.
   */
  firstEver: boolean;
  /**
   * The whole workout so far, in the order it was trained.
   *
   * The screen used to show only the CURRENT exercise's sets, which made a
   * session feel like a series of unrelated taps rather than a record being
   * built. This is the thing you are actually making while you train.
   */
  today: SessionLift[];
  /** Every set logged today, across all lifts. */
  totalSets: number;
  /** Running volume for the session, in the session's unit. */
  totalVolume: number;
  /**
   * Whether `totalVolume` is a total or a floor — see `SessionStats.volumeKnown`.
   *
   * False for bodyweight work with no reading behind it, where the sum is 0
   * because the weight ADDED was 0. The fifth surface to carry this same
   * claim, found by grepping `sessionStats(` rather than waiting for a later
   * round to trip over it — and the only one that is LIVE, printing "1 set
   * 0 lb" under the logged sets while the lifter is still in the gym.
   */
  totalVolumeKnown: boolean;
}

export interface SessionLift {
  exerciseId: string;
  name: string;
  sets: LoggedSet[];
  /** True for the lift currently open, so the screen can mark where you are. */
  current: boolean;
}
