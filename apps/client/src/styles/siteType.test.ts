import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The site's typography, pinned (U3-2).
 *
 * Phase U bundled Silkscreen and Pixelify Sans and then deliberately did not
 * put them on the marketing pages: *"they are a different surface — a
 * marketing site, not a HUD over pixel art."* That left the front door on
 * `system-ui` with `ui-monospace` labels for four phases, and it was the
 * single largest reason the site did not look like the game it advertises.
 * U3 closed it.
 *
 * **Three of the four rules below are about what NOT to write.** Silkscreen
 * draws its own spacing and sits on an 8px grid, so the two habits the old
 * mono labels depended on — `letter-spacing` and `rem` sizes — are now bugs
 * that look exactly like working CSS. `ui.css` learned this for the HUD when
 * it deleted `var(--mono)`; this is the same lesson on the other surface, and
 * a stylesheet cannot feel it any more than it could feel a contrast ratio.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', '..');

/** The stylesheets the site pages load. `ui.css` and `hud.css` are the game's. */
const SITE_SHEETS = ['base.css', 'landing.css', 'auth.css', 'legal.css', 'credits.css'];

/** Every page entry that imports `base.css`, and therefore owes the fonts. */
const SITE_ENTRIES = ['landing.ts', 'auth-form.ts', 'legal.ts', 'credits.ts'];

const read = (name: string) => readFileSync(join(HERE, name), 'utf8');

/**
 * Splits a stylesheet into `{ selector, body }` for each rule.
 *
 * Crude on purpose: it does not understand nesting or at-rules, and it does
 * not need to. Every declaration this file cares about lives in a flat rule,
 * and a parser that handled the general case would be a second thing to keep
 * correct. At-rule preludes fall out as selectors with no declarations.
 */
function rules(css: string): { selector: string; body: string }[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim().replace(/\s+/g, ' '),
    body: m[2]!,
  }));
}

describe('the site loads the bundled faces', () => {
  it('imports ui.css from every page entry, which is where @font-face lives', () => {
    for (const entry of SITE_ENTRIES) {
      const src = readFileSync(join(CLIENT, 'src', 'pages', entry), 'utf8');
      expect(src, `${entry} must import ui.css or it renders in fallback fonts`).toMatch(
        /import '\.\.\/styles\/ui\.css';/,
      );
    }
  });

  /**
   * The order is load-bearing: equal specificity means the later file wins, so
   * `.ui-plate` can only beat `.btn` if `ui.css` comes second. The game side
   * states the same contract the other way round (`ui.css` before `hud.css`).
   */
  it('imports ui.css after base.css so the primitives win', () => {
    for (const entry of SITE_ENTRIES) {
      const src = readFileSync(join(CLIENT, 'src', 'pages', entry), 'utf8');
      expect(src.indexOf("import '../styles/ui.css';")).toBeGreaterThan(
        src.indexOf("import '../styles/base.css';"),
      );
    }
  });

  it('declares Bitter alongside the two pixel faces', () => {
    const ui = read('ui.css');
    for (const family of ['Pixelify Sans', 'Silkscreen', 'Bitter']) {
      expect(ui).toContain(`font-family: '${family}';`);
    }
  });

  /**
   * Self-hosted, and the reason is in `public/fonts/README.md`: a Google Fonts
   * `<link>` leaks every player's IP and page visit to a third party and puts a
   * render-blocking request in front of the game. Phase U verified zero such
   * requests in the browser; this keeps it true without a browser.
   */
  it('asks Google for nothing', () => {
    const html = readdirSync(CLIENT).filter((f) => f.endsWith('.html'));
    expect(html.length).toBeGreaterThan(0);
    for (const file of [...html.map((f) => join(CLIENT, f)), ...SITE_SHEETS.map((f) => join(HERE, f))]) {
      expect(readFileSync(file, 'utf8'), `${file} reaches a font CDN`).not.toMatch(
        /fonts\.(googleapis|gstatic)\.com/,
      );
    }
  });

  it('bundles a woff2 for every family it declares', () => {
    const bundled = readdirSync(join(CLIENT, 'public', 'fonts'));
    for (const stem of ['pixelify-sans', 'silkscreen', 'bitter']) {
      expect(
        bundled.some((f) => f.startsWith(stem) && f.endsWith('.woff2')),
        `no ${stem} woff2 in public/fonts`,
      ).toBe(true);
    }
  });
});

describe('the pixel faces are set the way pixel faces have to be set', () => {
  /** Every rule that puts Silkscreen or Pixelify Sans on something. */
  const pixelRules = SITE_SHEETS.flatMap((sheet) =>
    rules(read(sheet))
      .filter((r) => /font-family:\s*var\(--font-(display|pixel)\)/.test(r.body))
      .map((r) => ({ sheet, ...r })),
  );

  it('finds the rules it is meant to be checking', () => {
    // A guard on the guard: if either token is ever renamed, the three tests
    // below would pass by matching nothing at all.
    expect(pixelRules.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * **Silkscreen's spacing is drawn into the face.** Adding `letter-spacing`
   * on top of it double-spaces the label — it does not look broken, it looks
   * like a slightly worse version of the thing you wanted, which is why every
   * one of these survived four phases of being looked at.
   */
  it('never adds letter-spacing to Silkscreen', () => {
    const offenders = pixelRules
      .filter((r) => /font-family:\s*var\(--font-display\)/.test(r.body))
      .filter((r) => /letter-spacing:/.test(r.body))
      .map((r) => `${r.sheet} ${r.selector}`);
    expect(offenders, `Silkscreen rules with letter-spacing: ${offenders}`).toEqual([]);
  });

  /**
   * Pixelify Sans is a display face and may be tracked — but only in whole
   * pixels. `0.22em` of a 20px face is 4.4px, and the fraction puts every stem
   * after the first between device pixels.
   */
  it('tracks Pixelify Sans in whole pixels or not at all', () => {
    const offenders = pixelRules
      .flatMap((r) => {
        const spacing = /letter-spacing:\s*([^;]+);/.exec(r.body)?.[1]?.trim();
        if (!spacing || spacing === 'normal') return [];
        return /^-?\d+px$/.test(spacing) ? [] : [`${r.sheet} ${r.selector} (${spacing})`];
      });
    expect(offenders, `pixel-face rules tracked off the grid: ${offenders}`).toEqual([]);
  });

  /**
   * Both faces are drawn on fixed grids — Silkscreen on 8, Pixelify Sans on 10
   * — and render crisply only at integer multiples. `0.72rem` is 12.24px,
   * which lands the stems between device pixels: the exact softness these
   * faces were chosen to remove.
   */
  it('sizes both faces in whole pixels, never rem', () => {
    const offenders = pixelRules
      .filter((r) => /font-size:\s*[\d.]+(rem|em)\b/.test(r.body))
      .map((r) => `${r.sheet} ${r.selector}`);
    expect(offenders, `pixel-face rules sized in rem/em: ${offenders}`).toEqual([]);
  });
});

describe('the body face', () => {
  const base = read('base.css');

  it('is Bitter, and falls back to a serif rather than system-ui', () => {
    expect(base).toMatch(/--font-sans:\s*'Bitter'/);
    // system-ui as the fallback would hide a failed font load behind exactly
    // the look this phase removed, and nobody would notice for another four
    // phases. A serif fallback is visibly the wrong serif.
    expect(/--font-sans:[^;]*/.exec(base)![0]).not.toContain('system-ui');
  });

  it('does not ask Bitter for a weight it does not have', () => {
    // The variable axis is 400-700. `font-weight: 800` asks the browser to
    // synthesise one, which smears the outline instead of thickening it.
    const offenders = SITE_SHEETS.flatMap((sheet) =>
      rules(read(sheet))
        .filter((r) => /font-weight:\s*(800|900)\b/.test(r.body))
        .map((r) => `${sheet} ${r.selector}`),
    );
    expect(offenders, `weights above Bitter's 700 maximum: ${offenders}`).toEqual([]);
  });

  it('keeps a real monospace for code and licence strings', () => {
    // Silkscreen has no character-cell alignment; `.legal code` and the
    // `/credits` licence lines are literal text and need one. They used to say
    // `var(--mono, …)` — a token Phase U deleted, leaving them silently on the
    // fallback argument.
    expect(base).toMatch(/--font-mono:\s*ui-monospace/);
    for (const sheet of SITE_SHEETS) {
      // Comments stripped: this file's own prose names the deleted token.
      const code = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, `${sheet} still references the deleted --mono`).not.toMatch(/var\(--mono[,)]/);
    }
  });
});
