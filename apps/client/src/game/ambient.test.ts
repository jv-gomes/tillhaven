import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_CHIMNEY, HOUSE_TIER_ART } from '@tillhaven/shared/config';
import { CHIMNEY_OFFSET_Y, CHIMNEY_SMOKE, particlesAlive } from './ambient.js';

/**
 * Chimney smoke, as arithmetic (U3-9).
 *
 * `effects.ts` established why a cosmetic burst gets a test at all: the
 * numbers are the design, and "seven particles for 400ms in these two tints"
 * is a claim a screenshot cannot check. The same applies here, with one extra
 * duty — this emitter runs **forever**, so a wrong frequency is not a bad
 * frame, it is a leak.
 */

describe('the plume is ambient, not weather', () => {
  /**
   * **The number the whole effect turns on.** Four specks alive keeps the
   * roofline from being still; twenty would be a chimney fire, and one is a
   * rendering fault. `frequencyMs` and `lifespanMs` can each be tuned, but
   * only together.
   */
  it('keeps a handful of particles alive, not a cloud', () => {
    const alive = particlesAlive(CHIMNEY_SMOKE);
    expect(alive).toBeGreaterThan(2);
    expect(alive).toBeLessThan(8);
  });

  it('rises, and keeps rising', () => {
    // Phaser's gravity is positive-down. A plume that arcs back onto the roof
    // is not smoke.
    expect(CHIMNEY_SMOKE.gravityY).toBeLessThan(0);
    expect(CHIMNEY_SMOKE.speed.min).toBeGreaterThan(0);
    expect(CHIMNEY_SMOKE.speed.max).toBeGreaterThan(CHIMNEY_SMOKE.speed.min);
  });

  it('emits upward in a cone, not a line and not a fan', () => {
    // 270 is straight up in Phaser's convention.
    const { min, max } = CHIMNEY_SMOKE.angle;
    expect(min).toBeLessThan(270);
    expect(max).toBeGreaterThan(270);
    // Dead straight looks like a leak; a wide fan looks like an explosion.
    expect(max - min).toBeGreaterThan(8);
    expect(max - min).toBeLessThan(60);
  });

  it('widens and fades as it climbs', () => {
    expect(CHIMNEY_SMOKE.scale.end).toBeGreaterThan(CHIMNEY_SMOKE.scale.start);
    expect(CHIMNEY_SMOKE.alpha.end).toBeLessThan(CHIMNEY_SMOKE.alpha.start);
    // Fully out by the end, or the last frame of every particle pops.
    expect(CHIMNEY_SMOKE.alpha.end).toBe(0);
  });

  it('never reaches full opacity', () => {
    // Smoke you cannot see past is smoke that has become a foreground object.
    expect(CHIMNEY_SMOKE.alpha.start).toBeLessThan(0.7);
  });

  it('is grey, and is grey in more than one shade', () => {
    expect(CHIMNEY_SMOKE.tints.length).toBeGreaterThan(1);
    for (const tint of CHIMNEY_SMOKE.tints) {
      const [r, g, b] = [(tint >> 16) & 0xff, (tint >> 8) & 0xff, tint & 0xff];
      // Near-neutral: the chimney bricks are a grey family, and §9 says sample
      // the art rather than invent a colour.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);
      // Light enough to read against a dark roof, dark enough against sky.
      expect(Math.min(r, g, b)).toBeGreaterThan(120);
    }
  });

  it('starts clear of the brickwork', () => {
    // Up is negative in world pixels. Emitting on the mouth row clips the
    // particle against the roof it is leaving.
    expect(CHIMNEY_OFFSET_Y).toBeLessThan(0);
  });
});

describe('the chimney is measured for every tier', () => {
  it('has one mouth per house, so no tier smokes from its corner', () => {
    expect(HOUSE_CHIMNEY).toHaveLength(HOUSE_TIER_ART.length);
  });

  /**
   * **The invariant that caught the bug.** The first measurement took the
   * highest opaque column in each sprite and got the roof ridge — the chimney
   * is shorter than the gable — so smoke rose from the peak of the roof. A
   * mouth at y=0 is the signature of that mistake, because the ridge is the
   * only thing that reaches the window's top row.
   */
  it('never puts a mouth on the very top row, which is the roof ridge', () => {
    for (const mouth of HOUSE_CHIMNEY) {
      if (!mouth) continue;
      expect(mouth.y).toBeGreaterThan(0);
    }
  });

  it('puts every mouth inside its house', () => {
    HOUSE_CHIMNEY.forEach((mouth, tier) => {
      if (!mouth) return;
      const look = HOUSE_TIER_ART[tier]!.look;
      expect(mouth.x, `tier ${tier} chimney is off the sprite`).toBeGreaterThan(0);
      expect(mouth.x).toBeLessThan(look.width);
      expect(mouth.y).toBeLessThan(look.height);
    });
  });

  /**
   * Tier 2 (`8.png`) is a brick house with a round gable window and no stack.
   * `null` is the honest answer; a guessed coordinate would smoke from a roof
   * with nothing on it, and would look like a bug nobody could locate.
   */
  it('records the chimneyless tier as null rather than guessing', () => {
    expect(HOUSE_CHIMNEY[2]).toBeNull();
    expect(HOUSE_CHIMNEY.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('puts the plume out when a tier has no chimney', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const house = readFileSync(join(HERE, 'entities', 'House.ts'), 'utf8');
    // `setTier` must rebuild rather than reposition, or upgrading to tier 2
    // leaves smoke hanging over a roof with no stack under it.
    const setTier = house.slice(house.indexOf('setTier(tier: number)'));
    expect(setTier).toContain('this.smoke?.destroy()');
    expect(setTier).toContain('this.lightTheFire(');
  });
});

describe('the plume respects reduced motion', () => {
  /**
   * Source-text, since there is no jsdom. `prefersReducedMotion()` is the
   * gate T-17.01 routed to the canvas, and an ambient emitter is the purest
   * case for it there is: nothing is lost by removing it, and it moves
   * continuously without being asked.
   */
  it('is gated in House.ts, where it is handed to Phaser', () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const house = readFileSync(join(HERE, 'entities', 'House.ts'), 'utf8');
    expect(house).toContain('prefersReducedMotion()');
    expect(house).toContain('CHIMNEY_SMOKE');
  });
});
