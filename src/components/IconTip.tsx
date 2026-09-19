import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** The glyph shown inline. */
  icon: ReactNode;
  /** What the icon means — shown in the tooltip and read by screen readers. */
  label: string;
  className?: string;
}

/**
 * A small inline icon that explains itself: hovering (desktop) or tapping (touch —
 * the span is focusable, and a tap focuses it) shows a tooltip with `label`.
 *
 * The tooltip is portaled to <body> with fixed positioning measured from the icon,
 * so a scrolling ancestor (e.g. a modal's scroll list) can never clip it — a plain
 * CSS ::after tooltip would get cut off at the list's edges.
 */
export function IconTip({ icon, label, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  }
  const hide = () => setPos(null);

  // The bubble is fixed-positioned from a one-off measurement, so any scroll
  // (page or a scrolling list, hence capture) would leave it floating in the wrong
  // place — just dismiss it.
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [pos]);

  return (
    <>
      <span
        ref={ref}
        className={`icon-tip${className ? ` ${className}` : ''}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={() => {
          if (document.activeElement !== ref.current) hide();
        }}
        onFocus={show}
        onBlur={hide}
        onClick={() => ref.current?.focus()}
      >
        {icon}
      </span>
      {pos &&
        createPortal(
          <span className="icon-tip-bubble" role="tooltip" style={{ left: pos.x, top: pos.y }}>
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}
