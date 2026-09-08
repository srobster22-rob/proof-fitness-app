import fs from 'node:fs';
import path from 'node:path';

/**
 * A `node --test` reporter whose only job is to make a failure survive.
 *
 * Twice now a full-suite run has reported one failure that was never
 * identified (R499, R509), and both times the cause was the same and was
 * mine: the command that ran the suite piped stdout through `grep` to pull out
 * the counts, so the name of the failing test and its assertion went to
 * /dev/null. The second time I even had a mechanism from R501 to check it
 * against and could not, because there was nothing left to check.
 *
 * "Remember to capture the output" is not a fix — it is the same instruction
 * that was already being ignored. A reporter writes to a FILE, so the evidence
 * is kept by the runner rather than by the discipline of whoever invoked it,
 * and it survives any pipe, filter or truncation applied to stdout.
 *
 * Deliberately silent: it yields nothing, so the spec reporter running
 * alongside it owns the console and this changes nothing about what a person
 * sees. It only leaves a file behind.
 *
 * The file is rewritten per run, not appended across runs. A log that grows
 * forever gets ignored, and the question being answered is always "what failed
 * in the run that just happened".
 */
/*
 * Overridable, and only so this reporter can be TESTED without two runs
 * writing the same file. The suite runs as ~120 concurrent processes, and a
 * test that spawns its own run would otherwise stamp on the log belonging to
 * the run it is part of — the shared-artifact defect R501 spent a round
 * removing, reintroduced by the very thing meant to record such defects.
 */
const OUT = process.env.PROOF_FAILURE_LOG
  || path.join(import.meta.dirname, '..', 'test-failures.log');

export default async function* failureLog(source) {
  let started = false;
  let failures = 0;

  const write = (text) => {
    try {
      if (!started) { fs.writeFileSync(OUT, text); started = true; }
      else fs.appendFileSync(OUT, text);
    } catch {
      // A reporter must never be the reason a test run dies. If the log cannot
      // be written the suite result is still the suite result.
    }
  };

  write(`# test failures — ${new Date().toISOString()}\n`);

  for await (const event of source) {
    if (event.type === 'test:fail') {
      const { name, file, line, details } = event.data;
      // Suites report a failure of their own once a child fails; counting
      // those would multiply one real failure into several.
      if (details?.error?.failureType === 'subtestsFailed') continue;
      failures++;
      const err = details?.error;
      write(
        `\n--- ${failures} ---\n` +
        `test: ${name}\n` +
        `file: ${file ?? '(unknown)'}${line ? ':' + line : ''}\n` +
        `error: ${err?.message ?? '(no message)'}\n` +
        (err?.cause?.stack ? `stack:\n${err.cause.stack}\n` : '')
      );
    }
  }

  write(failures === 0 ? '\n(no failures)\n' : `\n${failures} failure(s)\n`);
}
