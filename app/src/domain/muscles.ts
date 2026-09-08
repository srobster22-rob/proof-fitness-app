import type { LoggedSet } from './types.ts';
import { t, type Language } from './i18n.ts';

/**
 * What each movement actually trains, and what that means for what to do next.
 *
 * The picker already answers "what do you usually train next" — `predict.ts`
 * scores frequency and recency from this user's own history. That is the right
 * answer for a returning lifter and a useless one for everybody else: with no
 * history it falls back to a generic list, and even with history it will
 * happily hand you a second heavy horizontal press straight after the first,
 * because that is what you did last week too.
 *
 * This is the other half — what the training literature says about ORDER within
 * a session, so the app can recommend rather than merely repeat.
 *
 * ## The evidence this encodes
 *
 * 1. **Compounds before isolations for the same muscle.** The most consistently
 *    supported ordering rule: work performed early in a session gets maximal
 *    neuromuscular output, and whatever is left to the end is done under
 *    accumulated fatigue. Pre-exhausting with an isolation first reduces the
 *    load on the following compound by roughly 10–30% with no hypertrophy
 *    benefit to show for it.
 *
 * 2. **Order matters much less than volume and effort.** A meta-analysis across
 *    11 studies and 268 participants found a hypertrophy effect size of 0.03
 *    (p = 0.86) between compound-first and isolation-first training. This is
 *    why the recommendation is a SUGGESTION with a stated reason and never a
 *    restriction: the honest claim is "this is the more efficient order", not
 *    "the other one does not work".
 *
 * 3. **Shared prime movers are the thing to avoid back-to-back.** Bench press,
 *    incline press and overhead press are all built on pectoralis major,
 *    anterior deltoid and triceps brachii; bench performance measurably decays
 *    with accumulated fatigue (lower bar velocity, longer lift times). Stacking
 *    two of them consecutively means the second is done with the first one's
 *    fatigue, so it is the same muscles for less load.
 *
 * 4. **Pairing distant muscle groups is efficient, not a compromise.**
 *    Agonist–antagonist paired sets reach comparable strength and hypertrophy
 *    outcomes in about half the session time (4.5 h vs 10.1 h of total training
 *    in one trial), which is why "go do something that is not fatigued" is a
 *    recommendation rather than a consolation prize.
 *
 * Sources are listed in RECOMMENDATION_SOURCES below so the claim can be
 * checked rather than taken on faith (§16).
 */

export type Muscle =
  | 'chest' | 'frontdelt' | 'sidedelt' | 'reardelt' | 'triceps'
  | 'lats' | 'upperback' | 'traps' | 'biceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'lowerback' | 'core';

export interface Profile {
  /** The muscles the movement is FOR. */
  primary: Muscle[];
  /** Muscles meaningfully involved but not the point of the lift. */
  secondary: Muscle[];
  /**
   * Multi-joint, driven by more than one muscle group.
   *
   * Decides the compound-before-isolation rule, so it is a property of the
   * movement rather than a count of the muscle lists.
   */
  compound: boolean;
}

/**
 * The library, mapped.
 *
 * Custom movements the user invents are deliberately absent — see
 * `profileFor`. Inventing a muscle profile for "Sled Push" from its name would
 * be exactly the made-up fact §16 exists to stop, and a wrong profile is worse
 * than none because it would move real recommendations around.
 */
export const MUSCLES: Record<string, Profile> = {
  // ---- push ---------------------------------------------------------------
  bench:      { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true },
  incline:    { primary: ['chest', 'frontdelt'], secondary: ['triceps'], compound: true },
  dbpress:    { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true },
  chestpress: { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true },
  pushup:     { primary: ['chest', 'triceps'], secondary: ['frontdelt', 'core'], compound: true },
  dip:        { primary: ['chest', 'triceps'], secondary: ['frontdelt'], compound: true },
  ohp:        { primary: ['frontdelt', 'triceps'], secondary: ['sidedelt', 'core'], compound: true },
  dbohp:      { primary: ['frontdelt', 'triceps'], secondary: ['sidedelt'], compound: true },
  fly:        { primary: ['chest'], secondary: [], compound: false },
  triext:     { primary: ['triceps'], secondary: [], compound: false },
  pushdown:   { primary: ['triceps'], secondary: [], compound: false },
  lateral:    { primary: ['sidedelt'], secondary: [], compound: false },

  // ---- pull ---------------------------------------------------------------
  row:       { primary: ['lats', 'upperback'], secondary: ['biceps', 'lowerback'], compound: true },
  dbrow:     { primary: ['lats', 'upperback'], secondary: ['biceps'], compound: true },
  cablerow:  { primary: ['lats', 'upperback'], secondary: ['biceps'], compound: true },
  pulldown:  { primary: ['lats'], secondary: ['biceps'], compound: true },
  pullup:    { primary: ['lats'], secondary: ['biceps'], compound: true },
  chinup:    { primary: ['lats', 'biceps'], secondary: [], compound: true },
  deadlift:  { primary: ['hamstrings', 'glutes', 'lowerback'], secondary: ['traps', 'lats'], compound: true },
  shrug:     { primary: ['traps'], secondary: ['forearms'], compound: false },
  facepull:  { primary: ['reardelt', 'upperback'], secondary: [], compound: false },
  revfly:    { primary: ['reardelt', 'upperback'], secondary: [], compound: false },
  curl:      { primary: ['biceps'], secondary: ['forearms'], compound: false },
  hammer:    { primary: ['biceps', 'forearms'], secondary: [], compound: false },

  // ---- legs ---------------------------------------------------------------
  squat:     { primary: ['quads', 'glutes'], secondary: ['lowerback', 'core'], compound: true },
  legpress:  { primary: ['quads', 'glutes'], secondary: [], compound: true },
  lunge:     { primary: ['quads', 'glutes'], secondary: ['core'], compound: true },
  rdl:       { primary: ['hamstrings', 'glutes'], secondary: ['lowerback'], compound: true },
  hipthrust: { primary: ['glutes', 'hamstrings'], secondary: [], compound: true },
  legcurl:   { primary: ['hamstrings'], secondary: [], compound: false },
  legext:    { primary: ['quads'], secondary: [], compound: false },
  calf:      { primary: ['calves'], secondary: [], compound: false }
};

/** Null for anything invented by the user — see MUSCLES. */
export function profileFor(exerciseId: string): Profile | null {
  return MUSCLES[exerciseId] ?? null;
}

/**
 * How much two movements tread on each other, 0 to 1.
 *
 * Primary-on-primary is the expensive collision — two lifts built on the same
 * prime movers — so it is weighted full. A primary landing on somebody else's
 * secondary is real but cheaper, and secondary-on-secondary barely registers.
 * Scaled by the candidate's own primary count so a two-muscle lift is not
 * penalised simply for involving more.
 */
export function overlap(a: Profile, b: Profile): number {
  const inB = (m: Muscle) => b.primary.includes(m) ? 1 : b.secondary.includes(m) ? 0.4 : 0;
  let score = 0;
  for (const m of a.primary) score += inB(m);
  for (const m of a.secondary) score += 0.4 * inB(m);
  const most = a.primary.length + 0.4 * a.secondary.length;
  return most === 0 ? 0 : score / most;
}

export interface Recommendation {
  exerciseId: string;
  /** Higher is a better next choice. */
  score: number;
  /** Why, in the app's own words. Empty when there is nothing worth saying. */
  reason: string;
}

/**
 * What to do next, and why.
 *
 * Three signals, in the order they matter:
 *
 * 1. **Fresh muscles beat fatigued ones.** A candidate whose prime movers were
 *    just used as prime movers is the same work for less load — that is the
 *    bench → incline → overhead press trap, where all three run on chest,
 *    anterior deltoid and triceps. The penalty is heaviest against the lift
 *    JUST done and lighter against the rest of the session, because fatigue
 *    fades across a workout rather than staying flat.
 *
 * 2. **Compounds before isolations, per muscle.** Once a muscle has had its
 *    compound, its isolation is the natural follow-up; before that, the
 *    isolation is pre-exhaustion, which costs the compound 10–30% of its load
 *    for no measured benefit.
 *
 * 3. **Nothing already trained today.** A lift already done this session is not
 *    a recommendation, it is a repetition, and the "+" on its own block is the
 *    faster way to add another set of it.
 *
 * Returns every candidate scored, best first, so the caller can rank a whole
 * rail rather than take one answer on trust.
 */
export function recommendNext(
  candidates: string[],
  sessionSets: readonly LoggedSet[],
  lang: Language = 'en'
): Recommendation[] {
  const done = sessionSets.map(s => s.exerciseId);
  const last = done.length ? done[done.length - 1] : null;
  const lastProfile = last ? profileFor(last) : null;

  /** Muscles already hit by a COMPOUND this session — see rule 2. */
  const compounded = new Set<Muscle>();
  for (const id of done) {
    const p = profileFor(id);
    if (p?.compound) for (const m of p.primary) compounded.add(m);
  }

  const earlier = new Set(done.slice(0, -1));

  return candidates.map(id => {
    const p = profileFor(id);
    // An unmapped movement is scored neutrally and says nothing. Guessing at a
    // profile from a name the user typed would move real recommendations.
    if (!p) return { exerciseId: id, score: 0, reason: '' };

    let score = 1;
    let reason = '';

    if (done.includes(id)) {
      // Already trained today. Not wrong, just not a recommendation.
      score -= 1.2;
      reason = '';
    }

    /*
     * The isolation that FINISHES the compound you just did is the one case
     * where overlap is the point rather than the problem — that is the whole
     * compound-then-isolation rule. Scored as a clash it came out behind an
     * overhead press after a bench press, which is precisely the pairing the
     * evidence argues against, so the penalty is not applied to it.
     */
    const finishes = !p.compound
      && p.primary.length > 0
      && p.primary.every(m => compounded.has(m));

    if (lastProfile && id !== last && !finishes) {
      const clash = overlap(p, lastProfile);
      score -= clash * 1.6;
      if (clash >= 0.75) {
        reason = t(lang, 'reasonHeavyOverlap');
      } else if (clash <= 0.15) {
        reason = t(lang, 'reasonNotFatigued');
      }
    }

    // Anything trained earlier in the session, at a third of the weight: real
    // fatigue, but it has had time.
    if (!finishes) {
      for (const id2 of earlier) {
        const p2 = profileFor(id2);
        if (p2) score -= overlap(p, p2) * 0.5;
      }
    }

    if (!p.compound) {
      if (finishes) {
        /*
         * The textbook follow-up: the compound is done, now finish the muscle
         * off with the isolation.
         *
         * 0.4, not 0.9. At 0.9 it outranked a compound on a completely FRESH
         * muscle, which inverts the rule it is meant to implement — on a
         * full-body day the leg press belongs before the triceps extension,
         * because compound-first means the heavy work happens while something
         * is still fresh. Tuned so the order comes out: fresh compound, then
         * the finishing isolation, then anything that collides with what was
         * just trained.
         */
        score += 0.4;
        reason = t(lang, 'reasonFinishesCompound');
      } else {
        // Isolation first is pre-exhaustion: it costs the compound 10-30% of
        // its load for no measured hypertrophy benefit.
        score -= 0.5;
        if (!reason) reason = t(lang, 'reasonAfterHeavyWork');
      }
    } else {
      const fresh = p.primary.filter(m => !compounded.has(m));
      if (fresh.length === p.primary.length) {
        score += 0.6;
        if (!reason) reason = t(lang, 'reasonFreshMuscle');
      }
    }

    return { exerciseId: id, score: Math.round(score * 1000) / 1000, reason };
  }).sort((a, b) => b.score - a.score || a.exerciseId.localeCompare(b.exerciseId));
}

/**
 * Where the ordering rules come from, so the claim can be checked.
 *
 * §16: a number the user cannot check against anything is one they cannot
 * trust, and that applies double to advice. Kept in the code rather than in a
 * doc because the code is what implements it.
 */
export const RECOMMENDATION_SOURCES: Array<{ claim: string; url: string }> = [
  {
    claim: 'Pre-exhaustion (isolation before compound) offers no added benefit over ' +
           'compound-first ordering.',
    url: 'https://cdnsciencepub.com/doi/full/10.1139/apnm-2014-0162'
  },
  {
    claim: 'Compound-first ordering, and the ~0.03 hypertrophy effect size between ' +
           'orderings across 11 studies — order matters, but far less than volume.',
    url: 'https://hypertrophy.towerofrecords.com/hypertrophy/exercise-order'
  },
  {
    claim: 'Bench, incline and overhead pressing all run on pectoralis major, anterior ' +
           'deltoid and triceps brachii.',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9354811/'
  },
  {
    claim: 'Bench press performance measurably decays with accumulated fatigue.',
    url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4096084/'
  },
  {
    claim: 'Agonist-antagonist paired sets reach comparable adaptations in roughly half ' +
           'the total training time.',
    url: 'https://pubmed.ncbi.nlm.nih.gov/20733520/'
  }
];
