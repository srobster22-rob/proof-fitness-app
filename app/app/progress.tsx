import React, { useCallback, useMemo, useState } from 'react';
import { useGuardedPush, useGuardedLeave } from '../src/ui/guarded-push.ts';
import { TabBar } from '../src/ui/TabBar.tsx';
import { goTab } from '../src/ui/tab-bar.ts';
import { View, Text, StyleSheet, ScrollView, Pressable, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { getRepo } from '../src/data/db.ts';
import { t, fill, languageOf, dateLocale, number } from '../src/domain/i18n.ts';

/**
 * Every visible string on this screen, in the chosen language.
 *
 * Module scope rather than a binding inside the route component, because this
 * file's chrome is spread across half a dozen sub-components — the goal card,
 * the sheet, the backup block — and threading a `T` prop through each is how
 * one of them ends up forgotten. `getRepo` is a lazily-read singleton, so
 * calling it per string costs a map lookup and always reflects a language
 * changed while the screen is mounted (Settings opens over the top of it).
 */
const T = (k: Parameters<typeof t>[1]) => t(languageOf(getRepo()), k);

import { ConfirmSheet } from '../src/ui/ConfirmSheet.tsx';
import {
  progressRows, hiddenRowCount, recentSessions, goalTag, bestSetA11y, trendA11y, lastTrainedA11y, erasureLine, erasureIsSingle, erasureCounts, weeklyLine, shareWeeklyText, SPARK_POINTS,
  type ProgressRow, type SessionSummary } from '../src/ui/progress-model.ts';
import { weekStreak, longestStreakBefore } from '../src/domain/session.ts';
import { streakWorthShowing } from '../src/ui/recap-model.ts';
import { shareBackup, pickAndRestore } from '../src/ui/backup.ts';
import { COLUMN } from '../src/ui/column.ts';
import { displayUnit } from '../src/ui/display-unit.ts';
import { TYPE, SPACING } from '../src/ui/type.ts';
import { buzz } from '../src/ui/haptics.ts';
import { pressStyle, useReducedMotion } from '../src/ui/press.ts';
import { Spark } from '../src/ui/Spark.tsx';

/**
 * Screen 2 — Progress. PROMPT.md §5: "one screen, not a dashboard".
 *
 * Capped and ranked by progress-model, never exhaustive — §8's mature clause
 * says old lifts fall OFF this screen rather than into a scroll. The sparkline
 * is drawn with plain Views rather than a chart library: ten normalised bars
 * need no dependency, and a charting package would be the largest thing in the
 * bundle for the least-used screen.
 */
export default function Progress() {
  const repo = getRepo();
  const router = useRouter();
  const push = useGuardedPush(router);
  // Back, or home when there is nowhere back to — see useGuardedLeave for
  // the "GO_BACK was not handled" history this used to hit on its own.
  const leave = useGuardedLeave(router);
  const still = useReducedMotion();
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  /*
   * Re-read whatever changed while this screen sat behind another one (R485).
   *
   * Progress is the ONLY screen Settings can be pushed over — `index.tsx` is
   * the other route to it and `NowScreen` has had this exact effect for rounds,
   * with a comment saying it exists to "pick up a unit chosen in Settings".
   * Progress never got it, so it stayed mounted holding whatever it read when
   * it opened. Walked live: switch the language in Settings, tap DONE, and the
   * whole screen is still English — and ERASE EVERYTHING then draws its
   * Spanish template around an English inventory, "Se eliminaran 36 workouts,
   * 288 sets, 1 goal and 1 setting", which is R480's half-translated
   * destructive dialog arriving again by a different route.
   *
   * The same staleness reaches Progress from `/measure` too: a bodyweight
   * recorded there changes both the erase inventory and what a bodyweight
   * lift's row can honestly report, and Progress is mounted underneath.
   */
  useFocusEffect(useCallback(() => { setTick(t => t + 1); }, []));
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => progressRows(repo, Date.now()), [repo, tick]);
  const hidden = hiddenRowCount(repo, Date.now(), undefined, rows);
  const history = useMemo(() => recentSessions(repo), [repo, tick]);
  // §10's rest-day claim. Null on most weeks, and silence is correct then.
  const weekly = useMemo(() => weeklyLine(repo, Date.now()), [repo, tick]);
  /*
   * Computed but not rendered here — the CURRENT streak is already shown
   * persistently, on every visit to the Now screen (its own top-right
   * corner, gated by the same `streakWorthShowing`). This is kept only to
   * decide when `best`, below, is a fact genuinely distinct from it.
   */
  const streak = useMemo(() => weekStreak(repo.allSets(), Date.now()), [repo, tick]);
  /*
   * `longestStreakBefore` has existed since the recap's own `streakRecord`
   * flag was built (R271) — the only question it was ever asked is "did the
   * CURRENT run just beat it", a yes/no the card shows for a few seconds.
   * The number itself — the record to chase — was never named anywhere
   * else. Shown only while it is a fact distinct from the CURRENT streak:
   * once the current run reaches or passes it, the Now screen's own badge
   * already says everything this line would, and repeating the same number
   * under two labels is not a second fact.
   */
  const best = useMemo(() => {
    const b = longestStreakBefore(repo.allSets(), Date.now());
    return b > streak && streakWorthShowing(b) ? b : null;
  }, [repo, tick, streak]);
  const [weeklyShareError, setWeeklyShareError] = useState<string | null>(null);
  /*
   * §10 calls this an "already formatted postable card" — `weeklyCard` and
   * the wire format have handled `kind: 'weekly'` since R228/R271, and
   * nothing in the running app ever called either. Same failure shape as
   * Recap's own share: `Share.share` rejects when the platform cannot open a
   * sheet (this project's own web preview does), and an unhandled rejection
   * on a tap the user asked for is a worse failure than one that says so.
   */
  const shareWeekly = useCallback(async () => {
    const message = shareWeeklyText(repo, Date.now());
    if (!message) return;
    try {
      setWeeklyShareError(null);
      await Share.share({ message });
    } catch (e) {
      setWeeklyShareError(e instanceof Error ? e.message : 'Could not open the share sheet.');
    }
  }, [repo]);

  // §11 — "a plain-file export, user-initiated." It lives here, at the bottom of
  // the data screen, alongside Settings rather than being its own reason to add
  // a screen — a screen that existed to hold one button is exactly the clutter
  // §5 is written to prevent.
  const run = useCallback(async (fn: () => Promise<{ ok: boolean; message: string } | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fn();
      if (r) { setNote(r.message); if (r.ok) setTick(t => t + 1); }
    } finally {
      setBusy(false);
    }
  }, [busy]);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Text style={s.title}>{T('progress')}</Text>
        <Pressable accessibilityRole="button" onPress={leave} hitSlop={16}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('done')}>
          <Text style={s.close}>{T('done')}</Text>
        </Pressable>
      </View>

      {rows.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyText}>{T('emptyProgress')}</Text>
          {/*
            The YOU row belongs here too, and its absence was a real gap: it
            used to render only in the populated branch, so on a fresh install
            there was NO route to the measurements screen at all.

            That matters more than a missing link usually would, because a
            bodyweight reading does not back-fill — `readingAt` only accepts
            one logged at or before a set, deliberately. So the sets that most
            need a bodyweight are the ones a new user does first, and the only
            way to have it in time is to record it BEFORE that first session —
            which was unreachable from the one screen that offers it. The
            recap even says "Add your bodyweight on YOU to count these sets"
            while the link it names was hidden.
          */}
          <YouRow onPress={() => push('/measure')} still={still} />
          <Backup busy={busy} note={note} run={run} repo={repo} still={still}
            onSettings={() => goTab(router, 'settings')}
            onErased={() => { buzz.destroyed(); setNote(T('everythingErased')); setTick(t => t + 1); }}
            revision={tick} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {/*
            §10: "one auto-surfaced comparison per week — generated, not
            requested". An app opened only mid-workout has nothing to say on a
            rest day, and this is the one thing it can say. It leads the screen
            because it is a claim about the lifter rather than a row of data,
            and it is simply absent when nothing improved — §8's cry-wolf rule
            is about every claim here, not only PRs.
          */}
          {/* R327: the CURRENT streak was already claimed here, once — and
              turned out to be a mistake, found only by testing with an
              actual multi-week streak instead of the single-week data every
              earlier round happened to have. The Now screen's own top-right
              corner has shown `state.streak` persistently, on the app's
              most-visited screen, since well before this round; adding a
              second copy here restated a fact already always on screen
              rather than filling a real gap. Removed. The record to chase —
              `longestStreakBefore` — is the genuinely new fact: it has
              existed since the recap's own streakRecord flag and was only
              ever asked a yes/no question, never named as a number anywhere
              until now. Shown only while it is distinct from the CURRENT
              streak (computed above, unrendered, purely to gate this): once
              the current run reaches or passes it, the Now screen's own
              badge already says everything this line would. */}
          {best !== null && (
            <Text style={s.bestStreakLine} accessibilityLabel={fill(T('bestStreakA11y'), { n: best })}>
              {fill(T('bestStreakLine'), { n: best })}
            </Text>
          )}

          {weekly && (
            <View style={s.weekly}>
              <View style={s.weeklyRow}>
                <Text style={s.weeklyLabel}>{T('weeklyHeading')}</Text>
                <Pressable accessibilityRole="button" onPress={shareWeekly} hitSlop={10}
                  style={pressStyle(null, 'quiet', still)}
                  accessibilityLabel={T('share')}>
                  <Text style={s.weeklyShare}>{T('share')}</Text>
                </Pressable>
              </View>
              <Text style={s.weeklyText}>{weekly}</Text>
              {weeklyShareError && <Text style={s.weeklyShareError}>{weeklyShareError}</Text>}
            </View>
          )}

          {/* One line for the whole list, not a label per row (§15). Without
              it the right-hand column is a bare signed number over an unlabelled
              sparkline, and nothing on screen says what it is measured across —
              the user cannot check it, so they cannot trust it. */}
          <View style={s.legend}>
            <Text style={s.legendText}>
              {T('changeLast')} {SPARK_POINTS} {T('sessionsWord')}
            </Text>
          </View>
          {rows.map(row => <Row key={row.exerciseId} row={row} />)}

          {/* §5 wants old lifts to fall off rather than into a scroll, which is
              right — but falling off SILENTLY is a different claim. The screen
              reads as the complete list of what you train, and past eight
              movements it is not. One line turns a truncation into a fact. */}
          {hidden > 0 && (
            <Text style={s.hiddenNote}>
              {fill(T('hiddenLiftsNote'), { n: hidden, lift: T(hidden === 1 ? 'hiddenLiftWord' : 'hiddenLiftsWord') })}
            </Text>
          )}

          {/*
            Measurements of the LIFTER, one tap from the screen that tracks
            lifts. Not a fifth destination on the logging path (§5) — nothing
            here is needed mid-set — and it lives above the history because it
            answers the same question the rows above do: where am I now.
          */}
          <YouRow onPress={() => push('/measure')} still={still} />

          {/*
            What you actually did, day by day.

            The rows above answer "how is this lift going" and cannot answer
            "what did I do on Tuesday" — the question you ask standing in the
            gym trying to remember whether you have already pressed this week.
            Until now the only place that answer existed was inside one recap
            you could no longer reach.
          */}
          {history.length > 0 && (
            <>
              <View style={s.legend}>
                <Text style={s.legendText}>{T('recentWorkouts')}</Text>
              </View>
              {history.map(h => (
                <PastSession key={h.id} h={h}
                  onPress={() => push({ pathname: '/recap', params: { session: h.id } })} />
              ))}
            </>
          )}

          <Backup busy={busy} note={note} run={run} repo={repo} still={still}
            onSettings={() => goTab(router, 'settings')}
            onErased={() => { buzz.destroyed(); setNote(T('everythingErased')); setTick(t => t + 1); }}
            revision={tick} />
        </ScrollView>
      )}
      <TabBar current="progress" go={tab => goTab(router, tab)} />
    </SafeAreaView>
  );
}

/**
 * One past workout.
 *
 * A summary, not a transcript: the lifts and their top set, which is what
 * people compare week to week. Every set of a past session is what the recap is
 * for, and reprinting forty of them here would bury the trend rows this screen
 * is built around.
 */
/**
 * Measurements of the LIFTER, one tap from the screen that tracks lifts.
 *
 * Not a fifth destination on the logging path (§5) — nothing here is needed
 * mid-set — and on the populated screen it sits above the history because it
 * answers the same question the rows do: where am I now.
 *
 * One component rather than two copies, because it renders in both the empty
 * and the populated branch and those had already drifted apart once: it
 * existed only in the populated one, which left a fresh install with no route
 * to the measurements screen at all.
 */
function YouRow({ onPress, still = false }: { onPress: () => void; still?: boolean }) {
  return (
    <Pressable accessibilityRole="link" style={pressStyle(s.youRow, 'surface', still)}
      onPress={onPress}
      accessibilityLabel={T('yourMeasurementsA11y')}>
      <Text style={s.youText}>{T('youCard')}  ·  {T('bodyHeight')}</Text>
      <Text style={s.youArrow}>›</Text>
    </Pressable>
  );
}

function PastSession({ h, onPress }: { h: SessionSummary; onPress: () => void }) {
  /*
   * R327: found by driving the app with an actual gap in training history —
   * two sessions two years apart sat side by side in this list reading
   * "Sat, Sep 14" and "Sat, Aug 15" with no year on either, which a user
   * reads as ten months apart within the same year, not as one of them
   * being two years stale. `recentSessions` is capped by COUNT, not by a
   * time window, so an account with a real gap genuinely has an old and a
   * new session sitting next to each other here. Same rule Measure's own
   * `trendLine` already uses for the identical reason: the year only when
   * it is not this one.
   */
  const startedDate = new Date(h.startedAt);
  const when = startedDate.toLocaleDateString(dateLocale(languageOf(getRepo())), {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(startedDate.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {})
  });
  const still = useReducedMotion();
  return (
    // This summary already answers "what did I do" — it could not answer
    // "show me the card", which is the one artifact §5 says the whole
    // product is judged on, and until now the only route to it was the
    // moment right after FINISH. Tapping a day reopens that same card,
    // read as it stood the day it was made (see recap.tsx's own note on
    // why `now` is the session's end here, not today).
    <Pressable accessibilityRole="button" onPress={onPress}
      style={pressStyle(s.past, 'surface', still)}
      accessibilityLabel={fill(T('viewRecapA11y'), { title: h.title, when })}>
      <View style={s.pastTop}>
        <Text style={s.pastTitle} numberOfLines={1}>{h.title}</Text>
        <Text style={s.pastWhen}>{when}</Text>
      </View>
      {h.lifts.map(l => (
        <View key={l.name} style={s.pastLift}>
          <Text style={s.pastName} numberOfLines={1}>{l.name}</Text>
          <Text style={s.pastBest}>{l.best}</Text>
        </View>
      ))}
      {/* The volume clause is dropped, not zeroed, when the app cannot compute
          it — bodyweight work with no reading behind it. "1 set · 0 lb" under
          a row that has just said "BW × 12" contradicts itself in the space of
          one line. The set count is still a fact, so it stays. */}
      <Text style={s.pastFoot}>
        {h.setCount} {T(h.setCount === 1 ? 'setOne' : 'sets')}
        {h.volumeKnown ? `  ·  ${number(h.volume, languageOf(getRepo()))} ${h.unit}` : ''}
      </Text>
    </Pressable>
  );
}

function Row({ row }: { row: ProgressRow }) {
  return (
    <View style={s.row}>
      <View style={s.rowTop}>
        <Text style={s.name} numberOfLines={1}
          accessibilityLabel={lastTrainedA11y(row, languageOf(getRepo()))}>{row.name}</Text>
        <Text style={s.best} accessibilityLabel={bestSetA11y(row, languageOf(getRepo()))}>
          {row.best > 0 || row.realBest ? `${row.best} × ${row.bestReps}` : '—'}
          {/* What it actually weighed, for a lift whose load is the lifter. A
              pull-up logged as "0 x 8" is not a light set, it is a set the app
              had no bodyweight for; with one, it says so. Quiet, because the
              number the user TYPED is still the one they will recognise. */}
          {row.realBest !== null && (
            <Text style={s.realBest}>  {row.realBest} {row.unit}</Text>
          )}
          {/* The milestone lifters actually chase and quote — same rule the
              recap claims it with, so the two can never disagree about what
              counts. Never alongside `realBest`: that field is already a
              ratio (bodyweight plus what was added) for the lifts this one
              excludes, and a multiple of a ratio is not a number anyone
              asked for. */}
          {row.bestMultiple !== null && (
            <Text style={s.multipleValue}>  {row.bestMultiple}×</Text>
          )}
        </Text>
      </View>
      <View style={s.rowBottom}>
        <Spark values={row.spark} style={s.sparkFlex} />
        {/* The target, on the screen that tracks the lift.
        
            Goals are per-lift but lived only on their own screen, so a lift 20lb
            from its target looked exactly like one with no target at all. It
            also gives the row something true to say early on: `trend` is null
            until two comparable sessions exist, so a new user's Progress is a
            column of dashes, and this is a real number from the first session. */}
        {/*
          The slot is reserved on EVERY row, goal or not.

          Rendered only when a goal existed, the spark on a goal-less row grew
          into the space the tag would have taken — so on a 320pt phone the
          charts came out at two different bar widths on one screen: 14pt on
          rows without a goal and 8pt on the row with one. Seen as a picture,
          the odd row out reads as a mistake and, worse, as a different SHAPE:
          a sparkline column exists to be scanned down, and two scales cannot
          be compared.

          Reserving it costs nothing at 390pt — the bars there are capped at 14
          and there is still room — and at 320pt it makes every row agree.
        */}
        <Text style={[s.goalTag, row.goal?.achieved && s.goalTagDone]} numberOfLines={1}>
          {row.goal ? goalTag(row.goal, languageOf(getRepo())) : ''}
        </Text>
        {/* The unit is printed because "+25" alone is a number with no
            stated basis, and the column header above says over what. */}
        <Text style={[
          s.trend,
          row.trend != null && row.trend > 0 && s.up,
          row.trend != null && row.trend < 0 && s.down
        ]} accessibilityLabel={trendA11y(row, languageOf(getRepo())) ?? undefined}>
          {row.trend == null ? '—'
            : row.trend === 0 ? `0 ${row.unit}`
            : `${row.trend > 0 ? '+' : ''}${row.trend} ${row.unit}`}
        </Text>
      </View>
    </View>
  );
}

function Backup({ busy, note, run, repo, onErased, onSettings, still, revision }: {
  busy: boolean;
  still: boolean;
  note: string | null;
  run: (fn: () => Promise<{ ok: boolean; message: string } | null>) => void;
  repo: Parameters<typeof shareBackup>[0];
  /** The training log was actually destroyed. Says so, out loud, with the heavy buzz. */
  onErased: () => void;
  /** Opens the Settings SCREEN — see the note on the control itself. */
  onSettings: () => void;
  /**
   * Bumped whenever the screen re-reads the repo, so this block's counts do too.
   *
   * Replaces an `onChanged` callback that was declared, typed, documented and
   * passed by both call sites — and never once invoked (R485). Its caller was
   * the settings SHEET, which R232 deleted when Settings became a real screen;
   * the prop outlived it silently, because a React prop is not an export and
   * `tools/orphan-scan.cjs` only ever looks at exports.
   *
   * Its reason is worth keeping, because it is the reason this is a plain
   * revision number and not a callback: "something changed" and "everything was
   * erased" were once the same signal, so dismissing the settings sheet with
   * the backdrop — changing nothing — fired the destructive haptic and printed
   * **"Everything erased."** under EXPORT MY DATA, on the one screen whose job
   * is to reassure somebody about their data. A number that goes up says only
   * what it means and cannot be mistaken for an announcement.
   */
  revision: number;
}) {
  const [confirmErase, setConfirmErase] = useState(false);
  const counts = useMemo(() => ({
    /*
     * Is there anything at all to erase? (R488)
     *
     * This block used to compute `sets`, `sessions` and `goals`, and the erase
     * control was gated on `sets > 0` — while `eraseAll` deletes measurements,
     * custom exercises and every `pref.%` row too, with its own comment saying
     * "their chosen jump amounts are theirs too". So a lifter who set their
     * units, recorded a bodyweight on YOU and invented a movement before ever
     * logging a set had data the app was holding and **no control to erase it**:
     * §11 makes the export file the only backup and treats all of this as the
     * user's own, and erasing is the other half of that promise.
     *
     * `erasureCounts` is already the one place that decides what counts as
     * erasable — it is what the confirmation sentence is built from — so the
     * button and the sentence now answer to the same list and cannot disagree
     * about whether there is anything there. It is empty exactly when a fresh
     * install is untouched, which is the one case the control should be absent.
     *
     * `sessions` and `goals` went with `sets`: all three were computed on every
     * render of this block and nothing read any of them.
     */
    erasable: erasureCounts(repo).length > 0,
    // The full list, phrased. See `erasureLine`: this sentence used to name
    // three of the five things `eraseAll` deletes.
    erasing: erasureLine(repo, languageOf(getRepo())),
    // Spanish agrees the verb with what is being erased — see `erasureIsSingle`.
    erasingOne: erasureIsSingle(repo)
    // `revision` is what makes this recompute (R485). It was `[repo, note]`,
    // and `repo` is a stable singleton while `note` only changes on export or
    // restore — so a language chosen in Settings, or a bodyweight recorded on
    // YOU, left this inventory frozen at whatever it said when the screen
    // opened. It is the sentence the user reads before destroying everything;
    // being one navigation out of date is not a cosmetic problem here.
  }), [repo, note, revision]);

  return (
    <View style={s.backup}>
      <View style={s.backupRow}>
        <Pressable accessibilityRole="button" onPress={() => run(() => shareBackup(repo, Date.now()))} hitSlop={12} disabled={busy}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('exportData')}>
          <Text style={[s.backupLink, busy && s.backupBusy]}>{T('exportData')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => run(() => pickAndRestore(repo))} hitSlop={12} disabled={busy}
          style={pressStyle(null, 'quiet', still)} accessibilityLabel={T('restore')}>
          <Text style={[s.backupLink, busy && s.backupBusy]}>{T('restore')}</Text>
        </Pressable>
      </View>
      {/* A during-state, not just a done-state. `note` only ever spoke after the
          work finished, so the whole time a file was being written or read the
          screen said the same sentence it says at rest. */}
      <Text style={s.backupNote}>
        {busy
          ? T('workingEllipsis')
          : note ?? T('plainJsonFile')}
      </Text>

      {/* Deliberately here, under the export, and not on the logging screen.
          §11 has no server copy, so the only thing standing behind this is the
          file the button above it makes — putting them together is the whole
          reason this is the right home for it. §9 bans a settings screen, so
          the alternative was a fifth screen, which §5 also bans. */}
      {/*
        One Settings, reached from two places.

        This used to open `SettingsSheet` — the jump-amounts sheet that existed
        while §9 still banned a settings SCREEN. The product owner overruled
        that (see the note atop `app/settings.tsx`) and the full screen now
        holds the split, units, language and the jump amounts, but the sheet was
        never removed. So there were two controls both labelled SETTINGS showing
        different things, and the jump fields existed twice — which is how R209's
        fix for "an empty number field is a bug" (§4) reached one copy and not
        the other: the sheet still seeded its inputs to `''` and still treated a
        cleared field as "leave it as it is", so there was no way to get back to
        the default from here.

        The affordance is worth keeping — this screen holds everything else
        about your data — so it goes to the same place the gear does rather than
        being deleted.
      */}
      <Pressable
        onPress={onSettings}
        hitSlop={12}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={T('settingsA11y')}
        style={pressStyle(null, 'quiet', still)}
      >
        <Text style={[s.backupLink, s.settingsLink, busy && s.backupBusy]}>{T('settings')}</Text>
      </Pressable>

      {counts.erasable && (
        <Pressable
          onPress={() => setConfirmErase(true)}
          hitSlop={12}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={T('eraseEverythingA11y')}
          style={pressStyle(null, 'quiet', still)}
        >
          <Text style={[s.eraseLink, busy && s.backupBusy]}>{T('eraseAll')}</Text>
        </Pressable>
      )}

      {confirmErase && (
        <ConfirmSheet
          title={T('eraseTitle')}
          body={fill(T(counts.erasingOne ? 'eraseBodyOne' : 'eraseBody'), { what: counts.erasing })}
          confirmLabel={T('eraseLabel')}
          onCancel={() => setConfirmErase(false)}
          onConfirm={() => { repo.eraseAll(); setConfirmErase(false); onErased(); }}
        />
      )}
    </View>
  );
}

const VOLT = '#CCFF00';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  // R341: same header idiom found overflowing on Settings at 2.35x Dynamic
  // Type — DONE pushed past the screen's right edge by the title. Same fix.
  header: {
    ...COLUMN,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingTop: 8, paddingBottom: 18, flexWrap: 'wrap'
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 2 },
  close: { color: '#7C8792', fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  body: {
    ...COLUMN, paddingHorizontal: 24, paddingBottom: 28 },
  empty: {
    ...COLUMN, flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#9AA5AF', fontSize: 14 },

  row: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#161B20' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  name: { color: '#E8EAED', fontSize: 15, fontWeight: '600', flexShrink: 1, marginRight: 12 },
  best: { color: '#fff', fontSize: 15, fontWeight: '800' },
  realBest: { color: '#7C8792', fontSize: 12, fontWeight: '700' },
  // Same rule the recap gives a PR: the app's one static signal for "this is
  // the thing worth noticing", not a fourth grey. §12 — colour only, no motion.
  multipleValue: { color: VOLT, fontSize: 12, fontWeight: '800' },
  // The spark keeps its natural width now, so the spacer is what pushes the
  // goal tag and the trend to the right edge.
  /*
   * R338: found at 2.35x text scale (iOS's largest accessibility size,
   * simulated by driving live rather than eyeballing) — `goalTag` and
   * `trend` are deliberately `flexShrink: 0` (numbers must never be
   * squeezed), and `spark`'s own bars have their own floor width
   * (`barMin`), so once Dynamic Type inflates the goal tag's TEXT past
   * what the row's remaining width can hold, there is nothing left to
   * give and the tag's text renders directly on top of the sparkline's
   * last few bars — silent, no error, just two real numbers overlapping
   * on the row whose entire job is being checkable. `flexWrap: 'wrap'`
   * costs nothing at normal scale — measured, still one line, still the
   * exact geometry `progress-row-fits.test.ts` already pins — and turns
   * the extreme-scale case into a second line instead of an overlap.
   */
  rowBottom: {
    flexDirection: 'row', alignItems: 'flex-end', marginTop: 12, gap: 14, flexWrap: 'wrap'
  },

  /*
   * Measured: five bars, 14px wide, in a 256px box — the chart filled 86px and
   * left 170px of nothing, so it read as a graphic that had failed to load
   * rather than a small one. `flex: 1` on the container made it claim the whole
   * row while `maxWidth: 14` on the bars stopped them ever filling it.
   *
   * It takes its content's width now, and the leftover goes to a spacer. The
   * baseline is the other half: bars with no floor float, and a floor is what
   * makes five dashes read as a chart.
   */
  /*
   * The chart is what yields when the row runs out of width, because the
   * numbers beside it are the information and it is the shape.
   *
   * Measured on the running app at 320pt — an iPhone SE, which §5 still counts
   * as a phone this has to work on: the row wanted 290pt before the goal tag
   * had said anything, the flex spacer collapsed to nothing, and then the tag
   * itself collapsed to **width 0** under `overflow: hidden`. Not ellipsised —
   * gone. "30 TO 225" simply was not on the screen, with no sign it had been
   * dropped, on the one row whose job is saying how far a lift is from its
   * target. At 390pt the same tag measures 52pt and everything looks fine,
   * which is why this survived: it is invisible on exactly the devices nobody
   * develops on.
   *
   * `flex: 1` here plus `flexShrink: 0` on the two numbers reverses who gives
   * way.
   *
   * `minWidth` was 0 — required for the container to shrink below its
   * CONTENT's natural width at all, but wrong once that content has its own
   * floor: each bar refuses to go under 5pt (`bar.minWidth`), so a container
   * told it may reach 0 shrinks past what its own children can honour, and
   * the bars silently OVERFLOW the shrunk container rather than the row
   * ever noticing it ran out of room. Found at 2.35x Dynamic Type scale
   * (iOS's largest accessibility size): `goalTag`'s text grew past the
   * remaining width, `spark` collapsed toward 0 as flexbox intends, and the
   * bars — still 5pt each, unable to shrink further — rendered directly on
   * top of the goal tag's own text. The real floor is what the bars
   * themselves need: ten bars at their own 5pt minimum, nine 4pt gaps
   * between them. With it, flexbox correctly refuses to shrink `spark`
   * past what it can actually honour, and `rowBottom`'s `flexWrap` (below)
   * has real slack to detect and wrap into instead of silently overflowing.
   */
  // Layout only. Everything the sparkline IS — bar widths, gap, baseline, the
  // floor ten bars need — lives in `Spark.tsx`; this says only that the row's
  // sparkline is the child that absorbs the shortfall beside the goal tag.
  sparkFlex: { flex: 1 },
  hiddenNote: {
    color: '#9AA5AF', fontSize: 12, lineHeight: 18, marginTop: 6, marginBottom: 4
  },
  goalTag: {
    color: '#7C8792', fontSize: 10, fontWeight: '800', letterSpacing: 0.8,
    // Measured: "30 TO 225" renders 57pt, and a four-digit target ("120 TO
    // 1000") is the realistic worst case. The slot is held open even when
    // empty so every sparkline on the screen is the same width.
    marginLeft: 10, flexShrink: 0, minWidth: 62
  },
  goalTagDone: { color: VOLT },

  backup: { marginTop: 34, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#161B20' },
  // R346: found on the EMPTY state at 2.35x Dynamic Type — RESTORE's right
  // edge ran to x410.7 on a 320px phone. Same fix as every overflow found
  // tonight; empty states got the same care as populated ones for it.
  backupRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  backupLink: { color: '#7C8792', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  /*
   * Opacity, not a colour — and this was broken by an earlier round of my own.
   *
   * It used to be `color: '#39414A'`, a dimmer grey than the link's #7C8792.
   * R117 folded #39414A into #7C8792 because it measured 1.83:1 against a
   * required 4.5, which was right for TEXT and quietly made the busy style
   * identical to the resting one: during an export every control looked exactly
   * as it had, and nothing on screen said the app was doing anything.
   *
   * Disabled text is exempt from the contrast floor precisely because it is
   * meant to recede, so the honest way to say "not right now" is opacity. It
   * also cannot collide with a palette value again.
   */
  backupBusy: { opacity: 0.4 },
  backupNote: { color: '#9AA5AF', fontSize: 12, marginTop: 12, lineHeight: 18 },
  /* Quieter than the two links above it, and red only once it is opened. A
     destructive control that shouts is one people learn to tap past. */
  settingsLink: { color: '#7C8792', marginTop: 18 },
  eraseLink: {
    color: '#B87A7A', fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginTop: 18
  },

  trend: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', minWidth: 62, flexShrink: 0, textAlign: 'right' },
  // One label, over the ONE column that needs it. "195 x 5" explains itself;
  // a signed number does not. It is right-aligned because a heading that does
  // not sit over its column is worse than none.
  youRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 26, marginBottom: 6, paddingVertical: 16, paddingHorizontal: 18,
    borderRadius: 14, borderWidth: 1, borderColor: '#181D22', backgroundColor: '#0E1114'
  },
  youText: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  youArrow: { color: '#7C8792', fontSize: 20, fontWeight: '700' },

  past: {
    backgroundColor: '#0E1114', borderRadius: 14, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#181D22'
  },
  pastTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Shrinks so a long day name never pushes the date off the card — the same
  // rule the goal cards needed once they held more than one thing.
  pastTitle: { color: '#E8EAED', fontSize: 12, fontWeight: '900', letterSpacing: 1.6, flexShrink: 1 },
  pastWhen: { color: '#9AA5AF', fontSize: 11, fontWeight: '700', flexShrink: 0, paddingLeft: 10 },
  pastLift: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, gap: 12 },
  pastName: { color: '#9AA5AF', fontSize: 14, flexShrink: 1 },
  pastBest: { color: '#E8EAED', fontSize: 14, fontWeight: '700', flexShrink: 0 },
  pastFoot: { color: '#7C8792', fontSize: 11, fontWeight: '600', marginTop: 12 },

  /*
   * The rest-day claim, given a card rather than a line so it reads as a
   * statement about the lifter and not as another row of the list below it.
   * Volt on the number's own line, quiet label above — the same hierarchy the
   * recap uses, at a size that does not compete with the hero there.
   */
  // Quiet, not volt — a reference number, and the only streak fact this
  // screen states; the CURRENT streak is the Now screen's own badge.
  bestStreakLine: {
    color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800',
    letterSpacing: SPACING.micro, paddingHorizontal: 24, paddingTop: 4
  },
  weekly: {
    ...COLUMN, paddingHorizontal: 24, paddingTop: 4, paddingBottom: 16
  },
  weeklyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6
  },
  weeklyLabel: {
    color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro
  },
  weeklyShare: {
    color: '#7C8792', fontSize: TYPE.micro, fontWeight: '800', letterSpacing: SPACING.micro
  },
  weeklyShareError: { color: '#FF8A8A', fontSize: TYPE.meta, marginTop: 8 },
  weeklyText: { color: VOLT, fontSize: TYPE.lead, fontWeight: '800', lineHeight: 21 },
  legend: { alignItems: 'flex-end', paddingBottom: 10 },
  legendText: { color: '#7C8792', fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  up: { color: VOLT },
  down: { color: '#FF6B6B' }
});
