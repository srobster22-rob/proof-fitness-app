import { useEffect, useRef } from 'react';

/**
 * Click-and-drag for a horizontal row, on the platforms that do not give it.
 *
 * A touch screen drags a horizontal `ScrollView` for free, so on a phone the
 * day rail has always worked. On web it has not: react-native-web renders the
 * row as an overflow container, and an overflow container scrolls to the wheel
 * and to a trackpad swipe but IGNORES a held mouse button. So the rail looked
 * draggable, invited the gesture, and did nothing — which reads as the row
 * being broken rather than the pointer being wrong.
 *
 * Attaching this makes the two behave the same way.
 *
 * The part that needs care is the click at the end. Every chip in these rows is
 * a button, so a drag that ends over a chip would otherwise fire it — you would
 * scroll the rail and change exercise. A drag past `SLOP` swallows the next
 * click in the capture phase, before it can reach the Pressable. Under the slop
 * nothing is swallowed, so an ordinary tap still selects.
 */
const SLOP = 6;

export function useDragScroll<T>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const held = ref.current as unknown as
      { getScrollableNode?: () => HTMLElement } | HTMLElement | null;
    if (!held) return;
    const node: HTMLElement | undefined =
      typeof (held as { getScrollableNode?: () => HTMLElement }).getScrollableNode === 'function'
        ? (held as { getScrollableNode: () => HTMLElement }).getScrollableNode()
        : (held as HTMLElement);
    // Native has no DOM node and needs none of this.
    if (!node || typeof node.addEventListener !== 'function') return;

    let down = false;
    let startX = 0;
    let startLeft = 0;
    let travelled = 0;

    const onDown = (e: PointerEvent) => {
      // Left button only, and never a touch or pen — those already work, and
      // taking them over would replace momentum scrolling with a worse copy.
      if (e.button !== 0 || e.pointerType !== 'mouse') return;
      down = true;
      startX = e.clientX;
      startLeft = node.scrollLeft;
      travelled = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - startX;
      travelled = Math.max(travelled, Math.abs(dx));
      if (travelled > SLOP) {
        node.scrollLeft = startLeft - dx;
        // Stops the browser turning the drag into a text selection across the
        // labels, which is what a held mouse button means everywhere else.
        e.preventDefault();
      }
    };

    const onUp = () => { down = false; };

    const onClick = (e: MouseEvent) => {
      if (travelled <= SLOP) return;
      e.stopPropagation();
      e.preventDefault();
      travelled = 0;
    };

    node.addEventListener('pointerdown', onDown);
    // On the window, so releasing outside the row still ends the drag rather
    // than leaving it stuck to the pointer.
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    node.addEventListener('click', onClick, true);

    return () => {
      node.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      node.removeEventListener('click', onClick, true);
    };
  }, []);

  return ref;
}
