import { useState } from 'react';
import { ChatbotSteps, isInstructionsPaste } from './ChatbotSteps';
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import type { AlImportResult } from '../importAlLog';

interface Props {
  /** Choose-step title, e.g. "Import from Adventurers League Log". */
  title: string;
  /** Chatbot-step title, e.g. "Convert the AL Log with an AI Chatbot". */
  chatbotTitle: string;
  fileName: string;
  /** Muted paragraph under the file name on the choose step. */
  intro?: ReactNode;
  /** Muted hint at the bottom of the choose step comparing the two engines. */
  engineHint?: ReactNode;
  /** Warning shown on the chatbot step, under the privacy note — e.g. long-log
   * length-limit caveats. Omit where it doesn't apply. */
  chatbotWarning?: ReactNode;
  /** Runs the offline converter (throws on failure). Omit for AI-only sources
   * (free-form formats no offline heuristic can exist for) — the modal then skips
   * the engine chooser and opens straight on the chatbot step. */
  quickImport?: () => AlImportResult;
  /** Self-contained chatbot instructions with the source data embedded. */
  buildPrompt: () => string;
  /** Validates the pasted chatbot reply (throws on failure). */
  parseReply: (reply: string) => AlImportResult;
  /** A conversion was produced — hand it to the shared import-preview modal. */
  onResult: (result: AlImportResult) => void;
  onClose: () => void;
}

/**
 * CSV import, step 1: pick a conversion engine. "Quick Import" runs the offline
 * best-effort parser; "Use an AI Chatbot" is the zero-key flow — copy prepared
 * instructions (CSV embedded) into any chatbot, paste the JSON reply back. Both
 * paths end in the same preview modal; nothing is saved until the user confirms
 * there. Shared by the AL Log import and the (private) log-sheet import. The
 * free-form CSV import omits quickImport (no offline heuristic can exist for an
 * unknown layout), which skips step 1 entirely — the chatbot step IS the modal.
 */
export function ImportConvertModal({
  title,
  chatbotTitle,
  fileName,
  intro,
  engineHint,
  quickImport,
  chatbotWarning,
  buildPrompt,
  parseReply,
  onResult,
  onClose,
}: Props) {
  const [step, setStep] = useState<'choose' | 'chatbot'>(quickImport ? 'choose' : 'chatbot');
  const [reply, setReply] = useState('');

  function produce(convert: () => AlImportResult) {
    try {
      onResult(convert());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  // ← Back from the chatbot step also drops the pasted reply: going back usually
  // means changing the source, which makes that reply stale. (ChatbotSteps unmounts
  // too, so its copied/sent progress resets and the guide starts over at step 1.)
  function backFromChatbot() {
    setReply('');
    setStep('choose');
  }

  if (step === 'chatbot') {
    // A real chatbot reply is in (not empty, not the instructions pasted back).
    const replyReady = reply.trim() !== '' && !isInstructionsPaste(reply, buildPrompt);
    return (
      <Modal title={chatbotTitle} wide decoration="decorations/ai-scribe.png" onClose={onClose}>
        <div className="text-import">
          {!quickImport && (
            <p>
              <strong>{fileName}</strong>
            </p>
          )}
          <ChatbotSteps
            copyLabel="Copy the prepared instructions (the whole CSV is included):"
            buildPrompt={buildPrompt}
            reply={reply}
            onReplyChange={setReply}
            finishLabel="Preview Import"
          />
          <div className="modal-actions">
            {quickImport && (
              <button type="button" className="btn btn-ghost" onClick={backFromChatbot}>
                ← Back
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn${replyReady ? ' btn-primary btn-next' : ''}`}
              disabled={!replyReady}
              onClick={() => produce(() => parseReply(reply))}
            >
              Preview Import →
            </button>
          </div>
          <p className="muted modal-hint">
            Your data only goes to the AI chatbot you paste it into — nowhere else. You'll still
            get the usual preview before anything is imported.
          </p>
          {chatbotWarning && <p className="warning modal-hint">{chatbotWarning}</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} decoration="decorations/ai-scribe.png" onClose={onClose}>
      <p>
        <strong>{fileName}</strong>
      </p>
      <p className="muted">{intro}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => quickImport && produce(quickImport)}>
          ✨ Quick Import
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setStep('chatbot')}>
          🤖 Use an AI Chatbot…
        </button>
      </div>
      <p className="muted modal-hint">{engineHint}</p>
    </Modal>
  );
}
