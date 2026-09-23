import type { Exercise } from './types.ts';

/**
 * Finding a movement by typing part of its name (R683).
 *
 * The picker offers what the day and the lifter's history predict, and below
 * three sessions that is twelve movements of the sixty. Anything else was
 * reachable only by typing its exact library name, and a near miss ("RDL",
 * "Tricep Push", "Front Squats") became a second, duplicate lift with none of
 * the first one's history (PT1). This matches what people actually type.
 */

/** How many matches the add field shows: enough to pick from, few enough to read at a glance. */
export const MATCHES_SHOWN = 5;

/**
 * What a lifter types for a movement the library names another way, keyed by
 * `stem`, so spacing, hyphens and a plural need no entry of their own. Only
 * names that mean ONE movement, because an alias also decides what ADD picks
 * instead of creating: "shoulder press" could be three of them, "flyes" four,
 * and a stiff-leg deadlift is not a Romanian one.
 */
const ALIASES: Record<string, string> = {
  rdl: 'rdl',
  skullcrusher: 'skull-crusher',
  lyingtricepextension: 'skull-crusher',
  ohp: 'ohp',
  militarypress: 'ohp',
  ropepushdown: 'pushdown',
  bss: 'bulgarian-split-squat',
  kbswing: 'kettlebell-swing',
  pecfly: 'fly',
  bench: 'bench'
};

/**
 * One plural off a word: "flies" to "fly", "presses" and "crunches" lose "es",
 * "squats" its "s". Never the "ss" of "press", and nothing under four letters,
 * so "abs" and "ups" stay as typed.
 */
function singular(w: string): string {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (/(ss|ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
}

/**
 * One spelling for every way of typing a name: lower case, no Latin accents,
 * words split on anything that is not a letter, mark or digit (in any script,
 * so a Cyrillic or Japanese name is still a name, and a mark that changes a
 * letter stays with it), one plural off each word, "flye" as "fly", and
 * "dumbbell" as the library's "DB".
 */
export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean)
    .map(w => (w === 'dumbbell' || w === 'dumbbells' ? 'db' : w))
    .map(singular)
    .map(w => (w === 'flye' ? 'fly' : w))
    .join(' ');
}

/**
 * A name with the spaces between words gone and one plural off the end, so
 * "Pull-up", "pull ups" and "pullups" are one thing: "ups" is too short for
 * `singular` as a word of its own, but not once it is joined to "pull". A
 * number keeps its space, or "1/2" would become "12".
 */
function stem(normalized: string): string {
  return singular(normalized.replace(/(?<=[\p{L}\p{M}]) (?=\p{L})/gu, ''));
}

/** The name exactly as typed, ignoring only case and spacing. */
function literal(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Lower is better; null is no match. */
function score(query: string, e: Exercise): number | null {
  const name = normalizeName(e.name);
  if (stem(name) === stem(query)) return 0;
  if (ALIASES[stem(query)] === e.id) return 1;
  if (name.startsWith(query)) return 2;
  const words = name.split(' ');
  if (query.split(' ').every(q => words.some(w => w.startsWith(q)))) return 3;
  // Under three letters, a fragment is inside half the library ("ab" in
  // "cable"), which is no match at all.
  if (stem(query).length >= 3 && (name.includes(query) || stem(name).includes(stem(query)))) return 4;
  return null;
}

/**
 * The movements that match what was typed, best first: the name itself (as
 * typed before any spelling of it), then an alias, then a name that starts
 * with it, one whose words start with its words, and last one that merely
 * contains it. Ties go to the shorter name.
 */
export function findExercises(query: string, exercises: readonly Exercise[], limit = MATCHES_SHOWN): Exercise[] {
  const q = normalizeName(query);
  if (!q) return [];
  const typed = literal(query);
  return exercises
    .map(e => ({ e, s: literal(e.name) === typed ? -1 : score(q, e) }))
    .filter((m): m is { e: Exercise; s: number } => m.s !== null)
    .sort((a, b) => a.s - b.s || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map(m => m.e);
}

/**
 * The movement this name already IS, or null. Adding "RDL" picks Romanian
 * Deadlift instead of making a second one. The name exactly as typed wins
 * first, so a lifter's own "Pullups" keeps its history even though "Pull-up"
 * is the same spelling; then any spelling of a name; then an alias.
 */
export function exactExercise(query: string, exercises: readonly Exercise[]): Exercise | null {
  const typed = literal(query);
  if (!typed) return null;
  const same = exercises.find(e => literal(e.name) === typed);
  if (same) return same;
  const q = normalizeName(query);
  if (!q) return null;
  return exercises.find(e => score(q, e) === 0) ?? exercises.find(e => score(q, e) === 1) ?? null;
}
