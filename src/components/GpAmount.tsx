import { formatGpParts } from '../derive';

/** Renders a GP amount with its sp/cp fraction printed smaller than the whole
 * number — see formatGpParts in derive.ts for why. */
export function GpAmount({ value }: { value: number }) {
  const { sign, whole, fraction } = formatGpParts(value);
  return (
    <>
      {sign}
      {whole}
      {fraction && <span className="gp-fraction">.{fraction}</span>}
    </>
  );
}
