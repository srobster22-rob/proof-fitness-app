import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initRepo, repoStatus, resetRepo, dbDiagnostic, DB_NAME } from '../data/db.ts';
import { t, fill, languageFor } from '../domain/i18n.ts';
import { deviceLocale } from './locale.ts';
import { failure } from './failure-look.ts';

/*
 * The device locale, not `repo.getPref(PREF_LANG)` — this screen renders
 * exactly when the database may have failed to open, which is the one
 * preference source it cannot trust. The device locale needs nothing from
 * the repo at all, so it is the only language signal this screen can reach.
 */
const T = (k: Parameters<typeof t>[1]) => t(languageFor(deviceLocale()), k);

/**
 * Opens the database before any screen renders, and shows something honest if it
 * cannot.
 *
 * Without this, `openDatabaseSync` or a migration throwing during render takes
 * the app to a white screen with no message — and on a local-first app with no
 * server copy, that is also the moment a user concludes their training history
 * is gone. Saying "your data is still on the device" is the single most useful
 * thing this screen does.
 *
 * Deliberately does NOT offer to delete and recreate the database. That is the
 * obvious "fix" and it destroys the only copy of the user's history that exists
 * (§11). Recovery is a support conversation, not a button.
 *
 * What it does do, after a couple of failed retries, is stop giving advice it
 * can see is not working. "Closing and reopening usually clears it" is true of a
 * locked file and false of a corrupt one; walked against a corrupted store, the
 * screen repeated it indefinitely while every retry failed the same way. The
 * later message names the only two real outcomes — restore a backup, or lose the
 * log — which is the honest version of the same support conversation.
 */
export function RepoGate({ children }: { children: React.ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [, settle] = useState(0);

  // Opening is async on web (wasm) and effectively instant on native. Awaiting
  // it here means no screen has to handle a not-ready database.
  useEffect(() => {
    let live = true;
    initRepo().then(() => { if (live) settle(n => n + 1); });
    return () => { live = false; };
  }, [attempt]);

  const retry = useCallback(() => {
    resetRepo();
    setAttempt(a => a + 1);
  }, []);

  const status = repoStatus();

  if (status.error) {
    return <StorageError error={status.error} onRetry={retry} attempt={attempt} />;
  }
  if (!status.ready) {
    /*
     * Deliberately bare, and deliberately the ONLY spinner in the app.
     *
     * §4 makes "loading spinners on the logging path — zero" an acceptance
     * criterion, and this is not on it: `RepoGate` wraps the root once, before
     * any screen mounts. Nothing after boot ever waits.
     *
     * This used to say the frame is never seen on native. That overclaims —
     * `openPlatformDb` is async on both platforms because it dynamic-imports
     * its driver, so React renders this branch at least once on every cold
     * launch. What is true is that it is a frame or two on native against a few
     * hundred milliseconds of wasm on web. A branded splash would turn that
     * into a loading screen the product does not otherwise have.
     */
    return (
      <View style={s.loading}>
        <ActivityIndicator color="#CCFF00" />
      </View>
    );
  }
  return <>{children}</>;
}

function StorageError({
  error, onRetry, attempt
}: { error: Error; onRetry: () => void; attempt: number }) {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.mark} />
        <Text style={s.title}>{T('repoGateTitle')}</Text>
        <Text style={s.body1}>{T('repoGateBody1')}</Text>
        {/*
          The advice has to stop being wrong.
        
          "Closing and reopening usually clears it" is true of a locked file or a
          half-finished migration, and false of a corrupt one — walked with a
          deliberately corrupted store, TRY AGAIN failed identically every time
          and the screen went on giving the same reassurance, with no other
          guidance and no way forward. Repeated failure is itself information,
          so after a couple of attempts the screen says what it now knows.
        */}
        <Text style={s.body2}>
          {T(attempt < 2 ? 'repoGateBody2Early' : 'repoGateBody2Late')}
        </Text>

        <View style={s.detail}>
          <Text style={s.detailLabel}>{DB_NAME}</Text>
          <Text style={s.detailText} selectable>{error.message}</Text>
          {/*
            Where the file ended up, when that is not where it should be (§8b).
            Only rendered on the error screen because this is the one place the
            app already talks about storage — and null on a healthy launch, so
            it never appears as noise.
          */}
          {dbDiagnostic() && (
            <Text style={[s.detailText, s.detailNote]} selectable>{dbDiagnostic()}</Text>
          )}
        </View>

        <Pressable accessibilityRole="button" style={s.retry} onPress={onRetry}
          accessibilityLabel={T('repoGateRetry')}>
          <Text style={s.retryText}>{T('repoGateRetry')}</Text>
        </Pressable>

        {/*
          "Send the message below" was an instruction nobody could follow.

          The copy told the user to send the diagnostic and then gave them no
          destination and no way to lift it off the screen — a `selectable`
          Text, which on a phone means dragging handles across a stack trace.
          The app already shares the recap, so sharing is a mechanism it has;
          this hands the whole diagnostic to the system sheet, where mail, notes
          and messages are all one tap away.

          Wrapped in a catch for the same reason the recap's share is: `Share.share`
          REJECTS when a platform cannot open a sheet, and an unhandled rejection
          on the screen that already means "something is broken" would be the
          second failure in a row.
        */}
        <Pressable accessibilityRole="button" style={s.send}
          accessibilityLabel={T('repoGateSendA11y')}
          onPress={() => {
            Share.share({
              message: `PROOF could not open ${DB_NAME}.\n\n${error.message}` +
                (dbDiagnostic() ? `\n\n${dbDiagnostic()}` : '')
            }).catch(() => { /* no share sheet here; the text stays selectable */ });
          }}
        >
          <Text style={s.sendText}>{T('repoGateSend')}</Text>
        </Pressable>
        {attempt > 0 && (
          <Text style={s.attempts}>
            {attempt === 1 ? T('repoGateTriedOnce') : fill(T('repoGateTried'), { n: attempt })}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// The face RepoGate shares with every screen's error boundary (failure-look.ts), and its own extras.
const s = {
  ...failure,
  ...StyleSheet.create({
    loading: { flex: 1, backgroundColor: '#08090A', alignItems: 'center', justifyContent: 'center' },
    body2: { color: '#7C8792', fontSize: 14, lineHeight: 22, marginBottom: 24 },
    detailNote: {
      marginTop: 10, paddingTop: 10,
      borderTopWidth: 1, borderTopColor: '#1A1F25'
    },
    send: { alignSelf: 'center', paddingVertical: 14, paddingHorizontal: 18 },
    sendText: { color: '#9AA5AF', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
    attempts: { color: '#9AA5AF', fontSize: 12, textAlign: 'center', marginTop: 14 }
  })
};
