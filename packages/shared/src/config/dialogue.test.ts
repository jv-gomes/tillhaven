import { describe, it, expect } from 'vitest';
import {
  DIALOGUE_ESTABLISHED_LEVEL,
  DIALOGUE_MAX_LINE,
  NPC_DIALOGUE,
  dialogueStateFor,
  entryNode,
  nodeById,
  npcDialogue,
  type NpcDialogue,
} from './dialogue.js';
import { DAY_SEGMENTS } from './time.js';

/**
 * T-33.01. The dialogue tables, checked for the failures a line tree can have
 * that a type cannot catch: a `next` pointing at nothing, a node no state can
 * reach, a loop, and a line too long for the box it is rendered in.
 *
 * All of these fail the same way in front of a player — the conversation stops,
 * or never starts — and none of them fails at build time.
 */
describe('every NPC dialogue tree', () => {
  const npcs = NPC_DIALOGUE.map((npc) => [npc.id, npc] as const);

  it.each(npcs)('%s has unique node ids', (_id, npc) => {
    const ids = npc.nodes.map((n) => n.id);
    expect(new Set(ids).size, `duplicate node id in ${npc.id}`).toBe(ids.length);
  });

  /**
   * The mandatory fallback. `dialogueStateFor` picks from live conditions and
   * can grow a branch nobody wrote an entry for; without `default` that is a
   * character who says nothing, which reads as a broken game rather than a
   * missing line.
   */
  it.each(npcs)('%s has a default state', (_id, npc) => {
    expect(npc.states['default'], `${npc.id} has no default state`).toBeDefined();
  });

  it.each(npcs)('%s resolves every state to a real node', (_id, npc) => {
    for (const [state, nodeId] of Object.entries(npc.states)) {
      expect(nodeById(npc, nodeId), `${npc.id} state "${state}" -> missing node "${nodeId}"`)
        .toBeDefined();
    }
  });

  it.each(npcs)('%s resolves every next to a real node', (_id, npc) => {
    for (const node of npc.nodes) {
      if (node.next === undefined) continue;
      expect(nodeById(npc, node.next), `${npc.id} node "${node.id}" -> missing next "${node.next}"`)
        .toBeDefined();
    }
  });

  /**
   * **A conversation must end.** `next` is followed by the panel with no visit
   * set, so a cycle is an NPC the player cannot walk away from except by
   * Escape — and the one path out of a modal is the one that must not be the
   * only path out.
   */
  it.each(npcs)('%s terminates from every state', (_id, npc) => {
    for (const state of Object.keys(npc.states)) {
      const seen = new Set<string>();
      let node = entryNode(npc, state);
      while (node) {
        expect(seen.has(node.id), `${npc.id} loops at "${node.id}" from state "${state}"`).toBe(
          false,
        );
        seen.add(node.id);
        node = node.next === undefined ? undefined : nodeById(npc, node.next);
      }
    }
  });

  /**
   * A line nobody can reach is a line that will rot — it is never seen, so it
   * is never noticed when it stops making sense. Reachability is from the
   * STATES, because that is the only way in.
   */
  it.each(npcs)('%s can reach every node it defines', (_id, npc) => {
    const reached = new Set<string>();
    const walk = (id: string | undefined): void => {
      if (id === undefined || reached.has(id)) return;
      const node = nodeById(npc, id);
      if (!node) return;
      reached.add(id);
      walk(node.next);
    };
    for (const nodeId of Object.values(npc.states)) walk(nodeId);

    const orphans = npc.nodes.filter((n) => !reached.has(n.id)).map((n) => n.id);
    expect(orphans, `${npc.id} defines nodes no state can reach`).toEqual([]);
  });

  it.each(npcs)('%s says something in every node', (_id, npc) => {
    for (const node of npc.nodes) {
      expect(node.lines.length, `${npc.id} node "${node.id}" has no lines`).toBeGreaterThan(0);
      for (const line of node.lines) {
        expect(line.trim(), `${npc.id} node "${node.id}" has a blank line`).not.toBe('');
      }
    }
  });

  /**
   * **The 390x844 requirement, as an assertion rather than a screenshot.** The
   * box does not scroll on purpose (see `DIALOGUE_MAX_LINE`), so a line written
   * on a desktop that overflows a phone is not a layout bug to find later — it
   * is a line to split into two beats now.
   */
  it.each(npcs)('%s keeps every line inside the box', (_id, npc) => {
    for (const node of npc.nodes) {
      for (const line of node.lines) {
        expect(
          line.length,
          `${npc.id} node "${node.id}": "${line.slice(0, 40)}…" is ${line.length} chars, ` +
            `over the ${DIALOGUE_MAX_LINE} that fits the three rows the box reserves at 390px`,
        ).toBeLessThanOrEqual(DIALOGUE_MAX_LINE);
      }
    }
  });
});

describe('dialogueStateFor', () => {
  const met = { farmLevel: 1, segment: 'day', met: true } as const;

  /**
   * The ordering IS the design: an introduction plays once, so it must win over
   * every branch that can play again. A player who meets the merchant at
   * midnight should be introduced, not greeted as an old friend at night.
   */
  it('introduces before anything else, at any hour and any level', () => {
    for (const { name } of DAY_SEGMENTS) {
      for (const farmLevel of [1, DIALOGUE_ESTABLISHED_LEVEL, 40]) {
        expect(dialogueStateFor({ farmLevel, segment: name, met: false })).toBe('first-meeting');
      }
    }
  });

  it('has a night line that beats the established line', () => {
    expect(dialogueStateFor({ ...met, farmLevel: 40, segment: 'night' })).toBe('night');
  });

  it('treats the farm as established at the trade gate and not before', () => {
    expect(dialogueStateFor({ ...met, farmLevel: DIALOGUE_ESTABLISHED_LEVEL - 1 })).toBe('default');
    expect(dialogueStateFor({ ...met, farmLevel: DIALOGUE_ESTABLISHED_LEVEL })).toBe('established');
  });

  /**
   * Whatever it returns must be renderable. This is the guard that makes the
   * `default` fallback more than a comment: add a branch to `dialogueStateFor`
   * and forget the entry, and this fails rather than a player meeting silence.
   */
  it('only ever names a state some NPC can answer', () => {
    for (const npc of NPC_DIALOGUE) {
      for (const { name } of DAY_SEGMENTS) {
        for (const met2 of [true, false]) {
          for (const farmLevel of [1, 4, 5, 99]) {
            const state = dialogueStateFor({ farmLevel, segment: name, met: met2 });
            expect(entryNode(npc, state), `${npc.id} cannot answer state "${state}"`).toBeDefined();
          }
        }
      }
    }
  });
});

describe('entryNode', () => {
  it('falls back to default for a state the NPC never heard of', () => {
    const npc = npcDialogue('merchant') as NpcDialogue;
    expect(entryNode(npc, 'harvest-festival')?.id).toBe(npc.states['default']);
  });
});
