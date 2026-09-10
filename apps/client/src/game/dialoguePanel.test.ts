import { describe, it, expect } from 'vitest';
import { npcDialogue, type NpcDialogue } from '@tillhaven/shared/config';
import { advance, frameAt, openCursor, type DialogueCursor } from './dialoguePanel.js';

/**
 * T-33.01. The pure half of the box: where a conversation is, and what one
 * press of the action key does to it.
 *
 * Split out of the DOM for the same reason `floatText.ts` and `idleSummary.ts`
 * are — the interesting failures are "the last line of every node is skipped"
 * and "the conversation never ends", and neither needs a browser to find.
 */

const merchant = npcDialogue('merchant') as NpcDialogue;

/** Every cursor a conversation from `state` passes through, in order. */
function walk(npc: NpcDialogue, state: string): DialogueCursor[] {
  const seen: DialogueCursor[] = [];
  let cursor = openCursor(npc, state);
  // Bounded so a cycle fails as a test rather than as a hung run.
  while (cursor && seen.length < 200) {
    seen.push(cursor);
    cursor = advance(npc, cursor);
  }
  return seen;
}

describe('advance', () => {
  /**
   * **The bug this test exists for.** Advancing the NODE first and then showing
   * its first line drops the last line of every node — which looks like the
   * writer forgot a sentence, so it gets "fixed" in the config file where the
   * fault is not.
   */
  it('walks every line of a node before following its next', () => {
    const first = merchant.nodes.find((n) => n.id === 'first')!;
    expect(first.lines.length).toBeGreaterThan(1);

    const lines = walk(merchant, 'first-meeting')
      .filter((c) => c.nodeId === 'first')
      .map((c) => c.line);

    expect(lines).toEqual(first.lines.map((_, i) => i));
  });

  it('shows every line of every node reached, exactly once', () => {
    const path = walk(merchant, 'first-meeting');
    const keys = path.map((c) => `${c.nodeId}#${c.line}`);
    expect(new Set(keys).size).toBe(keys.length);

    for (const cursor of path) {
      expect(frameAt(merchant, cursor), `no frame for ${cursor.nodeId}#${cursor.line}`).not.toBeNull();
    }
  });

  it('ends the conversation on the last line of a node with no next', () => {
    const shop = merchant.nodes.find((n) => n.id === 'shop')!;
    const last: DialogueCursor = { nodeId: 'shop', line: shop.lines.length - 1 };
    expect(advance(merchant, last)).toBeNull();
  });

  /**
   * A dangling `next` ends the conversation rather than freezing it. The config
   * test rejects such a table long before this matters, but the failure mode
   * has to be "closed early", never "cannot be closed" — the box is modal, and
   * a modal that will not close takes the whole game with it.
   */
  it('ends rather than sticking when next names a node that is gone', () => {
    const broken: NpcDialogue = {
      ...merchant,
      nodes: [{ id: 'only', lines: ['…'], next: 'nowhere' }],
      states: { default: 'only' },
    };
    expect(advance(broken, { nodeId: 'only', line: 0 })).toBeNull();
  });

  it('ends rather than sticking when the cursor names a node that is gone', () => {
    expect(advance(merchant, { nodeId: 'nowhere', line: 0 })).toBeNull();
  });
});

describe('frameAt', () => {
  it('says there is more until the very last press', () => {
    const path = walk(merchant, 'first-meeting');
    const frames = path.map((c) => frameAt(merchant, c)!);

    expect(frames.slice(0, -1).every((f) => f.more)).toBe(true);
    expect(frames.at(-1)!.more).toBe(false);
  });

  it('names the speaker on every frame, so a second NPC needs no new code', () => {
    for (const cursor of walk(merchant, 'default')) {
      expect(frameAt(merchant, cursor)!.speaker).toBe(merchant.name);
    }
  });

  it('has nothing to draw for a line past the end of a node', () => {
    const shop = merchant.nodes.find((n) => n.id === 'shop')!;
    expect(frameAt(merchant, { nodeId: 'shop', line: shop.lines.length })).toBeNull();
  });
});

describe('openCursor', () => {
  it('starts at the first line of the state entry node', () => {
    expect(openCursor(merchant, 'first-meeting')).toEqual({ nodeId: 'first', line: 0 });
  });

  it('falls back to default rather than refusing an unknown state', () => {
    expect(openCursor(merchant, 'harvest-festival')).toEqual({ nodeId: 'greet', line: 0 });
  });

  /**
   * `null` is the signal the caller falls through on — the merchant still opens
   * their shop if their lines are ever deleted. An empty box would be worse
   * than silence: it takes input and says nothing.
   */
  it('declines when the NPC has no reachable node', () => {
    const mute: NpcDialogue = { ...merchant, nodes: [], states: { default: 'gone' } };
    expect(openCursor(mute, 'default')).toBeNull();
  });
});
