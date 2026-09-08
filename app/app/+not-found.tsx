import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { getRepo } from '../src/data/db.ts';
import { t, languageOf } from '../src/domain/i18n.ts';

const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);

/**
 * Reachable in exactly one realistic way: a share link (§5's link path) pointing
 * at a route this build does not have — an older app opening a newer URL. Without
 * this file expo-router shows its own debug screen, which is fine in development
 * and not fine in a stranger's hands.
 */
export default function NotFound() {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <Text style={s.title}>{T('notFoundTitle')}</Text>
        <Text style={s.text}>
          {/* "this version of the app doesn't have YET" promised something that
              may never come, and named a version number the reader cannot see.
              A dead link is usually just a dead link. */}
          {T('notFoundBody')}
        </Text>
        <Link href="/" asChild>
          <Pressable accessibilityRole="button" style={s.button}
            accessibilityLabel={T('goToWorkout')}>
            <Text style={s.buttonText}>{T('goToWorkout')}</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 28, gap: 14 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  text: { color: '#7C8792', fontSize: 15, lineHeight: 23, marginBottom: 14 },
  button: {
    backgroundColor: '#CCFF00', borderRadius: 14, height: 56,
    alignItems: 'center', justifyContent: 'center'
  },
  buttonText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 1.5 }
});
