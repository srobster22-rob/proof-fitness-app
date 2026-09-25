import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { NowScreen } from '../src/ui/NowScreen.tsx';
import { getRepo } from '../src/data/db.ts';
import { deviceLocale } from '../src/ui/locale.ts';
import { useGuardedPush } from '../src/ui/guarded-push.ts';
import { errorBoundaryFor } from '../src/ui/ScreenErrorBoundary.tsx';

/** A render error here is recorded as "now" and shown in place of the screen. */
export const ErrorBoundary = errorBoundaryFor('now');

/**
 * The app's entry point IS the logging screen. §4: cold launch goes to the
 * active workout if one is running, never a home screen — and `NowModel`'s
 * constructor resolves that on its own, resuming a live session or closing a
 * stale one and starting fresh.
 */
export default function Index() {
  const repo = getRepo();
  const router = useRouter();
  const push = useGuardedPush(router);

  const onFinish = useCallback(() => {
    // §5 screen 4 — the recap is generated automatically when a workout ends;
    // it is not something the user has to go and ask for. NowScreen's own
    // FINISH button already guards against calling this twice (R383) — this
    // guard is belt and braces, so nothing that reaches `onFinish` some
    // other way in the future silently inherits an unguarded push.
    push('/recap');
  }, [push]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.body}>
        <NowScreen
          repo={repo}
          locale={deviceLocale()}
          onFinish={onFinish}
          onOpenProgress={() => push('/progress')}
          onOpenGoals={() => push('/goals')}
          onOpenSettings={() => push('/settings')}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  body: { flex: 1 }
});
