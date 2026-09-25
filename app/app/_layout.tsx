import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RepoGate } from '../src/ui/RepoGate.tsx';
import { errorBoundaryFor } from '../src/ui/ScreenErrorBoundary.tsx';
import { watchGlobalErrors } from '../src/ui/error-log.ts';

/**
 * What breaks the layout itself (RepoGate, the stack) is recorded as "app"; each
 * route has its own boundary for its own screen (ScreenErrorBoundary.tsx).
 */
export const ErrorBoundary = errorBoundaryFor('app');

/**
 * Root layout.
 *
 * No tab bar and no headers: §15 says no nav chrome competing with content, and
 * §4 says a cold launch lands on the active workout rather than a home screen —
 * so the router opens on `index`, which IS the Now screen. Progress, Goals and
 * Recap are pushed on top of it, never a destination you have to navigate back
 * from to log a set.
 */
export default function RootLayout() {
  // What no screen's boundary sees: a throw in a handler, a rejected promise.
  useEffect(() => watchGlobalErrors(), []);
  return (
    <>
      <StatusBar style="light" />
      {/* Every route runs past a successful database open, so screens can use the
          throwing `getRepo()` without each one handling failure. */}
      <RepoGate>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: 'fade',
            contentStyle: { backgroundColor: '#08090A' }
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="recap" options={{ animation: 'slide_from_bottom' }} />
        </Stack>
      </RepoGate>
    </>
  );
}
