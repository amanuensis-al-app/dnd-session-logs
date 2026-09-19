import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Edge-fade hints for a scrolling box: returns ` scroll-fade-top` while there's
 * content scrolled away above, ` scroll-fade-bottom` while there's more below
 * (either, both, or ''), to append to the box's className. The fades themselves
 * are a CSS mask on `.scroll-fade` (index.css) — they only appear where scrolling
 * is actually possible, so a list that fits shows no fade at all. The hook also
 * keeps `--scrollbar-width` set on the box so the mask can skip the scrollbar.
 *
 * Re-checks on scroll, on the box resizing, and whenever `deps` change (pass
 * whatever changes the content, e.g. the filtered rows).
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, deps: unknown[]): string {
  const [edges, setEdges] = useState({ top: false, bottom: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      // The scrollbar's width (0 for overlay scrollbars) — the CSS mask leaves that
      // strip unfaded so the fade only touches the content, never the scrollbar.
      el.style.setProperty('--scrollbar-width', `${el.offsetWidth - el.clientWidth}px`);
      const top = el.scrollTop > 1;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return `${edges.top ? ' scroll-fade-top' : ''}${edges.bottom ? ' scroll-fade-bottom' : ''}`;
}
