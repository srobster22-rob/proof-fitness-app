import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Now screen's source as one text, for the tests that read it as text.
 *
 * NowScreen.tsx was one 2,673-line file. Its sheets, small controls, shared
 * constants and stylesheet now have their own files, and so do its hooks and
 * the sections it draws. These tests read the screen as a whole, so they read
 * those files together: the kit, the screen, its hooks, its sections in the
 * order they are drawn, then the sheets. Reading source text is debt
 * (AGENT_LOOP §3a item 8, ARCHITECTURE.md); this keeps a move a move.
 */
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const NOW_SCREEN_FILES = [
  'src/ui/now-kit.ts', 'src/ui/NowScreen.tsx', 'src/ui/now-hooks.ts', 'src/ui/NowHeader.tsx',
  'src/ui/LogRows.tsx', 'src/ui/DayRail.tsx', 'src/ui/TodaySets.tsx', 'src/ui/NowFooter.tsx',
  'src/ui/DayChooser.tsx', 'src/ui/EditSetSheet.tsx', 'src/ui/ExercisePicker.tsx', 'src/ui/EquipmentSheet.tsx',
  'src/ui/NowControls.tsx', 'src/ui/now-styles.ts',
];

export function nowScreenSource(): string {
  return NOW_SCREEN_FILES.map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
}
