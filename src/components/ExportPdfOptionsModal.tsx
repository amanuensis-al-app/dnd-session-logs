import { useState } from 'react';
import type { Character } from '../types';
import { Modal } from './Modal';

export interface ExportPdfOptions {
  showIcon: boolean;
  showPrep: boolean;
  showLogs: boolean;
}

interface Props {
  character: Character;
  onCancel: () => void;
  onConfirm: (options: ExportPdfOptions) => void;
}

/**
 * Asked right before "Export PDF" opens the printable report — lets the user drop
 * sections from THIS particular export (e.g. skip Prep for a report that's just
 * about log history, or leave the icon off a copy headed somewhere more public).
 * Nothing here is persisted; every export starts back at these defaults.
 */
export function ExportPdfOptionsModal({ character, onCancel, onConfirm }: Props) {
  const hasIcon = !!character.icon;
  const [showIcon, setShowIcon] = useState(hasIcon);
  const [showPrep, setShowPrep] = useState(true);
  const [showLogs, setShowLogs] = useState(true);

  return (
    <Modal title="Export PDF" onClose={onCancel}>
      <p className="muted">Choose what to include in this report.</p>
      <div className="modal-checkbox-list">
        <label className="modal-checkbox-row">
          <input
            type="checkbox"
            checked={showIcon}
            disabled={!hasIcon}
            onChange={(e) => setShowIcon(e.target.checked)}
          />
          Show Character Icon
          {!hasIcon && <span className="muted"> — no icon set</span>}
        </label>
        <label className="modal-checkbox-row">
          <input type="checkbox" checked={showPrep} onChange={(e) => setShowPrep(e.target.checked)} />
          Show Prep
        </label>
        <label className="modal-checkbox-row">
          <input type="checkbox" checked={showLogs} onChange={(e) => setShowLogs(e.target.checked)} />
          Show Logs
        </label>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => onConfirm({ showIcon: hasIcon && showIcon, showPrep, showLogs })}
        >
          Continue
        </button>
      </div>
    </Modal>
  );
}
