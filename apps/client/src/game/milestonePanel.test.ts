import { describe, expect, it } from 'vitest';
import { MILESTONES } from '@tillhaven/shared/config';
import type { MilestoneView } from '../net/progression.js';
import {
  ALL_DONE,
  BOARD_AUTO_OPEN_MIN_WIDTH,
  BOARD_SECTIONS,
  boardAutoOpens,
  boardStartsOpen,
  goalPercent,
  goalRows,
  progressLabel,
  rewardLabel,
} from './milestonePanel.js';

/**
 * What the goal board says (T-30.09).
 *
 * The panel itself is DOM over a canvas and its interesting half is not: which
 * three goals it picks, how far along each bar is, and what each row claims the
 * reward is. Those are functions of the server's view, so they are asserted
 * here rather than by driving a browser — the browser run proves the wiring,
 * these prove the arithmetic.
 *
 * Nothing here decides whether a goal is earned. `earned` and `claimed` arrive
 * from the server (§4.1); these tests only pin what the panel does with them.
 */

function view(over: Partial<MilestoneView> = {}): MilestoneView {
  return {
    id: 'break_ground',
    title: 'Break ground',
    hint: 'Till a plot with your hoe.',
    earned: false,
    claimed: false,
    progress: 0,
    target: 1,
    reward: { gold: 0, items: [{ itemId: 'leek_seeds', quantity: 2 }] },
    ...over,
  };
}

describe('goalPercent', () => {
  it('is the fraction of the target, as an integer', () => {
    expect(goalPercent(view({ progress: 3, target: 6 }))).toBe(50);
    expect(goalPercent(view({ progress: 1, target: 6 }))).toBe(17);
  });

  it('is zero before anything has been done', () => {
    expect(goalPercent(view({ progress: 0, target: 6 }))).toBe(0);
  });

  /**
   * The server caps `progress` at `target`, so this should never be reached
   * through the wire. It is pinned anyway because the bar is written straight
   * into `width: n%`, and a width of 500% is a fill that escapes its own frame.
   */
  it('never exceeds a full bar', () => {
    expect(goalPercent(view({ progress: 30, target: 5 }))).toBe(100);
  });

  it('is full the moment the goal is earned, whatever the counter says', () => {
    // `experience` goals have huge targets; an earned one must read as done
    // rather than as 99% because of a rounding step.
    expect(goalPercent(view({ earned: true, progress: 1, target: 100_000 }))).toBe(100);
  });

  /**
   * Not reachable from the shipped table — every requirement has a positive
   * target — but a divide by zero would render `NaN%` across the whole board,
   * which is a bad way to find out a future milestone got it wrong.
   */
  it('does not divide by a zero target', () => {
    expect(goalPercent(view({ progress: 0, target: 0 }))).toBe(0);
  });
});

describe('progressLabel', () => {
  it('counts toward the target while the goal is unearned', () => {
    expect(progressLabel(view({ progress: 2, target: 6 }))).toBe('2 / 6');
  });

  it('groups large numbers, because experience goals are in the thousands', () => {
    expect(progressLabel(view({ progress: 1500, target: 12_000 }))).toBe('1,500 / 12,000');
  });

  /**
   * An earned goal stops counting and starts asking. "6 / 6" beside a live
   * Claim button says the same thing twice and the useful half is the button.
   */
  it('asks to be claimed once the goal is earned', () => {
    expect(progressLabel(view({ earned: true, progress: 6, target: 6 }))).toContain('claim');
  });
});

describe('rewardLabel', () => {
  it('names the items rather than counting them', () => {
    expect(rewardLabel({ gold: 0, items: [{ itemId: 'leek_seeds', quantity: 2 }] })).toBe(
      '2 × Leek Seeds',
    );
  });

  it('says gold first when a goal pays both', () => {
    const label = rewardLabel({
      gold: 250,
      items: [{ itemId: 'leek_seeds', quantity: 2 }],
    });

    expect(label).toBe('250g, 2 × Leek Seeds');
  });

  it('groups gold, so a four-figure reward is readable', () => {
    expect(rewardLabel({ gold: 1250, items: [] })).toBe('1,250g');
  });

  /**
   * An unknown id can only come from a client running older config than the
   * server. Tidying the id beats rendering "undefined" at the player — the same
   * fallback `floatTextFor` takes, for the same reason.
   */
  it('falls back to a tidied id for an item this build does not know', () => {
    expect(rewardLabel({ gold: 0, items: [{ itemId: 'moon_cheese', quantity: 1 }] })).toBe(
      '1 × moon cheese',
    );
  });

  it('says so plainly rather than rendering an empty line', () => {
    expect(rewardLabel({ gold: 0, items: [] })).toBe('Nothing');
  });
});

describe('goalRows', () => {
  const board: MilestoneView[] = [
    view({ id: 'a', claimed: true, earned: true }),
    view({ id: 'b', progress: 2, target: 6 }),
    view({ id: 'c', earned: true, progress: 1, target: 1 }),
    view({ id: 'd', progress: 0, target: 4 }),
    view({ id: 'e', progress: 0, target: 7 }),
  ];

  /**
   * The whole reason the board is worth opening: a reward waiting to be
   * collected outranks anything still being worked toward, however close.
   */
  it('puts a claimable goal above every unearned one', () => {
    expect(goalRows(board).map((r) => r.id)).toEqual(['c', 'b', 'd']);
  });

  it('shows three, because that is what fits beside a farm', () => {
    expect(goalRows(board)).toHaveLength(3);
  });

  it('drops goals that have already been claimed', () => {
    expect(goalRows(board, 10).map((r) => r.id)).not.toContain('a');
  });

  it('marks exactly the earned-and-unclaimed row as claimable', () => {
    const rows = goalRows(board);

    expect(rows.filter((r) => r.claimable).map((r) => r.id)).toEqual(['c']);
  });

  it('is empty when every goal has been claimed, and the panel has words for it', () => {
    const done = board.map((v) => ({ ...v, earned: true, claimed: true }));

    expect(goalRows(done)).toEqual([]);
    expect(BOARD_SECTIONS[0]!.empty).toBe(ALL_DONE);
  });

  /**
   * The shipped table, not a fixture. A brand-new player sees the first three
   * milestones in config order, and if someone reorders `MILESTONES` so a
   * level-10 goal leads the board, this is where it shows up.
   */
  it('opens a new farm on the first three milestones, in table order', () => {
    const fresh = MILESTONES.map((m) =>
      view({ id: m.id, title: m.title, hint: m.hint, earned: false, claimed: false }),
    );

    expect(goalRows(fresh).map((r) => r.id)).toEqual(MILESTONES.slice(0, 3).map((m) => m.id));
  });
});

describe('boardAutoOpens', () => {
  const PHONE = 390;
  const LAPTOP = 1366;

  it('opens itself for a new player on a laptop', () => {
    expect(boardAutoOpens(null, LAPTOP)).toBe(true);
  });

  /**
   * Screenshotted at 390x844: the board fits without overflow and still covers
   * most of the farm, because most of the farm is not very much at that size.
   * The Goals button in the bar is the invitation there instead.
   */
  it('does not barge in on a phone', () => {
    expect(boardAutoOpens(null, PHONE)).toBe(false);
    expect(boardAutoOpens(null, BOARD_AUTO_OPEN_MIN_WIDTH - 1)).toBe(false);
    expect(boardAutoOpens(null, BOARD_AUTO_OPEN_MIN_WIDTH)).toBe(true);
  });

  /** A remembered choice is the player's, and it wins at any width. */
  it('honours a remembered open even on a phone', () => {
    expect(boardAutoOpens('open', PHONE)).toBe(true);
  });

  it('honours a remembered close even on a wide screen', () => {
    expect(boardAutoOpens('closed', LAPTOP)).toBe(false);
  });
});

describe('boardStartsOpen', () => {
  /**
   * The default is OPEN, and it is the requirement rather than a preference:
   * the board exists for a player three minutes in who does not know there is
   * a list of things to work toward, and one behind a button they have no
   * reason to press does not reach them.
   */
  it('opens for a player who has never touched it', () => {
    expect(boardStartsOpen(null)).toBe(true);
  });

  it('stays shut for a player who closed it', () => {
    expect(boardStartsOpen('closed')).toBe(false);
  });

  it('opens again for a player who reopened it', () => {
    expect(boardStartsOpen('open')).toBe(true);
  });

  /** Anything else is a stale or corrupted value; the default wins. */
  it('opens on a value it does not recognise', () => {
    expect(boardStartsOpen('1')).toBe(true);
  });
});
