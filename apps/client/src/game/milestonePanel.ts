import { ITEMS } from '@tillhaven/shared/config';
import { isModalOpen } from '../lib/focus.js';
import { NO_REQUESTS, questRows, type QuestRow } from './questPanel.js';
import { acceptQuest, fetchQuests, turnInQuest, type QuestView, type TurnInResult } from '../net/quests.js';
import { messageFor } from '../net/errors.js';
import {
  claimMilestone,
  fetchProgression,
  nextGoals,
  type ClaimResult,
  type MilestoneRewardView,
  type MilestoneView,
} from '../net/progression.js';

/**
 * The goal board (T-30.09, CLAUDE.md §5.8).
 *
 * `docs/qa-audit-2026-09-03.md` F-1 found a **42-minute hole at 0:03**: six
 * plots planted in three minutes and then nothing to do. The server has had an
 * answer to that since T-30.06 — ten named goals, derived on read — and until
 * now there was nowhere to look at it. This is the place.
 *
 * **A popover, not a modal.** It deliberately does NOT carry `MODAL_ATTR`: the
 * whole point is reading "till all six of your starting plots" *while walking
 * to the sixth plot*, and a board that froze the character would break the
 * feature it exists for. `lib/focus.ts` states the rule it is following — "a
 * dialog you are reading takes input, not any floating element" — and the decor
 * tray is the existing precedent.
 *
 * **Nothing here decides anything** (§4.1). `earned` is the server's arithmetic
 * over counters it holds, `claimed` is a unique index, and the reward is read
 * from shared config on both sides. The panel formats and asks.
 */

/* ------------------------------------------------------------------ *
 * The pure part: what a row says
 * ------------------------------------------------------------------ */

/** One goal, in the strings and numbers a row is built out of. */
export interface GoalRow {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  /** `3 / 6`, or the claim prompt once it is earned. */
  readonly progressText: string;
  /** 0–100, for the bar. Integer, like `levelBarPercent`. */
  readonly percent: number;
  readonly claimable: boolean;
  readonly rewardText: string;
}

/**
 * How full the bar is.
 *
 * Clamped at both ends and rounded to an integer for the same reason
 * `levelBarPercent` is: it is written straight into a `width: n%` and an
 * `aria-valuenow`, and a fraction in either is noise. `target` of zero cannot
 * occur in the shipped table, but a divide-by-zero rendering `NaN%` across the
 * whole board is a bad way to find out a future milestone got it wrong.
 */
export function goalPercent(view: MilestoneView): number {
  if (view.earned) return 100;
  if (view.target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((view.progress / view.target) * 100)));
}

/**
 * The counter under the title.
 *
 * An earned goal stops counting and starts asking: `6 / 6` beside a live Claim
 * button says the same thing twice, and the useful half is the button.
 */
export function progressLabel(view: MilestoneView): string {
  if (view.earned) return 'Done — claim your reward';
  return `${view.progress.toLocaleString()} / ${view.target.toLocaleString()}`;
}

/**
 * What the goal pays, named rather than counted.
 *
 * Item names come from shared config so the board and the bag cannot disagree
 * about what a thing is called (§4.4) — the same reason `floatTextFor` reads
 * `ITEMS`. A reward with neither gold nor items is not in the shipped table and
 * would be a config mistake, so it says so plainly instead of rendering an
 * empty line.
 */
export function rewardLabel(reward: MilestoneRewardView): string {
  const parts: string[] = [];
  if (reward.gold > 0) parts.push(`${reward.gold.toLocaleString()}g`);
  for (const stack of reward.items) {
    parts.push(`${stack.quantity} × ${itemName(stack.itemId)}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Nothing';
}

function itemName(itemId: string): string {
  return ITEMS[itemId]?.name ?? itemId.replace(/_/g, ' ');
}

/**
 * The rows to draw, from the whole board.
 *
 * `nextGoals` (T-30.08) does the choosing — claimable first, then unearned, and
 * claimed ones dropped entirely. This only formats what it picked, which keeps
 * "which goals matter" in one place rather than one place per surface: Phase
 * 33's quest log will call the same pair.
 */
export function goalRows(milestones: readonly MilestoneView[], count = 3): GoalRow[] {
  return nextGoals(milestones, count).map((view) => ({
    id: view.id,
    title: view.title,
    hint: view.hint,
    progressText: progressLabel(view),
    percent: goalPercent(view),
    /*
     * The SECOND of two guards, and it does not fail a break-test on its own:
     * `nextGoals` has already dropped every claimed goal, so nothing reaching
     * here can be both. It stays because the two cover each other — a future
     * surface that renders the whole board (Phase 33's quest log is the
     * candidate) would go through this function without going through that
     * filter, and a Claim button on an already-claimed goal is a button that
     * only ever answers `MILESTONE_ALREADY_CLAIMED`.
     */
    claimable: view.earned && !view.claimed,
    rewardText: rewardLabel(view.reward),
  }));
}

/**
 * What the board says when there are no rows left.
 *
 * Reachable — ten milestones is a finite list — and a blank panel would read as
 * a failed fetch rather than as an achievement.
 */
export const ALL_DONE = 'Every goal claimed. More are coming.';

/* ------------------------------------------------------------------ *
 * The lists this panel holds
 * ------------------------------------------------------------------ */

/**
 * The board is a list of LISTS, and that is the whole of "shape it for two
 * lists now" (T-30.09).
 *
 * Phase 33's quest log lands in this same panel. Declaring the sections rather
 * than hardcoding one heading means it arrives as an entry here plus a source
 * for its rows — not as a second panel with its own open state, its own Escape
 * handler and its own place on screen for the player to learn.
 */
export interface BoardSection {
  readonly key: string;
  readonly title: string;
  readonly empty: string;
}

export const BOARD_SECTIONS: readonly BoardSection[] = [
  { key: 'goals', title: 'Goals', empty: ALL_DONE },
  // Phase 33's quest log, arriving exactly as this list was shaped for it
  // (T-33.07): an entry here plus a source for its rows.
  { key: 'requests', title: 'Requests', empty: NO_REQUESTS },
];

/* ------------------------------------------------------------------ *
 * Whether it starts open
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'tillhaven.goals';

/**
 * The board is **open by default**, and that is the task's requirement rather
 * than a preference: T-30.09 asks for a panel "open and useful from minute
 * zero", because the player it is for is the one who has just planted six plots
 * and does not know there is anything else. A board behind a button they have
 * no reason to press is a board that does not fix F-1.
 *
 * Closing it is remembered, so it nags exactly once. In `localStorage` rather
 * than on the player row for the same reason mute is (`sound.ts`): it decides
 * nothing about the farm (§4.1), and it is a property of the device — someone
 * who knows the game on their laptop is still new to it on their phone.
 *
 * Pure over the stored string so the default, the remembered-closed case and a
 * junk value are all assertable without a browser.
 */
export function boardStartsOpen(stored: string | null): boolean {
  return stored !== 'closed';
}

/**
 * The width below which the board does not open ITSELF.
 *
 * The same 700px the stylesheet narrows it at — one number, so "the board is
 * cramped here" and "the board should not barge in here" cannot drift apart.
 */
export const BOARD_AUTO_OPEN_MIN_WIDTH = 700;

/**
 * Whether to open the board unasked.
 *
 * Screenshotted at 390x844 and the reason this gate exists: the board fits
 * without overflow, and it still covers most of the farm, because most of the
 * farm is not very much at that size. "Open from minute zero" is about a new
 * player's attention, not about their screen — so on a phone the Goals button
 * in the bar is the invitation, and on anything wider the board is.
 *
 * A remembered *open* still opens at any width: that is the player asking.
 */
export function boardAutoOpens(stored: string | null, viewportWidth: number): boolean {
  if (stored === 'open') return true;
  if (stored === 'closed') return false;
  return viewportWidth >= BOARD_AUTO_OPEN_MIN_WIDTH;
}

export function readBoardOpen(): boolean {
  try {
    return boardAutoOpens(
      globalThis.localStorage?.getItem(STORAGE_KEY) ?? null,
      globalThis.innerWidth ?? BOARD_AUTO_OPEN_MIN_WIDTH,
    );
  } catch {
    // Private-mode Safari throws on `localStorage`. Open is the safe answer:
    // it is the default, and the player can close it again.
    return true;
  }
}

export function rememberBoardOpen(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, open ? 'open' : 'closed');
  } catch {
    // See `readBoardOpen`. The choice still holds for this session.
  }
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

export interface MilestoneHost {
  toast(message: string, kind?: 'info' | 'error'): void;
  /** A claim landed. The HUD re-syncs gold, the bag and the level bar. */
  onClaimed(result: ClaimResult): void;
  /**
   * A request was handed in (T-33.07). Separate from `onClaimed` because the
   * two carry different ids, and the HUD logs which one paid — but it does the
   * same three things with the result, which is why they are two lines in the
   * host rather than two panels.
   */
  onTurnedIn(result: TurnInResult): void;
  /** How many of an item the bag holds, for the progress a request shows. */
  heldOf(itemId: string): number;
  /**
   * Announced rather than inferred, because the board closes four ways — the
   * bar button, its own ×, Escape, and walking into the house — and a button
   * that tracked only the first would soon be lying about what is on screen.
   * The same reason `IdleHost` has one.
   *
   * `remember` separates "the player closed the board" from "the board got out
   * of the way": only the first should be persisted, or a board that stayed
   * shut forever because someone once opened their front door would be the
   * panel quietly deciding it was not wanted. `aria-expanded` follows every
   * change regardless, which is why this is one call and not two.
   */
  onOpenChange(open: boolean, remember: boolean): void;
}

export class MilestonePanel {
  private root!: HTMLElement;
  private host!: MilestoneHost;
  private readonly lists = new Map<string, HTMLElement>();
  private readonly sections = new Map<string, HTMLElement>();

  private milestones: readonly MilestoneView[] = [];
  private quests: readonly QuestView[] = [];
  /** Which tab is showing. Client-side state; nothing depends on it. */
  private section = BOARD_SECTIONS[0]!.key;
  private open = false;
  /** A claim is out; a second click must not claim the same goal twice. */
  private inFlight = false;
  /** Whether a board has ever been fetched, so "empty" is not shown before one. */
  private loaded = false;

  mount(host: MilestoneHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('aside');
    this.root.className = 'board';
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Goals');
    this.root.innerHTML = `
      <header class="board__head">
        <div class="board__tabs" role="tablist" aria-label="Board"></div>
        <button class="board__close" type="button" data-close aria-label="Close board">×</button>
      </header>
    `;

    /*
     * **Tabs, not two stacked lists** (T-33.07). The board is a narrow left-hand
     * column and has to fit 390x844 with the hotbar below it; two lists of three
     * rows each would push the second off the bottom on a phone, where it would
     * be a section nobody scrolls to. One list at a time, and the tab strip is
     * what says the other exists.
     *
     * Built from `BOARD_SECTIONS` rather than written out, which is the point of
     * that declaration: a third list is an entry there and nothing here.
     */
    const tabs = this.root.querySelector('.board__tabs')!;

    for (const section of BOARD_SECTIONS) {
      const tab = document.createElement('button');
      tab.className = 'board__tab';
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.dataset['section'] = section.key;
      tab.textContent = section.title;
      tab.addEventListener('click', () => this.setSection(section.key));
      tabs.append(tab);

      const el = document.createElement('section');
      el.className = 'board__section';
      el.setAttribute('aria-label', section.title);

      const list = document.createElement('div');
      list.className = 'board__list';
      el.append(list);

      this.lists.set(section.key, list);
      this.sections.set(section.key, el);
      this.root.append(el);
    }

    this.applySection();

    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());

    /*
     * **A modal's Escape is not the board's** (T-18.13's rule, applied the
     * other way round).
     *
     * Found in the browser and it took two attempts, which is the interesting
     * part. Opening the bag over the board and pressing Escape closed BOTH —
     * and because the board persists "closed", one press over the bag silenced
     * it for every future session. `stopPropagation` cannot fix it: every panel
     * listens on `document`, and stopping propagation does not stop other
     * listeners on the same node.
     *
     * Asking `isModalOpen()` inside the bubble handler does not fix it either,
     * and that was the failed first attempt: the bag's own handler has already
     * run and hidden the bag by then, so the board asks "is a modal open" a
     * microsecond after the modal stopped being open and gets a truthful "no".
     *
     * The answer has to be read BEFORE any panel reacts, which is what the
     * capture-phase listener is for — capture on `document` runs ahead of every
     * bubble listener on it. It records rather than acts, so no other panel's
     * handling changes.
     */
    let modalAtPress = false;
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape') modalAtPress = isModalOpen();
      },
      true,
    );

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open) return;
      if (modalAtPress) return;

      // The press is ours. Consumed so it does not also reach Phaser's plugin
      // on `window` and walk the player out of the house (T-18.13, BUG-11).
      event.stopPropagation();
      this.hide();
    });

    return this.root;
  }

  get isOpen(): boolean {
    return this.open;
  }

  async toggle(): Promise<void> {
    if (this.open) {
      this.hide();
      return;
    }
    await this.show();
  }

  /** `remember: false` for the automatic open at mount, which was not a choice. */
  async show(remember = true): Promise<void> {
    this.open = true;
    this.root.hidden = false;
    this.host.onOpenChange(true, remember);
    this.render();
    await this.refresh();
  }

  /**
   * Closes the board.
   *
   * `remember: false` is for a close the player did not ask for — walking into
   * the house, where the left-hand column belongs to the house controls. See
   * `MilestoneHost.onOpenChange` for why that distinction is persisted state
   * rather than a detail.
   */
  hide(remember = true): void {
    if (!this.open) return;
    this.open = false;
    this.root.hidden = true;
    this.host.onOpenChange(false, remember);
  }

  /**
   * Re-reads the board.
   *
   * A pure read server-side — nothing settles on the way past, unlike the
   * shipping box's `GET` — so this is safe to call after any action that could
   * have moved a counter, and the scene does exactly that.
   */
  async refresh(): Promise<void> {
    try {
      /*
       * Both lists in one round trip's worth of latency. `Promise.all` rather
       * than awaiting in turn: they are independent reads and the panel cannot
       * usefully render half of itself.
       */
      const [{ milestones }, quests] = await Promise.all([fetchProgression(), fetchQuests()]);
      this.milestones = milestones;
      this.quests = quests;
      this.loaded = true;
      if (this.open) this.render();
    } catch (err) {
      // Silent unless the player is looking at it: the board refreshes on every
      // state change, and a closed panel failing to fetch is not news.
      if (this.open) this.host.toast(messageFor(err), 'error');
    }
  }

  /** Switches tab. Pure client state — nothing is fetched and nothing is sent. */
  private setSection(key: string): void {
    if (!this.lists.has(key)) return;
    this.section = key;
    this.applySection();
  }

  private applySection(): void {
    for (const [key, el] of this.sections) el.hidden = key !== this.section;
    for (const tab of this.root.querySelectorAll<HTMLButtonElement>('.board__tab')) {
      const active = tab.dataset['section'] === this.section;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    }
  }

  /**
   * Re-draws from what is already cached, fetching nothing.
   *
   * **The request rows are the only part of this panel that depends on the
   * BAG**, and the bag changes without the board being re-read: harvest a leek
   * and the row that wants four of them is stale until the next farm poll. The
   * HUD calls this from `setSlots` for the same reason it already calls
   * `shop.refresh()` there — one funnel, so a panel showing inventory cannot
   * disagree with the inventory.
   *
   * Found in the browser (T-33.07): four leeks in the bag and the accepted
   * request still offered no Hand in button, because nothing had told the board
   * the bag had changed.
   */
  redraw(): void {
    if (this.open) this.render();
  }

  private render(): void {
    for (const section of BOARD_SECTIONS) {
      const list = this.lists.get(section.key);
      if (!list) continue;

      if (!this.loaded) {
        list.replaceChildren(note('Reading the board…'));
        continue;
      }

      if (section.key === 'requests') {
        const rows = questRows(this.quests, (id) => this.host.heldOf(id));
        list.replaceChildren(
          ...(rows.length > 0 ? rows.map((row) => this.questRowEl(row)) : [note(section.empty)]),
        );
        continue;
      }

      const rows = goalRows(this.milestones);
      list.replaceChildren(
        ...(rows.length > 0 ? rows.map((row) => this.rowEl(row)) : [note(section.empty)]),
      );
    }
  }

  /**
   * One request.
   *
   * Deliberately the same `goalrow` skeleton as a milestone — title, hint, bar,
   * meta, button — because they are two lists in one panel and a player should
   * not have to learn two row shapes. What differs is what the button DOES, and
   * the rotating marker.
   */
  private questRowEl(row: QuestRow): HTMLElement {
    const el = document.createElement('article');
    el.className = row.turnInReady ? 'goalrow is-claimable' : 'goalrow';

    const title = document.createElement('h3');
    title.className = 'goalrow__title';
    title.textContent = row.title;
    if (row.rotating) {
      const mark = document.createElement('span');
      mark.className = 'goalrow__tag';
      mark.textContent = 'today';
      // Said in words too — a coloured tag is not information to a screen reader.
      mark.setAttribute('aria-label', 'expires when the board turns over');
      title.append(' ', mark);
    }

    const hint = document.createElement('p');
    hint.className = 'goalrow__hint';
    hint.textContent = row.summary;

    const bar = document.createElement('div');
    bar.className = 'goalrow__bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(row.percent));
    bar.setAttribute('aria-label', `${row.title}: ${row.needs.join(', ')}`);

    const fill = document.createElement('i');
    fill.className = 'goalrow__fill';
    fill.style.width = `${row.percent}%`;
    bar.append(fill);

    const meta = document.createElement('p');
    meta.className = 'goalrow__meta';
    meta.textContent = `${row.needs.join(' · ')} · pays ${row.rewardText}`;

    el.append(title, hint, bar, meta);

    if (row.acceptable || row.turnInReady) {
      const button = document.createElement('button');
      button.className = 'goalrow__claim';
      button.type = 'button';
      button.textContent = row.acceptable ? 'Accept' : 'Hand in';
      button.setAttribute('aria-label', `${button.textContent} ${row.title}`);
      button.addEventListener('click', () =>
        void (row.acceptable ? this.accept(row.id, button) : this.turnIn(row.id, button)),
      );
      el.append(button);
    }

    return el;
  }

  private async accept(questId: string, button: HTMLButtonElement): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    button.disabled = true;
    try {
      await acceptQuest(questId);
      await this.refresh();
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
      button.disabled = false;
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Hands a request in.
   *
   * The same shape as `claim`: the flag stops a second request being handed in
   * while this one is out, and the disabled attribute is what the player can
   * see. The server refuses a double turn-in regardless — the conditional
   * update, not this — so both are courtesy (§4.1).
   */
  private async turnIn(questId: string, button: HTMLButtonElement): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    button.disabled = true;
    try {
      const result = await turnInQuest(questId);
      this.host.onTurnedIn(result);
      await this.refresh();
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
      button.disabled = false;
    } finally {
      this.inFlight = false;
    }
  }

  private rowEl(row: GoalRow): HTMLElement {
    const el = document.createElement('article');
    el.className = row.claimable ? 'goalrow is-claimable' : 'goalrow';

    const title = document.createElement('h3');
    title.className = 'goalrow__title';
    title.textContent = row.title;

    const hint = document.createElement('p');
    hint.className = 'goalrow__hint';
    hint.textContent = row.hint;

    /*
     * A progressbar rather than a bare counter, for the reason the level bar is
     * one (T-30.02): "2 / 6" alone cannot say whether the goal is a minute away
     * or an evening away, and the bar is the half a glance can read.
     */
    const bar = document.createElement('div');
    bar.className = 'goalrow__bar';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(row.percent));
    bar.setAttribute('aria-label', `${row.title}: ${row.progressText}`);

    const fill = document.createElement('i');
    fill.className = 'goalrow__fill';
    fill.style.width = `${row.percent}%`;
    bar.append(fill);

    const meta = document.createElement('p');
    meta.className = 'goalrow__meta';
    meta.textContent = `${row.progressText} · pays ${row.rewardText}`;

    el.append(title, hint, bar, meta);

    if (row.claimable) {
      const claim = document.createElement('button');
      claim.className = 'goalrow__claim';
      claim.type = 'button';
      claim.textContent = 'Claim';
      claim.setAttribute('aria-label', `Claim ${row.title}`);
      claim.addEventListener('click', () => void this.claim(row.id, claim));
      el.append(claim);
    }

    return el;
  }

  /**
   * Claims one goal.
   *
   * The button is disabled for the round trip as well as the `inFlight` guard:
   * the flag stops a second *goal* being claimed while this one is out, and the
   * disabled attribute is what the player can see. The server refuses a double
   * claim regardless — the unique index, not this — so both are courtesy (§4.1).
   */
  private async claim(milestoneId: string, button: HTMLButtonElement): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    button.disabled = true;

    try {
      const result = await claimMilestone(milestoneId);
      this.host.onClaimed(result);
    } catch (err) {
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
      // Re-read either way. A refusal usually means the board moved under the
      // player — claimed in another tab, or not earned after all — and the
      // fresh board is the explanation.
      await this.refresh();
    }
  }
}

function note(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'board__empty';
  el.textContent = text;
  return el;
}
