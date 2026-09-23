import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { ScreenModal } from './ScreenModal.tsx';
import { COLUMN } from './column.ts';

/**
 * The bottom sheet as this app draws it. A dimmed backdrop closes it, the sheet
 * itself does not, and a grabber sits at the top. `ScreenModal` does the
 * arriving and the leaving with the screen.
 */
export function BottomSheet({ label, onClose, children }: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <ScreenModal visible animationType="none" transparent aria-label={label} onRequestClose={onClose}>
      <Pressable style={s.backdrop} tabIndex={-1} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <View style={s.grabber} />
          {children}
        </Pressable>
      </Pressable>
    </ScreenModal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    ...COLUMN,
    backgroundColor: '#0C0E10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 22, paddingTop: 10, paddingBottom: 30, maxHeight: '86%'
  },
  grabber: {
    width: 38, height: 4, borderRadius: 2, backgroundColor: '#2A323A',
    alignSelf: 'center', marginBottom: 18
  }
});
