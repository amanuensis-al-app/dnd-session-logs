import { importAlLog } from '../importAlLog';
import type { AlImportResult } from '../importAlLog';
import { buildAlChatbotPrompt, parseAlChatbotReply } from '../importAlChatbot';
import { ImportConvertModal } from './ImportConvertModal';

interface Props {
  csvText: string;
  fileName: string;
  /** A conversion was produced — hand it to the shared import-preview modal. */
  onResult: (result: AlImportResult) => void;
  onClose: () => void;
}

/** Import AL Log (the public adventurersleaguelog.com path) — engine choice +
 * chatbot bridge live in ImportConvertModal; this is just the AL configuration. */
export function ImportAlLog({ csvText, fileName, onResult, onClose }: Props) {
  return (
    <ImportConvertModal
      title="Import from Adventurers League Log"
      chatbotTitle="Convert the AL Log with an AI Chatbot"
      fileName={fileName}
      intro={
        <>
          How should this log be converted? Either way you'll review a preview before
          anything is imported.
        </>
      }
      engineHint={
        <>
          <strong>Use an AI Chatbot</strong> reads the notes bullets like a person: starting
          gold becomes a Creation log, "Sell back…" lines become a proper Sell log, and items
          get clean names with prices and quantities. <strong>Quick Import</strong> is instant
          and offline, but best-effort — it can leave those as oddly-named items or Free Logs
          you'll have to fix by hand.
        </>
      }
      quickImport={() => importAlLog(csvText)}
      buildPrompt={() => buildAlChatbotPrompt(csvText)}
      parseReply={(reply) => parseAlChatbotReply(reply, csvText)}
      onResult={onResult}
      onClose={onClose}
    />
  );
}
