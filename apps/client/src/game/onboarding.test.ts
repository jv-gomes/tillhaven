import { describe, expect, it } from 'vitest';
import { CROPS } from '@tillhaven/shared/config';
import type { PlotView } from '@tillhaven/shared/types';
import { STEP_TEXT, nextStep, type OnboardingStep } from './onboarding.js';

/**
 * T-18.17 (F-5) — the one line telling a new player what to do next.
 *
 * The action key is never named anywhere else in the game: a new account lands
 * on a farm holding a hoe, with a highlighted tile in front of it, and nothing
 * says that pressing anything does anything.
 *
 * The interesting property under test is that this is **derived, not scripted**.
 * There is no cursor, no "step 3 of 5" and nothing persisted, so every
 * assertion below is really the same question: given this farm, is the sentence
 * true right now?
 */

const NOW = 1_700_000_000_000;
const SEEDS = [{ itemId: CROPS.leek.seedItemId, quantity: 3 }];
const NO_SEEDS = [{ itemId: 'hoe_wood', quantity: 1 }];

const PLOT: PlotView = {
  id: 'p1',
  farmId: 'f1',
  x: 9,
  y: 9,
  unlocked: true,
  cropId: null,
  plantedAt: null,
  growthDurationMs: null,
  wateredAt: null,
  witheredAt: null,
  harvestedAt: null,
  tilled: false,
  stage: 0,
  isRipe: false,
  readyInMs: 0,
  isPaused: false,
  isWet: false,
  wetUntil: null,
  effectiveDurationMs: 0,
};

const plot = (over: Partial<PlotView> = {}): PlotView => ({ ...PLOT, ...over });

const step = (plots: PlotView[], slots = SEEDS): OnboardingStep | null =>
  nextStep({ plots, slots, serverNow: NOW, now: NOW });

/** A crop that is planted, part grown and currently dry. */
const dry = plot({
  tilled: true,
  cropId: 'leek',
  plantedAt: NOW - 60_000,
  growthDurationMs: CROPS.leek.growthDurationMs,
  effectiveDurationMs: CROPS.leek.growthDurationMs,
  readyInMs: CROPS.leek.growthDurationMs,
  wetUntil: NOW - 1,
});

const growing = plot({ ...dry, wetUntil: NOW + 60_000 });

/**
 * `displayAt` short-circuits on the server's own `isRipe`, which is the honest
 * way to build this: ripeness is the SERVER's answer and the client only
 * interpolates forward from it. My first attempt backdated `plantedAt`, which
 * `displayAt` deliberately ignores — growth stopped being wall-clock time when
 * D-1 made it depend on watering.
 */
const ripe = plot({ ...dry, isRipe: true, readyInMs: 0, wetUntil: NOW + 60_000 });

describe('nextStep', () => {
  it('starts a brand-new farm at the hoe', () => {
    expect(step([plot(), plot({ id: 'p2' })])).toBe('till');
  });

  it('asks for a seed once there is soil to put one in', () => {
    expect(step([plot({ tilled: true })])).toBe('plant');
  });

  it('asks for the can once something is planted and dry', () => {
    expect(step([growing, dry])).toBe('water');
  });

  it('asks for a harvest once anything is ready', () => {
    expect(step([ripe])).toBe('harvest');
  });

  /**
   * The exit, and the reason nothing is persisted. One harvest is the whole
   * loop, so a player who has done it once needs no more prompting — and that
   * fact is on the farm, not in a flag somebody has to remember to set.
   */
  it('stops for good once a plot has been harvested', () => {
    expect(step([plot({ harvestedAt: NOW - 1 }), plot()])).toBeNull();
    // ...even with something urgent on the farm. They know how.
    expect(step([plot({ harvestedAt: NOW - 1 }), ripe])).toBeNull();
  });

  /**
   * Ordered by what the FARM needs, not by what a tutorial script would say
   * next. Someone who reached a ripe crop without ever seeing "till" should be
   * told to pick it, not sent back to the beginning.
   */
  it('answers the most urgent thing when several apply', () => {
    expect(step([plot(), plot({ tilled: true }), dry, ripe])).toBe('harvest');
    expect(step([plot(), plot({ tilled: true }), dry])).toBe('water');
    expect(step([plot(), plot({ tilled: true })])).toBe('plant');
  });

  /** Told to plant with nothing to plant is a dead end, so it says so. */
  it('sends the player to the merchant when the seeds run out', () => {
    expect(step([plot({ tilled: true })], NO_SEEDS)).toBe('buy_seeds');
  });

  /**
   * F-1's "nothing to do", about three minutes into a first session. It is not
   * a dead end, it is the design — and until T-18.18 nothing said so. The
   * sentence names the idle switch, which is the answer to "what do I do now".
   */
  it('explains the wait once everything is planted and watered', () => {
    expect(step([growing])).toBe('growing');
    expect(STEP_TEXT.growing).toMatch(/idle/i);
  });

  it('stops explaining the wait after the first harvest', () => {
    expect(step([growing, plot({ id: 'p2', harvestedAt: NOW - 1 })])).toBeNull();
  });

  it('says nothing on a farm with no unlocked plots', () => {
    expect(step([plot({ unlocked: false })])).toBeNull();
    expect(step([])).toBeNull();
  });

  it('ignores locked plots when choosing the step', () => {
    // A locked untilled plot must not keep saying "till" forever.
    expect(step([growing, plot({ id: 'p9', unlocked: false })])).toBe('growing');
  });
});

describe('STEP_TEXT', () => {
  /**
   * The entire point of F-5. The player is not short of motivation, they are
   * short of the fact that `E` exists — so a sentence that does not name a key
   * is not onboarding, it is flavour.
   */
  it('names a key in every single line', () => {
    for (const [step, text] of Object.entries(STEP_TEXT)) {
      expect(text, step).toMatch(/press e|number keys|wasd|press idle/i);
      expect(text.length, `${step} is too long to read at a glance`).toBeLessThan(110);
    }
  });

  it('has a line for every step, and no extras', () => {
    const steps: OnboardingStep[] = [
      'till',
      'plant',
      'water',
      'harvest',
      'buy_seeds',
      'growing',
    ];
    expect(Object.keys(STEP_TEXT).sort()).toEqual([...steps].sort());
  });
});
