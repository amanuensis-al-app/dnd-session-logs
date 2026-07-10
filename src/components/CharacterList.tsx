import { useState } from 'react';
import type { Character, DerivedStats } from '../types';
import { newId } from '../types';
import { formatGp } from '../derive';

interface Props {
  characters: Character[];
  derivedByCharacter: Map<string, DerivedStats>;
  onOpen: (characterId: string) => void;
  onCreate: (character: Character) => void;
}

export function CharacterList({ characters, derivedByCharacter, onOpen, onCreate }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('');
  const [charClass, setCharClass] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      id: newId(),
      name: name.trim(),
      species: species.trim(),
      class: charClass.trim(),
      createdAt: Date.now(),
    });
    setName('');
    setSpecies('');
    setCharClass('');
    setCreating(false);
  }

  return (
    <div className="character-list">
      <div className="page-heading">
        <h1>Characters</h1>
        <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
          {creating ? 'Cancel' : '+ New Character'}
        </button>
      </div>

      {creating && (
        <form className="card form-card" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Name *
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Thistle Brambleburr"
                required
              />
            </label>
            <label>
              Species
              <input
                value={species}
                onChange={(e) => setSpecies(e.target.value)}
                placeholder="e.g. Halfling"
              />
            </label>
            <label>
              Class
              <input
                value={charClass}
                onChange={(e) => setCharClass(e.target.value)}
                placeholder="e.g. Rogue"
              />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Create Character
            </button>
          </div>
        </form>
      )}

      {characters.length === 0 && !creating ? (
        <div className="empty-state">
          <p>No characters yet.</p>
          <p className="muted">
            Create a character, then use a <strong>Free Log</strong> to record their starting
            level and equipment.
          </p>
        </div>
      ) : (
        <div className="character-grid">
          {characters.map((c) => {
            const d = derivedByCharacter.get(c.id)!;
            return (
              <button key={c.id} className="card character-card" onClick={() => onOpen(c.id)}>
                <div className="character-card-name">{c.name}</div>
                <div className="character-card-sub muted">
                  {[c.species, c.class].filter(Boolean).join(' · ') || '—'}
                </div>
                <div className="character-card-stats">
                  <span>
                    <strong>Lv {d.level}</strong>
                  </span>
                  <span>{formatGp(d.gp)} gp</span>
                  <span>{d.downtimeDays} downtime</span>
                  <span>{d.inventory.length} items</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
