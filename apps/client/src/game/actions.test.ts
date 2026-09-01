import { describe, it, expect } from 'vitest';
import {
  ANIMALS,
  ANIMAL_KINDS,
  CROPS,
  CROP_IDS,
  ITEMS,
  type AnimalKind,
} from '@tillhaven/shared/config';
import type { AnimalView, PlotView } from '@tillhaven/shared/types';
import { actionFor, isAnimalIntent, swingFor, type Dispatch, type Target } from './actions.js';

/**
 * The control scheme, as a matrix (T-9.06).
 *
 * Every cell is "equipped item × plot state → what gets sent", and the two
 * things this file is really guarding are: nothing is sent that the server is
 * certain to refuse, and nothing that SHOULD be sent is swallowed. A gate that
 * silently eats a valid action is worse than no gate, because the player has no
 * way to tell it from a broken server.
 */

const HOE = { itemId: 'hoe_wood' };
const CAN = { itemId: 'watering_can_wood' };
const SEED = { itemId: 'leek_seeds' };
const PRODUCE = { itemId: 'leek' };

const BASE: PlotView = {
  id: 'plot-1',
  farmId: 'farm-1',
  x: 5,
  y: 7,
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

const rough = (over: Partial<PlotView> = {}): Target => ({
  kind: 'plot',
  view: { ...BASE, ...over },
  isRipe: false,
});
const tilled = (over: Partial<PlotView> = {}): Target => rough({ tilled: true, ...over });
const CROP: Partial<PlotView> = {
  tilled: true,
  cropId: 'leek',
  plantedAt: 1_700_000_000_000,
  growthDurationMs: CROPS.leek.growthDurationMs,
  effectiveDurationMs: CROPS.leek.growthDurationMs,
  readyInMs: CROPS.leek.growthDurationMs,
};
const RIPE_CROP: Partial<PlotView> = { ...CROP, isRipe: true, readyInMs: 0 };

const growing = (over: Partial<PlotView> = {}): Target => tilled({ ...CROP, ...over });
const ripe = (): Target => ({
  kind: 'plot',
  view: { ...BASE, ...RIPE_CROP },
  isRipe: true,
});

/** Every refusal must say something; an empty toast is a bug, not a message. */
function expectRefusal(dispatch: Dispatch): string {
  expect(dispatch.kind).toBe('refused');
  const message = dispatch.kind === 'refused' ? dispatch.message : '';
  expect(message.length).toBeGreaterThan(0);
  return message;
}

describe('the four things the action key does', () => {
  it('hoes rough ground', () => {
    expect(actionFor(HOE, rough())).toEqual({ kind: 'till', plotId: 'plot-1' });
  });

  it('plants the seed that is actually equipped, not a picker default', () => {
    // The seed picker is gone (T-9.06): which crop goes in the ground is
    // whichever stack the hotbar has selected.
    expect(actionFor(SEED, tilled())).toEqual({
      kind: 'plant',
      plotId: 'plot-1',
      cropId: 'leek',
    });
    expect(actionFor({ itemId: 'onion_seeds' }, tilled())).toEqual({
      kind: 'plant',
      plotId: 'plot-1',
      cropId: 'onion',
    });
  });

  it('waters a growing crop', () => {
    expect(actionFor(CAN, growing())).toEqual({ kind: 'water', plotId: 'plot-1' });
  });

  it('harvests a ripe crop with empty hands', () => {
    expect(actionFor(null, ripe())).toEqual({ kind: 'harvest', plotId: 'plot-1' });
  });

  /** Every crop's seed, not just the one the rest of this file uses. */
  it.each(CROP_IDS)('plants %s from its own seed item', (cropId) => {
    expect(actionFor({ itemId: CROPS[cropId].seedItemId }, tilled())).toEqual({
      kind: 'plant',
      plotId: 'plot-1',
      cropId,
    });
  });
});

describe('what it refuses, and why', () => {
  it('says the plot is not cleared, whatever is in hand', () => {
    // Checked before the item: the player's next move is to buy the plot, and
    // "wrong tool" would send them looking for a different one.
    for (const held of [HOE, CAN, SEED, null]) {
      expect(expectRefusal(actionFor(held, rough({ unlocked: false })))).toMatch(/cleared/i);
    }
  });

  it('sends the player to the hoe when they try to plant in rough ground', () => {
    expect(expectRefusal(actionFor(SEED, rough()))).toMatch(/till/i);
  });

  it('refuses a second hoeing of tilled soil', () => {
    expect(expectRefusal(actionFor(HOE, tilled()))).toMatch(/already tilled/i);
  });

  it('refuses the hoe and the seed on an occupied plot, naming the crop as the reason', () => {
    for (const held of [HOE, SEED]) {
      expect(expectRefusal(actionFor(held, growing()))).toMatch(/already growing/i);
    }
  });

  it('refuses to harvest a crop that is not ready', () => {
    expect(expectRefusal(actionFor(null, growing()))).toMatch(/not ready/i);
  });

  it('asks for empty hands rather than harvesting with produce held', () => {
    // §5.2: harvest is by hand. The message has to say what to DO about it.
    expect(expectRefusal(actionFor(PRODUCE, ripe()))).toMatch(/empty/i);
  });

  it('has something to say for every tool on bare untilled ground', () => {
    expect(expectRefusal(actionFor(CAN, rough()))).toBeTruthy();
    expect(expectRefusal(actionFor(null, rough()))).toBeTruthy();
    expect(expectRefusal(actionFor(CAN, tilled()))).toBeTruthy();
    expect(expectRefusal(actionFor(null, tilled()))).toBeTruthy();
  });

  /**
   * The one silent case, and it is deliberate. The character faces open ground
   * for most of the time it is moving; a toast on every press there would train
   * the player to ignore toasts, including the ones that matter.
   */
  it('says nothing at all when there is no plot in front of the character', () => {
    for (const held of [HOE, CAN, SEED, null]) {
      expect(actionFor(held, null)).toEqual({ kind: 'nothing' });
    }
  });

  it('never refuses without a message', () => {
    // Guards the shape rather than any one branch: a refusal is only useful
    // because of what it says.
    const targets = [rough(), tilled(), growing(), ripe(), rough({ unlocked: false })];
    for (const held of [HOE, CAN, SEED, PRODUCE, null]) {
      for (const target of targets) {
        const dispatch = actionFor(held, target);
        if (dispatch.kind === 'refused') expect(dispatch.message.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('watering', () => {
  /**
   * The server allows watering a ripe crop and it changes nothing that matters,
   * so the client allows it too. A client-side rule the server does not have
   * would make watering a whole row require knowing which plots are ripe first.
   */
  it('waters a ripe crop rather than inventing a rule the server does not have', () => {
    expect(actionFor(CAN, ripe())).toEqual({ kind: 'water', plotId: 'plot-1' });
  });

  it('refuses to water bare soil, tilled or not', () => {
    expect(expectRefusal(actionFor(CAN, rough()))).toBeTruthy();
    expect(expectRefusal(actionFor(CAN, tilled()))).toBeTruthy();
  });

  it('waters a paused crop — that is the entire point of the can', () => {
    expect(actionFor(CAN, growing({ isPaused: true }))).toEqual({
      kind: 'water',
      plotId: 'plot-1',
    });
  });
});

describe('a plot that is planted but somehow untilled', () => {
  /**
   * Not reachable through the endpoints — planting requires tilled soil and
   * harvesting leaves it tilled — but the crop, not the soil, is what decides
   * here. If the order were reversed, a plot in that state would offer the hoe
   * on top of a growing crop.
   */
  it('is still treated as occupied', () => {
    const odd = growing({ tilled: false });
    expect(actionFor(CAN, odd)).toEqual({ kind: 'water', plotId: 'plot-1' });
    expect(expectRefusal(actionFor(HOE, odd))).toMatch(/already growing/i);
  });
});

/**
 * The three things you can stand at (T-10.05, T-11.03, T-11.04). They are the
 * targets that are not plots, and the answers that send nothing — opening a
 * panel is the client showing what the server already guards on its own terms.
 */
describe('the things you stand at', () => {
  const PLACES = [
    ['chest', { kind: 'chest' } as Target],
    ['shipping', { kind: 'shipping' } as Target],
    ['shop', { kind: 'merchant' } as Target],
  ] as const;

  it.each(PLACES)('%s opens whatever is in hand', (what, target) => {
    // Refusing to open one while holding a hoe would be a rule with nothing
    // behind it: these are views of what the player already has, not actions.
    for (const held of [HOE, CAN, SEED, PRODUCE, null]) {
      expect(actionFor(held, target), JSON.stringify(held)).toEqual({ kind: 'open', what });
    }
  });

  it.each(PLACES)('%s is never a farm intent — nothing sent, nothing swung', (_what, target) => {
    const dispatch = actionFor(HOE, target);
    expect(dispatch).not.toHaveProperty('plotId');
    expect(dispatch.kind).toBe('open');
    if (dispatch.kind === 'open') expect(swingFor(dispatch as never)).toBeNull();
  });

  /** Each one answers with ITS OWN panel; the tiles are what tell them apart. */
  it('never confuses one for another', () => {
    const opened = PLACES.map(([, target]) => {
      const d = actionFor(null, target);
      return d.kind === 'open' ? d.what : d.kind;
    });
    expect(opened).toEqual(['chest', 'shipping', 'shop']);
  });

  /** Facing open ground stays silent; only their own tiles open them. */
  it('does not open from anywhere else', () => {
    expect(actionFor(null, null)).toEqual({ kind: 'nothing' });
    expect(actionFor(null, ripe())).toEqual({ kind: 'harvest', plotId: 'plot-1' });
  });
});

describe('swingFor', () => {
  it('swings the hoe when tilling and the can when watering', () => {
    expect(swingFor({ kind: 'till', plotId: 'p' })).toBe('hoe');
    expect(swingFor({ kind: 'water', plotId: 'p' })).toBe('water');
  });

  it('plays nothing for planting or harvesting', () => {
    // The pack has no kneel or pick animation (T-8.09 measured what exists),
    // and a hoe swing on a plant would be a lie about what happened.
    expect(swingFor({ kind: 'plant', plotId: 'p', cropId: 'leek' })).toBeNull();
    expect(swingFor({ kind: 'harvest', plotId: 'p' })).toBeNull();
  });
});


/* ------------------------------------------------------------------ *
 * Animals (T-12.03)
 * ------------------------------------------------------------------ */

const T0 = 1_700_000_000_000;

function animal(over: Partial<AnimalView> = {}): Target {
  return {
    kind: 'animal',
    view: {
      id: 'animal-1',
      farmId: 'farm-1',
      kind: 'chicken',
      variant: 'chicken_red',
      name: null,
      acquiredAt: T0,
      maturesAt: T0,
      lastCollectedAt: T0,
      fedUntil: null,
      isMature: true,
      isFed: true,
      hasProduce: false,
      readyInMs: 0,
      ...over,
    },
  };
}

const CHICKEN_FEED = { itemId: ANIMALS.chicken.feedItemId };
const HAY = { itemId: ANIMALS.cow.feedItemId };

describe('facing an animal', () => {
  it('collects with an empty hand when there is produce', () => {
    expect(actionFor(null, animal({ hasProduce: true }))).toEqual({
      kind: 'collect',
      animalId: 'animal-1',
    });
  });

  it('feeds a hungry animal when its own feed is held', () => {
    expect(actionFor(CHICKEN_FEED, animal({ isFed: false }))).toEqual({
      kind: 'feed',
      animalId: 'animal-1',
    });
  });

  /**
   * The change T-12.03 makes on purpose. The click path this replaced did
   * "collect if you can, otherwise feed" from one input, so a player who meant
   * to collect spent a bag of feed instead. Feeding costs an item; it should
   * take saying so.
   */
  it('does not spend feed just because the animal is hungry', () => {
    const dispatch = actionFor(null, animal({ isFed: false, hasProduce: false }));

    expect(dispatch.kind).toBe('refused');
    expectRefusal(dispatch);
  });

  /** Produce first: an animal can hold produce it earned before its food ran out. */
  it('collects rather than feeds when both apply and hands are empty', () => {
    expect(actionFor(null, animal({ isFed: false, hasProduce: true }))).toEqual({
      kind: 'collect',
      animalId: 'animal-1',
    });
  });

  /**
   * The server picks the feed item from the animal's KIND, so hay at a chicken
   * would quietly consume chicken feed. Refusing here turns a surprise into a
   * sentence — and the sentence names the food, because both bags look alike
   * in a hotbar slot.
   */
  it('refuses the wrong feed, and names the right one', () => {
    const message = expectRefusal(actionFor(HAY, animal({ isFed: false })));
    expect(message).toContain(ITEMS[ANIMALS.chicken.feedItemId]!.name);
  });

  it('refuses a tool, and any other item', () => {
    for (const held of [HOE, CAN, SEED, PRODUCE]) {
      expectRefusal(actionFor(held, animal({ hasProduce: true })));
    }
  });

  it('says a full animal is not hungry rather than feeding it again', () => {
    expectRefusal(actionFor(CHICKEN_FEED, animal({ isFed: true })));
  });

  /**
   * A chick cannot be collected from and CAN be fed — that is how it starts
   * producing the moment it grows up. Both fall out of the ordinary branches.
   */
  it('feeds a chick but does not try to collect from one', () => {
    expectRefusal(actionFor(null, animal({ isMature: false, hasProduce: false })));
    expect(actionFor(CHICKEN_FEED, animal({ isMature: false, isFed: false }))).toEqual({
      kind: 'feed',
      animalId: 'animal-1',
    });
  });

  it('tells a growing chick apart from a fed adult with nothing ready', () => {
    const growing = expectRefusal(actionFor(null, animal({ isMature: false })));
    const idle = expectRefusal(actionFor(null, animal({ isMature: true })));
    expect(growing).not.toBe(idle);
  });

  it('works the same for every kind, using that kind own feed', () => {
    for (const kind of ANIMAL_KINDS) {
      const def = ANIMALS[kind];
      const target = animal({ kind, variant: def.variants[0]!, isFed: false });

      expect(actionFor({ itemId: def.feedItemId }, target), kind).toEqual({
        kind: 'feed',
        animalId: 'animal-1',
      });
    }
  });

  /** The sprite is on screen because the server sent it; the player is owed a message. */
  it('refuses rather than throwing for a kind config no longer knows', () => {
    expectRefusal(actionFor(null, animal({ kind: 'griffin' as AnimalKind })));
  });

  /** Nothing to swing at a cow: the pack has no kneel or milk strip (T-8.09). */
  it('is never a plot intent, and never swings a tool', () => {
    for (const dispatch of [
      actionFor(null, animal({ hasProduce: true })),
      actionFor(CHICKEN_FEED, animal({ isFed: false })),
    ]) {
      expect(isAnimalIntent(dispatch)).toBe(true);
      expect(dispatch).not.toHaveProperty('plotId');
      expect(dispatch).toHaveProperty('animalId');
    }
  });

  it('does not mistake a plot intent for an animal one', () => {
    expect(isAnimalIntent(actionFor(HOE, rough()))).toBe(false);
    expect(isAnimalIntent(actionFor(null, ripe()))).toBe(false);
    expect(isAnimalIntent(actionFor(null, { kind: 'chest' }))).toBe(false);
    expect(isAnimalIntent(actionFor(null, null))).toBe(false);
  });
});
