import type { DaySegment } from './time.js';

/**
 * What the villagers say (T-33.01, CLAUDE.md §4.4).
 *
 * **Lines are data.** Not one string lives in a scene: the panel is handed a
 * node and renders it, and adding a character to the farm is an entry in this
 * file rather than a branch in `Farm.ts`. That is the same rule the crops, the
 * shop rows and the milestones already follow, and it is what will let T-33.03
 * add the Chef and the Blacksmith without touching the panel at all.
 *
 * **Shared, not client-only**, even though only the client renders it. Quests
 * (T-33.04) attach to the same givers, and the server has to validate a turn-in
 * against the giver a line belongs to. Two copies of "who the Chef is" is one
 * too many, and the copy that would rot is the one nobody renders.
 *
 * **Nothing here is authoritative** (§4.1). A state is chosen from what the
 * client already knows — farm level, time of day, whether these two have met —
 * so a player editing their own memory sees different flavour text and gains
 * nothing. If a line ever gates a reward, the reward moves to the server and
 * the line stays here.
 */

/** Every character who can say something. */
export type NpcId = 'merchant' | 'chef';

/**
 * One screen of dialogue.
 *
 * **`lines`, plural, is the unit of ADVANCE.** A node holds the lines the
 * action key steps through; `next` is where the conversation goes when they run
 * out. Splitting on both axes — a node per line, and a chain of `next` — was
 * the first shape, and it made a two-sentence greeting into five config
 * objects with four ids nobody reads. A node is a beat; a line is a press.
 */
export interface DialogueNode {
  /** Unique within its NPC. Written into `next` and nowhere else. */
  readonly id: string;
  /** Shown one at a time, in order. The action key advances. */
  readonly lines: readonly string[];
  /** Where to go when the lines run out. Absent means the conversation ends. */
  readonly next?: string;
}

export interface NpcDialogue {
  readonly id: NpcId;
  /** Shown above the text, so the player learns who they are talking to. */
  readonly name: string;
  /**
   * The node each state starts at.
   *
   * **`default` is mandatory** and the tests enforce it: a state chosen from
   * live conditions can always land on one the author did not write, and the
   * failure has to be a slightly generic greeting rather than a silent NPC.
   */
  readonly states: Readonly<Record<string, string>>;
  readonly nodes: readonly DialogueNode[];
}

/**
 * The longest a single line may be.
 *
 * **Measured in the running game at 390x844, and the first guess was wrong.**
 * Reasoning from the box width (`min(46rem, 100vw - 2rem)` = 358px), the font
 * (0.82rem monospace) and the padding gave "about 46 characters per row, so 132
 * is three rows". Growing a real sentence a word at a time inside the real box
 * gives **40 per row and 120 for three** — the arithmetic ignored that a line
 * breaks at a WORD, so the last few characters of every row are usually spent
 * on a break rather than on text.
 *
 * Three rows is the ceiling because `.dialogue__text` reserves exactly that
 * much height. A longer line does not overflow anything — it grows the box by
 * one row, which moves the hint the player is reading. A box that changes size
 * as you press through a conversation is the thing this prevents.
 *
 * A cap rather than a scrollbar: a dialogue box the player has to scroll is a
 * dialogue box that should have been two beats. `dialogue.test.ts` fails an
 * over-long line, which is the only way this stays true as lines are added by
 * somebody writing on a desktop.
 */
export const DIALOGUE_MAX_LINE = 120;

/**
 * The merchant, who has stood silent on that tile since T-18.02.
 *
 * Lines vary by farm level and time of day (T-33.02). The point is not the
 * writing — it is that the *mechanism* varies, so a second NPC is content and
 * not code.
 */
const MERCHANT: NpcDialogue = {
  id: 'merchant',
  name: 'Merchant',
  states: {
    default: 'greet',
    'first-meeting': 'first',
    night: 'night',
    established: 'established',
  },
  nodes: [
    {
      id: 'first',
      lines: [
        "You must be the one who took over the old plot. I wondered who'd turn up.",
        'I buy what you grow and I sell what you need. Seeds mostly, tools when I have them.',
        "Come back when you've something worth weighing.",
      ],
      next: 'shop',
    },
    {
      id: 'greet',
      lines: ['Morning. Have a look — I restock whenever I can get down the road.'],
      next: 'shop',
    },
    {
      id: 'night',
      lines: [
        "You're up late. So am I, apparently.",
        "Go on then, I'll not make you walk back in the dark for nothing.",
      ],
      next: 'shop',
    },
    {
      id: 'established',
      lines: [
        "That field of yours is starting to look like a farm rather than a plan.",
        'Prices are the same for everyone, mind. Even the ones I like.',
      ],
      next: 'shop',
    },
    /*
     * The terminal node every path runs into.
     *
     * It exists so the panel has one place to say "and now the shop opens",
     * rather than four nodes each ending the conversation and four callers each
     * remembering what happens next.
     */
    { id: 'shop', lines: ["Right. What'll it be?"] },
  ],
};

/**
 * The Chef (T-33.03), who wants cooked food and cannot have any yet.
 *
 * **The lines are honest about that.** T-33.03's brief says the Chef wants
 * cooked goods and the Blacksmith wants ore, so that Phases 32 and 36 land into
 * something rather than onto nothing. Neither system exists — Phase 32 is
 * superseded and Phase 36 is blocked — so writing a Chef who offers to buy
 * cooked food would be a promise the game cannot keep, and a player who goes
 * looking for a kitchen would be right to feel lied to. He asks after raw
 * produce, mentions the kitchen he has not got, and leaves it there.
 *
 * When cooking exists he gains states and quests; the lines below stay true
 * either way, which is the test for whether flavour text can ship early.
 */
const CHEF: NpcDialogue = {
  id: 'chef',
  name: 'Chef',
  states: {
    default: 'greet',
    'first-meeting': 'first',
    night: 'night',
    established: 'established',
  },
  nodes: [
    {
      id: 'first',
      lines: [
        'Ah — the new farmer. Good. I was getting tired of the merchant.',
        "I cook. Or I will, once I've a kitchen worth the name and something to put in it.",
      ],
    },
    {
      id: 'greet',
      lines: ['Anything ripe today? I ask everyone. Mostly I get turnips.'],
    },
    {
      id: 'night',
      lines: ['Late. Even for me, and I keep bad hours by trade.'],
    },
    {
      id: 'established',
      lines: [
        "Twenty plots and counting. You'll out-grow what I can carry before long.",
        'Keep at it. I have plans for that field of yours.',
      ],
    },
  ],
};

export const NPC_DIALOGUE: readonly NpcDialogue[] = [MERCHANT, CHEF];

const BY_ID = new Map(NPC_DIALOGUE.map((npc) => [npc.id, npc]));

export function npcDialogue(id: NpcId): NpcDialogue | undefined {
  return BY_ID.get(id);
}

/** What the world looks like when a conversation starts. */
export interface DialogueContext {
  readonly farmLevel: number;
  readonly segment: DaySegment;
  /** Whether this player has talked to this NPC before. */
  readonly met: boolean;
}

/**
 * The farm level at which the merchant stops treating you as new.
 *
 * Deliberately the same number as `TRADE_MIN_FARM_LEVEL`: the moment the game
 * considers a farm established enough to trade with strangers is a reasonable
 * moment for the one NPC who has been watching to say so. Stated here rather
 * than imported so that changing the trade gate — a security number — cannot
 * silently change what an NPC says, which is the sort of coupling that makes a
 * security constant hard to move later.
 */
export const DIALOGUE_ESTABLISHED_LEVEL = 5;

/**
 * Which state a conversation should start in.
 *
 * **Ordered most specific first**, and the order is the design: a player
 * meeting the merchant for the first time at midnight should get the
 * introduction, not the night line, because the introduction is the one that
 * only ever plays once. Every branch below that is flavour and may be missed.
 *
 * Pure, so the test can walk every combination rather than trusting a comment.
 */
export function dialogueStateFor(context: DialogueContext): string {
  if (!context.met) return 'first-meeting';
  if (context.segment === 'night') return 'night';
  if (context.farmLevel >= DIALOGUE_ESTABLISHED_LEVEL) return 'established';
  return 'default';
}

/**
 * The node a state starts at, falling back to `default`.
 *
 * The fallback is the whole reason this is a function: `dialogueStateFor` can
 * grow a branch that an NPC has no entry for, and the honest failure is the
 * generic greeting rather than a character who has nothing to say.
 */
export function entryNode(npc: NpcDialogue, state: string): DialogueNode | undefined {
  const id = npc.states[state] ?? npc.states['default'];
  return npc.nodes.find((n) => n.id === id);
}

export function nodeById(npc: NpcDialogue, id: string): DialogueNode | undefined {
  return npc.nodes.find((n) => n.id === id);
}
