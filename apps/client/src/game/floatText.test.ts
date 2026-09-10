import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS } from '@tillhaven/shared/config';
import {
  FLOAT_STACK_PX,
  FLOAT_TINTS,
  floatFor,
  floatLifetimeMs,
  floatTextFor,
  stackedOffsetY,
  type FloatKind,
} from './floatText.js';

const KINDS: readonly FloatKind[] = ['gold', 'item', 'xp'];

describe('what a float says', () => {
  it('formats each kind the way the player reads it', () => {
    expect(floatTextFor('gold', 180)).toBe('+180g');
    expect(floatTextFor('xp', 24)).toBe('+24 xp');
    expect(floatTextFor('item', 2, 'potato')).toBe('+2 Potato');
  });

  /**
   * Item names come from shared config, never from a local table — the float
   * and the bag must not be able to disagree about what a thing is called.
   */
  it('takes item names from shared config', () => {
    expect(floatTextFor('item', 1, 'potato')).toContain(ITEMS.potato!.name);
    expect(floatTextFor('item', 3, 'wood')).toBe('+3 Wood');
  });

  it('tidies an unknown id rather than printing a raw key', () => {
    expect(floatTextFor('item', 1, 'strange_new_thing')).toBe('+1 strange new thing');
    // No id at all — still a sentence, never "+1 undefined".
    expect(floatTextFor('item', 1)).toBe('+1 item');
  });

  /**
   * §10: gold and quantities are integers everywhere. A float is the most
   * likely place for the first fraction in the game to appear by accident.
   */
  it('never shows a fraction', () => {
    expect(floatTextFor('gold', 12.7)).toBe('+12g');
    expect(floatTextFor('xp', 9.99)).toBe('+9 xp');
  });

  it('signs a negative rather than printing "+-"', () => {
    expect(floatTextFor('gold', -40)).toBe('-40g');
    expect(floatTextFor('gold', -40)).not.toContain('+');
  });

  it('groups big numbers so they stay readable', () => {
    expect(floatTextFor('gold', 12_500)).toBe('+12,500g');
  });
});

describe('floatFor', () => {
  it('gives every kind a complete spec', () => {
    for (const kind of KINDS) {
      const float = floatFor(kind, 5, { itemId: 'potato' });
      expect(float, kind).not.toBeNull();
      expect(float!.text.length, kind).toBeGreaterThan(0);
      expect(float!.tint, kind).toBe(FLOAT_TINTS[kind]);
      expect(float!.durationMs, kind).toBeGreaterThan(0);
      expect(float!.fontPx, kind).toBeGreaterThan(0);
      expect(float!.risePx, kind).toBeGreaterThan(0);
    }
  });

  /**
   * Zero is not an event. A `+0` rising off a tile is noise, and noise is how
   * a player learns to stop reading the numbers — `xpForHarvest` returns 0 for
   * an unknown crop, which is the case that reaches this in practice.
   */
  it('says nothing when there is nothing to say', () => {
    expect(floatFor('gold', 0)).toBeNull();
    expect(floatFor('xp', 0)).toBeNull();
    expect(floatFor('item', 0, { itemId: 'potato' })).toBeNull();
    expect(floatFor('gold', 0.4)).toBeNull(); // truncates to zero
    expect(floatFor('gold', Number.NaN)).toBeNull();
    expect(floatFor('gold', Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('pins the numbers, so a change to them is deliberate', () => {
    expect(floatFor('gold', 1)).toMatchObject({ risePx: 22, durationMs: 900, fontPx: 10 });
    expect(floatFor('item', 1, { itemId: 'potato' })).toMatchObject({
      risePx: 18,
      durationMs: 800,
      fontPx: 8,
    });
    expect(floatFor('xp', 1)).toMatchObject({ risePx: 26, durationMs: 1000, fontPx: 8 });
  });

  it('outlives its own animation', () => {
    for (const kind of KINDS) {
      const float = floatFor(kind, 1, { itemId: 'potato' })!;
      expect(floatLifetimeMs(float), kind).toBeGreaterThan(float.durationMs);
    }
  });
});

describe('reduced motion', () => {
  /**
   * Reduced motion means no travel, not no feedback. Removing the label would
   * take information away from exactly the players most likely to want it
   * stated plainly.
   */
  it('stops the label moving without silencing it', () => {
    for (const kind of KINDS) {
      const still = floatFor(kind, 7, { itemId: 'potato', reducedMotion: true })!;
      const moving = floatFor(kind, 7, { itemId: 'potato' })!;

      expect(still.risePx, kind).toBe(0);
      expect(moving.risePx, kind).toBeGreaterThan(0);

      // Same words, same colour, same size — only the travel changed.
      expect(still.text, kind).toBe(moving.text);
      expect(still.tint, kind).toBe(moving.tint);
      expect(still.fontPx, kind).toBe(moving.fontPx);
    }
  });

  it('lingers a little longer when it cannot move', () => {
    const still = floatFor('gold', 7, { reducedMotion: true })!;
    const moving = floatFor('gold', 7)!;
    expect(still.durationMs).toBeGreaterThan(moving.durationMs);
  });

  it('still says nothing about zero', () => {
    expect(floatFor('gold', 0, { reducedMotion: true })).toBeNull();
  });
});

describe('stacking', () => {
  /**
   * A harvest produces three floats at one tile in one frame — produce, gold
   * and XP. Drawn at a single offset they are one illegible smear.
   */
  it('separates floats that land together', () => {
    const float = floatFor('gold', 10)!;
    const offsets = [0, 1, 2].map((i) => stackedOffsetY(float, i));

    expect(new Set(offsets).size).toBe(3);
    expect(offsets[1]! - offsets[0]!).toBe(FLOAT_STACK_PX);
    // Later floats sit HIGHER, so the first one drawn stays nearest the tile
    // that produced it.
    expect(offsets[2]!).toBeGreaterThan(offsets[0]!);
  });

  it('is at least as tall as the text it separates', () => {
    const biggest = Math.max(...KINDS.map((k) => floatFor(k, 1, { itemId: 'potato' })!.fontPx));
    expect(FLOAT_STACK_PX).toBeGreaterThanOrEqual(biggest);
  });
});

/**
 * The module is a SPEC, and a spec that reaches for a renderer stops being one.
 * `effects.ts` and `animalWander.ts` hold the same line — it is what lets these
 * numbers be asserted in node with no canvas.
 */
describe('purity', () => {
  const SOURCE = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'floatText.ts'),
    'utf8',
  );

  /**
   * Comments are stripped first, and that is not a convenience — the first
   * version of this test failed on its own module's doc comment, which says
   * the scene "hands these to Phaser". Describing the boundary is exactly what
   * the comments are for; a purity check that cannot tell prose from code
   * punishes the file for explaining itself.
   */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('imports no renderer', () => {
    expect(CODE).not.toMatch(/from\s+['"]phaser['"]/i);
    expect(CODE).not.toMatch(/\bPhaser\s*\./);
  });

  it('touches no DOM', () => {
    for (const global of ['document', 'window', 'matchMedia']) {
      expect(CODE, `floatText.ts reaches for ${global}`).not.toMatch(
        new RegExp(`\\b${global}\\s*\\.`),
      );
    }
  });

  /** The stripper has to actually strip, or the two tests above prove nothing. */
  it('strips comments before looking', () => {
    expect(SOURCE).toMatch(/Phaser/); // the prose really does mention it
    expect(CODE).not.toMatch(/hand these to/);
  });
});
