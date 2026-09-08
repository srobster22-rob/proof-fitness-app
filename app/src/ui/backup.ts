import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import type { Repo } from '../data/repo.ts';
import { prepareBackup, applyBackup, type RestoreOutcome } from './backup-model.ts';
import { t, fill, languageOf } from '../domain/i18n.ts';

/**
 * The native half of export/restore. PROMPT.md §11.
 *
 * Everything decidable lives in `backup-model.ts`; this file only touches
 * modules a test runner cannot load. Same split as `db`/`open-once` and
 * `locale`/`inferUnit` — it keeps the untestable surface as small as possible.
 */

/**
 * Write the backup to the cache directory and hand it to the share sheet.
 *
 * Cache rather than documents: once the user has sent it, the copy on device is
 * redundant, and the OS is welcome to reclaim it. Leaving backups in the
 * documents directory would silently accumulate a full history-sized file per
 * export.
 */
export async function shareBackup(repo: Repo, now: number): Promise<RestoreOutcome> {
  const lang = languageOf(repo);
  try {
    const { filename, text, summary } = prepareBackup(repo, now);

    /*
     * The browser has its own way of handing a file to a user, and none of the
     * native machinery above works there. `expo-file-system`'s `File`/`Paths`
     * API is native-only: calling it on web threw
     * `this.validatePath is not a function`, and the raw message went straight
     * to the screen under a promise that reads "A plain JSON file. Yours to
     * keep, readable without this app."
     *
     * §11 is the reason this matters more than a broken dev affordance: there
     * is no server copy, so this file is the only safety net the user has, and
     * it should work wherever the app runs rather than only where it ships.
     * A Blob and an anchor need no dependency and no permission.
     */
    if (Platform.OS === 'web') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick: revoking synchronously can cancel the
      // download in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return { ok: true, message: fill(t(lang, 'exportedLine'), { summary }) };
    }

    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();     // same-day re-export replaces
    file.create();
    file.write(text);

    if (!(await Sharing.isAvailableAsync())) {
      return { ok: false, message: fill(t(lang, 'sharingUnavailable'), { uri: file.uri }) };
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: t(lang, 'trainingLogTitle')
    });
    return { ok: true, message: fill(t(lang, 'exportedLine'), { summary }) };
  } catch (e) {
    return { ok: false, message: fill(t(lang, 'exportFailed'), { err: (e as Error).message }) };
  }
}

/**
 * Pick a backup file and merge it.
 *
 * The picker is deliberately not restricted to `application/json` alone — iOS
 * reports JSON files exported by other apps under a variety of types, and a
 * filter that is too tight makes the user's own file un-pickable, which looks
 * exactly like the app refusing to read it. `parse()` is the real gate.
 */
export async function pickAndRestore(repo: Repo): Promise<RestoreOutcome | null> {
  const lang = languageOf(repo);
  try {
    /*
     * The browser half, for the same reason as `shareBackup`: `File` is
     * native-only, so restore threw before it could read anything — and an
     * export you cannot restore from is not a safety net, it is a file.
     *
     * A bare `<input type="file">` rather than the document picker: it needs no
     * dependency, and the resolve-on-cancel path matters — a file input fires
     * no event when the dialog is dismissed, so without the `cancel` listener
     * the promise would hang forever and the button would look stuck.
     */
    if (Platform.OS === 'web') {
      const text = await new Promise<string | null>(resolve => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          f.text().then(resolve, () => resolve(null));
        };
        input.addEventListener('cancel', () => resolve(null));
        input.click();
      });
      if (text === null) return null;
      return applyBackup(repo, text);
    }

    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'public.json', '*/*'],
      copyToCacheDirectory: true
    });
    if (picked.canceled || !picked.assets?.length) return null;

    const file = new File(picked.assets[0].uri);
    return applyBackup(repo, file.textSync());
  } catch (e) {
    return { ok: false, message: fill(t(lang, 'couldntRead'), { err: (e as Error).message }) };
  }
}
