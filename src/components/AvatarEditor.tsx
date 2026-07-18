import { useRef, useState } from 'react';
import { Modal } from './Modal';

/** Square crop window, in CSS px. */
const VIEWPORT = 240;
/** Saved image never exceeds this — downscaled if the crop is bigger, kept native
 * resolution (no upscaling) if smaller. */
const MAX_OUTPUT = 256;

interface Offset {
  x: number;
  y: number;
}

interface Props {
  /** JPEG data URL of the cropped, resized image. */
  onSave: (dataUrl: string) => void;
  onClose: () => void;
}

/**
 * Pick an image file (kept in memory only, never uploaded anywhere), then pan/zoom it
 * inside a square crop window. Confirming renders the visible square to a canvas,
 * capped at 256×256, and hands back a JPEG data URL for the caller to persist.
 */
export function AvatarEditor({ onSave, onClose }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; start: Offset } | null>(null);

  // Scale that makes the image just cover the square viewport (like CSS `cover`).
  const baseScale = (image: HTMLImageElement) =>
    Math.max(VIEWPORT / image.naturalWidth, VIEWPORT / image.naturalHeight);
  const currentScale = (image: HTMLImageElement) => baseScale(image) * zoom;

  /** The most zoom worth offering (owner rule 2026-07-19, replacing an arbitrary
   * 4× cap): the point where the crop window captures exactly MAX_OUTPUT source
   * pixels — past it the saved image would only drop below 256px. At least 1× so
   * small images (already sub-256 at cover) keep their full range. */
  const maxZoom = (image: HTMLImageElement) =>
    Math.max(1, VIEWPORT / (MAX_OUTPUT * baseScale(image)));

  /** Keeps the image edges from ever pulling inside the crop window. */
  function clamp(image: HTMLImageElement, next: Offset, s: number): Offset {
    const w = image.naturalWidth * s;
    const h = image.naturalHeight * s;
    return {
      x: Math.min(0, Math.max(VIEWPORT - w, next.x)),
      y: Math.min(0, Math.max(VIEWPORT - h, next.y)),
    };
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const s = baseScale(image);
        setImg(image);
        setZoom(1);
        setOffset({
          x: (VIEWPORT - image.naturalWidth * s) / 2,
          y: (VIEWPORT - image.naturalHeight * s) / 2,
        });
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  /** Re-centers zoom on the point currently at the viewport's center, then re-clamps. */
  function changeZoom(next: number) {
    if (!img) return;
    const oldScale = currentScale(img);
    const anchorX = (VIEWPORT / 2 - offset.x) / oldScale;
    const anchorY = (VIEWPORT / 2 - offset.y) / oldScale;
    const newScale = baseScale(img) * next;
    setZoom(next);
    setOffset(
      clamp(
        img,
        { x: VIEWPORT / 2 - anchorX * newScale, y: VIEWPORT / 2 - anchorY * newScale },
        newScale,
      ),
    );
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, start: offset };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!img || !dragRef.current) return;
    const { startX, startY, start } = dragRef.current;
    setOffset(
      clamp(
        img,
        { x: start.x + (e.clientX - startX), y: start.y + (e.clientY - startY) },
        currentScale(img),
      ),
    );
  }

  function stopDrag() {
    dragRef.current = null;
  }

  function confirm() {
    if (!img) return;
    const s = currentScale(img);
    const srcSize = VIEWPORT / s;
    const srcX = -offset.x / s;
    const srcY = -offset.y / s;
    const outSize = Math.round(Math.min(MAX_OUTPUT, srcSize));
    const canvas = document.createElement('canvas');
    canvas.width = outSize;
    canvas.height = outSize;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, outSize, outSize);
    onSave(canvas.toDataURL('image/jpeg', 0.85));
  }

  return (
    <Modal title="Character Icon" onClose={onClose}>
      {!img ? (
        <>
          <p className="muted">
            Pick a photo — you'll be able to pan and zoom to crop it square next. Nothing
            leaves your browser.
          </p>
          <input
            type="file"
            accept="image/*"
            autoFocus
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            className="avatar-crop-viewport"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDrag}
            onPointerLeave={stopDrag}
          >
            <img
              src={img.src}
              alt=""
              draggable={false}
              style={{
                width: img.naturalWidth * currentScale(img),
                height: img.naturalHeight * currentScale(img),
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          </div>
          <label className="avatar-zoom-row">
            Zoom
            <input
              type="range"
              min={1}
              max={maxZoom(img)}
              step={0.01}
              value={zoom}
              onChange={(e) => changeZoom(Number(e.target.value))}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setImg(null)}>
              Choose Different Image
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirm}>
              Save
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
