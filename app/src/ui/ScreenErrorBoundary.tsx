import React, { useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t, languageFor } from '../domain/i18n.ts';
import { deviceLocale } from './locale.ts';
import { recordError } from './error-log.ts';
import { failure as s } from './failure-look.ts';

/**
 * A route's error boundary: expo-router renders it in place of a screen whose
 * render threw (AGENT_LOOP §3a item 6). The error is recorded against the
 * screen's name, so the log says WHICH screen broke, and the screen says so
 * too, with the message and a way to try again, instead of a white page.
 *
 * Every route exports one: `export const ErrorBoundary = errorBoundaryFor('progress')`.
 *
 * Its words come from the device locale, as RepoGate's do: the preference
 * lives in the database, which may be the thing that failed. Its face is
 * RepoGate's too (failure-look.ts).
 */
const T = (k: Parameters<typeof t>[1]) => t(languageFor(deviceLocale()), k);

type BoundaryProps = { error: Error; retry: () => Promise<void> };

export function errorBoundaryFor(screen: string): (props: BoundaryProps) => React.ReactElement {
  function ScreenError({ error, retry }: BoundaryProps) {
    useEffect(() => { recordError(screen, error); }, [error]);
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.body} accessibilityRole="alert">
          <View style={s.mark} />
          <Text style={s.title}>{T('screenErrorTitle')}</Text>
          <Text style={s.body1}>{T('screenErrorBody')}</Text>
          <View style={s.detail}>
            <Text style={s.detailLabel}>{screen.toUpperCase()}</Text>
            <Text style={s.detailText} selectable>{error.message}</Text>
          </View>
          <Pressable style={s.retry} onPress={() => { void retry(); }} accessibilityRole="button"
            accessibilityLabel={T('screenErrorRetry')}>
            <Text style={s.retryText}>{T('screenErrorRetry')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }
  ScreenError.displayName = `ErrorBoundary(${screen})`;
  return ScreenError;
}
