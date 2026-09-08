import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { RepoGate } from '../src/ui/RepoGate.tsx';

/**
 * expo-router renders this instead of a white screen when a route throws during
 * render. Re-exported rather than written: the default surfaces the stack, which
 * is what you actually want the first time the app runs on a device.
 */
export { ErrorBoundary } from 'expo-router';

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
