import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOAT_TINTS } from './floatText.js';
import {
  LEVEL_UP_FLASH,
  LEVEL_UP_SHAKE,
  POP,
  flashFor,
  popDurationMs,
  popFor,
  rgbHex,
  shakeFor,
} from './tween.js';

describe('the presets', () => {
  it('pins the numbers, so a change to them is deliberate', () => {
    expect(POP).toEqual({ scale: 1.15, durationMs: 90, ease: 'Quad.easeOut' });
    expect(LEVEL_UP_SHAKE).toEqual({ durationMs: 220, intensity: 0.004 });
    expect(LEVEL_UP_FLASH.durationMs).toBe(260);
  });

  /**
   * A tile is 16px. A pop that grows it by more than a couple of pixels reads
   * as the plot jumping rather than reacting, and its neighbours are 1px away.
   */
  it('keeps the pop within a couple of pixels of a tile', () => {
    const TILE_PX = 16;
    expect((POP.scale - 1) * TILE_PX).toBeLessThanOrEqual(3);
    expect(POP.scale).toBeGreaterThan(1);
  });

  /**
   * A level-up is good news. A hard shake is the vocabulary of damage, and
   * this is the only camera shake in the game, so nothing else moderates it.
   */
  it('keeps the level-up shake gentle', () => {
    expect(LEVEL_UP_SHAKE.intensity).toBeLessThanOrEqual(0.006);
    expect(LEVEL_UP_SHAKE.intensity).toBeGreaterThan(0);
    // Short enough not to interrupt the next action.
    expect(LEVEL_UP_SHAKE.durationMs).toBeLessThan(400);
  });

  /**
   * The flash is the level bar's own green — the same value `FLOAT_TINTS.xp`
   * uses — so a level-up reads as the existing system announcing itself louder
   * rather than as a new effect to learn.
   */
  it('flashes in the same green the XP system already uses', () => {
    const [r, g, b] = LEVEL_UP_FLASH.rgb;
    expect((r << 16) | (g << 8) | b).toBe(FLOAT_TINTS.xp);
  });

  it('converts rgb to the hex a stylesheet wants', () => {
    expect(rgbHex([121, 191, 86])).toBe('#79bf56');
    expect(rgbHex([0, 0, 0])).toBe('#000000');
    expect(rgbHex([255, 255, 255])).toBe('#ffffff');
  });

  it('reports a pop as the round trip, not half of it', () => {
    expect(popDurationMs(POP)).toBe(POP.durationMs * 2);
  });
});

describe('reduced motion', () => {
  it('removes the pop and the shake entirely', () => {
    expect(popFor(true)).toBeNull();
    expect(shakeFor(true)).toBeNull();

    expect(popFor(false)).toBe(POP);
    expect(shakeFor(false)).toBe(LEVEL_UP_SHAKE);
  });

  /**
   * The flash is the exception, deliberately. It is the only thing that says
   * "you levelled up" **at the moment it happens** — the bar quietly resetting
   * is not an announcement. A colour wash is not motion in the sense the
   * setting is about, so it is shortened rather than deleted; removing it would
   * leave a reduced-motion player with no level-up feedback at all.
   */
  it('keeps the flash, shortened, rather than deleting it', () => {
    const reduced = flashFor(true);
    expect(reduced).not.toBeNull();
    expect(reduced.durationMs).toBeLessThan(LEVEL_UP_FLASH.durationMs);
    expect(reduced.durationMs).toBeGreaterThan(0);
    // Same colour — only the length changed.
    expect(reduced.rgb).toEqual(LEVEL_UP_FLASH.rgb);
  });

  it('leaves full motion untouched', () => {
    expect(flashFor(false)).toBe(LEVEL_UP_FLASH);
  });
});

/**
 * A spec that reaches for a renderer stops being one. Same line `effects.ts`
 * and `floatText.ts` hold, and the same comment-stripping the latter needed —
 * the prose here names Phaser on purpose.
 */
describe('purity', () => {
  const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tween.ts'), 'utf8');
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('imports no renderer and touches no DOM', () => {
    expect(CODE).not.toMatch(/from\s+['"]phaser['"]/i);
    expect(CODE).not.toMatch(/\bPhaser\s*\./);
    for (const global of ['document', 'window']) {
      expect(CODE, `tween.ts reaches for ${global}`).not.toMatch(new RegExp(`\\b${global}\\s*\\.`));
    }
  });

  it('strips comments before looking', () => {
    expect(SOURCE).toMatch(/Phaser/);
    expect(CODE).not.toMatch(/vocabulary of damage/);
  });
});

/**
 * The gold bump is CSS, not a tween — so its reduced-motion guard lives in the
 * stylesheet and nothing in TypeScript can assert it. Read as text, the way
 * `hudHidden.test.ts` and `levelBar.test.ts` already do.
 */
describe('the gold bump', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const CSS = readFileSync(join(HERE, '..', 'styles', 'hud.css'), 'utf8');
  const HUD_TS = readFileSync(join(HERE, 'hud.ts'), 'utf8');

  it('is wired from the HUD to a rule that exists', () => {
    expect(HUD_TS).toContain('is-bumped');
    expect(CSS).toMatch(/\.is-bumped/);
    expect(CSS).toMatch(/@keyframes hud-gold-bump/);
  });

  it('is dropped under reduced motion', () => {
    const rule = CSS.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.is-bumped\s*\{[^}]*animation:\s*none/,
    );
    expect(rule, 'no reduced-motion rule for the gold bump').not.toBeNull();
  });

  /**
   * Scale only. The digits must not translate: a number that slides at the
   * moment it changes is briefly unreadable, which is precisely when the
   * player is looking at it.
   */
  it('scales without moving the digits', () => {
    const frames = CSS.match(/@keyframes hud-gold-bump\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(frames).toMatch(/scale\(/);
    expect(frames).not.toMatch(/translate/);
  });

  /** The re-trigger reflow, without which gold bumps once and never again. */
  it('forces a reflow so a second change re-plays', () => {
    expect(HUD_TS).toMatch(/offsetWidth/);
  });
});
