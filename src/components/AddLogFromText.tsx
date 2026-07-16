import { useState } from 'react';
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
  const [copied, setCopied] = useState(false);

  function applyResult(produce: () => TextImportResult) {
    try {
      const result = produce();
      onDraft(result.log, result.warnings);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(buildChatbotPrompt(text));
      setCopied(true);
    } catch {
      alert('Could not access the clipboard — please allow clipboard access and try again.');
    }
  }

  if (step === 'chatbot') {
    return (
      <Modal title="Fill It In with an AI Chatbot" wide onClose={onClose}>
        <div className="text-import">
          <ol>
            <li>
              Copy the prepared instructions (your pasted text is included):{' '}
              <button type="button" className="btn btn-small" onClick={copyInstructions}>
                {copied ? '✓ Copied' : '📋 Copy Instructions'}
              </button>
            </li>
            <li>
              Paste them into any AI chatbot you already use — ChatGPT, Claude, Gemini… — and
              send.
            </li>
            <li>Copy the chatbot's whole reply and paste it below.</li>
          </ol>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={7}
            placeholder="Paste the chatbot's reply here…"
          />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep('paste')}>
              ← Back
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reply.trim()}
              onClick={() => applyResult(() => parseChatbotReply(reply, characterId))}
            >
              Fill In the Form
            </button>
          </div>
          <p className="muted modal-hint">
            Your text only goes to the chatbot you paste it into — nowhere else.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Add Log from Text" wide onClose={onClose}>
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
          a chatbot you already have, for free. <strong>Quick Fill</strong> is instant and
          offline, but only catches what it recognises — best for neatly formatted posts.
        </p>
      </div>
    </Modal>
  );
}
