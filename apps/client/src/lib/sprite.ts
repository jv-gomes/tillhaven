import type { SheetSpec } from '@tillhaven/shared/config';

/**
 * Renders one frame of a spritesheet as a DOM element, outside the Phaser
 * canvas — used by the landing and auth pages.
 *
 * The sheet is set as a background image, scaled up as a whole, and offset so
 * the requested frame lands in the box. Only INTEGER scale factors are allowed:
 * a fractional scale resamples pixel art into mush no matter what
 * `image-rendering` says.
 */

export interface SpriteOptions {
  /** Integer upscale. Fractional values are rejected. */
  scale?: number;
  className?: string;
  /** Frames-per-second for an animated strip. Omit for a static frame. */
  fps?: number;
  /** Number of frames to cycle through, starting at `frame`. */
  frameCount?: number;
  title?: string;
}

let animationStyleSheet: CSSStyleSheet | null = null;
const registeredAnimations = new Set<string>();

function sheetForAnimations(): CSSStyleSheet {
  if (!animationStyleSheet) {
    const el = document.createElement('style');
    el.dataset['tillhaven'] = 'sprite-animations';
    document.head.appendChild(el);
    animationStyleSheet = el.sheet as CSSStyleSheet;
  }
  return animationStyleSheet;
}

/**
 * A horizontal strip animation is just background-position stepping. Using
 * `steps()` keeps every frame on an exact pixel boundary — a linear timing
 * function would land mid-frame and show two half-sprites at once.
 */
function registerStripAnimation(name: string, distancePx: number, steps: number): void {
  if (registeredAnimations.has(name)) return;
  registeredAnimations.add(name);
  const sheet = sheetForAnimations();
  sheet.insertRule(
    `@keyframes ${name} { from { background-position-x: 0px; } to { background-position-x: -${distancePx}px; } }`,
    sheet.cssRules.length,
  );
  void steps;
}

export function sprite(spec: SheetSpec, frame: number, opts: SpriteOptions = {}): HTMLElement {
  const scale = opts.scale ?? 3;
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`Sprite scale must be a positive integer, got ${scale}`);
  }

  const col = frame % spec.cols;
  const row = Math.floor(frame / spec.cols);

  const el = document.createElement('span');
  el.className = ['sprite', opts.className].filter(Boolean).join(' ');
  if (opts.title) el.title = opts.title;

  const w = spec.frameWidth * scale;
  const h = spec.frameHeight * scale;

  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.backgroundImage = `url("${spec.path}")`;
  el.style.backgroundSize = `${spec.width * scale}px ${spec.height * scale}px`;
  el.style.backgroundPositionX = `-${col * w}px`;
  el.style.backgroundPositionY = `-${row * h}px`;

  const frameCount = opts.frameCount ?? 1;
  if (opts.fps && frameCount > 1) {
    const name = `strip-${spec.key}-r${row}-c${col}-n${frameCount}-s${scale}`;
    registerStripAnimation(name, frameCount * w, frameCount);
    // Offset the whole animation by the starting column via a wrapper margin on
    // background-position-x is not possible alongside the keyframes, so strips
    // are expected to start at column 0 of their row.
    el.style.animation = `${name} ${frameCount / opts.fps}s steps(${frameCount}) infinite`;
  }

  return el;
}

/** Convenience for the common "animate a full row of a directional sheet" case. */
export function animatedSprite(
  spec: SheetSpec,
  row: number,
  frameCount: number,
  fps: number,
  opts: Omit<SpriteOptions, 'fps' | 'frameCount'> = {},
): HTMLElement {
  return sprite(spec, row * spec.cols, { ...opts, fps, frameCount });
}
