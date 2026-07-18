import { useState } from 'react';
import { Modal } from './Modal';
import { importSheetLog } from '../importSheetLog';
import type { AlImportResult } from '../importAlLog';
import { buildSheetChatbotPrompt, parseSheetChatbotReply } from '../importSheetChatbot';

interface Props {
  csvText: string;
  fileName: string;
  /** A conversion was produced — hand it to the shared import-preview modal. */
  onResult: (result: AlImportResult) => void;
  onClose: () => void;
}

/**
 * Import Log Sheet, step 1: pick a conversion engine. "Quick Import" runs the offline
 * best-effort parser (importSheetLog); "Use an AI Chatbot" mirrors Add Log from Text's
 * zero-key flow — copy prepared instructions (CSV embedded) into any chatbot, paste
 * the JSON reply back. Both paths end in the same preview modal; nothing is saved
 * until the user confirms there.
 */
export function ImportLogSheet({ csvText, fileName, onResult, onClose }: Props) {
  const [step, setStep] = useState<'choose' | 'chatbot'>('choose');
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState(false);

  function produce(convert: () => AlImportResult) {
    try {
      onResult(convert());
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async function copyInstructions() {
    try {
      await navigator.clipboard.writeText(buildSheetChatbotPrompt(csvText, fileName));
      setCopied(true);
    } catch {
      alert('Could not access the clipboard — please allow clipboard access and try again.');
    }
  }

  if (step === 'chatbot') {
    return (
      <Modal title="Convert the Log Sheet with an AI Chatbot" wide onClose={onClose}>
        <div className="text-import">
          <ol>
            <li>
              Copy the prepared instructions (the whole CSV is included):{' '}
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
            <button type="button" className="btn btn-ghost" onClick={() => setStep('choose')}>
              ← Back
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reply.trim()}
              onClick={() => produce(() => parseSheetChatbotReply(reply, fileName))}
            >
              Preview Import
            </button>
          </div>
          <p className="muted modal-hint">
            Your sheet only goes to the chatbot you paste it into — nowhere else. You'll still
            get the usual preview before anything is imported.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Import from Log Sheet" onClose={onClose}>
      <p>
        <strong>{fileName}</strong>
      </p>
      <p className="muted">
        How should this sheet be converted? Either way you'll review a preview before
        anything is imported.
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => produce(() => importSheetLog(csvText, fileName))}
        >
          ✨ Quick Import
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setStep('chatbot')}>
          🤖 Use an AI Chatbot…
        </button>
      </div>
      <p className="muted modal-hint">
        <strong>Use an AI Chatbot</strong> classifies the sheet's odd rows (body reforms,
        service awards, undated catch-ups…) better. <strong>Quick Import</strong> is instant
        and offline, but files everything it can't recognise as a Free Log.
      </p>
    </Modal>
  );
}
