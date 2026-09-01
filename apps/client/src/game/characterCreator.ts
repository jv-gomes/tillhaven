import {
  CHAR_ANIMS,
  CHAR_FRAME,
  CHAR_LAYER_ORDER,
  charDirectionStart,
  charLayerPath,
  charLayerVariant,
} from '@tillhaven/shared/config';
import {
  CLOTHES_COLORS,
  EYE_COLORS,
  EYE_SEXES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_IDS,
  type Appearance,
} from '@tillhaven/shared/schemas';
import { messageFor } from '../net/errors.js';
import { idempotencyKey } from '../net/api.js';
import { saveAppearance } from '../net/player.js';

/**
 * The first-login character creator (T-8.02).
 *
 * A blocking overlay rather than a panel: every other panel in the HUD is
 * something you dip into while the farm carries on behind it, and this is the
 * opposite — nothing else can be done until the character exists, so it covers
 * the whole HUD and swallows the clicks that would otherwise reach the canvas.
 *
 * **Every swatch is the real art**, not a colour chip: each one renders the
 * player's current appearance with exactly one field changed, through the same
 * compositor as the big preview. That was not the obvious first design (CSS
 * colour chips are less code), but the eye layer covers roughly one percent of
 * a 32×32 frame — a "blue eyes" chip would be a promise the art cannot keep,
 * while a whole character with blue eyes is honestly what you are choosing.
 *
 * The enum arrays come from `@tillhaven/shared/schemas`, the same ones the
 * server validates against (T-8.01), so an option this UI offers cannot be one
 * the endpoint refuses.
 */

/** The pose the creator shows: first frame of the down-facing Idle block. */
const PREVIEW_ANIM = 'idle';
const PREVIEW_FRAME = charDirectionStart(CHAR_ANIMS[PREVIEW_ANIM], 'down');

/** Integer upscales. Fractional scaling on pixel art produces mush. */
const PREVIEW_SCALE = 6;
const SWATCH_SCALE = 2;

/**
 * What a new farmer starts as, and what "Start farming" accepts unchanged —
 * T-8.02's default-accept button is just Save on an untouched default.
 *
 * Deliberately the first value of every enum, so this cannot drift out of step
 * with the schema by naming an option that was later removed — the arrays are
 * `as const` and non-empty, which is why the indexing is safe.
 */
export const DEFAULT_APPEARANCE: Appearance = {
  skin: SKIN_IDS[0],
  eyes: { sex: EYE_SEXES[0], color: EYE_COLORS[0] },
  hair: { style: HAIR_STYLES[0], color: HAIR_COLORS[0] },
  clothes: CLOTHES_COLORS[0],
};

/* ------------------------------------------------------------------ *
 * Layer image cache
 *
 * Drawing is kept SYNCHRONOUS and the cache is what makes that possible: a
 * draw paints whatever has already loaded and nothing else, and each image
 * that arrives later asks for a redraw. The async alternative — awaiting four
 * images per canvas — has to defend against a slow load for an option the
 * player has already clicked past, and there are 26 canvases here for it to
 * get wrong.
 * ------------------------------------------------------------------ */

const images = new Map<string, HTMLImageElement>();
const failed = new Set<string>();

function layerImage(path: string, onLoad: () => void): HTMLImageElement | null {
  const cached = images.get(path);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  if (failed.has(path)) return null;

  const img = new Image();
  images.set(path, img);
  img.addEventListener('load', onLoad);
  img.addEventListener('error', () => {
    // A missing strip means the appearance enums and `pnpm assets` have drifted
    // apart. Say which file, once — the creator still works, minus that layer.
    failed.add(path);
    console.error(`[tillhaven] character layer failed to load: ${path}`);
  });
  img.src = path;
  return null;
}

/**
 * Composites one appearance into a canvas, bottom layer first.
 *
 * Drawn at 1:1 into a 32×32 canvas and blown up by CSS, so the browser's
 * nearest-neighbour upscale (`image-rendering: pixelated`) is the only
 * resampling that happens.
 */
function drawAppearance(
  canvas: HTMLCanvasElement,
  appearance: Appearance,
  onLoad: () => void,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, CHAR_FRAME.width, CHAR_FRAME.height);

  for (const layer of CHAR_LAYER_ORDER) {
    const path = charLayerPath(PREVIEW_ANIM, layer, charLayerVariant(layer, appearance));
    const img = layerImage(path, onLoad);
    if (!img) continue;

    ctx.drawImage(
      img,
      PREVIEW_FRAME * CHAR_FRAME.width,
      0,
      CHAR_FRAME.width,
      CHAR_FRAME.height,
      0,
      0,
      CHAR_FRAME.width,
      CHAR_FRAME.height,
    );
  }
}

function makeCanvas(scale: number, className: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.width = CHAR_FRAME.width;
  canvas.height = CHAR_FRAME.height;
  canvas.style.width = `${CHAR_FRAME.width * scale}px`;
  canvas.style.height = `${CHAR_FRAME.height * scale}px`;
  return canvas;
}

function randomOf<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)]!;
}

function randomAppearance(): Appearance {
  return {
    skin: randomOf(SKIN_IDS),
    eyes: { sex: randomOf(EYE_SEXES), color: randomOf(EYE_COLORS) },
    hair: { style: randomOf(HAIR_STYLES), color: randomOf(HAIR_COLORS) },
    clothes: randomOf(CLOTHES_COLORS),
  };
}

/* ------------------------------------------------------------------ *
 * The rows
 * ------------------------------------------------------------------ */

/**
 * One swatch, with its option already baked in.
 *
 * `apply` is what lets a swatch be previewed and selected from one
 * definition: given the working appearance it returns the appearance this
 * option would produce, which is both what the swatch DRAWS and what a click
 * COMMITS. The two cannot disagree because there is only one of them.
 */
interface SwatchSpec {
  readonly label: string;
  readonly apply: (appearance: Appearance) => Appearance;
  readonly isSelected: (appearance: Appearance) => boolean;
}

interface RowSpec {
  readonly label: string;
  readonly swatches: readonly SwatchSpec[];
}

const titled = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Erases a row's value type into closures.
 *
 * Each row picks from a different enum, so an array of rows that still knew
 * its value type would need an `any` to hold them together. Closing over the
 * value here keeps every row fully checked at its own call site and leaves
 * `RowSpec` with nothing generic left to lose.
 */
function makeRow<T>(
  label: string,
  values: readonly T[],
  apply: (appearance: Appearance, value: T) => Appearance,
  current: (appearance: Appearance) => T,
  name: (value: T) => string,
): RowSpec {
  return {
    label,
    swatches: values.map((value) => ({
      label: name(value),
      apply: (appearance) => apply(appearance, value),
      isSelected: (appearance) => current(appearance) === value,
    })),
  };
}

/** In the order the pack's layers stack: body, then face, then hair, then clothes. */
const ROWS: readonly RowSpec[] = [
  makeRow('Skin', SKIN_IDS, (a, skin) => ({ ...a, skin }), (a) => a.skin, (v) => `Skin ${v}`),
  makeRow(
    'Face',
    EYE_SEXES,
    (a, sex) => ({ ...a, eyes: { ...a.eyes, sex } }),
    (a) => a.eyes.sex,
    titled,
  ),
  makeRow(
    'Eyes',
    EYE_COLORS,
    (a, color) => ({ ...a, eyes: { ...a.eyes, color } }),
    (a) => a.eyes.color,
    titled,
  ),
  makeRow(
    'Hair',
    HAIR_STYLES,
    (a, style) => ({ ...a, hair: { ...a.hair, style } }),
    (a) => a.hair.style,
    titled,
  ),
  makeRow(
    'Hair colour',
    HAIR_COLORS,
    (a, color) => ({ ...a, hair: { ...a.hair, color } }),
    (a) => a.hair.color,
    titled,
  ),
  makeRow('Clothes', CLOTHES_COLORS, (a, clothes) => ({ ...a, clothes }), (a) => a.clothes, titled),
];

export interface CharacterCreatorHost {
  toast(message: string, kind?: 'info' | 'error'): void;
  /** The server's echo of the saved appearance, for whatever renders it. */
  onSaved(appearance: Appearance): void;
}

interface SwatchCell {
  readonly button: HTMLButtonElement;
  readonly canvas: HTMLCanvasElement;
  readonly spec: SwatchSpec;
}

export class CharacterCreator {
  private root!: HTMLElement;
  private preview!: HTMLCanvasElement;
  private saveEl!: HTMLButtonElement;
  private host!: CharacterCreatorHost;
  private readonly swatches: SwatchCell[] = [];

  private working: Appearance = DEFAULT_APPEARANCE;
  private open = false;
  /**
   * True once this session has saved an appearance. The HUD re-checks the
   * player on every 20-second poll, and the poll that overlaps a save still
   * carries the old `appearance: null` — without this the overlay would blink
   * back over a farm that already has a character.
   */
  private saved = false;
  private inFlight = false;
  private renderQueued = false;

  mount(host: CharacterCreatorHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('section');
    this.root.className = 'creator';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Create your farmer');
    this.root.innerHTML = `
      <div class="creator__card">
        <header class="creator__head">
          <span class="creator__title">Your farmer</span>
        </header>
        <p class="creator__hint">
          Looks only — nothing here changes how the farm plays.
        </p>
        <div class="creator__body">
          <div class="creator__stage" data-stage></div>
          <div class="creator__rows" data-rows></div>
        </div>
        <footer class="creator__actions">
          <button class="creator__btn" type="button" data-random>Surprise me</button>
          <button class="creator__btn creator__btn--primary" type="button" data-save>
            Start farming
          </button>
        </footer>
      </div>
    `;

    this.preview = makeCanvas(PREVIEW_SCALE, 'creator__preview');
    this.root.querySelector('[data-stage]')!.append(this.preview);

    this.buildRows();

    this.saveEl = this.root.querySelector('[data-save]')!;
    this.saveEl.addEventListener('click', () => void this.save());
    this.root.querySelector('[data-random]')!.addEventListener('click', () => {
      this.working = randomAppearance();
      this.render();
    });

    // No Escape handler and no close button, unlike every other panel: there is
    // nothing to go back to. "Start farming" on the untouched default is the
    // way out for a player who does not care (T-8.02's default-accept button).
    return this.root;
  }

  /**
   * Shows the creator if this player has never made a character.
   *
   * Called with whatever the server last said about the player, so the null
   * check is the server's answer and not a local guess.
   */
  ensure(appearance: Appearance | null): void {
    if (appearance !== null || this.saved || this.open) return;
    this.show();
  }

  /** Dev-only: re-open the creator over an existing character (T-8.03 uses it). */
  reopen(appearance: Appearance | null): void {
    this.working = appearance ?? DEFAULT_APPEARANCE;
    this.saved = false;
    this.show();
  }

  private show(): void {
    this.open = true;
    this.root.hidden = false;
    this.render();
  }

  private hide(): void {
    this.open = false;
    this.root.hidden = true;
  }

  private buildRows(): void {
    const rows = this.root.querySelector('[data-rows]')!;

    for (const spec of ROWS) {
      const wrap = document.createElement('div');
      wrap.className = 'creator__row';

      const label = document.createElement('p');
      label.className = 'creator__rowlabel';
      label.id = `creator-row-${spec.label.replace(/\s+/g, '-').toLowerCase()}`;
      label.textContent = spec.label;

      const list = document.createElement('div');
      list.className = 'creator__swatches';
      list.setAttribute('role', 'radiogroup');
      list.setAttribute('aria-labelledby', label.id);

      for (const swatch of spec.swatches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'creator__swatch';
        button.setAttribute('role', 'radio');
        button.title = swatch.label;
        // The art carries the meaning; the name is for screen readers and for
        // anyone who cannot tell two hair styles apart at 64 pixels.
        button.setAttribute('aria-label', `${spec.label}: ${swatch.label}`);

        const canvas = makeCanvas(SWATCH_SCALE, 'creator__swatchart');
        button.append(canvas);
        button.addEventListener('click', () => {
          this.working = swatch.apply(this.working);
          this.render();
        });

        list.append(button);
        this.swatches.push({ button, canvas, spec: swatch });
      }

      wrap.append(label, list);
      rows.append(wrap);
    }
  }

  /**
   * Redraws everything from `working`.
   *
   * Cheap enough to do wholesale on every click — 27 draws of a 32×32 frame —
   * and wholesale is what keeps the swatches honest: each one shows the
   * appearance you would get by clicking it *from where you are now*, so
   * picking a hair style shows it in the hair colour you already chose.
   */
  private render(): void {
    if (!this.open) return;

    const redraw = (): void => this.scheduleRender();
    drawAppearance(this.preview, this.working, redraw);

    for (const { button, canvas, spec } of this.swatches) {
      drawAppearance(canvas, spec.apply(this.working), redraw);
      const selected = spec.isSelected(this.working);
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-checked', String(selected));
    }
  }

  /**
   * Coalesces the redraws that late-arriving layer images ask for.
   *
   * Forty-five strips can finish loading in the same tick on a warm cache;
   * redrawing 27 canvases once per file would be forty-five full passes for
   * one visible result.
   */
  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  private async save(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    this.saveEl.disabled = true;

    try {
      // One key per click, reused across retries of THAT click (§4.5).
      const result = await saveAppearance(this.working, idempotencyKey());
      const appearance = result.player.appearance;
      if (appearance) {
        // The SERVER's copy, not the one that was sent (§4.1).
        this.working = appearance;
        this.host.onSaved(appearance);
      }
      this.saved = true;
      this.hide();
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
      this.saveEl.disabled = false;
    }
  }
}
