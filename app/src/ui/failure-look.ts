import { StyleSheet } from 'react-native';

/**
 * How the app looks when something failed: RepoGate's screen (the database
 * would not open) and every route's error boundary share one face, so a
 * failure always reads the same way: a mark, what happened, the message, and
 * a way to try again.
 */
const VOLT = '#CCFF00';

export const failure = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#08090A' },
  body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 40 },
  mark: { width: 44, height: 44, backgroundColor: VOLT, borderRadius: 8, marginBottom: 26 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 14 },
  body1: { color: '#C3CBD2', fontSize: 15, lineHeight: 23, marginBottom: 12 },
  detail: {
    backgroundColor: '#0E1114', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#1A1F25', marginBottom: 26
  },
  detailLabel: { color: '#9AA5AF', fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  detailText: { color: '#8B959E', fontSize: 12, lineHeight: 19, fontFamily: 'Courier' },
  retry: {
    backgroundColor: VOLT, borderRadius: 14, height: 56,
    alignItems: 'center', justifyContent: 'center'
  },
  retryText: { color: '#000', fontSize: 15, fontWeight: '900', letterSpacing: 2 },
});
