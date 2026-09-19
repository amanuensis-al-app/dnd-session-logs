import { useState } from 'react';
import { ChatbotSteps, isInstructionsPaste } from './ChatbotSteps';
import type { LogEntry } from '../types';
import { Modal } from './Modal';
import {
  buildChatbotPrompt,
  parseChatbotReply,
  parseLogText,
  type TextImportResult,
} from '../importText';

interface Props {
  characterId: string;
  /** A draft was produced — open the log form prefilled with it. */
  onDraft: (log: LogEntry, warnings: string[]) => void;
  onClose: () => void;
}

/**
 * "Add Log from Text" modal: paste a session write-up, then either run the built-in
 * best-effort parser or go through any AI chatbot the user already has (copy generated
 * instructions out, paste the JSON reply back). Both paths end in a prefilled LogForm.
 */
export function AddLogFromText({ characterId, onDraft, onClose }: Props) {
  const [step, setStep] = useState<'paste' | 'chatbot'>('paste');
  const [text, setText] = useState('');
  const [reply, setReply] = useState('');

  function applyResult(produce: () => TextImportResult) {
    try {
      const result = produce();
      onDraft(result.log, result.warnings);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  // ← Back from the chatbot step also drops the pasted reply: going back usually
  // means changing the source, which makes that reply stale. (ChatbotSteps unmounts
  // too, so its copied/sent progress resets and the guide starts over at step 1.)
  function backFromChatbot() {
    setReply('');
    setStep('paste');
  }

  if (step === 'chatbot') {
    // A real chatbot reply is in (not empty, not the instructions pasted back).
    const replyReady =
      reply.trim() !== '' && !isInstructionsPaste(reply, () => buildChatbotPrompt(text));
    return (
      <Modal
        title="Fill It In with an AI Chatbot"
        wide
        decoration="decorations/ai-scribe.png"
        onClose={onClose}
      >
        <div className="text-import">
          <ChatbotSteps
            copyLabel="Copy the prepared instructions (your pasted text is included):"
            buildPrompt={() => buildChatbotPrompt(text)}
            reply={reply}
            onReplyChange={setReply}
            finishLabel="Review Log"
          />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={backFromChatbot}>
              ← Back
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn${replyReady ? ' btn-primary btn-next' : ''}`}
              disabled={!replyReady}
              onClick={() => applyResult(() => parseChatbotReply(reply, characterId))}
            >
              Review Log →
            </button>
          </div>
          <p className="muted modal-hint">
            Your text only goes to the AI chatbot you paste it into — nowhere else.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add Log from Text" wide decoration="decorations/ai-scribe.png" onClose={onClose}>
      <div className="text-import">
        <p className="muted">
          Paste the session write-up (e.g. the message your DM posted on Discord) and the log
          form gets filled in for you to check — nothing is saved without your review.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          autoFocus
          placeholder="Paste the session write-up here…"
        />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!text.trim()}
            onClick={() => applyResult(() => parseLogText(text, characterId))}
          >
            ✨ Quick Fill
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!text.trim()}
            onClick={() => setStep('chatbot')}
          >
            🤖 Use an AI Chatbot…
          </button>
        </div>
        <p className="muted modal-hint">
          <strong>Use an AI Chatbot</strong> understands any format — it walks you through using
          an AI chatbot you already have, for free. <strong>Quick Fill</strong> is instant and
          offline, but only catches what it recognises — best for neatly formatted posts.
        </p>
      </div>
    </Modal>
  );
}
