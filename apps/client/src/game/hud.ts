import {
  ITEMS,
  SHEETS,
  ICON_SHEETS,
  UI_COIN,
  UI_HUD,
  UI_ICON,
  UI_MONEY,
  levelProgress,
  type AnimalBuilding,
  type LevelProgress,
} from '@tillhaven/shared/config';
import type { IdleView, PlotView, SelfPlayer, TradeEligibility } from '@tillhaven/shared/types';
import type { EnergyState } from '@tillhaven/shared/config';
import type { Appearance } from '@tillhaven/shared/schemas';
import type { CatalogueEntry, OwnedFurniture } from '../net/house.js';
import { sprite } from '../lib/sprite.js';
import { isTypingInDom } from '../lib/focus.js';
import { messageFor } from '../net/errors.js';
import { ApiRequestError } from '../net/api.js';
import { collectAllAnimals } from '../net/animals.js';
import { levelBarAriaLabel, levelBarLabel, levelBarPercent } from './levelBar.js';
import { STEP_TEXT, nextStep } from './onboarding.js';
import { restedAt, sleepLabel } from './sleepBanner.js';
import {
  CLOCK_HAND_FRAMES,
  DAY_LENGTH_MS,
  clockHandFrame,
  dialogueStateFor,
  timeOfDayAt,
  type NpcId,
} from '@tillhaven/shared/config';
import { isMuted, play as playCue, setMuted } from './sound.js';
import { startVipCheckout, vipReturnFrom } from '../net/vip.js';
import { getDecor } from '@tillhaven/shared/config';
import { harvestAll, logout, wake as wakeApi } from '../net/farm.js';
import type { InventorySlot } from '../net/inventory.js';
import { TradePanel } from './tradePanel.js';
import { ShopPanel } from './shopPanel.js';
import { InventoryPanel } from './inventoryPanel.js';
import { ShippingPanel } from './shippingPanel.js';
import { CharacterCreator } from './characterCreator.js';
import { IdlePanel } from './idlePanel.js';
import { MilestonePanel, readBoardOpen, rememberBoardOpen } from './milestonePanel.js';
import { DialoguePanel, hasMet, rememberMet } from './dialoguePanel.js';
import type { MilestoneRewardView } from '../net/progression.js';
import { Hotbar, type Equipped } from './hotbar.js';
import { mountTooltip } from './tooltip.js';

/**
 * The HUD: gold, hotbar, inventory, toasts.
 *
 * Rendered as DOM **over** the canvas rather than inside it (CLAUDE.md §2).
 * Panels made of real elements get text selection, keyboard focus and screen
 * reader support for free — none of which Phaser gives you.
 */

/** Integer upscale of the 16px HUD art. Fractional scaling turns it to mush. */
const HUD_ICON_SCALE = 2;

class Hud {
  private root!: HTMLElement;
  private goldEl!: HTMLElement;
  private thirstyEl!: HTMLElement;
  private xpEl!: HTMLElement;
  private levelEl!: HTMLElement;
  private xpFillEl!: HTMLElement;
  private coachEl!: HTMLElement;
  private vipBtn!: HTMLElement;
  private nameEl!: HTMLElement;
  private idleBtn!: HTMLElement;
  private toastsEl!: HTMLElement;
  private mounted = false;
  /** The decor piece armed for placement, or null (T-15.24). */
  private armed: string | null = null;
  /** The house piece armed for placement, if any (T-16.15). */
  private armedFurnitureId: string | null = null;
  /** Last catalogue+stock, so arming can re-render without a fetch. */
  private decorations: { catalogue: CatalogueEntry[]; owned: OwnedFurniture[] } | null = null;
  private decorOwned: readonly { readonly decorId: string; readonly quantity: number }[] = [];
  private decorTrayEl: HTMLElement | null = null;
  private onArmDecorListener?: (decorId: string | null) => void;
  private readonly shop = new ShopPanel();
  /** The trade post's panel (T-22.01). Reached from the mailbox, never a button. */
  private readonly trade = new TradePanel();
  /**
   * The server's last word on whether this player may trade (T-22.03).
   *
   * Null until the first poll. The panel asks for it when it renders rather
   * than being pushed, for the same reason `appearance` is a getter: the trade
   * post can be opened before or after any given poll.
   */
  private tradeEligibility: TradeEligibility | null = null;
  /**
   * One panel for both containers (T-10.04a). The Bag button opens the
   * backpack alone; the Chest button opens it with the chest half as well.
   */
  private readonly pack = new InventoryPanel();
  /** The shipping box. Opened at the box in the world, never from the bar. */
  private readonly shipping = new ShippingPanel();
  private readonly creator = new CharacterCreator();
  /** Idle mode's switch (T-13.06). Owns the standing orders and the banner. */
  private readonly idle = new IdlePanel();
  /** The goal board (T-30.09). The one panel that opens itself. */
  private readonly goals = new MilestonePanel();
  private readonly dialogue = new DialoguePanel();
  private goalsBtn!: HTMLButtonElement;
  private rewardListener: ((reward: MilestoneRewardView) => void) | null = null;
  /** The sleep banner's ticking timer, or null when awake (MVP re-scope). */
  private sleepTimer: number | null = null;
  private sleeping = false;
  private sleepListener: ((sleeping: boolean) => void) | null = null;
  private sleepBanner!: HTMLElement;
  private sleepText!: HTMLElement;
  private energyEl!: HTMLElement;
  private energyFillEl!: HTMLElement;
  private energyNumEl!: HTMLElement;
  private clockEl!: HTMLElement;
  private clockHandEl!: HTMLElement;
  private clockTextEl!: HTMLElement;
  private clockTimer: number | null = null;
  private readonly hotbar = new Hotbar();
  /** The server's last word on this player's appearance. Cosmetic only (§5.1). */
  private appearance: Appearance | null = null;
  private onAppearanceListener: ((appearance: Appearance) => void) | null = null;
  /** Last known gold and bag contents, used only to clamp the shop's inputs. */
  private gold = 0;
  /**
   * Last rendered farm level, and whether one has ever been rendered
   * (T-30.05). Display state only — the level itself is derived server-side
   * and stored nowhere, here included.
   */
  private level = 1;
  private levelSeen = false;
  private levelUpListener: ((level: number) => void) | null = null;
  private slots: InventorySlot[] = [];
  /** The backpack's size and next price, from the server. For the shop's row. */
  private bag: { capacity: number; nextCost: number | null } = { capacity: 0, nextCost: null };
  /**
   * Coop and barn tiers, as last reported by farm state (T-12.02).
   *
   * Held here rather than fetched, because the shop needs them and the farm
   * poll already carries them — a second endpoint for two integers on the
   * hottest path would be a strange trade.
   */
  private buildings: Record<AnimalBuilding, number> = { coop: 0, barn: 0 };
  /** Livestock currently housed in each building. See `setBuildings`. */
  private herd: Record<AnimalBuilding, number> = { coop: 0, barn: 0 };
  private vip = false;
  /** A checkout request is out; a second click must not open a second session. */
  private vipInFlight = false;
  private gatherBtn!: HTMLButtonElement;
  /** A gather is out; a second click must not run a second pair of batches. */
  private gatherInFlight = false;
  /** Set by the Farm scene so a trade can trigger an authoritative re-sync. */
  private onStateChanged: (() => void) | null = null;
  /** Set by the Interior scene, so the HUD's Leave button can close it. */
  private onLeaveHouseListener: (() => void) | null = null;
  private onPlaceListener: ((furnitureId: string) => void) | null = null;
  private onBuyFurnitureListener: ((furnitureId: string) => void) | null = null;
  private onIdleChangedListener: ((view: IdleView) => void) | null = null;

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;

    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <!--
        The one line telling a new player what to do next (T-18.17, F-5).
        Above the hotbar rather than in the top bar, because every sentence it
        shows names a hotbar key and the two should be read together.
      -->
      <!--
        Tillhaven is keyboard-driven: WASD walks, E acts, the number keys pick a
        hotbar slot, and the ONLY pointer handler in the game buys a plot. On a
        touch device the character therefore cannot be moved at all (T-18.23,
        BUG-05, D-19).

        This states that FACT rather than declaring a device unsupported — the
        landing page invites playing at lunch, and whichever way D-19 lands, a
        player on a phone should be told why nothing responds instead of being
        left to conclude the game is broken. Shown by CSS alone, on coarse-
        pointer narrow viewports, so there is no detection code to be wrong and
        a tablet with a keyboard attached is not lectured at desktop widths.
      -->
      <p class="hud__needskeys" role="note">Tillhaven needs a keyboard — WASD to walk, E to act.</p>
      <p class="hud__coach" data-coach hidden role="status"></p>
      <!--
        The HUD is two corner clusters, not a bar (Phase U2).

        It was a full-width "header" holding a brand, five readouts and nine
        labelled buttons, and it ate the top 70px of the farm across the whole
        screen. The design reference has no bar at all: a compact status cluster
        in one corner, a short stack of icon buttons in the other, and the world
        everywhere else. That is the shape a farm game wants — the thing the
        player is looking at is the farm.

        Two consequences worth stating, because both were load-bearing before:

        - **The buttons lose their labels and gain "aria-label".** The text WAS
          the accessible name; an icon-only button with none is a button that
          does not exist to a screen reader. Each also keeps a "title", so a
          mouse user can discover what a glyph means.
        - **The wrap behaviour goes away with the bar.** T-18.23/BUG-05 made the
          bar wrap rather than overflow at 390px. A vertical rail cannot
          overflow horizontally, so the problem it solved no longer exists;
          what a narrow screen needs instead is for the rail to stay clear of
          the hotbar, which "hud.css" handles by shrinking the plate.
      -->
      <nav class="hud__rail" aria-label="Game menu">
        <button
          class="hud__btn hud__btn--icon"
          type="button"
          data-bag
          aria-label="Backpack"
          title="Backpack (I)"
        >
          <i class="hud__icon hud__icon--bag" aria-hidden="true"></i>
        </button>
        <!--
          The goal board (T-30.09). Next to the bag rather than down by Log out,
          because it is a thing the player consults constantly in the first
          session and never after — the same shelf as their inventory.
        -->
        <button
          class="hud__btn hud__btn--icon"
          type="button"
          data-goals
          aria-expanded="false"
          aria-label="Goals"
          title="Goals"
        >
          <i class="ui-icon" style="--icon-col: 22" aria-hidden="true"></i>
        </button>
        <button
          class="hud__btn hud__btn--icon"
          type="button"
          data-decor
          aria-expanded="false"
          aria-label="Decorate"
          title="Decorate"
        >
          <i class="ui-icon" style="--icon-col: 23" aria-hidden="true"></i>
        </button>
        <button
          class="hud__btn hud__btn--icon"
          type="button"
          data-idle
          aria-expanded="false"
          aria-label="Idle mode"
          title="Idle mode"
        >
          <i class="ui-icon" style="--icon-col: 1" aria-hidden="true"></i>
        </button>
        <!--
          The VIP bulk action (T-24.01/02). One button for both batches, because
          the benefit was always sold as ONE action — "clear every ripe plot and
          every ready animal with a single action" — and two buttons would be
          two things to press for one advertised convenience.

          The mirror of the VIP button below it: that one is hidden once the
          account HAS vip, this one is hidden until it does. Nothing here is a
          second farming path — it sends the same intents the character does,
          batched (§5.1, D-23).
        -->
        <button
          class="hud__btn hud__btn--icon hud__btn--vip"
          type="button"
          data-gather
          hidden
          aria-label="Gather all"
          title="Gather all"
        >
          <i class="ui-icon" style="--icon-col: 38" aria-hidden="true"></i>
        </button>
        <!--
          The VIP purchase (T-18.20, BUG-18). Its own control, NOT a tab in the
          shop: the shop trades game gold, this trades real money, and putting
          them side by side is precisely the blurring §7's RMT hygiene exists to
          avoid. Hidden entirely once VIP is active — there is nothing to sell.

          It keeps the pack's one COOL plate colour for the same reason it used
          to keep purple: on a rail of eight brown squares, the button that
          spends real money must not look like the seven that do not.
        -->
        <button
          class="hud__btn hud__btn--icon hud__btn--vip"
          type="button"
          data-vip
          hidden
          aria-label="VIP"
          title="VIP"
        >
          <i class="ui-icon" style="--icon-col: 19" aria-hidden="true"></i>
        </button>
        <button
          class="hud__btn hud__btn--icon"
          type="button"
          data-mute
          aria-pressed="false"
          aria-label="Sound"
          title="Sound"
        >
          <i class="ui-icon" data-muteicon style="--icon-col: 5" aria-hidden="true"></i>
        </button>
        <!--
          Credits (Phase U). An anchor, not a button: it is a page, and the art
          pack's licence makes the credit mandatory, so it needs to be reachable
          from inside the game and not only from the marketing footer. Opens in
          a new tab so it never costs a player their session.
        -->
        <a
          class="hud__btn hud__btn--icon hud__btn--quiet"
          href="/credits"
          target="_blank"
          rel="noopener"
          aria-label="Credits"
          title="Credits"
        >
          <i class="ui-icon" style="--icon-col: 20" aria-hidden="true"></i>
        </a>
        <button
          class="hud__btn hud__btn--icon hud__btn--quiet"
          type="button"
          data-logout
          aria-label="Log out"
          title="Log out"
        >
          <i class="ui-icon" style="--icon-col: 4" aria-hidden="true"></i>
        </button>
      </nav>
      <!--
        The status cluster: who you are, what you have, and how much you have
        left in you. Top-right, mirroring the rail, so neither is where the
        character walks.
      -->
      <header class="hud__status">
        <!--
          The day/night clock. Purely a readout: the cycle is cosmetic, so this
          tells the player why the field just darkened and nothing more.

          It leads the cluster because it is round, and the reference's cluster
          is anchored by exactly one round thing.
        -->
        <span class="hud__clock" data-clock title="Time of day">
          <i class="hud__clockhand" data-clockhand aria-hidden="true"></i>
          <span class="hud__sronly" data-clocktext>Morning</span>
        </span>
        <div class="hud__readouts">
          <span class="hud__name" data-name></span>
          <span class="hud__gold"
            ><i class="hud__coin" aria-hidden="true"></i><span data-gold>—</span></span
          >
          <!--
            The two meters: farm level and energy.

            They are the SAME markup in the same three columns — glyph, track,
            number — because they are the same kind of fact, and the cluster's
            job is to let both be read in one glance. They were not: the XP
            track started at x1318 and the energy track at x1249, so the two
            bars a player compares had no shared edge to compare against, and
            the level pip wore the pack's cyan plate while the energy fill beside
            it was the pack's cyan. The one thing the original comment here said
            must not happen - two meters you have to read twice to tell apart -
            was happening through the pip instead of the bar.

            Told apart by GLYPH now, not by colour: a star for the level, a
            heart for energy, from the icon vocabulary the rail already uses.
            Colour is the redundant channel rather than the only one, which is
            also what makes them distinguishable to a colour-blind player.

            Farm level itself is T-30.02: the server has derived it since T-2.09
            and nothing on the client read it, so a player could cross the
            level-5 trade gate without a number moving on screen. A progressbar
            rather than a bare label because the bar IS the information - "Lv 3"
            alone cannot say whether the next level is a harvest away or an
            evening away.

            (No backticks in these comments: they live inside a template literal.)
          -->
          <span
            class="hud__meter"
            data-xp
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="0"
            aria-label="Farm level progress"
          >
            <i class="ui-icon hud__meter-glyph" style="--icon-col: 19" aria-hidden="true"></i>
            <span class="hud__track"
              ><i class="hud__track-fill hud__track-fill--xp" data-xpfill aria-hidden="true"></i
            ></span>
            <span class="hud__meter-num" data-level>Lv 1</span>
          </span>
          <!--
            Energy (MVP re-scope).

            The number is written out rather than left to the bar. A fraction is
            the only thing that answers "can I till this?", which is a question
            with an exact arithmetic answer the player is entitled to - and the
            level row deliberately does NOT carry its fraction, because "Lv 3" is
            the answer to the question a player asks about levels. Same shape,
            different number, each the one that is actually useful.
          -->
          <span
            class="hud__meter"
            data-energy
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="100"
            aria-label="Energy"
          >
            <i class="ui-icon hud__meter-glyph" style="--icon-col: 20" aria-hidden="true"></i>
            <span class="hud__track"
              ><i
                class="hud__track-fill hud__track-fill--energy"
                data-energyfill
                aria-hidden="true"
              ></i
            ></span>
            <span class="hud__meter-num" data-energynum>40/40</span>
          </span>
        </div>
        <!--
          How many crops have stopped growing for want of water (T-18.16, F-2).
          Hidden at zero rather than showing "0 thirsty": a farm with nothing to
          do should say nothing, or the one number in the cluster that means "go
          and act" is on screen permanently and stops meaning it.
        -->
        <span class="hud__thirsty" data-thirsty hidden role="status"></span>
      </header>
      <!--
        Sleeping (MVP re-scope). The same shape as idle mode's banner and for
        the same reason: the character is doing something the player is not
        driving, so there has to be one always-visible control that gives it
        back. Getting up must never be more than one click away.
      -->
      <div class="hud__sleep" data-sleep hidden role="status">
        <span data-sleeptext>Sleeping…</span>
        <button class="hud__btn" type="button" data-wake>Get up</button>
      </div>
      <div class="hud__toasts" data-toasts role="status" aria-live="polite"></div>
    `;

    /*
     * The bar's art, from the manifest rather than retyped in the stylesheet
     * (§9) — same technique the hotbar and the inventory panel use. The coin is
     * a six-frame strip stepped by a CSS animation; the bag is one cell of the
     * icon grid.
     */
    const px = (n: number) => `${n * HUD_ICON_SCALE}px`;
    this.root.style.setProperty('--coin-sheet', `url("${UI_MONEY.path}")`);
    this.root.style.setProperty('--coin-size', px(UI_COIN.size));
    this.root.style.setProperty('--coin-strip', px(UI_COIN.size * UI_COIN.frames));
    this.root.style.setProperty('--coin-frames', String(UI_COIN.frames));
    this.root.style.setProperty('--coin-spin', `${UI_COIN.frames / UI_COIN.fps}s`);
    this.root.style.setProperty('--icon-sheet', `url("${UI_HUD.path}")`);
    this.root.style.setProperty('--icon-size', px(UI_ICON.size));
    this.root.style.setProperty('--icon-sheet-size', `${px(UI_HUD.width)} ${px(UI_HUD.height)}`);
    this.root.style.setProperty('--icon-bag', `-${px(UI_ICON.bag.x)} -${px(UI_ICON.bag.y)}`);

    document.body.appendChild(this.root);

    /*
     * One tooltip for every slot in the game (Phase U). Mounted on the HUD root
     * and delegated, so the backpack, the chest and the hotbar all get it — and
     * none of them has to rebind anything when its grid re-renders on a poll.
     */
    // The handle is deliberately not kept: the HUD has no teardown path and
    // lives as long as the page does, so a field holding it would be dead
    // weight. `Tooltip.destroy` exists for tests and for whoever adds one.
    mountTooltip(this.root);

    this.goldEl = this.root.querySelector('[data-gold]')!;
    this.thirstyEl = this.root.querySelector('[data-thirsty]')!;
    this.xpEl = this.root.querySelector('[data-xp]')!;
    this.levelEl = this.root.querySelector('[data-level]')!;
    this.xpFillEl = this.root.querySelector('[data-xpfill]')!;
    this.coachEl = this.root.querySelector('[data-coach]')!;
    this.vipBtn = this.root.querySelector('[data-vip]')!;
    this.vipBtn.addEventListener('click', () => void this.buyVip());

    this.gatherBtn = this.root.querySelector('[data-gather]')!;
    this.gatherBtn.addEventListener('click', () => void this.gatherAll());

    /*
     * Sound on/off (T-18.19). A device setting, not an account one — someone
     * playing on a laptop in an office and a phone at home wants different
     * answers, so it lives in `localStorage` and never reaches the server.
     */
    const muteBtn = this.root.querySelector<HTMLElement>('[data-mute]')!;
    const muteIcon = this.root.querySelector<HTMLElement>('[data-muteicon]')!;
    const paintMute = () => {
      const off = isMuted();
      /*
       * The icon column swaps, and the LABEL is what carries the state now
       * (Phase U2).
       *
       * This used to set `textContent`, which on an icon-only button would
       * delete the icon and print "Sound off" inside a 44px square. Columns 5
       * and 8 of `button.png`'s icon row are the speaker and the crossed-out
       * speaker — the pack drew both states, same as it did for the slots.
       */
      muteIcon.style.setProperty('--icon-col', off ? '8' : '5');
      muteBtn.setAttribute('aria-label', off ? 'Sound off' : 'Sound on');
      muteBtn.setAttribute('title', off ? 'Sound off' : 'Sound on');
      muteBtn.setAttribute('aria-pressed', String(off));
    };
    muteBtn.addEventListener('click', () => {
      setMuted(!isMuted());
      paintMute();
      // Play the confirmation AFTER unmuting, so the button demonstrates
      // itself. Muting is silent, which is the correct kind of obvious.
      if (!isMuted()) playCue('open');
    });
    paintMute();
    this.nameEl = this.root.querySelector('[data-name]')!;
    this.toastsEl = this.root.querySelector('[data-toasts]')!;
    this.energyEl = this.root.querySelector('[data-energy]')!;
    this.energyFillEl = this.root.querySelector('[data-energyfill]')!;
    this.energyNumEl = this.root.querySelector('[data-energynum]')!;
    this.clockEl = this.root.querySelector('[data-clock]')!;
    this.clockHandEl = this.root.querySelector('[data-clockhand]')!;
    this.clockTextEl = this.root.querySelector('[data-clocktext]')!;
    this.startClock();
    this.sleepBanner = this.root.querySelector('[data-sleep]')!;
    this.sleepText = this.root.querySelector('[data-sleeptext]')!;
    this.root.querySelector('[data-wake]')!.addEventListener('click', () => void this.wake());

    const decorBtn = this.root.querySelector('[data-decor]') as HTMLButtonElement;
    decorBtn.addEventListener('click', () => {
      const tray = this.decorTray();
      tray.hidden = !tray.hidden;
      // The two left-hand trays are mutually exclusive (see `toggleGoals`).
      // Not remembered: the player reached for the tray, not away from the
      // board, and the board should be there again next session.
      if (!tray.hidden) this.goals.hide(false);
      decorBtn.setAttribute('aria-expanded', String(!tray.hidden));
      // Closing the tray disarms: leaving a piece armed behind a hidden panel
      // is how a player ends up placing a fence they forgot they had selected.
      if (tray.hidden && this.armed) this.armDecor(null);
      else this.renderDecorTray();
    });

    this.root.querySelector('[data-logout]')!.addEventListener('click', () => {
      void logout().finally(() => window.location.assign('/'));
    });

    this.root.append(
      this.shop.mount({
        gold: () => this.gold,
        backpack: () => this.bag,
        buildingTier: (building) => this.buildings[building] ?? 0,
        herdOf: (building) => this.herd[building] ?? 0,
        isVip: () => this.vip,
        // The last level the bar rendered (T-31.06). Display only — the server
        // re-derives it from experience before it will sell a gated seed.
        farmLevel: () => this.level,
        heldOf: (itemId) =>
          this.slots
            .filter((s) => s.itemId === itemId)
            .reduce((sum, s) => sum + s.quantity, 0),
        onGold: (gold) => this.setGold(gold),
        // Restocking the tray is a farm-state change like any other: the scene
        // re-fetches decoration and calls `setDecorOwned` (T-15.23).
        onDecorBought: () => this.onStateChanged?.(),
        onTraded: (goldAfter) => {
          // The server's balance, not a locally computed one.
          this.setGold(goldAfter);
          playCue('buy');
          // Re-fetch bag and farm so everything agrees again.
          void this.refreshInventory().then(() => this.shop.refresh());
          this.onStateChanged?.();
        },
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );



    this.root.append(
      this.pack.mount({
        // The panel owns the fetch, so this is how the HUD's own copy — used
        // only to clamp the shop's sell quantities — stays in step.
        onSlotsChanged: (slots, bag) => {
          this.setSlots(slots);
          // Only a fetched view carries these; a move's response does not.
          if (bag) this.bag = { capacity: bag.capacity, nextCost: bag.nextCost };
        },
        onGoldChanged: (goldAfter) => {
          this.setGold(goldAfter);
          playCue('buy');
          this.onStateChanged?.();
        },
        gold: () => this.gold,
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );

    this.root.append(
      this.shipping.mount({
        // The bag it lists is the HUD's own copy, kept current by the panel
        // that owns the fetch — no third fetcher for the same rows.
        slots: () => this.slots,
        onChanged: () => {
          void this.refreshInventory();
          this.onStateChanged?.();
        },
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );

    this.root.append(
      this.idle.mount({
        toast: (message, kind) => this.toast(message, kind),
        onChanged: (view) => {
          this.paintIdleButton(view.enabled);
          // The scene locks or frees the character off this, and re-polls so
          // the field it now owns (or has given back) is up to date.
          this.onIdleChangedListener?.(view);
        },
        onOpenChange: (open) => this.idleBtn.setAttribute('aria-expanded', String(open)),
      }),
    );

    this.idleBtn = this.root.querySelector('[data-idle]')!;
    this.idleBtn.addEventListener('click', () => this.idle.toggle());

    this.root.append(
      this.goals.mount({
        toast: (message, kind) => this.toast(message, kind),
        /*
         * A claim mints gold and items inside one server transaction, and the
         * client computed none of it — so everything that could have changed is
         * re-read rather than patched. `setExperience` is the one exception and
         * is not a local tally: it re-derives the bar through the SAME shared
         * `levelProgress` from the total the response carried (T-30.02).
         */
        onClaimed: (result) => {
          this.setExperience(result.experience);
          playCue('buy');
          void this.refreshInventory();
          this.onStateChanged?.();
          // The float rises off the character, which is the only place a claim
          // has (T-30.04). The scene draws it; the HUD does not own a camera.
          this.rewardListener?.(result.reward);
        },
        /*
         * A handed-in request pays through the same `grantReward` a milestone
         * does, so the client does the same three things with the answer:
         * re-derive the bar from the total the response carried, re-read
         * everything the server may have changed, and float the reward off the
         * character (T-30.04).
         */
        onTurnedIn: (result) => {
          this.setExperience(result.experience);
          playCue('buy');
          void this.refreshInventory();
          this.onStateChanged?.();
          this.rewardListener?.(result.reward);
        },
        heldOf: (itemId) =>
          this.slots
            .filter((s) => s.itemId === itemId)
            .reduce((sum, s) => sum + s.quantity, 0),
        onOpenChange: (open, remember) => {
          this.goalsBtn.setAttribute('aria-expanded', String(open));
          if (remember) rememberBoardOpen(open);
        },
      }),
    );

    this.goalsBtn = this.root.querySelector('[data-goals]')!;
    this.goalsBtn.addEventListener('click', () => void this.toggleGoals());

    // No button and no key of its own: a conversation is started by walking up
    // to somebody, which is the whole point of putting them on the map.
    this.root.append(this.dialogue.mount());

    /*
     * G opens the board. The bag has I and Tab; this is the only other panel a
     * player consults mid-stride, and it gets the letter its own button says.
     * Guarded exactly like those two — a farm named "Grange" must not open a
     * panel on every G.
     */
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyG') return;
      if (isTypingInDom() || event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();
      void this.toggleGoals();
    });

    this.root.querySelector('[data-bag]')!.addEventListener('click', () => {
      void this.pack.toggle();
    });

    /*
     * I and Tab open the backpack, the two keys everyone tries. Tab has to be
     * prevented or the browser moves focus to the next control instead, and
     * both are ignored while something is being typed (§2, the same guard the
     * hotbar and the action key use).
     *
     * There is no key for the CHEST: it opens by standing at it (T-10.05).
     */
    document.addEventListener('keydown', (event) => {
      if (event.code !== 'KeyI' && event.code !== 'Tab') return;
      if (isTypingInDom() || event.ctrlKey || event.metaKey || event.altKey) return;

      event.preventDefault();
      void this.pack.toggle();
    });

    /*
     * The trade panel, mounted at last (T-22.01). It went unmounted for eleven
     * phases with the note that *"trading is a place-based interaction like
     * everything else now, and there is nowhere to do it yet"* — and that was
     * right. D-21 gave it the mailbox, which stands on the same frontage row as
     * the shop, the chest and the shipping box and was the only one of the four
     * that did not answer the action key.
     *
     * No button, deliberately. `Farm.facedTarget` resolves the mailbox and
     * `openTrade` below is what the action key calls, exactly like the shop.
     */
    this.root.append(
      this.trade.mount({
        // Deduplicated, because the offer builder picks an ITEM, not a slot: a
        // bag holding two half-stacks of leeks offers "leeks", once.
        bagItems: () => {
          const totals = new Map<string, number>();
          for (const slot of this.slots) {
            totals.set(slot.itemId, (totals.get(slot.itemId) ?? 0) + slot.quantity);
          }
          return [...totals].map(([itemId, quantity]) => ({ itemId, quantity }));
        },
        /*
         * A completed trade moves items and gold on BOTH sides, and the client
         * computed none of it. Re-fetch rather than patch: this is the one
         * moment the bag can change without this tab having asked for it.
         */
        onExecuted: () => {
          void this.refreshInventory();
          this.onStateChanged?.();
        },
        eligibility: () => this.tradeEligibility,
        toast: (message, kind) => this.toast(message, kind),
        icon: (itemId, scale) => iconFor(itemId, scale),
      }),
    );

    this.root.append(this.hotbar.mount({ icon: (itemId, scale) => iconFor(itemId, scale) }));

    // Last, so it paints over the bar and every panel: until there is a
    // character there is nothing else worth clicking.
    this.root.append(
      this.creator.mount({
        toast: (message, kind) => this.toast(message, kind),
        onSaved: (appearance) => this.setAppearance(appearance),
      }),
    );

    /*
     * The board opens itself (T-30.09) — the one panel in the game that does.
     *
     * The player it exists for is three minutes in with six plots planted and
     * nothing to do, and does not know there is a list of things to work
     * toward; a board behind a button they have no reason to press does not fix
     * F-1's 42-minute hole. Closing it is remembered per device
     * (`readBoardOpen`), so it asks once.
     *
     * Last in `mount`, after every panel exists, and not awaited: the fetch
     * behind it must not hold up the HUD appearing.
     */
    if (readBoardOpen()) void this.goals.show(false);

    // Dev-only handle, matching main.ts's `__game`. The creator normally shows
    // once per account ever, which makes it the one panel that is otherwise
    // impossible to look at twice; T-8.03 needs exactly this to re-render a
    // character against a changed appearance. Stripped from production builds.
    if (import.meta.env.DEV) {
      (window as unknown as { __hud: Hud }).__hud = this;
    }
  }

  /**
   * The bag, from whichever panel last fetched it.
   *
   * One funnel rather than three call sites: the HUD's own copy (which clamps
   * the shop's sell quantities) and the hotbar's view must be the same list,
   * and the two panels that fetch it should not each have to remember both.
   */
  private setSlots(slots: InventorySlot[]): void {
    this.slots = slots;
    this.hotbar.setSlots(slots);
    this.shop.refresh();
    // The quest log counts requirements against the bag (T-33.07), so it goes
    // stale the moment anything is picked up. A redraw, not a re-fetch: nothing
    // the SERVER knows has changed.
    this.goals.redraw();
  }

  /** What the character is holding. Client-side state; gates nothing (§5.1). */
  getEquipped(): Equipped | null {
    return this.hotbar.getEquipped();
  }

  onEquippedChange(listener: (equipped: Equipped | null) => void): void {
    this.hotbar.onEquippedChange(listener);
  }

  /** Dev-only re-entry into the character creator. See the `__hud` handle above. */
  openCharacterCreator(): void {
    this.creator.reopen(this.appearance);
  }

  /**
   * Tells the Farm scene what the character looks like (T-8.03).
   *
   * The HUD is where appearance already arrives — on every `setPlayer`, and
   * again the moment the creator saves — so it is also where the scene hears
   * about it, rather than the scene fetching the player a second time. Fires
   * immediately if the answer is already known, since the scene may register
   * after the first poll has landed.
   */
  /**
   * The server's last word on how this player looks, or null before it has
   * said (T-18.27).
   *
   * A getter because two scenes need it at different moments and a push-only
   * hand-over cannot serve both: the Farm subscribes and gets every change,
   * while the Interior is created once and WOKEN thereafter, so it needs to be
   * able to ask. This object already holds the value — updated by the farm poll
   * and, crucially, synchronously by the character creator's save — so asking
   * it is always current in a way a value copied at scene-start is not.
   */
  currentAppearance(): Appearance | null {
    return this.appearance;
  }

  onAppearance(listener: (appearance: Appearance) => void): void {
    this.onAppearanceListener = listener;
    if (this.appearance) listener(this.appearance);
  }

  /** One place that both records the appearance and announces it. */
  private setAppearance(appearance: Appearance): void {
    this.appearance = appearance;
    this.onAppearanceListener?.(appearance);
  }

  /**
   * Opens the inventory with the chest half showing.
   *
   * Called by the Farm scene when the action key is pressed facing the chest —
   * the only way in. Standing at the box is what makes the chest's grid appear,
   * so the panel never offers a drag into a container the player is nowhere
   * near (T-10.05).
   */
  openChest(): Promise<void> {
    return this.pack.toggle(true);
  }

  /**
   * Talks to a villager who has no shop behind them (T-33.03).
   *
   * The merchant goes through `talkToMerchant` instead, because their
   * conversation ends by opening something. This one just ends.
   */
  talkTo(npc: NpcId): void {
    const met = hasMet(npc);
    const state = dialogueStateFor({
      farmLevel: this.level,
      segment: timeOfDayAt(Date.now()).segment,
      met,
    });
    if (!met) rememberMet(npc);
    this.dialogue.show(npc, state);
  }

  /**
   * Talks to the merchant, then opens their shop (T-33.02).
   *
   * **The dialogue is a doorway, not a gate.** `show` returns `false` when the
   * merchant has nothing to say for this state, and then the shop opens exactly
   * as it did before — so deleting every line in `config/dialogue.ts` degrades
   * this back to T-11.04's behaviour rather than shutting the shop.
   *
   * The state comes from what the client already knows: the level the bar last
   * rendered, the segment `timeOfDayAt` computes from the wall clock, and a
   * localStorage flag for whether these two have met. None of it is
   * authoritative (§4.1) — a player who clears their storage hears the
   * introduction twice and gains nothing.
   */
  talkToMerchant(): void {
    const met = hasMet('merchant');
    const state = dialogueStateFor({
      farmLevel: this.level,
      segment: timeOfDayAt(Date.now()).segment,
      met,
    });
    if (!met) rememberMet('merchant');

    const opened = this.dialogue.show('merchant', state, () => void this.openShop());
    if (!opened) void this.openShop();
  }

  /**
   * Opens the merchant's shop. Called by the Farm scene when the action key is
   * pressed facing the stall, and from nowhere else — buying and selling are a
   * place you walk to now, not a button in the corner (T-11.04).
   */
  async openShop(): Promise<void> {
    // Same reason the shipping box refreshes first: the sell tab clamps to what
    // the bag holds, and the bag has been changing while the player farmed.
    await this.refreshInventory();
    await this.shop.toggle();
  }

  /**
   * Opens the trade post. Called by the Farm scene when the action key is
   * pressed at the mailbox (T-22.01, D-21).
   *
   * Refreshes the bag first for the same reason `openShop` does: the offer
   * builder can only offer what is actually held, and the bag has been changing
   * while the player farmed.
   */
  async openTrade(): Promise<void> {
    await this.refreshInventory();
    await this.trade.toggle();
  }

  /**
   * Opens the shipping box. Called by the Farm scene when the action key is
   * pressed facing the box, and from nowhere else — like the chest, standing
   * there is what opens it (T-11.03).
   */
  async openShipping(): Promise<void> {
    // The bag it lists is this HUD's cached copy, and the player has been
    // farming since it was last read — refresh before showing them what they
    // can ship, or the list is whatever they were carrying a poll ago.
    if (!this.shipping.isOpen) await this.refreshInventory();
    await this.shipping.toggle();
  }

  /**
   * Opens or closes the goal board (T-30.09).
   *
   * **Opening it closes the decoration tray**, and that is the whole of how the
   * two share the left-hand column. They are both trays that sit under the bar
   * on the same side, and two overlapping popovers is the kind of thing a
   * player reads as broken. Mutually exclusive rather than repositioned,
   * because the tray's height is its contents' — there is no second slot that
   * stays right as the catalogue grows.
   */
  async toggleGoals(): Promise<void> {
    if (!this.goals.isOpen) {
      // The tray is built lazily, so a null here means it has never been
      // opened — which is the common case and needs no work.
      const tray = this.decorTrayEl;
      if (tray && !tray.hidden) {
        tray.hidden = true;
        this.root.querySelector('[data-decor]')?.setAttribute('aria-expanded', 'false');
        if (this.armed) this.armDecor(null);
      }
    }
    await this.goals.toggle();
  }

  /**
   * Fired when a claimed goal pays out (T-30.09).
   *
   * The HUD holds the panel because the panel is DOM; the SCENE draws the
   * floats because the camera is the scene's — the same split as `onLevelUp`.
   */
  onReward(listener: (reward: MilestoneRewardView) => void): void {
    this.rewardListener = listener;
  }

  /**
   * Announces gold the SERVER credited while settling the box on a farm poll.
   *
   * The balance would otherwise change in the corner of the screen with nothing
   * to explain it — the player is standing in a field, nowhere near the box,
   * when the ten minutes run out.
   */
  reportShippingPaid(amount: number): void {
    if (amount > 0) this.toast(`The shipping box sold your goods for ${amount.toLocaleString()}g.`);
  }

  /**
   * The clock face (MVP re-scope).
   *
   * **Driven by its own timer, not by the poll.** The cycle is a pure function
   * of the wall clock — `timeOfDayAt` asks the server nothing — so tying the
   * hand to the twenty-second farm poll would make it lurch through an eighth
   * of the sky at a time for no reason. It ticks on its own, at the resolution
   * the eight-position hand can actually show.
   */
  private startClock(): void {
    const paint = () => {
      const time = timeOfDayAt(Date.now());
      this.clockHandEl.style.setProperty('--clock-frame', String(clockHandFrame(time.phase)));
      this.clockTextEl.textContent = time.segment;
      this.clockEl.title = `Time of day: ${time.segment}`;
    };
    paint();

    if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
    // A full cycle divided by the frames the hand has, halved so a position is
    // never held past the point it should have moved on.
    this.clockTimer = window.setInterval(paint, DAY_LENGTH_MS / CLOCK_HAND_FRAMES / 2);
  }

  /**
   * Reconciles the sleeping banner with the server's answer (MVP re-scope).
   *
   * **The server is the only thing that decides whether you are asleep**, and
   * this is called from every `setPlayer` — so a player who reloads the page
   * mid-sleep comes back to the banner and its Get-up button rather than to a
   * character that silently refuses every action with `ASLEEP` and offers no
   * way out. Sleeping is the one state the client must never be the authority
   * on, because being wrong about it is unrecoverable.
   *
   * The countdown is arithmetic on `fullInMs`, not a poll: recovery is a pure
   * function of elapsed time, so a ticking client and a silent server cannot
   * drift.
   */
  applyEnergy(energy: EnergyState): void {
    if (!this.mounted) return;

    /*
     * The bar, from the server's numbers only. The client never subtracts a
     * cost of its own — energy is what refuses an action, and a bar that
     * predicted a refusal the server did not make would be worse than one that
     * lagged a poll behind.
     */
    const percent = energy.max > 0 ? Math.round((energy.current / energy.max) * 100) : 0;
    this.energyFillEl.style.width = `${percent}%`;
    this.energyNumEl.textContent = `${energy.current}/${energy.max}`;
    this.energyEl.setAttribute('aria-valuenow', String(percent));
    this.energyEl.setAttribute('aria-label', `Energy, ${energy.current} of ${energy.max}`);
    this.energyEl.toggleAttribute('data-empty', energy.current === 0);

    if (!energy.isSleeping) {
      this.sleepBanner.hidden = true;
      if (this.sleepTimer !== null) window.clearInterval(this.sleepTimer);
      this.sleepTimer = null;
      if (this.sleeping) {
        this.sleeping = false;
        this.sleepListener?.(false);
      }
      return;
    }

    const deadline = restedAt(energy, Date.now());
    const paint = () => {
      this.sleepText.textContent = sleepLabel(deadline - Date.now());
    };

    this.sleepBanner.hidden = false;
    paint();
    if (this.sleepTimer !== null) window.clearInterval(this.sleepTimer);
    this.sleepTimer = window.setInterval(paint, 1000);

    if (!this.sleeping) {
      this.sleeping = true;
      this.sleepListener?.(true);
    }
  }

  /**
   * Tells a scene when the player falls asleep or gets up, so it can take the
   * character away and give it back. Only ever fires on a CHANGE.
   */
  onSleepChange(listener: (sleeping: boolean) => void): void {
    this.sleepListener = listener;
  }

  /**
   * The current answer, for a scene that has just started.
   *
   * `onSleepChange` fires on transitions, and a scene created while the player
   * is already in bed sees none — so it would spawn an unlocked character into
   * a sleeping game. This is what it reads instead.
   */
  isSleeping(): boolean {
    return this.sleeping;
  }

  /**
   * Gets up. Lives on the HUD rather than in the Interior scene because the
   * banner can outlive it — reload while asleep and you land wherever the
   * game puts you, and the button has to work there too.
   */
  private async wake(): Promise<void> {
    try {
      const result = await wakeApi();
      this.applyEnergy(result.energy);
      this.toast(
        result.recovered > 0
          ? `You slept, and feel ${result.recovered} better.`
          : 'You get up, no more rested than before.',
      );
    } catch (err) {
      this.toast(messageFor(err), 'error');
    }
  }

  /** Lets the Farm scene re-sync after a trade changes the bag. */
  onStateChange(listener: () => void): void {
    this.onStateChanged = listener;
  }

  /**
   * Idle mode's standing orders, from the farm poll (T-13.05 puts them there).
   *
   * The poll is the only thing that seeds this panel — there is no settings
   * fetch of its own, which is also why the switch is still where the player
   * left it after a reload.
   */
  setIdle(view: IdleView): void {
    if (!this.mounted) return;

    this.idle.setView(view);
    this.paintIdleButton(view.enabled);
  }

  /**
   * Whether the farmer, rather than the player, is working the farm.
   *
   * The Farm scene asks before letting a key do anything. Answered from the
   * panel's copy of the SERVER's last word, never from the checkbox — see
   * `IdlePanel` for why that distinction is the whole safety of the lock.
   */
  isIdleEnabled(): boolean {
    return this.idle.isEnabled;
  }

  onIdleChange(listener: (view: IdleView) => void): void {
    this.onIdleChangedListener = listener;
  }

  onLeaveHouse(listener: () => void): void {
    this.onLeaveHouseListener = listener;
  }

  onDecorate(
    onPlace: (furnitureId: string) => void,
    onBuy: (furnitureId: string) => void,
  ): void {
    this.onPlaceListener = onPlace;
    this.onBuyFurnitureListener = onBuy;
  }

  /**
   * Clears any armed house piece.
   *
   * Called on leaving, so walking back out onto the farm never leaves a
   * fireplace armed against a plot.
   */
  clearFurnitureArm(): void {
    this.armedFurnitureId = null;
  }

  /* ---------------------------------------------------------------- *
   * Farm decoration (T-15.24)
   * ---------------------------------------------------------------- */

  /**
   * Called when the player arms a piece to place, or disarms with `null`.
   *
   * Arming is all the tray does. WHERE the piece goes is decided by the
   * character's faced tile, not by the tray and not by the pointer — decoration
   * is placed the same way everything else on this farm is acted on (§5.1).
   */
  onArmDecor(listener: (decorId: string | null) => void): void {
    this.onArmDecorListener = listener;
  }

  /**
   * The top bar's rendered height, in CSS pixels.
   *
   * Measured, not declared (T-15.27). The Farm scene has to keep the map clear
   * of the bar when it fits the camera, and it used to do that with a
   * hardcoded `HUD_MARGIN = 56` — which had drifted to 15px short of the real
   * 71px, so the top of the farm sat underneath the bar. Anything that changes
   * the bar's padding, font size or button chrome moves this number; asking the
   * element is the only version that cannot go stale.
   *
   * Returns 0 before the HUD is mounted, which the caller treats as "use the
   * fallback" rather than "there is no bar".
   */
  /**
   * The HUD's root element, for chrome that must live INSIDE it (T-28.02).
   *
   * The palette — `--ink`, `--paper`, `--barn` and the rest — is declared on
   * `.hud`, deliberately shadowing the site tokens of the same names that
   * `base.css` puts on `:root`. Anything appended to `document.body` instead
   * therefore resolves those variables to nothing and renders unstyled, which
   * is exactly what the touch controls did on their first run: a bare letter E
   * where a rust plate should have been.
   */
  element(): HTMLElement {
    return this.root;
  }

  /**
   * How much of the top of the screen the HUD occupies.
   *
   * It measures the STATUS CLUSTER now, not a full-width bar (Phase U2). The
   * cluster is the taller of the two corner groups and is what the camera can
   * actually collide with; the rail is narrow, hugs the left edge, and the fit
   * has never reserved horizontal space for anything.
   *
   * Still measured rather than declared, for the reason T-18.03 gave: the
   * element's height depends on its content and its media queries, and a
   * constant here goes stale the first time either changes.
   */
  /**
   * The idle button's ON state (Phase U2).
   *
   * It used to set `textContent`, which on an icon-only button deletes the
   * icon and prints "Idle · on" into a 44px square. The state shows the way
   * every other toggle in this HUD shows it now — a pressed plate — plus the
   * accessible name, which is the half a screen reader was always reading.
   */
  private paintIdleButton(on: boolean): void {
    this.idleBtn.setAttribute('aria-pressed', String(on));
    this.idleBtn.setAttribute('aria-label', on ? 'Idle mode, on' : 'Idle mode');
    this.idleBtn.setAttribute('title', on ? 'Idle mode — running' : 'Idle mode');
    this.idleBtn.classList.toggle('is-on', on);
  }

  barHeight(): number {
    if (!this.mounted) return 0;
    const status = this.root.querySelector('.hud__status');
    if (!status) return 0;
    const box = status.getBoundingClientRect();
    this.publishChromeTop(box);
    return Math.round(box.height);
  }

  /**
   * Tell the stylesheet how far down the top-anchored chrome reaches.
   *
   * `--chrome-top` is the vertical counterpart to `--rail-clear`, and every
   * panel's `--panel-lane-top` is derived from it. Published from the SAME
   * measurement the camera uses rather than declared in CSS, for the same
   * reason `barHeight` is measured at all: the cluster's height moves with its
   * padding, the type scale and the farm name's wrap, and a constant would go
   * stale silently — which is exactly what `top: 72px` did for nine panels
   * after Phase U2 deleted the 72px bar it was describing.
   *
   * **The rail counts only when it is a row.** On a desktop it is a tall column
   * down the left edge and panels clear it horizontally through `--rail-clear`;
   * folding its 400px into a vertical lane would push every panel off the
   * bottom of the screen. Under the narrow-screen rule it lies down under the
   * cluster instead, and then it genuinely is in the way — and it WRAPS, so its
   * height is not "one button" and cannot be written as a constant. Reading
   * `flex-direction` back off the element lets the stylesheet own the decision
   * and this own only the arithmetic.
   *
   * Called from `barHeight`, so it is refreshed on every camera fit: a resize,
   * a font swap or a longer farm name all move the lane with no second listener
   * to forget.
   */
  private publishChromeTop(status: DOMRect): void {
    if (status.bottom <= 0) return;
    // The cluster alone. The narrow-screen rail positions itself from this,
    // and must not read `--chrome-top` — that includes the rail's own height.
    this.root.style.setProperty('--status-bottom', `${Math.round(status.bottom)}px`);

    let bottom = status.bottom;
    const rail = this.root.querySelector('.hud__rail');
    if (rail && getComputedStyle(rail).flexDirection.startsWith('row')) {
      bottom = Math.max(bottom, rail.getBoundingClientRect().bottom);
    }

    this.root.style.setProperty('--chrome-top', `${Math.round(bottom)}px`);
  }

  /**
   * How much of the viewport the HUD covers, top and bottom (T-18.03).
   *
   * The camera fit only ever subtracted the top bar, because that is the piece
   * it was originally caught hiding the farm behind. The hotbar covers the
   * world just as opaquely — it is 68px tall and sits 12px off the bottom — and
   * ignoring it is what let the fit hand back a zoom whose bottom two tile rows
   * (including the barn's door) landed underneath it.
   *
   * `bottom` is measured from the viewport's bottom edge to the hotbar's TOP,
   * so it includes the gap beneath it. Measured rather than declared, for the
   * same reason `barHeight` is: a padding change here would otherwise silently
   * push the farm back under the chrome.
   *
   * Returns zeroes before the HUD is mounted; callers use their fallback.
   */
  chrome(): { top: number; bottom: number } {
    if (!this.mounted) return { top: 0, bottom: 0 };

    // Before measuring, not after: the strip re-picks its scale from the
    // viewport height, and this must not read the size it is about to stop
    // being. See `Hotbar.syncScale`.
    this.hotbar.syncScale();

    const hotbar = this.root.querySelector('.hotbar');
    if (!hotbar) return { top: this.barHeight(), bottom: 0 };

    const box = hotbar.getBoundingClientRect();
    // `visualViewport` would be the more correct height on a mobile browser
    // with a retracting URL bar, but the canvas is sized from `innerHeight`,
    // so this has to agree with the canvas, not with the device.
    const bottom = Math.max(0, Math.round(window.innerHeight - box.top));
    // The same number the stylesheet needs: everything anchored above the
    // hotbar — the coach hint, the dialogue box, the toasts, every panel's
    // max-height — has to clear exactly this. See `--hotbar-clear`.
    if (bottom > 0) {
      this.root.style.setProperty('--hotbar-clear', `${bottom}px`);
      this.publishBottomChrome(bottom);
    }
    return { top: this.barHeight(), bottom };
  }

  /**
   * How far UP the bottom-anchored chrome reaches, hotbar and coach together.
   *
   * The toasts need this and `--hotbar-clear` is not enough: the coach hint sits
   * one gap above the hotbar, so a toast that clears only the strip lands on the
   * hint. Measured at 1440x900 it overlapped it by 6px — the toast "That plot is
   * not cleared yet" printed across the top edge of "Walk with WASD…", which is
   * two pieces of instructional text arguing over the same pixels, the exact
   * complaint `.dialogue` already carries a note about.
   *
   * Measured rather than derived because the hint's height is not a constant: it
   * wraps with the viewport width, and `--t-body-sm` at `line-height: 1.5` makes
   * it one line at 1440 and three at 390.
   *
   * The coach is skipped when hidden — it retires itself on the first harvest —
   * so the toasts move back down for a player who is past the tutorial.
   */
  private publishBottomChrome(hotbarClear: number): void {
    let reach = hotbarClear;

    const coach = this.root.querySelector('.hud__coach');
    if (coach && !coach.hasAttribute('hidden')) {
      const box = coach.getBoundingClientRect();
      if (box.height > 0) {
        reach = Math.max(reach, Math.round(window.innerHeight - box.top));
      }
    }

    this.root.style.setProperty('--bottom-chrome', `${reach}px`);
  }

  /** True while a piece is armed, so the scene knows to draw the ghost. */
  armedDecor(): string | null {
    return this.armed;
  }

  /** Arms a piece, or disarms. Safe to call with the already-armed id. */
  armDecor(decorId: string | null): void {
    this.armed = decorId;
    this.renderDecorTray();
    this.onArmDecorListener?.(decorId);
    if (decorId) this.toast('Face a tile and press E to place it. Escape to cancel.');
  }

  /* ---------------------------------------------------------------- *
   * House furniture arming (T-16.15)
   *
   * Deliberately a mirror of the farm decoration API above rather than a
   * shared one. They are two catalogues, two servers modules and two trays,
   * and only one is ever on screen — sharing the armed slot would mean a piece
   * armed indoors staying armed on the farm, which is a bug waiting rather
   * than a duplication saved.
   * ---------------------------------------------------------------- */

  /** True while a house piece is armed, so the Interior draws its ghost. */
  armedFurniture(): string | null {
    return this.armedFurnitureId;
  }

  armFurniture(furnitureId: string | null): void {
    this.armedFurnitureId = furnitureId;
    this.renderDecorations();
    if (furnitureId) this.toast('Face a spot and press E to put it down. Escape to cancel.');
  }

  /** What the player owns but has not put down, from the server. */
  setDecorOwned(owned: readonly { readonly decorId: string; readonly quantity: number }[]): void {
    this.decorOwned = owned.filter((o) => o.quantity > 0);
    // Arming something and then placing the last one has to disarm, or the
    // marker keeps promising a piece that is no longer in storage.
    if (this.armed && !this.decorOwned.some((o) => o.decorId === this.armed)) {
      this.armDecor(null);
      return;
    }
    this.renderDecorTray();
  }

  private renderDecorTray(): void {
    if (!this.mounted) return;
    const list = this.decorTray().querySelector('[data-decor-list]')!;
    list.replaceChildren();

    if (this.decorOwned.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hud__decorempty";
      empty.textContent = "Nothing in storage. Buy decoration from the merchant.";
      list.append(empty);
      return;
    }

    for (const owned of this.decorOwned) {
      const def = getDecor(owned.decorId);
      if (!def) continue;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'decorrow';
      row.setAttribute('aria-pressed', String(this.armed === def.id));
      row.textContent = `${def.name} x${owned.quantity}`;
      row.addEventListener('click', () => {
        this.armDecor(this.armed === def.id ? null : def.id);
      });
      list.append(row);
    }
  }

  private decorTray(): HTMLElement {
    if (this.decorTrayEl) return this.decorTrayEl;

    const panel = document.createElement('section');
    panel.className = 'hud__decor';
    panel.hidden = true;
    panel.innerHTML = `
      <h2 class="hud__decortitle">Decorate</h2>
      <div class="hud__decorlist" data-decor-list></div>
    `;
    this.root.append(panel);
    this.decorTrayEl = panel;
    return panel;
  }

  /**
   * The farm's building tiers, as the server reported them (T-12.02).
   *
   * Only the TIER comes from the server; the cap and next price the shop shows
   * are read from shared config through the same functions the purchase uses,
   * so there is no second formula to drift (§4.4).
   */
  setBuildings(coopTier: number, barnTier: number, herd?: Record<AnimalBuilding, number>): void {
    this.buildings = { coop: coopTier, barn: barnTier };
    // How many animals are actually IN each building (T-18.14). The shop needs
    // it to say "coop full — 4/4" rather than disabling a button silently, and
    // the farm poll already carries the animals, so this is a count rather than
    // a second request.
    if (herd) this.herd = herd;
    this.shop.refresh();
  }

  /** The authoritative balance after a purchase. Never computed locally. */
  /**
   * How many planted plots are sitting dry (T-18.16, F-2).
   *
   * The half of the fix the per-plot badge cannot do. A badge tells you about a
   * plot you are already looking at; the farm is thirty tiles across, and the
   * question a returning player has is "is there anything to do at all". This
   * is the only thing in the bar that answers it.
   *
   * Counted client-side off the farm poll rather than added to the payload:
   * "paused" is a function of `wetUntil` and the clock, which the client
   * already interpolates forward between polls (`displayAt`), so a number from
   * the server would be a poll interval stale exactly when it changes.
   */
  setThirsty(count: number): void {
    if (!this.mounted) return;

    this.thirstyEl.hidden = count === 0;
    this.thirstyEl.textContent = count === 1 ? '1 thirsty' : `${count} thirsty`;
  }

  /**
   * Farm level and progress toward the next (T-30.02).
   *
   * Takes the already-derived `LevelProgress` rather than raw experience, so
   * the bar and the server's own arithmetic cannot drift: `levelProgress` in
   * shared config is the single definition (§4.4), used here and by
   * `toSelfPlayer`.
   */
  private renderProgress(progress: LevelProgress): void {
    const percent = levelBarPercent(progress);

    /*
     * Level-up detection (T-30.05).
     *
     * `level` was added in T-30.02 and removed again the same task, because
     * nothing read it and `noUnusedLocals` was right to say so. This is the
     * consumer it was waiting for.
     *
     * `> this.level` rather than `!==`: the only way a level can go DOWN is a
     * reconciliation quirk — a poll landing behind an optimistic
     * `setExperience` — and celebrating that would be absurd. The guard on
     * `levelSeen` stops the very first poll of a session firing a level-up for
     * a player who was already level 12 when they opened the tab.
     */
    if (this.levelSeen && progress.level > this.level) {
      this.levelUpListener?.(progress.level);
    }
    /*
     * A level-up can UNLOCK a seed (T-31.06), so the shop is repainted on the
     * change rather than only when it is next opened. Guarded on an actual
     * change: `renderProgress` runs on every poll and every harvest response,
     * and repainting a shop three times a minute for a number that did not
     * move would fight the player's own quantity input.
     */
    const levelChanged = progress.level !== this.level;
    this.level = progress.level;
    this.levelSeen = true;
    if (levelChanged) this.shop.refresh();

    this.levelEl.textContent = levelBarLabel(progress);
    this.xpFillEl.style.width = `${percent}%`;
    this.xpEl.setAttribute('aria-valuenow', String(percent));
    this.xpEl.setAttribute('aria-label', levelBarAriaLabel(progress));
  }

  /**
   * Moves the bar from a harvest or collect response instead of waiting for the
   * next poll (T-30.02).
   *
   * `POLL_MS` is 20 seconds. A bar that only moved on the poll would sit still
   * through the action that earned it and then jump later for no visible
   * reason — which is worse than no bar, because it teaches the player the
   * number is unrelated to what they did.
   *
   * This recomputes through the SAME shared `levelProgress` the server uses, so
   * it is a re-derivation of a number the server already sent, not a local
   * tally (§4.1). The authoritative value re-lands on the next poll regardless.
   */
  setExperience(experience: number): void {
    if (!this.mounted) return;
    this.renderProgress(levelProgress(experience));
  }

  /**
   * Fired when the farm level goes UP (T-30.05).
   *
   * The HUD owns the detection because it is the only place that sees every
   * progress value — the poll and the action responses both land here. The
   * scene owns the reaction, because the camera is its.
   */
  onLevelUp(listener: (level: number) => void): void {
    this.levelUpListener = listener;
  }

  /**
   * A nudge on the gold readout when the number changes (T-30.05).
   *
   * CSS rather than a Phaser tween, because the gold chip is DOM — and CSS
   * gets `prefers-reduced-motion` for free through the stylesheet, with no
   * branch here to forget. The class is removed on animation end so a second
   * change re-triggers it; without that, gold would bounce once per session.
   */
  private bounceGold(): void {
    if (!this.mounted) return;
    this.goldEl.classList.remove('is-bumped');
    // Reading `offsetWidth` forces the style flush that makes the re-add
    // restart the animation. Without it the browser coalesces both changes and
    // nothing plays at all.
    void this.goldEl.offsetWidth;
    this.goldEl.classList.add('is-bumped');
  }

  /**
   * The next thing to do, or `null` once the player has been round the loop
   * (T-18.17, F-5).
   *
   * A `role="status"` line rather than a modal or a numbered tour: it does not
   * interrupt, it cannot be in the way, and there is nothing to dismiss. The
   * player who already knows how to play sees it for as long as it takes them
   * to harvest once and then never again.
   */
  setCoach(plots: readonly PlotView[], serverNow: number): void {
    if (!this.mounted) return;

    /*
     * Decided HERE rather than in the scene because the answer needs both the
     * plots (from the farm poll) and the bag (from the inventory poll), and
     * this is the only object that holds both. The scene would have to be told
     * the slots to ask the question, which is a second copy of state that
     * exists purely to be read once.
     */
    const step = nextStep({ plots, slots: this.slots, serverNow, now: Date.now() });
    const text = step === null ? null : STEP_TEXT[step];

    this.coachEl.hidden = text === null;
    if (text !== null && this.coachEl.textContent !== text) this.coachEl.textContent = text;
  }

  /**
   * Sends the player to Stripe (T-18.20, BUG-18).
   *
   * The client's entire part in the purchase: ask, then go where it is sent.
   * The price, the eligibility and the account that gets the grant are all
   * decided server-side from data this never supplies (§7), and no response to
   * this call can make anyone VIP — only the signature-verified webhook does
   * that.
   */
  private async buyVip(): Promise<void> {
    if (this.vipInFlight) return;
    this.vipInFlight = true;

    try {
      const { url } = await startVipCheckout();
      // A full navigation, not a popup: Stripe Checkout is a hosted page and
      // the success/cancel URLs bring the player back to `/play`.
      window.location.assign(url);
    } catch (err) {
      this.toast(messageFor(err), 'error');
      this.vipInFlight = false;
    }
  }

  /**
   * The VIP bulk action: clear every ripe plot, then every ready animal
   * (T-24.01, T-24.02).
   *
   * **Sequential, not `Promise.all`.** Both endpoints write inventory rows for
   * the same player and both run the idle catch-up first; firing them together
   * would have two transactions contending for the same rows to save a round
   * trip nobody is waiting on.
   *
   * "Nothing was ready" is not an error here even though each endpoint reports
   * it as one. A farm with ripe crops and no ready animals is the ordinary
   * case, and a refusal toast for the half that had nothing to do would make
   * the working half look broken. Only when BOTH have nothing does the player
   * hear about it.
   */
  private async gatherAll(): Promise<void> {
    if (this.gatherInFlight) return;
    this.gatherInFlight = true;
    this.gatherBtn.disabled = true;

    /** Runs one batch, treating its "nothing ready" code as an empty result. */
    const run = async <T>(
      call: () => Promise<T>,
      emptyCode: string,
    ): Promise<T | null> => {
      try {
        return await call();
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === emptyCode) return null;
        throw err;
      }
    };

    try {
      const crops = await run(() => harvestAll(), 'CROP_NOT_READY');
      const produce = await run(() => collectAllAnimals(), 'NOTHING_TO_COLLECT');

      const plots = crops?.harvested.length ?? 0;
      const animals = produce?.collected.length ?? 0;
      const full = (crops?.stoppedByFullBag ?? false) || (produce?.stoppedByFullBag ?? false);

      if (plots === 0 && animals === 0) {
        this.toast('Nothing is ready yet.');
      } else {
        const parts: string[] = [];
        if (plots > 0) parts.push(`${plots} ${plots === 1 ? 'crop' : 'crops'}`);
        if (animals > 0) parts.push(`${animals} ${animals === 1 ? 'animal' : 'animals'}`);
        this.toast(
          full
            ? `Gathered ${parts.join(' and ')} — your bag filled before the rest.`
            : `Gathered ${parts.join(' and ')}.`,
        );
      }

      await this.refreshInventory();
      // The authoritative re-sync. Plots, animals and gold all moved, and none
      // of it was applied locally (§4.1) — the scene re-polls and redraws.
      this.onStateChanged?.();
    } catch (err) {
      this.toast(messageFor(err), 'error');
    } finally {
      this.gatherInFlight = false;
      this.gatherBtn.disabled = false;
    }
  }

  /**
   * Says something true about a return from Stripe (T-18.20).
   *
   * **`?vip=success` means Stripe took the money, NOT that this account is
   * VIP.** Those are different events with a webhook between them, and the
   * webhook can land after the browser does. Granting anything here would be
   * the spoofable path §7 forbids — anyone can type `?vip=success` into the
   * address bar — so the copy promises only what actually happened and lets the
   * ordinary poll report the grant when it is real.
   *
   * The query is stripped afterwards so a reload does not repeat the message.
   */
  announceVipReturn(search: string, replaceUrl: (path: string) => void): void {
    const outcome = vipReturnFrom(search);
    if (outcome === null) return;

    if (outcome === 'success') {
      this.toast('Payment received — VIP will switch on in a moment.');
    } else {
      this.toast('Checkout cancelled. Nothing was charged.');
    }

    replaceUrl(window.location.pathname);
  }

  setGold(gold: number): void {
    const changed = gold !== this.gold;
    this.gold = gold;
    this.goldEl.textContent = `${gold.toLocaleString()}g`;
    if (changed) this.bounceGold();
    this.shop.refresh();
  }

  /**
   * The decoration tray: what is in storage, and what the catalogue sells.
   *
   * A piece in storage offers "Place"; one you do not own offers its price.
   * VIP-only pieces stay listed to a free account rather than being hidden —
   * knowing what VIP includes is the point of an exclusive, and the server
   * refuses the purchase anyway.
   */
  setDecorations(catalogue: CatalogueEntry[], owned: OwnedFurniture[]): void {
    this.decorations = { catalogue, owned };
    this.renderDecorations();
  }

  /**
   * Redraws the house tray from the last server answer.
   *
   * Split out in T-16.15 so arming a piece can re-render without a fetch — the
   * armed row has to look armed the instant it is clicked, and going back to
   * the server for that would be a round trip to change a border colour.
   */
  private renderDecorations(): void {
    if (!this.mounted || !this.decorations) return;
    const { catalogue, owned } = this.decorations;

    // Placing the last one has to disarm, or the ghost keeps promising a piece
    // that is no longer in storage. Same rule as `setDecorOwned`.
    if (
      this.armedFurnitureId &&
      !owned.some((o) => o.furnitureId === this.armedFurnitureId && o.quantity > 0)
    ) {
      this.armedFurnitureId = null;
    }

    const stock = new Map(owned.map((o) => [o.furnitureId, o.quantity]));
    const list = this.houseControls().querySelector('[data-decorlist]')!;
    list.replaceChildren();

    for (const entry of catalogue) {
      const held = stock.get(entry.id) ?? 0;

      const row = document.createElement('div');
      row.className = 'decorrow';
      if (this.armedFurnitureId === entry.id) row.setAttribute('aria-pressed', 'true');

      const name = document.createElement('span');
      name.className = 'decorrow__name';
      name.textContent = entry.name;
      if (entry.vipOnly) {
        // A span rather than a character appended to the text (T-16.14), so the
        // star can be coloured — it is a mark, and at 0.66rem an uncoloured one
        // reads as punctuation.
        const star = document.createElement('span');
        star.className = 'decorrow__vip';
        star.textContent = ' ★';
        star.title = 'VIP farms only. Never tradeable.';
        name.append(star);
      }

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'decorrow__btn';

      if (held > 0) {
        action.classList.add('decorrow__btn--place');
        const armedHere = this.armedFurnitureId === entry.id;
        action.textContent = armedHere ? 'Cancel' : held > 1 ? `Place (${held})` : 'Place';
        // ARMS the piece; where it goes is the character's faced tile (T-16.15).
        action.addEventListener('click', () => this.onPlaceListener?.(entry.id));
      } else {
        action.textContent = `${entry.price.toLocaleString()}g`;
        action.disabled = this.gold < entry.price;
        action.addEventListener('click', () => this.onBuyFurnitureListener?.(entry.id));
      }

      row.append(name, action);
      list.append(row);
    }
  }

  /**
   * Indoors, the farm's controls are about a place the player cannot see.
   *
   * Nothing has to be hidden for the farm any more: T-9.06 retired the seed
   * picker, and the hotbar is the bag — it stays useful inside. Only the
   * house's own controls appear and disappear.
   */
  setInsideHouse(inside: boolean): void {
    if (!this.mounted) return;

    this.houseControls().hidden = !inside;
    // Crossing the threshold closes everything the other side owned
    // (T-18.13, BUG-12). Called from both directions, so it covers going out
    // as well as coming in.
    this.closePanels();
  }

  /**
   * Shuts every modal panel (T-18.13, BUG-12).
   *
   * **World-anchored panels are the reason this exists.** The chest, the
   * shipping box and the shop are all opened by standing at a thing on the
   * FARM, and nothing was closing them on the way indoors — so you could walk
   * into your house and stand there with the farm's chest UI open, operating a
   * chest that is outside. The player has no way to read that as anything but
   * broken.
   *
   * Everything is closed rather than a curated list, and that is deliberate:
   * "which panels belong to which scene" is a second thing to keep in step, and
   * the panels that are NOT world-anchored (the bag, the idle switch) are ones
   * a player can trivially reopen from the bar. Losing a panel across a scene
   * change costs one click; keeping the wrong one open costs trust.
   *
   * The character creator is excluded on purpose — it is the one panel that
   * must not be dismissible (see `characterCreator.ts`), and it cannot be open
   * during a house transition anyway.
   */
  closePanels(): void {
    this.shop.hide();
    this.pack.hide();
    this.shipping.hide();
    this.idle.hide();
    /*
     * The goal board goes too, because indoors the left-hand column is the
     * house controls' — the two would sit on top of each other (T-30.09).
     * `false` so the automatic close is not mistaken for the player closing it;
     * see `MilestoneHost.onOpenChange`.
     */
    this.goals.hide(false);
  }

  /**
   * The house's own controls — Leave, and the decoration tray — built on first
   * use rather than baked into the bar.
   *
   * Reachable again since T-16.12 — `Farm.enterHouse()` calls
   * `setInsideHouse(true)` on the way in. It was built lazily because the
   * Interior scene was unregistered from T-11.05, and staying lazy is still
   * right: most sessions never go indoors, and DOM that only exists once
   * someone is in the house cannot be dead.
   */
  private houseControls(): HTMLElement {
    const existing = this.root.querySelector<HTMLElement>('[data-house]');
    if (existing) return existing;

    const panel = document.createElement('aside');
    panel.className = 'hud__decor';
    panel.dataset['house'] = '';
    panel.hidden = true;
    /*
     * `hud__decortitle` rather than `hud__label` (T-16.14): the farm's own
     * decoration tray uses it, and these two lists are the same thing indoors
     * and out. Two classes for one heading was how they drifted apart.
     */
    panel.innerHTML = `
      <h2 class="hud__decortitle">Decorate</h2>
      <div class="hud__decorlist" data-decorlist></div>
      <button class="hud__btn hud__btn--leave" type="button" data-leave>Leave house</button>
    `;
    panel.querySelector('[data-leave]')!.addEventListener('click', () => {
      this.onLeaveHouseListener?.();
    });

    this.root.append(panel);
    return panel;
  }

  /** Gold comes from the server on every refresh — never incremented locally. */
  setPlayer(player: SelfPlayer): void {
    this.setGold(player.gold);
    this.nameEl.textContent = player.username;
    // The SERVER's answer (it also knows about flagged accounts, which the
    // client is deliberately never told about) — not a local expiry compare.
    this.vip = player.isVip;
    /*
     * The one place VIP status is read (T-18.20). The button hides itself when
     * the server says the account already has VIP — which is also what makes
     * the post-payment wait honest: the offer disappears when the WEBHOOK has
     * landed, never when a redirect claimed it had.
     */
    this.vipBtn.hidden = player.isVip;
    // Same source, opposite sense: the perk appears exactly when the offer to
    // buy it disappears, so the two can never both be on screen.
    this.gatherBtn.hidden = !player.isVip;
    /*
     * Trading eligibility, from the same poll (T-22.03). The server computes it
     * — it is the only side that knows about flagged accounts — and the panel
     * turns it into a sentence rather than letting the player find the rule by
     * being refused.
     */
    this.tradeEligibility = player.trade;
    // The authoritative progress, from the same poll (T-30.02). `setExperience`
    // moves the bar sooner; this is what it reconciles to.
    this.renderProgress(player.progress);
    // Sleeping, from the same poll, and the server is the only authority on it
    // — see `applyEnergy`.
    this.applyEnergy(player.energy);
    this.shop.refresh();
    /*
     * The board, alongside the farm poll (T-30.09). `GET /api/progression` is
     * rated at 120/min precisely to be refreshed here, and every requirement it
     * shows is derived on read — so a goal ticks over as the player tills
     * rather than the next time they think to open the panel.
     *
     * Only while it is on screen. A closed board is re-read when it opens.
     */
    if (this.goals.isOpen) void this.goals.refresh();

    // A brand-new account has no character yet. The creator decides whether
    // that means "show me" — it also knows about the save this poll predates.
    if (player.appearance) this.setAppearance(player.appearance);
    this.creator.ensure(player.appearance);
  }

  /**
   * Re-reads the bag from the server.
   *
   * Delegated to the panel rather than duplicated: one fetch, one place that
   * knows the shape of the response, and the HUD's cached slots come back
   * through `onSlotsChanged`.
   */
  refreshInventory(): Promise<void> {
    return this.pack.refresh();
  }

  toast(message: string, kind: 'info' | 'error' = 'info'): void {
    // Every refusal in the game arrives here (T-18.19). One cue, one place —
    // the alternative is a `playCue` beside each of forty `toast(..., 'error')`
    // calls, and the fortieth would be the one that got forgotten.
    if (kind === 'error') playCue('refused');
    const el = document.createElement('p');
    el.className = `toast toast--${kind}`;
    el.textContent = message;
    this.toastsEl.append(el);

    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }
}

/**
 * Renders an item's icon from whichever sheet its definition names.
 *
 * Every item carries `icon: { sheet, frame }` in the shared config, so this
 * looks the sheet up rather than assuming crops — seeds and produce live on
 * each crop's own sheet (`CROPS[id].sheet`, T-7.07), eggs/milk/feed on
 * borrowed placeholder frames until T-7.09 gives them real icons.
 */
// Both manifest lists: item icons live in `ICON_SHEETS` since T-34.04, which
// is what keeps them from consuming gids.
const SHEETS_BY_KEY = new Map([...SHEETS, ...ICON_SHEETS].map((s) => [s.key, s]));

export function iconFor(itemId: string, scale = 2): HTMLElement | null {
  const item = ITEMS[itemId];
  if (!item) return null;

  const sheet = SHEETS_BY_KEY.get(item.icon.sheet);
  if (!sheet) return null;

  return sprite(sheet, item.icon.frame, { scale, title: item.name });
}

export const hud = new Hud();
