import { requireNativeModule, EventEmitter } from 'expo-modules-core';

const native = requireNativeModule('RecapExporter');
export const emitter = new EventEmitter(native);

export type Lift = { name: string; load: string; isPR: boolean };

export type RecapOptions = {
  title: string;
  date: string;
  volume: number;
  sets: number;
  duration: string;
  streak: number;
  prLift?: string;
  prWeight?: number;
  prReps?: number;
  prPrev?: number;
  lifts: Lift[];
  watermark: string;
  /** file:// URL of a camera-roll clip to composite underneath. */
  clipUri?: string;
};

export type RecapResult = { uri: string; elapsedMs: number };

/** Writes a 1080x1920 H.264 mp4 to the temp directory. Resolves with its file URL. */
export function exportRecap(options: RecapOptions): Promise<RecapResult> {
  return native.export(options);
}

export function cancelExport(): void {
  native.cancel();
}

export function onProgress(cb: (p: number) => void) {
  return emitter.addListener<{ progress: number }>('onProgress', e => cb(e.progress));
}
