import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * WCAG AA contrast, pinned (T-27.01).
 *
 * Found by running axe-core over every page: **the only accessibility
 * violations in the whole product were colour contrast**, and there were four
 * distinct ones affecting 40 elements. No missing labels, no ARIA errors, no
 * unreachable controls — the HUD's existing `role`/`aria-*` work held up.
 *
 * Contrast is the failure mode a stylesheet cannot feel. Nobody notices #9a7a63
 * is 3.12:1 by looking at it on a good monitor in a lit room, which is exactly
 * why it survived eighteen phases. So the ratios are arithmetic now, and
 * arithmetic can be a test.
 *
 * **This does not replace an axe run.** It cannot see a nested override, a
 * gradient, or a colour set in JavaScript. What it pins is the palette — the
 * tokens, and the pairs the design actually puts together — so a future "warm
 * this up a bit" fails here rather than in an audit nobody runs.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = readFileSync(join(HERE, 'base.css'), 'utf8');
const HUD = readFileSync(join(HERE, 'hud.css'), 'utf8');
/* Phase U: chrome and the panel interior live here, text colours still in HUD. */
const UI = readFileSync(join(HERE, 'ui.css'), 'utf8');

/**
 * Reads a custom property's value out of a stylesheet.
 *
 * `after` scopes the search past a marker, because `base.css` declares each ink
 * token twice — once for light, once inside the dark-theme media query — and
 * the two have opposite requirements.
 */
function token(css: string, name: string, after = ''): string {
  const from = after ? css.indexOf(after) : 0;
  expect(from, `marker "${after}" not found`).toBeGreaterThanOrEqual(0);
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css.slice(from));
  expect(match, `--${name} not found${after ? ` after "${after}"` : ''}`).not.toBeNull();
  return match![1]!.toLowerCase();
}

/** Relative luminance, per WCAG 2.x. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** WCAG AA for normal-size text. Every pair below is normal-size text. */
const AA = 4.5;

describe('the contrast maths', () => {
  it('agrees with WCAG on the reference extremes', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Order must not matter — the ratio is symmetric.
    expect(contrast('#f7dbc6', '#a64622')).toBeCloseTo(contrast('#a64622', '#f7dbc6'), 6);
  });
});

describe('the site palette meets WCAG AA', () => {
  const DARK = '@media (prefers-color-scheme: dark)';

  const paper = token(BASE, 'paper');
  const paperRaised = token(BASE, 'paper-raised');
  const paperSunk = token(BASE, 'paper-sunk');

  /**
   * `--ink-faint` is the one that was broken, and it is the one most worth
   * pinning: it is used for every secondary line on the site, and it is the
   * text a reader can least afford to lose because it carries the numbers.
   */
  it.each([
    ['--ink on --paper', token(BASE, 'ink'), paper],
    ['--ink-soft on --paper', token(BASE, 'ink-soft'), paper],
    ['--ink-faint on --paper', token(BASE, 'ink-faint'), paper],
    ['--ink-faint on --paper-raised', token(BASE, 'ink-faint'), paperRaised],
    ['--ink-faint on --paper-sunk', token(BASE, 'ink-faint'), paperSunk],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  /** The dark theme has the same duty and the opposite direction of fix. */
  it.each([
    ['--ink on dark --paper', token(BASE, 'ink', DARK), token(BASE, 'paper', DARK)],
    ['--ink-soft on dark --paper', token(BASE, 'ink-soft', DARK), token(BASE, 'paper', DARK)],
    ['--ink-faint on dark --paper', token(BASE, 'ink-faint', DARK), token(BASE, 'paper', DARK)],
    [
      '--ink-faint on dark --paper-raised',
      token(BASE, 'ink-faint', DARK),
      token(BASE, 'paper-raised', DARK),
    ],
    [
      '--ink-faint on dark --paper-sunk',
      token(BASE, 'ink-faint', DARK),
      token(BASE, 'paper-sunk', DARK),
    ],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
  });
});

describe('the HUD palette meets WCAG AA', () => {
  const hudPaper = token(HUD, 'paper');
  const hudInk = token(HUD, 'ink');

  /**
   * Bar buttons are `--paper` on `--barn` at rest and on `--soil-deep` when
   * hovered. Both are small bold text, so both owe 4.5:1 — the hover state is
   * not exempt just because it is transient.
   */
  it.each([
    ['button label at rest', hudPaper, token(HUD, 'barn')],
    ['button label on hover', hudPaper, token(HUD, 'soil-deep')],
    ['gold pill', hudInk, token(HUD, 'soil')],
    ['bar text on the plate', hudInk, token(HUD, 'paper')],
    ['quiet text on the plate', token(HUD, 'faint'), token(HUD, 'paper')],
    ['quiet text on a raised panel', token(HUD, 'faint'), token(HUD, 'paper-raised')],
    // The sleeping banner (MVP re-scope): the countdown and its Get-up button
    // are the only way out of a locked character, so this pair is not one to
    // find out about in an audit.
    ['sleeping banner', token(HUD, 'paper-raised'), token(HUD, 'night')],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * **The banner's plate has to be declared in THIS file.** The game page loads
   * `hud.css`, not `base.css`, so a `var(--night)` borrowed from the landing
   * page's tokens resolves to nothing and paints the banner transparent —
   * measured in the browser, where the countdown rendered as cream text
   * directly on the grass. The test is here because the fix is a one-line
   * declaration that looks redundant next to `base.css` and invites deletion.
   */
  it('declares the banner plate in the stylesheet the game page loads', () => {
    expect(HUD).toMatch(/--night:\s*#[0-9a-fA-F]{6}/);
  });

  /**
   * The literals, not just the tokens.
   *
   * `--faint` exists because three rules had #9a7a63 pasted straight in, where
   * darkening the token could not reach them — a token guard that only reads
   * `:root` would have declared the palette fixed while the actual text stayed
   * at 2.98:1. So every literal colour used as `color:` in this file is checked
   * against the HUD's paper too.
   */
  it('leaves no hardcoded text colour below AA on the HUD paper', () => {
    const literals = [...HUD.matchAll(/^\s*color:\s*(#[0-9a-fA-F]{6})\s*;/gm)].map((m) =>
      m[1]!.toLowerCase(),
    );

    const failing = [...new Set(literals)].filter(
      (hex) => contrast(hex, hudPaper) < AA && contrast(hex, hudInk) < AA,
    );

    expect(failing, `hardcoded text colours below AA on both grounds: ${failing}`).toEqual([]);
  });

  /**
   * The sampled colour is recorded in the comment beside the token, and the
   * point of recording it is that it stays recorded. If someone "restores" the
   * palette to the pack value, the button test above fails — but this makes the
   * intent explicit rather than leaving the next reader to work out why 4.21
   * was not good enough.
   */
  it('still records the sampled rust it was derived from', () => {
    expect(HUD).toContain('#ae4924');
    expect(token(HUD, 'barn')).not.toBe('#ae4924');
  });
});

/**
 * The panel interior, which Phase U changed out from under every one of the
 * ratios above.
 *
 * **This whole block exists because darkening a background is invisible.**
 * Panels stopped being `--paper` (#f7dbc6) and became `--panel-fill` (#ffd2a1),
 * the tan the pack paints inside its own timber. It is only 6% darker and it
 * looks warmer and better — and it quietly took `--faint` from 4.55:1 to
 * 4.29:1, `--barn` from 4.52 to 4.26 and `--grass-deep` from 4.30 to 4.06.
 * Three AA passes lost to a change nobody would think to re-audit, on the
 * surface that now carries almost all of the HUD's text.
 *
 * The fix was to darken those three tokens 4-7% (`hud.css`), which is the same
 * trade T-27.01 made for `--barn`. This block is what stops the next warm-it-up
 * from undoing it, and it is deliberately separate from the block above: the
 * old one checks text on the BAR, this one checks text in a PANEL, and they are
 * different surfaces with the same tokens on them.
 */
describe('the HUD palette meets WCAG AA on a framed panel', () => {
  const tan = token(UI, 'panel-fill');

  it('uses the pack tan the frames are drawn around', () => {
    expect(tan).toBe('#ffd2a1');
  });

  it.each([
    ['body text in a panel', token(HUD, 'ink'), tan],
    ['quiet text in a panel', token(HUD, 'faint'), tan],
    ['a price in a panel', token(HUD, 'barn'), tan],
    ['progress green in a panel', token(HUD, 'grass-deep'), tan],
    ['the frame colour as text', token(HUD, 'frame'), tan],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  /**
   * The same literal sweep the bar gets. A hardcoded colour that passes on
   * cream can fail on tan, and `.hud__coach` was exactly that case — three
   * off-palette literals that T-15.26's sampling pass missed because the hint
   * only appears in a first session and was not on screen during the audit.
   */
  /**
   * The dark timber board, which is the *other* new surface and the one that
   * has caused the same mistake three times.
   *
   * Phase U2 put the top bar, every panel header and the hotbar on
   * `ui-rail.png`'s plank. Anything on it inherits `--ink` unless told
   * otherwise, and **ink on timber measures 1.13:1** — not "low contrast",
   * invisible. It shipped three times before this block existed: the goal-board
   * tab (dark-on-dark at 55% opacity), the thirsty badge (#a8442f at 2.83), and
   * the energy fraction. Each was found by looking at a screenshot, which is
   * exactly the review step that does not scale.
   */
  it.each([
    ['cream text on the timber board', token(HUD, 'paper'), token(UI, 'timber')],
    ['the energy fraction', token(HUD, 'paper'), token(UI, 'timber')],
    ['a raised label on timber', token(HUD, 'paper-raised'), token(UI, 'timber')],
  ])('%s', (_label, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  it('proves ink on timber is the trap it is documented as', () => {
    // Not a style assertion — a guard on the comment. If someone lightens
    // `--timber` enough that ink works, the warnings above become misleading
    // and should be revisited rather than left to rot.
    expect(contrast(token(HUD, 'ink'), token(UI, 'timber'))).toBeLessThan(AA);
  });

  it('leaves no hardcoded text colour below AA on the panel tan', () => {
    const literals = [...HUD.matchAll(/^\s*color:\s*(#[0-9a-fA-F]{6})\s*;/gm)].map((m) =>
      m[1]!.toLowerCase(),
    );

    const failing = [...new Set(literals)].filter(
      (hex) => contrast(hex, tan) < AA && contrast(hex, token(HUD, 'ink')) < AA,
    );

    expect(failing, `hardcoded text colours below AA on the panel tan: ${failing}`).toEqual([]);
  });
});
