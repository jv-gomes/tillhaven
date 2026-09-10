import {
  entryNode,
  nodeById,
  npcDialogue,
  type DialogueNode,
  type NpcDialogue,
  type NpcId,
} from '@tillhaven/shared/config';
import { MODAL_ATTR } from '../lib/focus.js';

/**
 * The dialogue box (T-33.01, CLAUDE.md §5).
 *
 * **The verb it adds is "listen", and that is the only reason it is modal.**
 * The goal board is a popover on purpose — you read it while walking to the
 * sixth plot — but a conversation is the one HUD element where the player is
 * meant to be still. It carries `MODAL_ATTR`, so `lib/focus.ts` freezes
 * movement while it is open, and the character cannot walk out of a
 * conversation the way BUG-10 walked them out of the shop.
 *
 * **No lines live here** (§4.4). The panel is handed an NPC id and a state and
 * renders whatever `config/dialogue.ts` says; T-33.03 adds two more characters
 * without touching this file.
 */

/* ------------------------------------------------------------------ *
 * The pure part: where a conversation is, and what pressing the key does
 * ------------------------------------------------------------------ */

/** A position in a line tree: which node, and how far through its lines. */
export interface DialogueCursor {
  readonly nodeId: string;
  readonly line: number;
}

/** What the box is showing right now. */
export interface DialogueFrame {
  readonly speaker: string;
  readonly text: string;
  /** Whether one more press continues, or closes. */
  readonly more: boolean;
}

/**
 * Where the conversation starts, or `null` if this NPC cannot answer.
 *
 * `null` rather than a thrown error or an empty box: the caller's honest
 * response to "this character has nothing to say" is to do the other thing it
 * was going to do anyway — for the merchant, open the shop.
 */
export function openCursor(npc: NpcDialogue, state: string): DialogueCursor | null {
  const node = entryNode(npc, state);
  return node ? { nodeId: node.id, line: 0 } : null;
}

/**
 * One press of the action key.
 *
 * Returns the next cursor, or `null` when the conversation is over.
 *
 * **Lines first, then `next`.** A node is a beat and a line is a press, so the
 * key walks the lines of a node before it follows the arrow out of it. Doing it
 * the other way round — advance the node, show its first line — silently drops
 * the last line of every node, which is the kind of bug that reads as a writing
 * mistake rather than a code one.
 */
export function advance(npc: NpcDialogue, cursor: DialogueCursor): DialogueCursor | null {
  const node = nodeById(npc, cursor.nodeId);
  if (!node) return null;

  if (cursor.line + 1 < node.lines.length) {
    return { nodeId: node.id, line: cursor.line + 1 };
  }
  if (node.next === undefined) return null;
  // A `next` naming a node that does not exist ends the conversation rather
  // than freezing it. `dialogue.test.ts` fails the table long before a player
  // sees this, but "ends early" beats "cannot be closed" as a failure mode.
  return nodeById(npc, node.next) ? { nodeId: node.next, line: 0 } : null;
}

/** What to draw for a cursor, or `null` if it points at nothing. */
export function frameAt(npc: NpcDialogue, cursor: DialogueCursor): DialogueFrame | null {
  const node: DialogueNode | undefined = nodeById(npc, cursor.nodeId);
  const text = node?.lines[cursor.line];
  if (!node || text === undefined) return null;

  return {
    speaker: npc.name,
    text,
    more: advance(npc, cursor) !== null,
  };
}

/* ------------------------------------------------------------------ *
 * Whether these two have met
 * ------------------------------------------------------------------ */

/**
 * **A cosmetic flag, so it lives in the browser** (§4.1).
 *
 * An introduction that plays once is flavour, not progress: a player who clears
 * their storage hears it twice and gains nothing, which is the test for whether
 * something may be client-side at all. Putting it on the server would mean a
 * column, a migration and an endpoint for a line of dialogue.
 *
 * Per-NPC keys rather than one set, so T-33.03's Chef needed no migration of a
 * stored list and the next villager will need none either — the same reason the
 * milestone board stores one key rather than a blob.
 */
const MET_KEY_PREFIX = 'tillhaven.met.';

export function hasMet(npc: NpcId): boolean {
  try {
    return globalThis.localStorage?.getItem(`${MET_KEY_PREFIX}${npc}`) === 'yes';
  } catch {
    /*
     * Private-mode Safari throws on `localStorage`. "We have met" is the safe
     * answer: the cost of getting it wrong this way is a returning player
     * missing an introduction they have already had, and the other way is being
     * introduced to the same villager every single visit.
     */
    return true;
  }
}

export function rememberMet(npc: NpcId): void {
  try {
    globalThis.localStorage?.setItem(`${MET_KEY_PREFIX}${npc}`, 'yes');
  } catch {
    // See `hasMet`. The introduction still plays for this session.
  }
}

/* ------------------------------------------------------------------ *
 * The DOM part
 * ------------------------------------------------------------------ */

export class DialoguePanel {
  private root!: HTMLElement;
  private speakerEl!: HTMLElement;
  private textEl!: HTMLElement;
  private hintEl!: HTMLElement;

  private npc: NpcDialogue | null = null;
  private cursor: DialogueCursor | null = null;
  private onClosed: (() => void) | null = null;
  /** What had focus before the box opened, so Escape puts it back. */
  private returnFocus: HTMLElement | null = null;

  get isOpen(): boolean {
    return this.cursor !== null;
  }

  mount(): HTMLElement {
    this.root = document.createElement('section');
    this.root.className = 'dialogue';
    // A dialog the player is READING — the case `lib/focus.ts` describes as
    // taking input. Movement freezes until it closes.
    this.root.setAttribute(MODAL_ATTR, '');
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', 'Conversation');
    /*
     * Focusable, so the box itself can hold focus while it is open. Without
     * this the action key still works — the listener is on the document — but a
     * screen reader has nothing to announce and the tab ring is left wherever
     * the player last clicked, which after a walk is nowhere.
     */
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <p class="dialogue__speaker" data-speaker></p>
      <p class="dialogue__text" data-text></p>
      <p class="dialogue__hint" data-hint></p>
    `;

    this.speakerEl = this.root.querySelector('[data-speaker]')!;
    this.textEl = this.root.querySelector('[data-text]')!;
    this.hintEl = this.root.querySelector('[data-hint]')!;

    // Clicking the box advances it, for the same reason the action key does:
    // the box is the button. A separate "next" control would be a second thing
    // to aim at for an interaction that has exactly one outcome.
    this.root.addEventListener('click', () => this.step());

    document.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;

      if (event.key === 'Escape') {
        /*
         * Consume it (T-18.13, BUG-11). Phaser listens on `window` and this
         * listens on `document`, the last hop before it, so stopping here is
         * what keeps one Escape to one layer — otherwise skipping a line at the
         * merchant also walks the player out of the house.
         */
        event.stopPropagation();
        this.close();
        return;
      }

      if (event.key === 'e' || event.key === 'E' || event.key === ' ') {
        // Space scrolls the page by default, and a dialogue box that jumps the
        // viewport on every line is a dialogue box nobody finishes.
        event.preventDefault();
        event.stopPropagation();
        this.step();
      }
    });

    return this.root;
  }

  /**
   * Start a conversation, or decline to.
   *
   * Returns `false` when this NPC has nothing to say for this state, so the
   * caller can fall through to whatever it was going to do — which is how the
   * merchant still opens their shop if their lines are ever removed.
   *
   * `onClosed` fires exactly once, on the last press or on Escape, and is what
   * T-33.02 hangs the shop off.
   */
  show(id: NpcId, state: string, onClosed?: () => void): boolean {
    const npc = npcDialogue(id);
    if (!npc) return false;
    const cursor = openCursor(npc, state);
    if (!cursor) return false;

    this.npc = npc;
    this.cursor = cursor;
    this.onClosed = onClosed ?? null;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    this.root.hidden = false;
    this.render();
    this.root.focus();
    return true;
  }

  /** One press. Advances, or closes if this was the last line. */
  step(): void {
    if (!this.npc || !this.cursor) return;
    const next = advance(this.npc, this.cursor);
    if (!next) {
      this.close();
      return;
    }
    this.cursor = next;
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.cursor = null;
    this.npc = null;
    this.root.hidden = true;

    /*
     * Focus goes back where it came from BEFORE the callback runs, because the
     * callback opens the shop and the shop moves focus itself. Restoring
     * afterwards would yank focus back out of the panel it just opened.
     */
    this.returnFocus?.focus();
    this.returnFocus = null;

    const done = this.onClosed;
    this.onClosed = null;
    done?.();
  }

  private render(): void {
    if (!this.npc || !this.cursor) return;
    const frame = frameAt(this.npc, this.cursor);
    if (!frame) {
      this.close();
      return;
    }

    this.speakerEl.textContent = frame.speaker;
    this.textEl.textContent = frame.text;
    this.hintEl.textContent = frame.more ? 'E to continue' : 'E to finish';
  }
}
