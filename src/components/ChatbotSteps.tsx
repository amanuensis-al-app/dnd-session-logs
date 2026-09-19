import { useRef, useState } from 'react';

interface Props {
  /** Step 1's lead-in, e.g. "Copy the prepared instructions (the whole CSV is included):". */
  copyLabel: string;
  /** Builds the instructions text copied to the clipboard. */
  buildPrompt: () => string;
  reply: string;
  onReplyChange: (reply: string) => void;
  /** The caller's submit button label, named in step 3 ("…then press Review Log"). */
  finishLabel: string;
}

/** How much of the instructions' opening a reply must contain to count as "the
 * user pasted the instructions back instead of the chatbot's answer". */
const PROMPT_FINGERPRINT_LENGTH = 80;

/**
 * The shared copy → paste-into-chatbot → paste-reply-back steps of every AI-chatbot
 * screen (Add Log from Text, and the CSV imports via ImportConvertModal).
 *
 * Guided one step at a time: step 1 is highlighted (gold frame + the animated
 * arrow) until copied; then step 2 (paste into the chatbot and SEND — the one
 * playtesters kept skipping) lights up alone, marked "Next" with a glow and a
 * "Sent it" button; pressing that (or pasting a real reply, which proves it was
 * done) moves the highlight to step 3 and the reply box. The usual symptom of
 * skipping step 2 — pasting the instructions themselves back into the reply box —
 * is detected and called out (see `isInstructionsPaste`,
 * which the caller uses to keep its submit button disabled).
 */
export function ChatbotSteps({
  copyLabel,
  buildPrompt,
  reply,
  onReplyChange,
  finishLabel,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(buildPrompt());
      setCopied(true);
    } catch {
      alert('Could not access the clipboard — please allow clipboard access and try again.');
    }
  }

  const pastedInstructions = isInstructionsPaste(reply, buildPrompt);
  const hasReply = reply.trim() !== '' && !pastedInstructions;
  // Which step is highlighted: 1 until copied, 2 until marked sent, then 3 until
  // the reply is in. A real reply proves steps 1 AND 2 were done, so pasting one
  // jumps straight to 3 from anywhere — experienced users who skip the Copy button
  // (e.g. reusing instructions already in their chatbot) aren't held back.
  const step2Done = hasReply || (copied && sent);
  const activeStep = hasReply ? 3 : !copied ? 1 : !sent ? 2 : 3;

  function markSent() {
    setSent(true);
    replyRef.current?.focus();
  }

  return (
    <>
      <ol className={`chatbot-steps${copied ? ' chatbot-steps-copied' : ''}`}>
        <li
          className={`chatbot-step${
            activeStep === 1 ? ' chatbot-step-active chatbot-step-next' : ' chatbot-step-done'
          }`}
        >
          {copyLabel}
          <div className="copy-instructions-row">
            {activeStep === 1 && (
              <span className="copy-arrow-hint" aria-hidden="true">
                →
              </span>
            )}
            <button
              type="button"
              className={`btn btn-copy-prominent${copied ? '' : ' btn-primary'}`}
              onClick={copyInstructions}
            >
              {copied ? '✓ Copied — copy again' : '📋 Copy Instructions'}
            </button>
          </div>
        </li>
        <li
          className={`chatbot-step${
            activeStep === 2 ? ' chatbot-step-active chatbot-step-next' : ''
          }${step2Done ? ' chatbot-step-done' : ''}`}
        >
          {activeStep === 2 && <span className="chatbot-step-tag">Next</span>}
          <strong>Open any AI chatbot you already use</strong> — ChatGPT, Claude, Gemini… —{' '}
          <strong>paste the instructions into it and send</strong>.
          {activeStep === 2 && (
            <div className="chatbot-step-action">
              <button type="button" className="btn btn-primary" onClick={markSent}>
                ✓ Done, I've sent it
              </button>
            </div>
          )}
        </li>
        <li
          className={`chatbot-step${
            activeStep === 3 ? ` chatbot-step-active${hasReply ? '' : ' chatbot-step-next'}` : ''
          }`}
        >
          {activeStep === 3 && !hasReply && <span className="chatbot-step-tag">Next</span>}
          Wait for its answer, then <strong>copy the chatbot's whole reply</strong>, paste it
          below, and press <strong>{finishLabel}</strong>.
        </li>
      </ol>
      <textarea
        ref={replyRef}
        className={
          activeStep === 3 ? `chatbot-reply-active${hasReply ? '' : ' chatbot-reply-next'}` : undefined
        }
        value={reply}
        onChange={(e) => onReplyChange(e.target.value)}
        rows={7}
        placeholder="Paste the AI chatbot's reply here…"
      />
      {pastedInstructions && (
        <p className="warning chatbot-paste-warning">
          ⚠ That's the instructions you copied, not the chatbot's reply. Do step 2 first: paste
          them into your AI chatbot and send, then copy its answer back here.
        </p>
      )}
    </>
  );
}

/** True when `reply` is (or contains) the copied instructions rather than a chatbot
 * answer — the tell-tale sign of a skipped step 2. */
export function isInstructionsPaste(reply: string, buildPrompt: () => string): boolean {
  if (!reply.trim()) return false;
  const fingerprint = buildPrompt().trim().slice(0, PROMPT_FINGERPRINT_LENGTH);
  return fingerprint.length > 0 && reply.includes(fingerprint);
}
