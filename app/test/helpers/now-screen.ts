import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Now screen's source as one text, for the tests that read it as text.
 *
 * NowScreen.tsx was one 2,673-line file until R698 moved its sheets, small
 * controls, shared constants and stylesheet into their own files. These tests
 * read the screen as a whole, so they read those files together, in the order
 * the code stood in the old file: whatever sat between two functions still
 * does. Reading source text is debt (AGENT_LOOP §3a item 8, ARCHITECTURE.md);
 * this keeps the move a move.
 */
const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const NOW_SCREEN_FILES = [
  'src/ui/now-kit.ts', 'src/ui/NowScreen.tsx', 'src/ui/DayChooser.tsx', 'src/ui/EditSetSheet.tsx',
  'src/ui/ExercisePicker.tsx', 'src/ui/EquipmentSheet.tsx', 'src/ui/NowControls.tsx', 'src/ui/now-styles.ts',
];

export function nowScreenSource(): string {
  return NOW_SCREEN_FILES.map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
}
