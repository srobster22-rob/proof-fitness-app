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
