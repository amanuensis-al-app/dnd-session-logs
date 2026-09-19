import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

interface Props {
  text: string;
  className?: string;
}

/** Scroll speed of the hover marquee, in pixels per second. */
const MARQUEE_SPEED = 45;

/**
 * One line of text, truncated with an ellipsis at rest. When it doesn't fit, hovering
 * an ancestor `.marquee-host` (e.g. a character card) swaps the ellipsis for a
 * looping marquee of the full text — two copies side by side scrolling by exactly
 * one copy's width, so the loop is seamless. Text that fits never animates. The
 * full text is also the tooltip, and reduced-motion users just keep the ellipsis.
 *
 * Added 2026-09-20 so every character-list card has the same height regardless of
 * name/class length (owner's design: truncate normally, rotate on hover).
 */
export function MarqueeText({ text, className }: Props) {
  const restRef = useRef<HTMLSpanElement>(null);
  const [overflowWidth, setOverflowWidth] = useState(0);

  // Re-measure whenever the box resizes (window width, grid reflow), the text
  // changes, or a web font finishes loading — the box itself keeps its size when
  // the font swaps in, so the ResizeObserver alone would keep a stale measurement
  // taken with the fallback font. overflowWidth is the full text's width when it's
  // cut off, else 0.
  useLayoutEffect(() => {
    const el = restRef.current;
    if (!el) return;
    const measure = () =>
      setOverflowWidth(el.scrollWidth > el.clientWidth + 1 ? el.scrollWidth : 0);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts?.addEventListener('loadingdone', measure);
    document.fonts?.ready.then(measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [text]);

  const overflowing = overflowWidth > 0;
  const style = overflowing
    ? ({
        '--marquee-duration': `${Math.max(3, overflowWidth / MARQUEE_SPEED)}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span
      className={`marquee${overflowing ? ' marquee-overflowing' : ''}${className ? ` ${className}` : ''}`}
      title={overflowing ? text : undefined}
      style={style}
    >
      <span ref={restRef} className="marquee-rest">
        {text}
      </span>
      {overflowing && (
        <span className="marquee-track" aria-hidden="true">
          <span className="marquee-copy">{text}</span>
          <span className="marquee-copy">{text}</span>
        </span>
      )}
    </span>
  );
}
