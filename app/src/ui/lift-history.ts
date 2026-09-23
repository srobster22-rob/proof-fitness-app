import type { Repo } from '../data/repo.ts';
import type { LoggedSet, Unit } from '../domain/types.ts';
import { convertWeight } from '../domain/types.ts';
import { bestSetAtReps, findPRs } from '../domain/pr.ts';
import { topSetPerExercise } from '../domain/session.ts';
import { displayUnit } from './display-unit.ts';

/**
 * One lift's own history: the sheet a Progress row opens (R680).
 *
 * A Progress row shows a sparkline and one best set, and it could not be tapped.
 * So "what did I bench last week", "what is my best triple" and "when did I last
 * set a record" had no answer anywhere in the app, although every number was
 * already stored. Every comparable app answers them on the exercise's own page
 * (MARKET.md, row 4).
 *
 * It is a sheet over Progress rather than a seventh screen, and it lists the
 * last `HISTORY_SESSIONS` workouts with a line saying how many more there are.
 *
 * Every number on it is a set the lifter actually did. No e1RM is printed:
 * `pr.ts` lets an estimate rank sets but never stand in for one.
 */

/**
 * What the sheet tells the lifter, one section each, in the order it draws
 * them. `LiftSheet` renders from this list and `tools/inventory.ts` counts it,
 * so the count is of sections a lifter can see.
 */
export const LIFT_INSIGHTS = ['repBests', 'sessions'] as const;
export type LiftInsight = typeof LIFT_INSIGHTS[number];

/** The most workouts the sheet lists, newest first. */
export const HISTORY_SESSIONS = 12;

export interface LiftSession {
  sessionId: string;
  /** When the workout started: the day RECENT WORKOUTS and the recap name it by. */
  startedAt: number;
  /**
   * The workout's top set of this lift, in the display unit. It is chosen by
   * `topSetPerExercise`, the rule the recap card and RECENT WORKOUTS already
   * use, so the three can never name different sets for one workout.
   */
  weight: number;
  reps: number;
  /** How many sets of this lift that workout logged. */
  sets: number;
  /**
   * That workout's recap awarded a record on this lift. It is decided by
   * `findPRs`, on the history the recap saw (everything logged before the
   * workout began), in the workout's own unit.
   */
  record: boolean;
}

/** The heaviest set done for a rep count, when nothing heavier was done for more reps. */
export interface RepBest {
  reps: number;
  /** The weight they entered, in the display unit. 0 is bodyweight. */
  weight: number;
  /** When they did it. The first time, if they matched it later. */
  at: number;
}

export interface LiftHistory {
  exerciseId: string;
  name: string;
  unit: Unit;
  /** Newest first, at most `HISTORY_SESSIONS`. */
  sessions: LiftSession[];
  /** The workouts the cap leaves out. */
  olderSessions: number;
  /** Fewest reps first: every rep count whose best set was done for exactly that many reps. */
  repBests: RepBest[];
}

export function liftHistory(repo: Repo, exerciseId: string): LiftHistory | null {
  const all = repo.allSets();
  const mine = all.filter(s => s.exerciseId === exerciseId);
  if (!mine.length) return null;

  const unit = displayUnit(repo);
  const measurements = repo.measurements();
  const sessionUnits = repo.sessionUnits();
  const exercises = repo.exercises();
  const unitOf = (sessionId: string) => sessionUnits.get(sessionId) ?? unit;
  const shown = (x: LoggedSet) => {
    const from = unitOf(x.sessionId);
    return from === unit ? x.weight : convertWeight(x.weight, from, unit);
  };

  // When each workout began, over ALL its sets: the history a recap's records
  // were judged against is everything logged before that (`historyBefore`).
  const began = new Map<string, number>();
  for (const s of all) {
    const at = began.get(s.sessionId);
    if (at === undefined || s.at < at) began.set(s.sessionId, s.at);
  }

  const bySession = new Map<string, LoggedSet[]>();
  for (const s of mine) {
    const held = bySession.get(s.sessionId);
    if (held) held.push(s);
    else bySession.set(s.sessionId, [s]);
  }
  const ordered = [...bySession.keys()].sort((a, b) => began.get(b)! - began.get(a)!);

  const sessions = ordered.slice(0, HISTORY_SESSIONS).map(sessionId => {
    const sets = bySession.get(sessionId)!;
    const own = unitOf(sessionId);
    const top = topSetPerExercise(sets, measurements, own).get(exerciseId)!;
    const start = began.get(sessionId)!;
    const before = mine.filter(s => s.sessionId !== sessionId && s.at < start);
    return {
      sessionId,
      startedAt: repo.session(sessionId)?.startedAt ?? start,
      weight: shown(top),
      reps: top.reps,
      sets: sets.length,
      record: findPRs(sets, before, exercises, own, measurements, sessionUnits).length > 0
    };
  });

  /*
   * A rep count earns a row only when its best set was done for exactly that
   * many reps. Otherwise a heavier set for more reps beats it, and the row would
   * repeat that set under a smaller number. Every set competes, high reps too,
   * because that is how `pr.ts` compares them: after 300 × 15, a 280 × 10 is not
   * a record, so the sheet does not call it the best for ten. Only the rep counts
   * actually done can have a row.
   */
  const counts = [...new Set(mine.map(s => s.reps))].filter(r => r >= 1).sort((a, b) => a - b);
  const repBests: RepBest[] = [];
  for (const reps of counts) {
    const best = bestSetAtReps(mine, exerciseId, reps, measurements, unit, sessionUnits);
    if (best && best.reps === reps) repBests.push({ reps, weight: shown(best), at: best.at });
  }

  return {
    exerciseId,
    name: exercises.get(exerciseId)?.name ?? exerciseId,
    unit,
    sessions,
    olderSessions: Math.max(0, ordered.length - HISTORY_SESSIONS),
    repBests
  };
}
