import type { Character } from '../types';

/** First + last initials, or '?' for a blank name. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/** The character's uploaded icon, or an initials placeholder when none is set. */
export function CharacterAvatar({ character, size = 48 }: { character: Character; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  return character.icon ? (
    <img className="avatar" src={character.icon} alt="" style={style} />
  ) : (
    <div className="avatar avatar-placeholder" style={style}>
      {initials(character.name)}
    </div>
  );
}
