import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-expect-error -- plain .mjs developer tooling, outside any package's
// tsconfig and deliberately untyped. Importing it is the point of this test:
// the crop table is the single source of truth for the nine-slice geometry, and
// duplicating it into a .ts file to get types would create the second copy this
// test exists to prevent.
import { UI_CROPS } from '../../../../scripts/lib/ui-crops.mjs';

/**
 * The nine-slice geometry in `ui.css` must match the rectangles the build cuts
 * (Phase U).
 *
 * **Why this can go wrong silently.** `border-image-slice` is a set of magic
 * numbers describing an image the stylesheet cannot see. Get one wrong and CSS
 * does not complain — it renders a frame whose corners are taken from the wrong
 * pixels, which looks like a smeared or doubled border on every panel that uses
 * it, with nothing in the tooling pointing at the number that caused it. That
 * exact failure is why `hud.css` abandoned `border-image` in the first place.
 *
 * Three layers now guard the same numbers, each catching something the others
 * cannot:
 *   - `measure-ui.mjs --check` re-derives the insets FROM THE PIXELS and fails
 *     if `ui-crops.mjs` disagrees with the art;
 *   - `prepare-assets.mjs` decodes every crop it writes and compares it to the
 *     source rectangle;
 *   - this test checks the STYLESHEET against the crop table, which is the one
 *     link the other two cannot see.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = readFileSync(join(HERE, 'ui.css'), 'utf8');

type Crop = {
  out: string;
  slice?: { top: number; right: number; bottom: number; left: number };
};

const crops = UI_CROPS as Crop[];

/**
 * Every `border-image-slice` in the stylesheet, keyed by the asset the same
 * rule block actually applies it to.
 *
 * **The naive version of this was wrong, and the test caught it on its first
 * run** — worth recording, because the same trap is waiting for the next
 * reader. Taking every `url()` in a block and pairing it with that block's
 * slice attributes `.ui-plate`'s up-plate geometry (`3 3 5 3`) to the PRESSED
 * plate as well, because the base block *declares* `--plate-src-down` even
 * though it is only *used* in `:active` — where the correct `3 3 4 3` lives. A
 * custom-property declaration is a binding, not a use.
 *
 * So the two are separated: bindings are collected across the whole sheet, and
 * a block counts only when it has both a `border-image-source` and a
 * `border-image-slice`. `var(--x)` resolves through the bindings, which means
 * all eleven plate families are checked, not just the one written literally.
 */
function declaredSlices(css: string): Map<string, string[]> {
  const bindings = new Map<string, Set<string>>();
  for (const m of css.matchAll(/(--[\w-]+):\s*url\('\/assets\/([^']+)'\)/g)) {
    const set = bindings.get(m[1]!) ?? new Set<string>();
    set.add(m[2]!);
    bindings.set(m[1]!, set);
  }

  const found = new Map<string, string[]>();
  const record = (asset: string, slice: string) => {
    const list = found.get(asset) ?? [];
    list.push(slice);
    found.set(asset, list);
  };

  for (const block of css.split('}')) {
    const slice = /border-image-slice:\s*([^;]+);/.exec(block);
    const source = /border-image-source:\s*([^;]+);/.exec(block);
    if (!slice || !source) continue;

    const shorthand = slice[1]!.replace(/\s+/g, ' ').trim();
    const value = source[1]!.trim();

    const literal = /url\('\/assets\/([^']+)'\)/.exec(value);
    if (literal) {
      record(literal[1]!, shorthand);
      continue;
    }

    const varRef = /var\((--[\w-]+)/.exec(value);
    if (varRef) {
      for (const asset of bindings.get(varRef[1]!) ?? []) record(asset, shorthand);
    }
  }

  return found;
}

/** `border-image-slice` shorthand → the four sides, per CSS box order. */
function expand(shorthand: string): { top: number; right: number; bottom: number; left: number } {
  const parts = shorthand.replace(/\bfill\b/, '').trim().split(/\s+/).map(Number);
  const [a, b, c, d] = parts;
  if (parts.length === 1) return { top: a!, right: a!, bottom: a!, left: a! };
  if (parts.length === 2) return { top: a!, right: b!, bottom: a!, left: b! };
  if (parts.length === 3) return { top: a!, right: b!, bottom: c!, left: b! };
  return { top: a!, right: b!, bottom: c!, left: d! };
}

describe('ui.css nine-slice geometry', () => {
  const declared = declaredSlices(UI);

  it('has crops to check', () => {
    // Guards the import path: an empty table would make every case below vacuous.
    expect(crops.length).toBeGreaterThan(30);
  });

  it('slices every frame exactly where the art repeats', () => {
    const mismatches: string[] = [];

    for (const crop of crops) {
      if (!crop.slice) continue;
      const uses = declared.get(crop.out);
      // Not every crop has to be used yet; an unused one is inventory, not a bug.
      if (!uses) continue;

      for (const shorthand of uses) {
        const got = expand(shorthand);
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
          if (got[side] !== crop.slice[side]) {
            mismatches.push(
              `${crop.out}: ui.css says ${side} ${got[side]}, the crop measures ${crop.slice[side]}` +
                ` (border-image-slice: ${shorthand})`,
            );
          }
        }
      }
    }

    expect(
      mismatches,
      'Regenerate with `node scripts/measure-ui.mjs --md` and fix ui.css, not the crop table:' +
        `\n  ${mismatches.join('\n  ')}`,
    ).toEqual([]);
  });

  it('never references an asset the build does not cut', () => {
    /*
     * Whole sheets copied by COPIES are addressed by `background-position`, not
     * sliced, so they are legitimate `url()` targets that have no crop entry.
     * Listed explicitly: an asset that is in neither list is a typo, and a typo
     * in a CSS url() is invisible — the property just does not apply.
     */
    const wholeSheets = new Set([
      'ui-bars.png',
      'ui-button.png',
      'ui-hud.png',
      'ui-money.png',
      'ui-tags.png',
      'ui-inventory-slots.png',
      'ui-clock.png',
      'ui-clock-hand.png',
    ]);
    const cut = new Set(crops.map((c) => c.out));

    const unknown = [...UI.matchAll(/url\('\/assets\/([^']+)'\)/g)]
      .map((m) => m[1]!)
      .filter((name) => !cut.has(name) && !wholeSheets.has(name));

    expect([...new Set(unknown)]).toEqual([]);
  });

  it('scales frames by whole pixels only', () => {
    /*
     * `lib/sprite.ts` throws on a fractional sprite scale; frames have the same
     * requirement for the same reason — a 6px corner at 2.5x lands on half
     * pixels and the outline goes soft exactly where the eye checks first.
     * CSS cannot throw, so the integer-ness of the scale tokens is pinned here.
     */
    for (const name of ['--ui-scale', '--ui-scale-plate']) {
      const match = new RegExp(`${name}:\\s*([0-9.]+)\\s*;`).exec(UI);
      expect(match, `${name} not declared in ui.css`).not.toBeNull();
      expect(Number.isInteger(Number(match![1])), `${name} must be a whole number`).toBe(true);
    }
  });
});
