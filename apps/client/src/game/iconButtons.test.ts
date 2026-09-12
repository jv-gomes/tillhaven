import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Controls are drawn, not typed (U3-7).
 *
 * `ui-button.png` holds 43 columns of 16x16 glyphs and `.ui-icon` has
 * addressed that grid by cell since Phase U — whose own notes recorded that
 * "the icon-button vocabulary is barely touched" and "the close buttons are
 * still the character `x`". They were: six panels and a trade row, all
 * rendering a typographic multiplication sign as a button label.
 *
 * **A typed glyph is not a worse icon, it is a different thing.** It inherits
 * the font, so it changed size with the type scale, sat on a different
 * baseline in every fallback stack, and had no pressed state. It also looked
 * approximately right, which is why it survived twenty phases.
 *
 * Source-text, because there is no jsdom here — same reasoning as
 * `styles/railButtons.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

const SOURCES = readdirSync(HERE)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => [f, readFileSync(join(HERE, f), 'utf8')] as const);

/** The glyphs that have been used as controls here, and their lookalikes. */
const TYPED_CONTROLS = ['×', '✕', '✖', '⨯', '✓', '✔'];

describe('no control is a typed character', () => {
  it.each(SOURCES)('%s', (_file, src) => {
    // Only markup and assignments that REACH a button. A `×` inside a label
    // like "Leek × 3" is a multiplication sign doing its actual job.
    const offenders: string[] = [];

    for (const glyph of TYPED_CONTROLS) {
      const inButton = new RegExp(`<button[^>]*>\\s*${glyph}\\s*</button>`, 'g');
      for (const m of src.matchAll(inButton)) offenders.push(m[0]);

      const assigned = new RegExp(`(\\w+)\\.textContent\\s*=\\s*['"\`]${glyph}['"\`]`, 'g');
      for (const m of src.matchAll(assigned)) {
        // `foo.textContent = '×'` is only a problem when `foo` is a button.
        const name = m[1]!;
        if (new RegExp(`${name}\\s*=\\s*document\\.createElement\\(['"]button`).test(src)) {
          offenders.push(m[0]);
        }
      }
    }

    expect(offenders, `typed glyphs used as controls: ${offenders.join(' | ')}`).toEqual([]);
  });
});

describe('every icon button still says what it does', () => {
  /**
   * **An icon with no accessible name is a regression, not polish.** Replacing
   * a `×` with a picture removes the only text the control had; the
   * `aria-label` is what stops it becoming an unlabelled button, and
   * `aria-hidden` on the glyph is what stops a screen reader announcing the
   * decoration alongside it.
   */
  it.each(SOURCES.filter(([, s]) => s.includes('class="ui-icon"')))(
    '%s labels its icon buttons',
    (_file, src) => {
      const unlabelled = [...src.matchAll(/<button(?![^>]*aria-label)[^>]*>\s*<i class="ui-icon"/g)];
      expect(unlabelled.map((m) => m[0]), 'icon button with no aria-label').toEqual([]);
    },
  );

  it.each(SOURCES.filter(([, s]) => s.includes('class="ui-icon"')))(
    '%s hides the glyph from assistive tech',
    (_file, src) => {
      const exposed = [...src.matchAll(/<i class="ui-icon"(?![^>]*aria-hidden)[^>]*>/g)];
      expect(exposed.map((m) => m[0]), 'ui-icon without aria-hidden').toEqual([]);
    },
  );
});

describe('the close glyph is one glyph', () => {
  /**
   * Six panels close, and they should not close with six different pictures.
   * The column is the vocabulary; pinning it here is cheaper than noticing in
   * a screenshot that one panel's cross is the tick.
   */
  it('uses the same icon column for every close button', () => {
    const columns = new Set<string>();
    for (const [, src] of SOURCES) {
      for (const m of src.matchAll(
        /data-close[^>]*>\s*<i class="ui-icon" style="--icon-col: (\d+)"/g,
      )) {
        columns.add(m[1]!);
      }
    }
    expect(columns.size, `close buttons use columns ${[...columns]}`).toBe(1);
    // 15 is the cross in `ui-button.png`'s icon region; 16 is the tick.
    expect([...columns][0]).toBe('15');
  });

  it('found every close button it thinks it did', () => {
    // A guard on the guard: if the markup changes shape, the test above would
    // pass by matching nothing.
    const count = SOURCES.reduce(
      (n, [, src]) => n + [...src.matchAll(/data-close[^>]*>\s*<i class="ui-icon"/g)].length,
      0,
    );
    expect(count).toBeGreaterThanOrEqual(6);
  });
});
