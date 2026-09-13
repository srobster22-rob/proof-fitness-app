import React from 'react';
import { View, Text, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { getRepo } from '../data/db.ts';
import { t, languageOf } from '../domain/i18n.ts';
import { pressStyle, useReducedMotion } from './press.ts';
import { TAB_BAR_HEIGHT } from './tab-bar.ts';

const VOLT = '#CCFF00';

export type Tab = 'now' | 'progress' | 'goals' | 'settings';

/** Route for each tab. NOW is the root; the others are its siblings. */
export const TAB_ROUTE: Record<Tab, string> = {
  now: '/', progress: '/progress', goals: '/goals', settings: '/settings'
};

/**
 * Where a tab tap goes. NOW is the root screen and is ALWAYS under the current
 * one, so it is reached by popping back to it: `replace('/')` swapped the top
 * of the stack for a second Now, and every trip through another tab left one
 * more live Now screen underneath (R646, measured 1 -> 2 -> 3). The other three
 * are siblings of each other, one deep, so `replace` keeps the stack at two.
 */
export function goTab(
  router: { dismissAll: () => void; replace: (h: never) => void }, tab: Tab
): void {
  if (tab === 'now') router.dismissAll();
  else router.replace(TAB_ROUTE[tab] as never);
}

const GLYPH: Record<Tab, string> = { now: '◆', progress: '↗', goals: '◎', settings: '⚙' };
const LABEL: Record<Tab, 'nowWord' | 'progress' | 'goals' | 'settings'> = {
  now: 'nowWord', progress: 'progress', goals: 'goals', settings: 'settings'
};
const TABS: Tab[] = ['now', 'progress', 'goals', 'settings'];

/**
 * The bottom tab bar, on every tab it names (R645). R640 shipped it on Now
 * alone, so tapping PROGRESS made the bar vanish and the screen you landed on
 * answered "where am I" with a back link -- a bar that disappears when you use
 * it is a row of links that happens to be at the bottom.
 *
 * The current tab is lit and not pressable; the others call `go`. Each tab's
 * spoken label is the same string as the drawn one, from the same table entry.
 */
export function TabBar({ current, go, style }: {
  current: Tab;
  go: (tab: Tab) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const still = useReducedMotion();
  const lang = languageOf(getRepo());
  return (
    <View style={[s.tabBar, style]}>
      {TABS.map(id => {
        const label = t(lang, LABEL[id]);
        const on = id === current;
        return (
          <Pressable
            key={id}
            accessibilityRole="link"
            accessibilityLabel={label}
            disabled={on}
            onPress={() => go(id)}
            style={pressStyle(s.tabItem, 'quiet', still)}
          >
            <Text style={[s.tabGlyph, on && s.tabGlyphOn]}>{GLYPH[id]}</Text>
            <Text style={[s.tabLabel, on && s.tabLabelOn]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  // 56px keeps a 44pt target with a label under the glyph -- see TAB_BAR_HEIGHT.
  // The border is what separates chrome from content above it.
  tabBar: {
    flexDirection: 'row', height: TAB_BAR_HEIGHT,
    borderTopWidth: 1, borderTopColor: '#161B20', backgroundColor: '#0B0D0F'
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  tabGlyph: { color: '#9AA5AF', fontSize: 15, fontWeight: '700' },
  tabGlyphOn: { color: VOLT },
  tabLabel: { color: '#9AA5AF', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  tabLabelOn: { color: VOLT }
});
