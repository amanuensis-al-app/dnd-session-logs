import { useEffect, type ReactNode } from 'react';

/** Open modals in mount order — Escape and the backdrop close only the topmost one,
 * so a picker opened INSIDE another modal (e.g. the magic-item picker from the
 * inventory item editor) doesn't take the parent down with it. */
const openModals: (() => void)[] = [];

/** Centered dialog over a dimmed backdrop. Closes on Escape or backdrop click. */
export function Modal({
  title,
  onClose,
  wide = false,
  decoration,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Wider dialog for content like pasted text. */
  wide?: boolean;
  /** Illustration shown above the title — the AI-chatbot screens' Ama-and-scribe
   * header image (see index.css .modal-decoration). Public-asset path, joined with
   * BASE_URL the same way ama-icon.png is elsewhere. */
  decoration?: string;
  children: ReactNode;
}) {
  useEffect(() => {
    openModals.push(onClose);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === onClose) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => {
      const i = openModals.indexOf(onClose);
      if (i !== -1) openModals.splice(i, 1);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={wide ? 'modal card modal-wide' : 'modal card'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {decoration && (
          <img
            className="modal-decoration"
            src={`${import.meta.env.BASE_URL}${decoration}`}
            alt=""
          />
        )}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
