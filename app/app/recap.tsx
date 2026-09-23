import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useGuardedLeave } from '../src/ui/guarded-push.ts';
import { goTab } from '../src/ui/tab-bar.ts';
import { getRepo } from '../src/data/db.ts';
import { t, fill, languageOf, number } from '../src/domain/i18n.ts';

/**
 * Every visible string on the card, in the chosen language.
 *
 * Module scope, like Progress and Goals: the recap is drawn by several small
 * components and threading a prop through each is how one gets forgotten. This
 * is the artifact §5 judges the product on and the one surface that LEAVES the
 * app — a lifter who set the language to Spanish and shares a workout is
 * sharing it with people who read Spanish.
 */
const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);
import { latestRecap, recapFor, shareText, streakWorthShowing } from '../src/ui/recap-model.ts';
import { COLUMN } from '../src/ui/column.ts';
import { loadLabel } from '../src/domain/types.ts';
import { pressStyle, useReducedMotion } from '../src/ui/press.ts';

/**
 * Screen 4 — Recap. PROMPT.md §5.
 *
 * This is a static preview of the payload, not the shareable itself: the video
 * is produced natively by spike/ios-module and needs a device. What renders
 * here is exactly the data that gets burned into it, so a wrong number shows up
 * before anything is exported rather than after it has been sent.
 *
 * The share button hands over text for now. Wiring it to RecapExporter is the
 * last step, and it is a device-only step.
 */
export default function Recap() {
  const repo = getRepo();
  const router = useRouter();
  // Back, or home when there is nowhere back to — see useGuardedLeave.
  const leave = useGuardedLeave(router);
  /*
   * Reached two ways: straight off FINISH, with no id, and this is the
   * live post-workout card §5 was built around — or from Progress's own
   * history list, with `?session=<id>`, asking for a day already passed.
   *
   * A historical card is read with the CLOCK STOPPED at the session's own
   * end, not today's date. `recapFor`'s `now` decides two live-feeling
   * things — whether a goal reads as achieved, and whether the weekly
   * comparison fires — and both ask "as of when". Passed today's real
   * `Date.now()` for a session from three weeks ago, a goal finished
   * yesterday would retroactively claim THIS card, and the weekly line
   * would compare against a week that session was never part of: a true
   * card about today wearing an old session's date. Passed the session's
   * own end, both questions get the honest, period-accurate answer instead
   * — the card reads exactly as it would have the day it was made.
   */
  const { session: sessionParam } = useLocalSearchParams<{ session?: string }>();
  const viewingHistory = typeof sessionParam === 'string' && sessionParam.length > 0;
  const recap = useMemo(() => {
    if (!viewingHistory) return latestRecap(repo, Date.now());
    const s = repo.session(sessionParam);
    if (!s) return null;
    return recapFor(repo, sessionParam, s.endedAt ?? s.startedAt);
  }, [repo, viewingHistory, sessionParam]);
  const [shareError, setShareError] = useState<string | null>(null);
  // Honour the system's reduced-motion setting — see `useReducedMotion`.
  const still = useReducedMotion();

  /**
   * Sharing must never throw.
   *
   * `Share.share` REJECTS when the platform cannot open a share sheet — on this
   * project's own web preview it rejects with "Share is not supported in this
   * browser" — and the call site did not handle it, so tapping the one button
   * this whole product exists to serve produced an unhandled promise rejection:
   * a red stack trace over the recap in development, and a silently swallowed
   * failure in production where the user taps SHARE and simply nothing happens.
   *
   * Same rule as `feedback()` on the Now screen: the presentation layer is not
   * allowed to blow up. The difference is that a failed share is worth SAYING,
   * because the user asked for it and is owed an answer — a buzz that does not
   * happen is not.
   */
  const share = useCallback(async (message: string) => {
    try {
      setShareError(null);
      await Share.share({ message });
    } catch (e) {
      setShareError(e instanceof Error ? e.message : 'Could not open the share sheet.');
    }
  }, []);

  if (!recap) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.empty}>
          <Text style={s.emptyText}>{T('nothingLogged')}</Text>
          <Pressable accessibilityRole="button" onPress={leave} hitSlop={16}
            style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('back')}>
            <Text style={s.back}>{T('back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const { payload, thin, next, uncounted } = recap;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {/*
          R341: this screen previews the exact artifact §5 says the whole
          product is judged on — "a static preview of the payload, not the
          shareable itself", with the real render happening natively so the
          two stay pixel-for-pixel the same card. Letting Dynamic Type scale
          the PREVIEW would mean showing something different from what
          actually gets shared, on top of overflowing the screen outright:
          measured at 2.35x, the date alone ran to x368 on a 320pt phone.
          `allowFontScaling={false}` here is not a workaround, it is what
          "preview of a fixed artifact" already implies.
        */}
        <View style={s.headerRow}>
          <Text style={s.title} allowFontScaling={false} role="heading">{payload.title}</Text>
          <Text style={s.date} allowFontScaling={false}>{payload.date}</Text>
        </View>
        <View style={s.rule} />

        {/* Slack is shared between two places, not pooled in one.

            A single spacer put every spare pixel in the same gap: measured on a
            five-set session, 380px of nothing between the summary and the lift
            list, which reads as a broken card rather than a short workout. This
            one takes the smaller share above the summary, so on a short session
            the whole block floats clear of the header instead of the card
            splitting in two. Both are flexGrow, so on a long session both are
            simply zero and nothing moves. */}
        <View style={s.slackTop} />

        {/* A total the app cannot actually compute is not shown as one.
            `volumeKnown` is false only for bodyweight work logged before the
            lifter ever recorded a bodyweight — where the sum is 0 because the
            weight ADDED was 0, and printing "TOTAL VOLUME 0 LB" over twelve
            push-ups tells them they moved nothing. The set count and the time
            beside it are still facts, so the card keeps its shape and loses
            only the number it does not have. */}
        {/* R341: same fixed-preview exemption — this is the same hero that
            overflowed to x396/x460 at 2.35x before it was found; it is not
            rendered through `Stat()` so it needed its own fix. */}
        <Text style={s.label} allowFontScaling={false}>{T('totalVolume')}</Text>
        <View style={s.volumeRow}>
          {/* R689: with barbell work beside it, a bodyweight set without a
              reading hid the whole total (13,000 lb for one pull-up set, PT2).
              The total it knows is shown, and the note below says what it
              leaves out; only a total of nothing is still replaced. */}
          {payload.volumeKnown === false && payload.volume <= 0 ? (
            <Text style={s.volumeUnknown} allowFontScaling={false}>{T('needsBodyweight')}</Text>
          ) : (
            <>
              <Text style={s.volume} allowFontScaling={false}>{number(payload.volume, payload.lang ?? 'en')}</Text>
              <Text style={s.unit} allowFontScaling={false}>{payload.unit.toUpperCase()}</Text>
            </>
          )}
        </View>

        {payload.volumeKnown === false && payload.volume > 0 && uncounted > 0 && (
          <Text style={s.volumeNote} allowFontScaling={false}>
            {fill(T(uncounted === 1 ? 'volumeLeavesOutOne' : 'volumeLeavesOut'), { n: uncounted })}
          </Text>
        )}

        <View style={s.stats}>
          <Stat label={T('setsLabel')} value={String(payload.sets)} />
          <Stat label={T('timeLabel')} value={payload.duration} />
          {/* Absent, not zeroed, until it is real — see `streakWorthShowing`.
              The row is three flex:1 tiles, so the two that remain simply
              spread; a tile reading "1 WK" on a first-ever session is a stat
              the app cannot back. */}
          {streakWorthShowing(payload.streak) && (
            <Stat label={T('streakLabel')} value={`${payload.streak} ${T('weekShort')}`}
              hit={payload.streakRecord} />
          )}
        </View>

        {/* R341: the same "fixed preview of the shareable" exemption as the
            title/date/stats above, extended to the rest of the card's own
            text for consistency — none of it is reflowable app UI. */}
        {payload.pr && (
          <View style={s.prSlab}>
            <Text style={s.prLabel} allowFontScaling={false}>{T('newPR')}</Text>
            <Text style={s.prValue} allowFontScaling={false}>{loadLabel(payload.pr.weight)} × {payload.pr.reps}</Text>
            <Text style={s.prLift} allowFontScaling={false}>
              {/* `gain` is null when nothing comparable was beaten — the e1RM
                  branch. Subtracting `prev` here printed the whole bar as the
                  improvement: "SQUAT +315 LB" for a 15 lb gain.

                  Gated on `heaviest`, not just `gain !== null` — R435. A set
                  can beat its own rep count's previous best (a real, positive
                  `gain`) while still being lighter than a DIFFERENT rep count's
                  PR: 230x5 over 225x5 is a genuine +5, but with a 275x3 on the
                  books it is not the heaviest thing this lifter has ever
                  moved. `shareText` already downgrades that exact case to
                  "best set yet" — this card, shown first and more often than
                  the share sheet ever opens, was still printing "+5 LB" for
                  it, which is the crying-wolf failure `heaviest` exists to
                  prevent, just relocated from the text to the screen. */}
              {payload.pr.lift.toUpperCase()}
              {payload.pr.heaviest && payload.pr.gain !== null
                ? `   +${payload.pr.gain} ${payload.unit.toUpperCase()}`
                : `   ${T('bestYet')}`}
            </Text>
          </View>
        )}

        {/* The one honest thing a first workout can claim.
        
            It is deliberately NOT the PR slab: no record was broken, and
            dressing a first set up as one is the crying wolf §8 forbids. It is
            outlined rather than filled for the same reason — the volt fill is
            reserved for a beaten record, and this is a starting line. But a
            first recap has no PR and no goal, which made it the emptiest this
            card ever renders, and it is the one most likely to be shared. */}
        {payload.firstSession && !payload.pr && payload.best && (
          <View style={s.baseSlab}>
            <Text style={s.baseLabel} allowFontScaling={false}>{T('sessionOne')}</Text>
            {/* The heaviest set, not the volume — the hero above already IS the
                volume, and printing it twice reads as a rendering fault. */}
            <Text style={s.baseValue} allowFontScaling={false}>{loadLabel(payload.best.weight)} × {payload.best.reps}</Text>
            <Text style={s.baseNote} allowFontScaling={false}>
              {payload.best.lift.toUpperCase()}   {T('oneToBeat')}
            </Text>
          </View>
        )}

        {/* The two sessions after the first, which were the emptiest this card
            ever rendered — see `bestYet` in session.ts. Same outlined slab as
            SESSION ONE, deliberately: no record was broken by §8's definition,
            so it must not wear the volt fill a real PR does. It says what was
            beaten, which is a fact the reader can check against the lift list
            a few rows below (§16). */}
        {payload.bestYet && !payload.firstSession && payload.best && (
          <View style={s.baseSlab}>
            <Text style={s.baseLabel} allowFontScaling={false}>{T('bestYet')}</Text>
            <Text style={s.baseValue} allowFontScaling={false}>{loadLabel(payload.best.weight)} × {payload.best.reps}</Text>
            <Text style={s.baseNote} allowFontScaling={false}>
              {payload.best.lift.toUpperCase()}   {fill(T('upFromPrev'), { prev: loadLabel(payload.bestYet.prev) })}
            </Text>
          </View>
        )}

        {/* §5 — goals exist to feed the output. This is where that happens.
            And when there is no goal, §8's second lead takes the same slot:
            a mature account cannot be told "no PR today" 200 times and
            nothing else. They never both render — a goal wins. */}
        {(payload.goalLine ?? payload.trendLine) && (
          <View style={s.goalRow}>
            <View style={s.goalTick} />
            <Text style={s.goalText} allowFontScaling={false}>{payload.goalLine ?? payload.trendLine}</Text>
          </View>
        )}

        {/*
          What the best set was worth relative to the lifter. 315 means nothing
          until you know who lifted it, and this is the only line in the app
          that supplies the other half. Quiet, below the goal, because it is
          context for the work rather than a claim about the session.
        */}
        {recap.multiple && (
          <View style={s.multipleRow}>
            <Text style={s.multipleText} allowFontScaling={false}>{recap.multiple}</Text>
          </View>
        )}

        {/* The summary and its claim sit above this; the itemisation below. */}
        <View style={s.slack} />

        <View style={s.lifts}>
          {payload.lifts.map(([name, load, isPR]) => (
            <View key={name} style={s.liftRow}>
              <Text style={[s.liftName, isPR && s.volt]} numberOfLines={1} allowFontScaling={false}>{name}</Text>
              <Text style={[s.liftLoad, isPR && s.volt]} allowFontScaling={false}>{load}</Text>
            </View>
          ))}
        </View>

        {/* The coach's call for next time (R687): a number to come back and
            beat, named on the first recap too. Not on the share card. */}
        {next && (
          <View style={s.next}>
            <Text style={s.label} allowFontScaling={false}>{T('nextTime')}</Text>
            <Text style={s.nextLine} allowFontScaling={false}>
              <Text style={s.nextLift}>{next.lift}</Text>{'  ·  '}{next.line}
            </Text>
          </View>
        )}

        {/* A first session has no streak to hold — see `shortOneFirst`. */}
        {thin && (
          <Text style={s.thin} allowFontScaling={false}>
            {T(payload.firstSession ? 'shortOneFirst' : 'shortOne')}
          </Text>
        )}
      </ScrollView>

      <View style={s.actions}>
        <View style={s.actionRow}>
          <Pressable accessibilityRole="button"
            style={pressStyle(s.share, 'primary', still)}
            onPress={() => share(shareText(recap, languageOf(repo)))}
            accessibilityLabel={T('share')}
          >
            <Text style={s.shareText}>{T('share')}</Text>
          </Pressable>

          <Pressable accessibilityRole="button" onPress={leave} hitSlop={16}
            style={pressStyle(s.doneBtn, 'quiet', still)} accessibilityLabel={T('done')}>
            <Text style={s.done}>{T('done')}</Text>
          </Pressable>
        </View>

        {/*
          Back into the workout you just finished.

          FINISH was one-way, and it is the last thing you tap while still stood
          in the gym — which is exactly when you notice the set you typed wrong.
          The only route back was to start a NEW workout and log corrections
          into it, which splits one session in two and files the fix on the
          wrong day. Reopening clears the end time and nothing else: every set,
          its time and its order are untouched, and finishing again just sets a
          later end.
        */}
        {/*
          Reopening rewrites `ended_at` and hands the session back to the Now
          screen as the one CURRENTLY live — right for the workout you just
          walked away from, wrong for one from three weeks ago, which would
          make the app think you are mid-workout on a day that has long
          since ended. Live-only.
        */}
        {recap && !viewingHistory && (
          <Pressable accessibilityRole="button" style={pressStyle(s.reopen, 'quiet', still)} hitSlop={10}
            accessibilityLabel={T('reopenA11y')}
            onPress={() => {
              if (repo.reopenSession(recap.sessionId)) goTab(router, 'now');
            }}
          >
            <Text style={s.reopenText}>{T('editWorkout')}</Text>
          </Pressable>
        )}

        {/* The user asked for this and is owed an answer. Quiet, inline, and it
            clears the moment they try again — not an alert.

            BELOW the buttons, not inside their row. It was a third child of a
            flex row in which SHARE was the only thing that grew, so the error
            took its ~250px out of SHARE's width. That cost nothing while the row
            was the full window; the moment the column was capped to 430 the row
            had 354px for 320px of fixed children and the volt button collapsed
            to a ~34px splinter with its black label spilling onto the black
            background. Its own style — centred, with its own top margin — was
            always written for a block rather than a row item. */}
        {shareError && <Text style={s.shareError} accessibilityRole="alert">{shareError}</Text>}
      </View>
    </SafeAreaView>
  );
}

function Stat({ label, value, hit }: { label: string; value: string; hit?: boolean }) {
  // R341: same reason as the title/date — this whole screen previews a
  // fixed artifact, not reflowable UI.
  return (
    <View style={s.stat}>
      <Text style={s.statLabel} allowFontScaling={false}>{label}</Text>
      <Text style={[s.statValue, hit && s.statValueHit]} allowFontScaling={false}>{value}</Text>
    </View>
  );
}

const VOLT = '#CCFF00';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  // `flexGrow: 1` so the content container is at least as tall as the scroll
  // view — without it there is no free space for `slack` to take, and the
  // spacer collapses to nothing on exactly the screens that need it.
  body: {
    ...COLUMN, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  emptyText: { color: '#7C8792', fontSize: 15 },
  back: { color: VOLT, fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },

  headerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 1.5 },
  date: { color: '#7C8792', fontSize: 12, fontWeight: '600' },
  rule: { height: 3, backgroundColor: VOLT, marginTop: 10, marginBottom: 30 },

  label: { color: '#7C8792', fontSize: 11, fontWeight: '700', letterSpacing: 3 },
  volumeRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 2 },
  volume: { color: '#fff', fontSize: 62, fontWeight: '900', letterSpacing: -2 },
  /* Sized to read as a note rather than as a hero number that failed to load —
     it is standing in for the number, not being one. */
  volumeUnknown: { color: '#9AA5AF', fontSize: 15, lineHeight: 22, fontWeight: '600', paddingVertical: 14 },
  volumeNote: { color: '#9AA5AF', fontSize: 12, lineHeight: 17, marginTop: 4 },
  unit: { color: VOLT, fontSize: 20, fontWeight: '900', marginLeft: 6 },

  stats: { flexDirection: 'row', marginTop: 22 },
  stat: { flex: 1 },
  statLabel: { color: '#7C8792', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 },
  // Volt only for the streak that just became the longest ever — same rule
  // §15 uses elsewhere: the accent marks the one thing that is actually news,
  // not every stat on the card.
  statValueHit: { color: VOLT },

  /*
   * A band, not a button.
   *
   * This is the one place in the app with two filled volt blocks on screen at
   * once — the record and SHARE — and the record was the bigger, higher, more
   * button-shaped of the two: same fill, same rounded rectangle, same black
   * label. The loudest control-looking thing on the screen did nothing when
   * pressed, and it sat directly above the one thing that did.
   *
   * The fix is geometry rather than colour, because the colour is right: a
   * personal record IS the most important thing on this card and dimming it to
   * satisfy a rule about chips would be the rule running the product. So it
   * keeps the fill and stops being shaped like a control — full-bleed to both
   * edges, square corners, cancelling the page's 24px gutter and putting it
   * back as padding so the text still lines up with everything above it.
   *
   * The general form of the rule, which also explains why a checkbox may fill:
   * SHAPE carries pressability, COLOUR carries importance.
   */
  prSlab: {
    backgroundColor: VOLT, borderRadius: 0, padding: 16, marginTop: 26,
    marginHorizontal: -24, paddingHorizontal: 24
  },
  prLabel: { color: '#000', fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  prValue: { color: '#000', fontSize: 34, fontWeight: '900', marginTop: 4 },
  prLift: { color: '#000', fontSize: 12, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },

  baseSlab: {
    borderRadius: 12, padding: 16, marginTop: 26,
    borderWidth: 1, borderColor: '#2A323A', backgroundColor: '#0C0E10'
  },
  baseLabel: { color: VOLT, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  baseValue: { color: '#fff', fontSize: 34, fontWeight: '900', marginTop: 4 },
  baseNote: { color: '#9AA5AF', fontSize: 11, fontWeight: '700', marginTop: 3, letterSpacing: 0.8 },

  slackTop: { flexGrow: 0.5 },

  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  multipleRow: { marginTop: 14 },
  multipleText: { color: '#9AA5AF', fontSize: 14, fontWeight: '600' },
  goalTick: { width: 4, height: 20, backgroundColor: VOLT, borderRadius: 2 },
  goalText: { color: '#E8EAED', fontSize: 15, fontWeight: '600' },

  /**
   * Where a short session's empty space goes.
   *
   * The actions row is pinned to the bottom of the screen and the scroll
   * content is top-aligned, so on a two-lift session every pixel of slack
   * collected in one place: the lift list ended at y 421 and SHARE sat at
   * y 744, leaving **323px of nothing** in the middle of the screen §5 judges
   * the whole product on. It did not read as breathing room, it read as a page
   * that had run out.
   *
   * `flexGrow` distributes only POSITIVE free space, which is exactly the
   * behaviour wanted and the reason this is not `justifyContent: 'center'` —
   * centering a content container that overflows pushes its top above the
   * scroll origin, where it cannot be reached. When the session is long enough
   * to fill the screen this spacer is simply 0 and nothing moves.
   *
   * The composition it produces is a receipt: what the workout came to at the
   * top — volume, stats, the PR, the goal — and the itemisation at the bottom,
   * meeting the button that sends it.
   */
  slack: { flexGrow: 1 },

  lifts: {
    marginTop: 28,
    // A hairline above, so the list reads as the second block of a deliberate
    // composition rather than as content that drifted down the screen.
    borderTopWidth: 1, borderTopColor: '#1B2126'
  },
  liftRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#1B2126'
  },
  liftName: { color: '#E8EAED', fontSize: 15, fontWeight: '500', flexShrink: 1, marginRight: 12 },
  liftLoad: { color: '#E8EAED', fontSize: 15, fontWeight: '800' },
  volt: { color: VOLT },

  thin: { color: '#9AA5AF', fontSize: 14, marginTop: 22, textAlign: 'center' },
  next: { marginTop: 24, gap: 6 },
  nextLine: { color: '#9AA5AF', fontSize: 15, fontWeight: '500', lineHeight: 21 },
  nextLift: { color: '#E8EAED', fontWeight: '800' },

  actions: { ...COLUMN, paddingHorizontal: 24, paddingBottom: 8 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  reopen: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  reopenText: { color: '#7C8792', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  share: {
    flex: 1, backgroundColor: VOLT, borderRadius: 16, height: 60,
    alignItems: 'center', justifyContent: 'center'
  },
  shareText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 2 },
  shareError: {
    color: '#7C8792', fontSize: 12, fontWeight: '600',
    textAlign: 'center', marginTop: 10, paddingHorizontal: 20
  },
  doneBtn: { paddingHorizontal: 14, paddingVertical: 18 },
  done: { color: '#7C8792', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 }
});
