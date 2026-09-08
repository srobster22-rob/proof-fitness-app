/**
 * Pull one exported function's SOURCE out of a module, body included.
 *
 * Written for R542's unit gate, which has to ask a question about a specific
 * function — "does this one read a weight?" — in a file where its neighbours
 * do. Asking per MODULE gets the answer wrong in the direction that matters:
 * `session.ts` reads `.weight` ten times and `weekStreak`, which lives in it,
 * reads none, so a module-level check would fail a function that is correct
 * and teach the next reader to stop trusting the gate.
 *
 * Brace counting, not a parser: the repo takes no new dependencies (§12), and
 * the alternative — a regex to the next `\nexport` — silently returns the rest
 * of the file when a function is last in its module.
 */
export function fnSource(src: string, name: string): string {
  const decl = new RegExp(`export (?:async )?function ${name}\s*[(<]`).exec(src);
  if (!decl) throw new Error(`no exported function "${name}" to read`);
  const open = src.indexOf('{', src.indexOf(')', decl.index));
  if (open < 0) throw new Error(`"${name}" has no body`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(decl.index, i + 1);
  }
  throw new Error(`"${name}" never closes — the brace counter walked off the end`);
}

/**
 * The body of the function or method ENCLOSING `i`, as a [start, end) range.
 *
 * R543 needed this because the R542 gate matched a local by NAME across a whole
 * file. Two different methods of `now-model` each open with `const all = ...` —
 * one from `allSets()` and one from `historyInSessionUnit()` — so tracking the
 * name alone reported `prefillFor` as reading raw history when it is handed the
 * converted form, and `progress-model` produced two more of the same kind. A
 * gate that cries wolf gets switched off, which is §8's rule applied to tests.
 *
 * Walks out to the nearest unmatched `{` whose head looks like a function's:
 * ending in `)` or `=>`, or in a RETURN TYPE after one. The return type is not
 * a nicety — `function progressRows(...): ProgressRow[] {` ends in `]`, so the
 * first version walked straight past every annotated function in the file and
 * handed back the whole module as the scope, which is the same "covers less
 * than it claims" failure the gate itself exists to catch.
 */
export function enclosingBody(src: string, i: number): [number, number] {
  let from = i;
  for (;;) {
    let depth = 0, open = -1;
    for (let j = from - 1; j >= 0; j--) {
      if (src[j] === '}') depth++;
      else if (src[j] === '{') {
        if (depth === 0) { open = j; break; }
        depth--;
      }
    }
    if (open < 0) return [0, src.length];
    const head = src.slice(Math.max(0, open - 200), open).trimEnd();
    if (/(\)|=>)$/.test(head) || /\)\s*:\s*[^;{}()]+$/.test(head)) {
      let d = 0;
      for (let k = open; k < src.length; k++) {
        if (src[k] === '{') d++;
        else if (src[k] === '}' && --d === 0) return [open, k];
      }
      return [open, src.length];
    }
    from = open;
  }
}
