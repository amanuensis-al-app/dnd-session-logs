import { importSheetLog } from '../importSheetLog';
import type { AlImportResult } from '../importAlLog';
import { buildSheetChatbotPrompt, parseSheetChatbotReply } from '../importSheetChatbot';
import { ImportConvertModal } from './ImportConvertModal';

interface Props {
  csvText: string;
  fileName: string;
  /** A conversion was produced — hand it to the shared import-preview modal. */
  onResult: (result: AlImportResult) => void;
  onClose: () => void;
}

/** Import Log Sheet (the owner's private format) — engine choice + chatbot bridge
 * live in ImportConvertModal; this is just the log-sheet configuration of it. */
export function ImportLogSheet({ csvText, fileName, onResult, onClose }: Props) {
  return (
    <ImportConvertModal
      title="Import from Log Sheet"
      chatbotTitle="Convert the Log Sheet with an AI Chatbot"
      fileName={fileName}
      intro={
        <>
          How should this sheet be converted? Either way you'll review a preview before
          anything is imported.
        </>
      }
      engineHint={
        <>
          <strong>Use an AI Chatbot</strong> classifies the sheet's odd rows (body reforms,
          service awards, undated catch-ups…) better. <strong>Quick Import</strong> is instant
          and offline, but files everything it can't recognise as a Free Log.
        </>
      }
      quickImport={() => importSheetLog(csvText, fileName)}
      buildPrompt={() => buildSheetChatbotPrompt(csvText, fileName)}
      parseReply={(reply) => parseSheetChatbotReply(reply, fileName)}
      onResult={onResult}
      onClose={onClose}
    />
  );
}
