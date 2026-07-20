import type { AlImportResult } from '../importAlLog';
import { buildCsvChatbotPrompt, parseCsvChatbotReply } from '../importCsvChatbot';
import { ImportConvertModal } from './ImportConvertModal';

interface Props {
  csvText: string;
  fileName: string;
  /** A conversion was produced — hand it to the shared import-preview modal. */
  onResult: (result: AlImportResult) => void;
  onClose: () => void;
}

/** Import CSV Log (any free-form CSV/spreadsheet play log) — AI-only: no
 * quickImport prop, so ImportConvertModal skips the engine chooser and opens
 * straight on the chatbot copy/paste step. An offline parser can't exist here —
 * the layout is unknown by definition; the prompt teaches the chatbot to
 * reverse-engineer it first (importCsvChatbot.ts). */
export function ImportCsvLog({ csvText, fileName, onResult, onClose }: Props) {
  return (
    <ImportConvertModal
      title="Import from CSV Log"
      chatbotTitle="Convert the CSV Log with an AI Chatbot"
      fileName={fileName}
      buildPrompt={() => buildCsvChatbotPrompt(csvText, fileName)}
      parseReply={(reply) => parseCsvChatbotReply(reply, fileName)}
      onResult={onResult}
      onClose={onClose}
    />
  );
}
