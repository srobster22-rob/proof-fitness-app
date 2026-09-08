import type { Repo } from '../data/repo.ts';
import { exportAll, serialize, parse, restore, summarise, count } from '../data/portable.ts';
import { t, fill, languageOf, type Language } from '../domain/i18n.ts';

/**
 * Export and restore, as the screen sees it. PROMPT.md §11.
 *
 * The file-writing and share-sheet calls live in `backup.ts`, which touches
 * native modules; everything decidable is here so it can be tested. The split is
 * the same one used for `open-once`/`db` and `locale`/`inferUnit`.
 *
 * **Where this lives, decided:** a single line at the bottom of Progress, not a
 * settings screen. §9 bans a settings screen and §11 requires an export; a
 * settings screen would exist solely to hold one button, which is how apps grow
 * the clutter §5 is written to prevent. Progress is already the data screen.
 */

/**
 * `proof-backup-2026-07-29.json`.
 *
 * Dated, not timestamped: someone exporting twice in a day almost certainly
 * wants the second file to replace the first, and a name with seconds in it
 * leaves a pile of near-identical files in their Files app instead.
 */
export function backupFilename(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `proof-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

export interface BackupContents {
  filename: string;
  text: string;
  /** What the user is about to send, so the screen can say it before sharing. */
  summary: string;
}

export function prepareBackup(repo: Repo, now: number): BackupContents {
  const file = exportAll(repo, now);
  const { sets, sessions } = file.counts;
  const lang = languageOf(repo);
  return {
    filename: backupFilename(now),
    text: serialize(file),
    // Stated up front because the file is about to leave the device via a share
    // sheet. §11's whole point is that the user is in control of their data, and
    // that means knowing what is in the thing they are sending.
    summary: fill(t(lang, 'exportSummary'), {
      sets: count(sets, t(lang, 'setOne'), t(lang, 'sets')),
      sessions: count(sessions, t(lang, 'sessionOneLower'), t(lang, 'sessionsLower'))
    })
  };
}

export interface RestoreOutcome { ok: boolean; message: string }

/**
 * Parse then merge. Returns one sentence either way.
 *
 * Never throws: this is reached from a document picker, so the input is an
 * arbitrary file the user chose. A crash here would look like the app breaking
 * on a file it simply could not read.
 */
export function applyBackup(repo: Repo, text: string): RestoreOutcome {
  const lang = languageOf(repo);
  const parsed = parse(text);
  // `!== null`, not a truthiness check: the union discriminates on null vs
  // string, and an empty error message is falsy — so `if (parsed.error)` would
  // read a failure with a blank reason as success. tsc caught this.
  //
  // `parsed.error` itself stays English: it is `parse()`'s diagnosis of a
  // malformed or foreign FILE ("Not valid JSON", "Unrecognised format") rather
  // than product copy, and it is meant to be pasted into a support message —
  // translating it would mean support has to translate it back.
  if (parsed.error !== null) return { ok: false, message: parsed.error };
  try {
    const report = restore(repo, parsed.file);
    return { ok: report.ok, message: summarise(report, lang) };
  } catch (e) {
    return { ok: false, message: fill(t(lang, 'restoreFailedErr'), { err: (e as Error).message }) };
  }
}
