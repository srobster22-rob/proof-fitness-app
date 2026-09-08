import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A row of bars. Values arrive normalised 0..1, so this does no maths.
 *
 * Built for Progress's per-lift trend and pulled out once Measure needed the
 * same shape — a bodyweight history is the same "how has this actually moved"
 * question a lift's is.
 *
 * ## The extraction only half happened, and the halves drifted (R475)
 *
 * This file's docstring claimed the shape was shared. It was not: `progress.tsx`
 * carried a byte-for-byte private copy of the component and never imported this
 * module, so every improvement made to the Progress sparkline stopped at the
 * file it was made in. Measured in the running app before the fix, on the same
 * ten-point history:
 *
 *     bar width   Progress 14px   Measure 4px
 *     gap         Progress  4px   Measure 3px
 *     baseline    Progress  1px   Measure none
 *
 * — the same question drawn 3.5x narrower on one of the two screens that asks
 * it. Progress's was the evolved one (grow-and-cap, so ten bars stay on screen
 * from 320pt up, and a hairline baseline to read heights against), so that is
 * what survives here and Measure now gets it too.
 *
 * ## What belongs here and what does not
 *
 * The BARS are the component: their widths, the gap, the baseline, and the
 * minimum width ten of them need before the row has to compress. Where the
 * sparkline SITS is the screen's business — Progress makes it the flex child
 * that absorbs the shortfall next to a goal tag, Measure gives it a top margin
 * under a card — so that comes in through `style` rather than being guessed at
 * here. That split is what makes one implementation possible; folding either
 * screen's layout in is what forced the copy in the first place.
 */

// The numbers live in `spark-geom.ts` — a module with no `react-native`
// import, so the row-fits budget test can do arithmetic on the real values
// rather than regexing them back out of a StyleSheet. See that file.
import { MIN_BAR, MAX_BAR, GAP, HEIGHT, sparkFloor } from './spark-geom.ts';

export function Spark({ values, style }: {
  values: number[];
  style?: StyleProp<ViewStyle>;
}) {
  // The width ten bars need before anything has to give. Derived from the bar
  // rules above rather than restated at a call site, which is where the two
  // copies disagreed: Progress computed this from its own `SPARK_POINTS` and
  // Measure never computed it at all.
  const floor = sparkFloor(values.length);

  return (
    <View style={[s.spark, { minWidth: floor }, style]}>
      {values.map((v, i) => (
        <View
          key={i}
          style={[
            s.bar,
            { height: 6 + v * 26 },
            i === values.length - 1 && s.barLast
          ]}
        />
      ))}
    </View>
  );
}

const VOLT = '#CCFF00';
const s = StyleSheet.create({
  spark: {
    flexDirection: 'row', alignItems: 'flex-end', gap: GAP, height: HEIGHT,
    // The zero line. Bar heights mean nothing without something to read them
    // against, and at 1px it reads as an axis rather than as a border.
    borderBottomWidth: 1, borderBottomColor: '#232A31', paddingBottom: 0
  },
  bar: {
    flexGrow: 1, flexShrink: 1, flexBasis: MAX_BAR, maxWidth: MAX_BAR, minWidth: MIN_BAR,
    borderRadius: 2, backgroundColor: '#2A323A'
  },
  barLast: { backgroundColor: VOLT }
});
