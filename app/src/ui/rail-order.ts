import type { Exercise } from '../domain/types.ts';
import { BUILTIN, WIDER_LIBRARY } from '../domain/coldstart.ts';

/*
 * The order of the day rail on the Now screen (R678), kept out of now-model.ts so
 * it can be tested directly: `railPool` decides what the lifts are ranked from,
 * `railOrder` puts the day's lifts in the order the rail shows them.
 */

/** A movement's place in the curated library. The lifter's own inventions come first. */
const LIBRARY_PLACE = new Map(BUILTIN.map((e, i) => [e.id, i]));
function libraryPlace(id: string): number {
  return LIBRARY_PLACE.get(id) ?? -1;
}
/** The wider library, which the rail offers only in the room the core leaves. */
const WIDER = new Set(WIDER_LIBRARY.map(e => e.id));

/**
 * The order the day's lifts are ranked from, before the muscle advice moves
 * them (R678).
 *
 * The predictor's ranking comes first, since it knows their history. Then every
 * other lift on the day: movements they invented ahead of the library, because
 * those are theirs (the picker's rule too), and then the library in its curated
 * order, which is the order a lifter with no history meets it. Before this the
 * untrained lifts all tied and fell to NAME order: a brand-new lifter's NEXT
 * after bench was Chest Fly, and after squats Calf Raise.
 */
export function railPool(onDay: readonly Exercise[], candidates: readonly string[]): string[] {
  const ranked = new Set(candidates);
  return [...candidates, ...onDay
    .filter(e => !ranked.has(e.id))
    .sort((a, b) => libraryPlace(a.id) - libraryPlace(b.id))
    .map(e => e.id)];
}

/**
 * Places a lift moves up per point of muscle advice. Measured at 3 and it was not
 * enough: after a bench press the rail still opened on OVERHEAD PRESS, habit
 * outvoting the recommendation by a nose on the exact pairing the evidence
 * argues against. Six moves a good next choice past several habitual ones
 * without burying a lift they always do.
 */
const ADVICE_PLACES = 6;
/** Wider than any pool, so a tier is never crossed by a place in it. */
const TIER = 1000;
const DONE_RANK = 3 * TIER;

/**
 * The day's lifts in rail order (R678).
 *
 * There are three tiers the muscle advice cannot cross, and lifts already done
 * this session come after all of them:
 *   - lifts they have any history with;
 *   - the day's untrained core library;
 *   - the wider library, in whatever room the cap leaves.
 * Within a tier, each lift's place in `pool` is moved by the advice.
 *
 * Without tiers the advice lifted the wider library's compounds over the core's
 * isolation lifts, and the cap then cut Tricep Pushdown off a push day, one of
 * the lifts the owner named when asking for this rail. Tier 0 is "has history"
 * rather than "the predictor listed it", because a lift they only tapped leaves
 * the predictor's list, and it must not then fall behind lifts they never do.
 */
export function railOrder(
  onDay: readonly Exercise[], pool: readonly string[], advice: ReadonlyMap<string, number>,
  hasHistory: (id: string) => boolean, done: ReadonlySet<string>
): Exercise[] {
  const place = new Map(pool.map((id, i) => [id, i - (advice.get(id) ?? 0) * ADVICE_PLACES]));
  const tier = (id: string) => (hasHistory(id) ? 0 : WIDER.has(id) ? 2 : 1);
  const rank = (e: Exercise) => (done.has(e.id) ? DONE_RANK : tier(e.id) * TIER + (place.get(e.id) ?? 0));
  return [...onDay].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
