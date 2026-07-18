import { useState } from 'react';
import type { InventoryItem, MinorProperty, Rarity } from '../types';
import {
  CATEGORY_LABELS_SINGULAR,
  MINOR_PROPERTIES,
  RARITIES,
  RARITY_CATEGORIES,
  STACKED_CATEGORIES,
} from '../types';
import { MagicItemNameField } from './MagicItemNameField';
import { Modal } from './Modal';

/** What the inventory item editor may change. Quantity and per-log pricing are
 * deliberately NOT editable here: quantities derive from gains/losses across logs,
 * and costs live on individual log entries — fix those in the logs themselves. */
export interface ItemEditChanges {
  name: string;
  rarity?: Rarity;
  description?: string;
  minorProperty?: MinorProperty;
  requiresAttunement?: boolean;
}

interface Props {
  item: InventoryItem;
  onSave: (changes: ItemEditChanges) => void;
  onClose: () => void;
}

/**
 * Edit an inventory item in place (Inventory tab's ✎ button). The item is written
 * back to its source log(s) by the caller — stacked items (consumables/equipment)
 * are renamed across EVERY log referencing them, so the modal says so up front.
 */
export function ItemEditModal({ item, onSave, onClose }: Props) {
  const [name, setName] = useState(item.name);
  const [rarity, setRarity] = useState<Rarity>(item.rarity ?? 'uncommon');
  const [description, setDescription] = useState(item.description ?? '');
  const [minorProperty, setMinorProperty] = useState<MinorProperty | ''>(item.minorProperty ?? '');
  const [requiresAttunement, setRequiresAttunement] = useState(item.requiresAttunement ?? true);

  const stacked = STACKED_CATEGORIES.includes(item.category);
  const isMagic = item.category === 'magic_item';
  const hasRarity = RARITY_CATEGORIES.includes(item.category);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      rarity: hasRarity ? rarity : undefined,
      description: stacked ? undefined : description.trim() || undefined,
      minorProperty: isMagic ? minorProperty || undefined : undefined,
      requiresAttunement: isMagic ? requiresAttunement : undefined,
    });
  }

  return (
    <Modal title={`Edit ${CATEGORY_LABELS_SINGULAR[item.category]}`} onClose={onClose}>
      {stacked && (
        <p className="muted">
          This item stacks: saving renames it in every log that granted it, and its
          losses follow.
        </p>
      )}
      <form onSubmit={submit} className="item-edit-form">
        {isMagic ? (
          <div className="field-stack">
            <span>Name *</span>
            <MagicItemNameField
              value={name}
              onChangeName={setName}
              onPick={(picked) => {
                setName(picked.name);
                setRarity(picked.rarity);
                setRequiresAttunement(picked.requiresAttunement);
              }}
              autoFocus
            />
          </div>
        ) : (
          <label>
            Name *
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        {hasRarity && (
          <label>
            Rarity
            <select value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
        )}
        {isMagic && (
          <>
            <label>
              Minor property
              <select
                value={minorProperty}
                onChange={(e) => setMinorProperty(e.target.value as MinorProperty | '')}
              >
                <option value="">— none —</option>
                {MINOR_PROPERTIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Attunement
              <select
                value={requiresAttunement ? 'required' : 'not-required'}
                onChange={(e) => setRequiresAttunement(e.target.value === 'required')}
              >
                <option value="required">Requires Attunement</option>
                <option value="not-required">Attunement Not Required</option>
              </select>
            </label>
          </>
        )}
        {!stacked && (
          <label>
            Description
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="description (optional)"
            />
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
