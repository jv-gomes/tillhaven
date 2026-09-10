import { describe, it, expect } from 'vitest';
import {
  ANIMALS,
  ANIMAL_KINDS,
  CROPS,
  CROP_IDS,
  ITEMS,
  ItemCategory,
  type AnimalKind,
} from '@tillhaven/shared/config';
import type { AnimalView, PlotView } from '@tillhaven/shared/types';
import {
  ANIMAL_SWING,
  actionFor,
  holdingTool,
  isAnimalIntent,
  swingFor,
  swingForKind,
  type Dispatch,
  type Target,
} from './actions.js';

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
const AXE = { itemId: 'axe_wood' };
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

  /**
   * T-18.06 (BUG-08). This test used to assert the opposite — that holding
   * produce refuses with "empty your hands" — and it passed for four phases
   * while making the game unplayable a row at a time.
   *
   * The bug is that harvest FILLS the hand it demanded be empty: produce lands
   * in the first free backpack slot, which is routinely the equipped one. Pick
   * a potato into your empty hotbar slot and the next plot refuses. The rule is
   * "not holding a tool", never "holding nothing", and the two only look alike
   * until the action's own output lands in your hand.
   */
  it('harvests while holding the crop just picked, one plot after another', () => {
    expect(actionFor(PRODUCE, ripe())).toEqual({ kind: 'harvest', plotId: 'plot-1' });
    // Any non-tool: the rule is about tools, not about this crop specifically.
    expect(actionFor({ itemId: 'egg' }, ripe())).toEqual({ kind: 'harvest', plotId: 'plot-1' });
  });

  /**
   * The half of the old rule that was real, kept — but both MVP tools are
   * answered EARLIER with something more useful than "put your tool away": a
   * can waters a planted plot and a hoe says what is in the way. So the
   * tool-blocks-harvest branch is defensive today, and the rule it rests on is
   * pinned directly below instead of through a faked item.
   */
  it('still answers the two real tools on a ripe plot, and answers them better', () => {
    expect(actionFor(CAN, ripe())).toEqual({ kind: 'water', plotId: 'plot-1' });
    expect(expectRefusal(actionFor(HOE, ripe()))).toMatch(/already growing/i);
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

  it.each(PLACES)('%s is never a farm intent — nothing is sent', (_what, target) => {
    const dispatch = actionFor(HOE, target);
    expect(dispatch).not.toHaveProperty('plotId');
    expect(dispatch.kind).toBe('open');
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
    expect(swingFor({ kind: 'water', plotId: 'p' })).toBe('watering');
  });

  /**
   * T-16.02 inverted this. It used to assert planting and harvesting swung
   * NOTHING, because T-8.09 found no kneel or pick strip in the pack — a true
   * observation about the five folders anyone had looked at, out of ~45.
   * `6. Shovel` and `13.3 Carrying - Pick Up` are those animations.
   */
  it('crouches to plant and bends to harvest', () => {
    expect(swingFor({ kind: 'plant', plotId: 'p', cropId: 'leek' })).toBe('plant');
    expect(swingFor({ kind: 'harvest', plotId: 'p' })).toBe('harvest');
  });

  /**
   * The property that matters more than any single mapping: every verb has a
   * swing. `Farm.act()` and the idle replay both call `playToolAnimation`
   * unconditionally now, so a `swingForKind` that fell through for a future
   * verb would not fail to animate — it would pass `undefined` into Phaser,
   * which plays nothing and logs nothing (the T-8.04 finding).
   */
  it('has a swing for every farm verb', () => {
    const verbs = ['till', 'plant', 'water', 'harvest'] as const;
    for (const kind of verbs) {
      expect(swingForKind(kind), kind).toBeTruthy();
    }
  });

  /** Both animal actions kneel; the art draws no difference between them. */
  it('kneels for animals', () => {
    expect(ANIMAL_SWING).toBe('pet');
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

  /**
   * T-18.06 (BUG-08), the animal half. This asserted that EVERY held item is
   * refused, which had the same defect the plot branch had and for the same
   * reason: the egg lands in the first free backpack slot, which is routinely
   * the equipped one, so collecting from one chicken refused the next. A coop
   * is a row of animals the way a field is a row of plots.
   *
   * The QA audit only caught the crop case; this one was found by fixing it.
   */
  it('collects while holding the egg just collected', () => {
    for (const held of [PRODUCE, { itemId: 'egg' }, SEED]) {
      expect(actionFor(held, animal({ hasProduce: true })), JSON.stringify(held)).toEqual({
        kind: 'collect',
        animalId: 'animal-1',
      });
    }
  });

  it('refuses a tool, and says both things it could be put away for', () => {
    for (const held of [HOE, CAN]) {
      const message = expectRefusal(actionFor(held, animal({ hasProduce: true })));
      expect(message).toMatch(/tool/i);
      expect(message).toContain(ITEMS[ANIMALS.chicken.feedItemId]!.name);
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

/* ------------------------------------------------------------------ *
 * The farmhouse door (T-16.11, D-7)
 * ------------------------------------------------------------------ */

describe('the farmhouse door', () => {
  const DOOR: Target = { kind: 'door' };

  /**
   * D-7 settled: the door is a faced-tile trigger, not a gap you walk through.
   * That makes it the same shape of interaction as the chest and the merchant,
   * which is the point — no second input mode to learn.
   */
  it('goes inside when faced', () => {
    expect(actionFor(null, DOOR)).toEqual({ kind: 'enter', what: 'house' });
  });

  /**
   * Holding something must not stop you going indoors. A rule like "put your
   * hoe away first" has nothing behind it, and the player would meet it while
   * standing on their own porch with no idea what they did wrong.
   */
  it('goes inside whatever is in hand', () => {
    for (const held of [HOE, CAN, SEED, PRODUCE]) {
      expect(actionFor(held, DOOR)).toEqual({ kind: 'enter', what: 'house' });
    }
  });

  /**
   * `enter` is its own kind rather than a fourth `open.what`, because `open`
   * means "show DOM over the farm" and this swaps the scene. `Farm.act()`
   * branches on exactly this distinction.
   */
  it('is not an open, a farm intent or an animal intent', () => {
    const dispatch = actionFor(null, DOOR);
    expect(dispatch.kind).toBe('enter');
    expect(dispatch).not.toHaveProperty('plotId');
    expect(isAnimalIntent(dispatch)).toBe(false);
  });

  it('says nothing when the character is merely near the house', () => {
    // Only the door tile answers; `facedTarget` returns null for the rest of
    // the building, and a null target is silence by design.
    expect(actionFor(null, null)).toEqual({ kind: 'nothing' });
  });
});

/**
 * T-18.06 — the rule the two hand actions now share.
 *
 * Tested directly, and against the REAL item table rather than a fixture,
 * because both call sites are partly shadowed by earlier branches: a hoe and a
 * watering can each get a more specific answer before the tool check is
 * reached on a plot. Asking `holdingTool` itself is what pins the rule for the
 * tiers D-4 will add — every one of them will be a tool with a `toolKind`, and
 * none of them will be listed here.
 */
describe('holdingTool — what "by hand" actually means', () => {
  it('is true for every declared tool in the item table', () => {
    const tools = Object.values(ITEMS).filter((i) => i.category === ItemCategory.TOOL);
    // If this ever hits zero the assertions below pass by looking at nothing.
    expect(tools.length).toBeGreaterThan(0);
    for (const item of tools) {
      expect(holdingTool({ itemId: item.id }), item.id).toBe(true);
    }
  });

  it('is false for everything a hand action can produce or a bag can hold', () => {
    const carried = Object.values(ITEMS).filter((i) => i.category !== ItemCategory.TOOL);
    expect(carried.length).toBeGreaterThan(0);
    for (const item of carried) {
      expect(holdingTool({ itemId: item.id }), item.id).toBe(false);
    }
  });

  it('is false for an empty hand and for an item the config has never heard of', () => {
    expect(holdingTool(null)).toBe(false);
    // Unknown ids reach here from a stale client after a config change. The
    // safe answer is "not a tool": the server re-checks, and refusing an
    // action over an id we cannot look up would strand the player.
    expect(holdingTool({ itemId: 'no_such_item' })).toBe(false);
  });

  /**
   * Asked of `toolKind`, not of `category`. The two agree today and the
   * distinction is the point: `toolKind` is what `actionFor` already switches
   * on for the hoe and the can, so one item declared `category: TOOL` with no
   * kind would be a tool the control scheme cannot use and this would say so.
   */
  it('agrees with the category for every item, which is the invariant', () => {
    for (const item of Object.values(ITEMS)) {
      expect(item.toolKind !== undefined, item.id).toBe(item.category === ItemCategory.TOOL);
    }
  });
});

/**
 * T-20.04 — the action key at a tree.
 *
 * Everything here is a **UX gate, never authority**: `chop` on the server looks
 * the axe up in the player's own inventory and re-checks the tree's state
 * whatever this decides (§4.1, §5.1). The point of deciding twice is that the
 * player learns by reading a sentence rather than by watching a swing play and
 * then be taken back.
 */
describe('actionFor at a tree', () => {
  const standing = { kind: 'tree' as const, view: { id: 't1', x: 3, y: 2, isStanding: true, regrowsInMs: 0 } };
  const stump = { kind: 'tree' as const, view: { id: 't1', x: 3, y: 2, isStanding: false, regrowsInMs: 60_000 } };

  it('chops a standing tree with an axe', () => {
    expect(actionFor(AXE, standing)).toEqual({ kind: 'chop', treeId: 't1' });
  });

  /**
   * The axe is the only thing that chops, and this loops the alternatives
   * rather than testing one: a rule that let a hoe fell a tree would be caught
   * here and nowhere else.
   */
  it('refuses without an axe, whatever else is held', () => {
    for (const held of [HOE, CAN, SEED, PRODUCE, null]) {
      const result = actionFor(held, standing);
      expect(result.kind, `holding ${held?.itemId ?? 'nothing'}`).toBe('refused');
    }
  });

  /**
   * A stump refuses rather than doing nothing — "nothing happened" is the one
   * outcome a player cannot debug. Same reasoning as a locked plot.
   */
  it('refuses a stump even with the axe out, and says why', () => {
    const result = actionFor(AXE, stump);
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.message).toMatch(/growing back/i);
  });

  /**
   * Order matters: a stump answers "still growing back", not "you need an axe",
   * because the state of the world is the more useful fact. A player holding a
   * hoe at a stump has two problems and should hear about the tree first.
   */
  it('reports the stump before the missing tool', () => {
    const result = actionFor(HOE, stump);
    expect(result.kind).toBe('refused');
    if (result.kind === 'refused') expect(result.message).toMatch(/growing back/i);
  });

  it('plays the axe swing for a chop', () => {
    expect(swingForKind('chop')).toBe('axe');
  });
});

/**
 * T-22.01 / D-21 — the mailbox is the trade post.
 *
 * The trade panel went unmounted for eleven phases because *"trading is a
 * place-based interaction like everything else now, and there is nowhere to do
 * it yet"*. This is that place, and these pin the two properties that make it
 * consistent with the other three panels on the same frontage row.
 */
describe('actionFor at the mailbox', () => {
  const mailbox = { kind: 'mailbox' as const };

  it('opens the trade panel', () => {
    expect(actionFor(null, mailbox)).toEqual({ kind: 'open', what: 'trade' });
  });

  /**
   * Whatever is in hand, exactly like the chest, the shipping box and the shop.
   * A rule such as "put your hoe away to read your post" would be a rule with
   * nothing behind it — these panels are views of what the player already owns,
   * not actions on the world.
   */
  it('opens whatever is being held', () => {
    for (const held of [HOE, CAN, AXE, SEED, PRODUCE, null]) {
      expect(actionFor(held, mailbox), `holding ${held?.itemId ?? 'nothing'}`).toEqual({
        kind: 'open',
        what: 'trade',
      });
    }
  });

  /** An `open` intent is not a farm intent: nothing is sent and nothing swings. */
  it('is an open intent, so no tool is swung at it', () => {
    const result = actionFor(HOE, mailbox);
    expect(result.kind).toBe('open');
    expect(result.kind).not.toBe('refused');
  });
});
