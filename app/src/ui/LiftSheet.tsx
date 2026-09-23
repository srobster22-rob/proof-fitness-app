import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { BottomSheet } from './BottomSheet.tsx';
import { getRepo } from '../data/db.ts';
import { t, fill, languageOf } from '../domain/i18n.ts';
import { loadLabel } from '../domain/types.ts';
import { liftHistory, LIFT_INSIGHTS, type LiftHistory, type LiftInsight } from './lift-history.ts';
import { shortDate } from './dates.ts';
import { TYPE, SPACING } from './type.ts';
import { pressStyle, useReducedMotion } from './press.ts';

const VOLT = '#CCFF00';
const MUTED = '#7C8792';

/**
 * One lift's own history, opened from its row on Progress (R680).
 *
 * A sheet rather than a seventh screen: §5 keeps Progress "one screen, not a
 * dashboard", and this is that screen looked at more closely, not somewhere
 * else to go. What it shows is `liftHistory`'s, and every number on it is a
 * set the lifter logged. Its sections are `LIFT_INSIGHTS`, in that order.
 */
export function LiftSheet({ exerciseId, onClose }: { exerciseId: string; onClose: () => void }) {
  const repo = getRepo();
  const lang = languageOf(repo);
  const still = useReducedMotion();
  const h = useMemo(() => liftHistory(repo, exerciseId), [repo, exerciseId]);
  if (!h) return null;
  const T = (k: Parameters<typeof t>[1]) => t(lang, k);
  // "BW" alone: bodyweight takes no unit (`loadLabel`).
  const weightOf = (w: number) => (w === 0 ? loadLabel(0) : `${loadLabel(w)} ${h.unit}`);
  const repCount = (n: number) => fill(T(n === 1 ? 'oneRepCount' : 'repCount'), { n });
  const setCount = (n: number) => `${n} ${T(n === 1 ? 'setOne' : 'sets')}`;

  const sections: Record<LiftInsight, (h: LiftHistory) => React.ReactNode> = {
    repBests: ({ repBests }) => (
      <>
        <Text style={s.label}>{T('repBestsHeading')}</Text>
        {repBests.map(b => (
          <View key={b.reps} style={s.line} accessible
            accessibilityLabel={fill(T('repBestA11y'), {
              count: repCount(b.reps), weight: weightOf(b.weight), when: shortDate(b.at, lang)
            })}>
            <Text style={s.lead}>{repCount(b.reps)}</Text>
            <Text style={s.value}>{weightOf(b.weight)}</Text>
            <Text style={s.meta}>{shortDate(b.at, lang)}</Text>
          </View>
        ))}
      </>
    ),
    sessions: ({ sessions, olderSessions }) => (
      <>
        <Text style={s.label}>{T('liftWorkoutsHeading')}</Text>
        {sessions.map(x => (
          <View key={x.sessionId} style={s.line} accessible
            accessibilityLabel={fill(T('liftWorkoutA11y'), {
              when: shortDate(x.startedAt, lang), weight: weightOf(x.weight), reps: x.reps, sets: setCount(x.sets)
            }) + (x.record ? T('personalRecordA11y') : '')}>
            <Text style={s.lead}>{shortDate(x.startedAt, lang)}</Text>
            <Text style={s.value}>
              {loadLabel(x.weight)} × {x.reps}
              {x.record && <Text style={s.star}> ★</Text>}
            </Text>
            <Text style={s.meta}>{setCount(x.sets)}</Text>
          </View>
        ))}
        {olderSessions > 0 && (
          <Text style={s.older}>
            {fill(T(olderSessions === 1 ? 'olderWorkoutOne' : 'olderWorkouts'), { n: olderSessions })}
          </Text>
        )}
      </>
    )
  };

  return (
    <BottomSheet label={fill(T('liftHistoryA11y'), { lift: h.name })} onClose={onClose}>
      <View style={s.head}>
        <Text style={s.title} role="heading" numberOfLines={1}>{h.name}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={16}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('done')}>
          <Text style={s.close}>{T('done')}</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {LIFT_INSIGHTS.map(id => <React.Fragment key={id}>{sections[id](h)}</React.Fragment>)}
      </ScrollView>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { color: '#fff', fontSize: TYPE.title, fontWeight: '900', flexShrink: 1 },
  close: { color: MUTED, fontSize: TYPE.label, fontWeight: '800', letterSpacing: SPACING.label },
  label: {
    color: MUTED, fontSize: TYPE.micro, fontWeight: '800',
    letterSpacing: SPACING.micro, marginTop: 20, marginBottom: 6
  },
  line: {
    flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: '#161B20'
  },
  lead: { color: '#9AA5AF', fontSize: TYPE.body, width: 72 },
  value: { color: '#E8EAED', fontSize: TYPE.body, fontWeight: '800', flex: 1 },
  meta: { color: MUTED, fontSize: TYPE.meta, fontWeight: '700' },
  star: { color: VOLT, fontWeight: '900' },
  older: { color: MUTED, fontSize: TYPE.meta, marginTop: 12 }
});
