import Phaser from 'phaser';
import {
  CROPS,
  CROP_IDS,
  ITEMS,
  FARM_MAP,
  GROUND_SOIL_DRY,
  GROUND_SOIL_WET,
  OBJ_CHEST,
  OBJ_MAPLE_TREE,
  OBJ_NEWSSTAND,
  OBJ_SHIPPING_BOX,
  OBJ_SHIPPING_BOX_LOOK,
  PIXEL_SCALE,
  PLOT_POSITIONS,
  TILE_SIZE,
} from '@tillhaven/shared/config';
import type { AnimalKind } from '@tillhaven/shared/config';
import type { AnimalView, FarmState, PlotView } from '@tillhaven/shared/types';
import {
  fetchFarm,
  fetchExpansion,
  plant,
  harvest,
  till,
  water,
  unlockPlot,
} from '../../net/farm.js';
import { idempotencyKey } from '../../net/api.js';
import { isTypingInDom } from '../../lib/focus.js';
import { messageFor, codeOf } from '../../net/errors.js';
import { hud } from '../hud.js';
import type { Equipped } from '../hotbar.js';
import { DEPTH } from '../depth.js';
import { Player, playerBounds } from '../entities/Player.js';
import { facedTile, tileCentre } from '../entities/targeting.js';
import { NO_INPUT } from '../entities/movement.js';
import {
  frameDistance,
  hasArrived,
  planReplay,
  replayInput,
  type ReplayPlan,
} from '../entities/idleReplay.js';
import { Animal } from '../entities/Animal.js';
import { House } from '../entities/House.js';
import { Coop } from '../entities/Coop.js';
import { Barn } from '../entities/Barn.js';
import { addMapleTree } from '../entities/Tree.js';
import { pastureSlot } from '../pasture.js';
import { idleSummaryMessage } from '../idleSummary.js';
import { collectAnimal, feedAnimal } from '../../net/animals.js';
import { displayAt, soilAt, type PlotDisplay, type SoilState } from '../plots.js';
import {
  actionFor,
  isAnimalIntent,
  swingFor,
  swingForKind,
  type AnimalIntent,
  type Dispatch,
  type FarmIntent,
  type Target,
} from '../actions.js';

/**
 * The farm.
 *
 * WORLD SPACE IS MAP SPACE. Everything here is positioned in the tilemap's own
 * pixel coordinates — one tile is TILE_SIZE (16) world pixels, plot (5,7) is
 * always at world (80,112) — and the camera does all the scaling with an
 * integer zoom. An earlier version scaled sprites by hand and re-centred the
 * field on `min(plot.x)`, which meant a plot's screen position depended on how
 * many plots existed and could not line up with an authored map at all.
 *
 * Authoritative state comes from GET /api/farm and is never invented locally.
 * Between polls the scene INTERPOLATES growth from the server's timestamps —
 * that is display smoothing, not a second source of truth, and only the server
 * can actually grant an item.
 *
 * INPUT: hover and clicks are both resolved by `tileAt()` against the same
 * rectangle the tile occupies. Nothing uses Phaser's per-object
 * `setInteractive` / `pointerover` here, and that is deliberate — an earlier
 * version did, and a missed `pointerout` left tiles highlighted while the
 * pointer was somewhere else entirely, so the visible highlight and the real
 * click target drifted apart. Deriving both from one rectangle every frame
 * makes that class of bug impossible.
 */

/** How often to re-fetch authoritative state. */
const POLL_MS = 20_000;

/**
 * The action key (T-9.06). Two of them: E is where the hand already is on WASD,
 * and Space is what everyone tries first.
 *
 * Phaser key CODES, like the movement keys in `Player.ts` — not the DOM
 * `event.code` strings the hotbar matches on. The two look interchangeable and
 * are not: `addKey('KeyE')` binds nothing at all and fails silently, which cost
 * a debugging round here.
 */
const ACTION_KEYS: readonly number[] = [
  Phaser.Input.Keyboard.KeyCodes.E,
  Phaser.Input.Keyboard.KeyCodes.SPACE,
];

const COLOR = {
  ripe: 0xfbf1e2,
  hover: 0xfbf1e2,
  locked: 0x2a1018,
  ink: '#2a1018',
  paper: '#fbf1e2',
} as const;

/** Room left at the top of the viewport for the HUD bar. */
const HUD_MARGIN = 56;

/**
 * How strongly the faced-tile outline reads.
 *
 * Deliberately fainter than a hovered plot (0.9): the target follows the
 * character everywhere and is on screen constantly, so it has to be findable
 * without competing with the thing the pointer is actually pointing at.
 */
const TARGET_ALPHA = 0.55;

interface Tile {
  view: PlotView;
  /**
   * The server-clock instant `view` describes.
   *
   * Every growth field on a view is measured from the `serverNow` of the
   * response it arrived in, and an optimistic view invented between two polls
   * has a different reference point from the last fetched one. Recording that
   * instant alongside the view means the drawing code can interpolate either
   * one without knowing which it is holding.
   *
   * (T-9.04 replaced a resolved "ripens at" instant with this. Since D-1 a crop
   * only grows while its soil is wet, so a single absolute ripening time is a
   * promise the plot cannot keep — the window may close first.)
   */
  viewAt: number;
  readonly container: Phaser.GameObjects.Container;
  /** Outline only. The soil underneath is `soil`, below. */
  readonly marker: Phaser.GameObjects.Rectangle;
  /**
   * Tilled/wet soil, drawn under the crop (T-9.04).
   *
   * The plot's soil is SERVER state now, so it is drawn per plot rather than
   * painted into the map: the map lays down plain ground under the field and
   * this covers it whenever the plot has actually been hoed.
   */
  readonly soil: Phaser.GameObjects.Image;
  readonly crop: Phaser.GameObjects.Sprite;
  /** World-space rect. The single definition of both "drawn here" and "clickable here". */
  readonly rect: Phaser.Geom.Rectangle;
  lastFrame: number;
}

export class Farm extends Phaser.Scene {
  private state: FarmState | null = null;
  private readonly tiles = new Map<string, Tile>();
  /** serverNow minus the local clock at the moment of the last fetch. */
  private clockOffset = 0;
  /** What the hotbar says is in hand. Client-side state; never sent (§5.5). */
  private equipped: Equipped | null = null;
  private pollTimer?: Phaser.Time.TimerEvent;
  /** Plots with an intent in flight, so a double-click cannot double-send. */
  private readonly busy = new Set<string>();
  private hoveredId: string | null = null;

  private map?: Phaser.Tilemaps.Tilemap;
  /**
   * Tiles the chest object stands on, from the authored map (T-10.05).
   *
   * Read only by the action key. Like every other position in this scene it is
   * client-side UX: the server validates what is in the chest on its own terms
   * and never learns where the character stood (§5.1).
   */
  private readonly chestTiles = new Set<string>();
  /** Tiles the shipping box stands on (T-11.03). Same rules as the chest. */
  private readonly shippingTiles = new Set<string>();
  /** Tiles the merchant's stall stands on (T-11.04). */
  private readonly merchantTiles = new Set<string>();
  /** Countdown for the hovered plot only — one label instead of forty. */
  private badge?: Phaser.GameObjects.Text;
  /** Outline on the tile the character is facing. Cosmetic; gates nothing. */
  private target?: Phaser.GameObjects.Rectangle;
  /** Cosmetic. Gates nothing, and its position never leaves the browser. */
  private player: Player | null = null;
  private readonly animals = new Map<string, Animal>();
  /** What each locked plot costs, from the server. Never computed here. */
  private readonly plotPrices = new Map<string, number>();
  private house: House | null = null;
  private coop: Coop | null = null;
  private barn: Barn | null = null;
  /**
   * What the idle farmer is walking to, if anything (T-13.07).
   *
   * Rebuilt only when the server names a different action — see `planReplay`
   * for why re-planning every frame would make the character orbit its target.
   */
  private replay: ReplayPlan | null = null;
  /** The action whose swing has already been played, so it plays once. */
  private replaySwung: string | null = null;

  constructor() {
    super('Farm');
  }

  create(): void {
    // Shows through anywhere the map does not cover, so it should read as
    // "outside the farm" rather than as a missing tile.
    this.cameras.main.setBackgroundColor('#123040');

    this.buildMap();
    // Before the player, so a character walking past the door draws in front.
    this.house = new House(this, 0);
    this.coop = new Coop(this, 0);
    this.barn = new Barn(this, 0);
    this.buildPlayer();
    this.buildTarget();
    this.buildBadge();
    // Before the first fetch, not after it: `refresh()` also fits the camera,
    // but it is a network round trip away, and until it lands an unfitted
    // camera shows the map crammed into the top-left corner.
    this.fitCamera();

    hud.onEquippedChange((equipped) => {
      this.equipped = equipped;
    });

    this.bindActionKeys();

    // A shop trade changes the bag, so pull authoritative state again.
    hud.onStateChange(() => void this.refresh());

    /*
     * Switching idle on or off takes the character away from the player, or
     * gives it back — immediately, rather than at the next poll twenty seconds
     * later. The re-poll behind it is what brings the field itself up to date:
     * the PUT settles the watermark server-side, so the farm it describes has
     * already moved on.
     */
    hud.onIdleChange((view) => {
      this.player?.setInputLocked(view.enabled);
      void this.refresh();
    });

    // One scene-level handler rather than one per tile: the tile under the
    // pointer is resolved the same way for clicks as it is for hover.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      /*
       * Clicking an animal did both jobs until T-12.03 and now does neither:
       * collecting and feeding are the character's, on the action key, like
       * every other thing done to the world (§5.2). Act-at-a-distance was the
       * last of it — a player could milk a cow from across the farm.
       */
      const tile = this.tileAt(pointer.worldX, pointer.worldY);
      if (!tile) return;

      /*
       * Buying a plot stays on the mouse, deliberately. It is the one thing
       * here that spends gold, and putting it on the same key the player taps
       * a hundred times an hour to farm would eventually buy a plot by
       * accident. Everything else is the character's job now.
       */
      if (!tile.view.unlocked) {
        void this.onLockedPlotClicked(tile.view.id);
        return;
      }

      // A click on the tile the character is FACING is the action key by
      // another name — not act-at-a-distance, which T-9.06 removed.
      const faced = this.facedPlot();
      if (faced && faced.view.id === tile.view.id) this.act();
    });

    void this.refresh();

    this.pollTimer = this.time.addEvent({
      delay: POLL_MS,
      loop: true,
      callback: () => void this.refresh(),
    });

    // Returning to the tab is when local interpolation is most stale.
    this.game.events.on(Phaser.Core.Events.FOCUS, () => void this.refresh());
    // Coming back from indoors: the state survived, but time passed.
    this.events.on(Phaser.Scenes.Events.WAKE, () => void this.refresh());
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera());
  }

  override update(_time: number, delta: number): void {
    // Before the character moves, so the steering it is given is this frame's.
    this.driveIdleReplay(delta);
    // Ahead of the state check: the character walks whether or not the first
    // fetch has landed, and a network stall should not freeze it.
    this.player?.update(delta);
    // Before the state check, like the character it follows: the target tracks
    // walking whether or not a fetch has landed.
    this.updateTarget();

    if (!this.state) return;
    this.updateHover();
    this.redraw(this.serverNow());
    for (const animal of this.animals.values()) animal.update(_time);
  }

  /** The server's clock, as best we can estimate it locally. */
  private serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /* ---------------------------------------------------------------- *
   * Idle replay
   * ---------------------------------------------------------------- */

  /**
   * Walks the character to the farmer's next job and swings at it (T-13.07).
   *
   * **Cosmetic, start to finish.** Nothing here sends anything, and nothing
   * here decides anything: the plot, the verb and the instant all come from
   * `state.idle.nextAction`, which the server computed by running its own
   * simulator one step forward (T-13.05). The work is applied on the next farm
   * read whether or not this animation ever played — a closed tab misses the
   * show, not the harvest.
   *
   * Which is why a stale plan is harmless rather than a desync to repair. The
   * only correction needed is to walk to whatever the newest poll named, and
   * that falls out of rebuilding the plan when the action changes.
   */
  private driveIdleReplay(deltaMs: number): void {
    const player = this.player;
    if (!player) return;

    const action = hud.isIdleEnabled() ? (this.state?.idle.nextAction ?? null) : null;
    if (!action) {
      this.replay = null;
      // Only while the farm is the farmer's: outside that the drive is ignored
      // anyway, and clearing it is what stops a half-finished walk dead when
      // the player takes over.
      if (hud.isIdleEnabled()) player.setDrive(NO_INPUT);
      return;
    }

    // A different plot, or the same one at a new instant, is a new job.
    const key = `${action.plotId}@${action.at}`;
    if (!this.replay || `${this.replay.plotId}@${this.replay.at}` !== key) {
      const plot = this.tiles.get(action.plotId);
      this.replay = plot
        ? planReplay(player, action, { tileX: plot.view.x, tileY: plot.view.y })
        : null;
      if (!this.replay) return;
    }

    const plan = this.replay;
    const now = this.serverNow();
    const stepPx = frameDistance(deltaMs);

    player.setDrive(replayInput(plan, player, now, stepPx));

    if (!hasArrived(plan, player, stepPx)) return;

    // Standing on the spot: look at the plot, then work it at the instant the
    // server named. Once — `at` stays in the past until the next poll replaces
    // the action, and a swing per frame would be a seizure.
    player.face(plan.facing);
    if (now >= plan.at && this.replaySwung !== key) {
      this.replaySwung = key;
      const swing = swingForKind(plan.kind);
      if (swing) player.playToolAnimation(swing);
    }
  }

  /* ---------------------------------------------------------------- *
   * The authored map
   * ---------------------------------------------------------------- */

  /**
   * Builds the tilemap exported from `apps/mapmaker`.
   *
   * Tileset names in the map are the manifest keys, by construction — the
   * editor writes `name: run.key` — so a tileset resolves to a loaded texture
   * of the same name with no lookup table in between.
   */
  private buildMap(): void {
    const map = this.make.tilemap({ key: FARM_MAP.key });
    this.map = map;

    const tilesets: Phaser.Tilemaps.Tileset[] = [];
    for (const tileset of map.tilesets) {
      const added = map.addTilesetImage(tileset.name, tileset.name);
      if (added) tilesets.push(added);
      else console.warn(`[tillhaven] map tileset "${tileset.name}" has no matching texture`);
    }

    for (const [index, layerData] of map.layers.entries()) {
      const layer = map.createLayer(layerData.name, tilesets, 0, 0);
      // First tile layer is the ground; anything above it is decoration that
      // still sits under sprites.
      layer?.setDepth(index === 0 ? DEPTH.ground : DEPTH.decor);
    }

    this.buildMapObjects(map);
  }

  /**
   * Places the trees, chests and buildings from the map's `objects` layer.
   *
   * Tiled anchors tile-objects to their BOTTOM edge, which is exactly what
   * pixel-art scenery wants: `setOrigin(0, 1)` puts the sprite's feet on the
   * tile the author clicked, so a 48px tree stands on its cell instead of
   * floating two tiles above it.
   */
  private buildMapObjects(map: Phaser.Tilemaps.Tilemap): void {
    const layer = map.getObjectLayer('objects');
    if (!layer) return;

    for (const object of layer.objects) {
      if (object.gid === undefined || object.x === undefined || object.y === undefined) continue;

      const located = locateInMap(map, object.gid);
      if (!located) {
        console.warn(`[tillhaven] map object gid ${object.gid} belongs to no tileset in the map`);
        continue;
      }

      const { key } = located;

      /*
       * Trees come off the animated sheet instead of the still one (T-9.05).
       * The frame the map placed is pixel-identical to the loop's first frame,
       * so this is the same tree in the same place, now dropping leaves.
       */
      if (key === OBJ_MAPLE_TREE.key) {
        addMapleTree(this, object.x, object.y);
        continue;
      }

      /*
       * Remember which tiles the chest covers, so the action key can tell when
       * the character is facing it (T-10.05). Taken from the map rather than
       * written down as a constant: the chest is placed in the editor, and a
       * second copy of its position here would be one that silently goes stale
       * the first time someone moves it (§9).
       */
      if (key === OBJ_CHEST.key) this.rememberObjectTiles(this.chestTiles, object);
      if (key === OBJ_NEWSSTAND.key) this.rememberObjectTiles(this.merchantTiles, object);
      /*
       * The shipping box is measured from what is DRAWN, not from the map
       * object's declared 48x64: only one 16px crate of that kit is rendered
       * (`OBJ_SHIPPING_BOX_LOOK`, T-7.11), so trusting the object's size would
       * make twelve tiles open the box while one of them shows it.
       */
      if (key === OBJ_SHIPPING_BOX.key) {
        this.rememberObjectTiles(this.shippingTiles, object, {
          width: OBJ_SHIPPING_BOX_LOOK.width,
          height: OBJ_SHIPPING_BOX_LOOK.height,
        });
      }

      // The shipping box's raw kit is not one pose but all four (open/closed x
      // wide/narrow) stacked in a single image — T-7.06 placed it directly by
      // gid anyway, since its footprint is a normal building size, and flagged
      // the crop as unclaimed. Swap in the one measured pose (T-7.04's
      // `OBJ_SHIPPING_BOX_LOOK`) as a custom frame, same technique as the
      // house/coop/barn multi-cell buildings below.
      const frame = key === OBJ_SHIPPING_BOX.key ? this.shippingBoxFrame() : located.frame;
      // Single-image assets (chest) have no numbered frames; spritesheets do.
      const sprite = this.textures.get(key).has(String(frame))
        ? this.add.sprite(object.x, object.y, key, frame)
        : this.add.image(object.x, object.y, key);

      sprite.setOrigin(0, 1).setDepth(DEPTH.world + object.y);
    }
  }

  /**
   * Registers (once) and returns the name of the shipping box's cropped
   * frame. Guarded on the frame already existing: Phaser's texture manager
   * outlives a scene, so a restart would otherwise add it twice.
   */
  private shippingBoxFrame(): string {
    const name = 'shipping-box-look';
    const texture = this.textures.get(OBJ_SHIPPING_BOX.key);
    if (!texture.has(name)) {
      const { x, y, width, height } = OBJ_SHIPPING_BOX_LOOK;
      texture.add(name, 0, x, y, width, height);
    }
    return name;
  }

  /**
   * Spawns the character on the ground below the field.
   *
   * The camera does NOT follow it. The whole farm fits on screen at an integer
   * zoom (`fitCamera`), so a follow camera would only ever scroll the map away
   * from a player who can already see all of it — and would fight the fit.
   */
  private buildPlayer(): void {
    const map = this.map;
    if (!map) return;

    this.player = new Player(this, {
      spawn: spawnPoint(),
      bounds: playerBounds(map.widthInPixels, map.heightInPixels),
    });

    // The character is invisible until the server says what it looks like
    // (T-8.03). The HUD already receives that on every refresh, and again the
    // instant the creator saves, so it is the one that says so.
    hud.onAppearance((appearance) => {
      void this.player?.setAppearance(appearance);
    });
  }

  /**
   * One countdown label, moved to whichever plot is hovered.
   *
   * Per-tile text was unreadable once the camera zoom arrived: a Text object is
   * rasterised at its font size and then magnified by the camera, so it either
   * dwarfs a 16px tile or blurs. Rendering it at `fontSize x zoom` and scaling
   * back down by `1 / zoom` lands it at 1:1 on screen — crisp — and showing
   * only one keeps the authored map visible.
   */
  /**
   * The tile the character would act on (T-8.05).
   *
   * One rectangle moved every frame, not one per tile: the target is a single
   * cell by definition, and the plot markers already showed that a highlight
   * recomputed from current state every frame cannot get stuck the way an
   * event-driven one can.
   *
   * Drawn on `DEPTH.decor` — above the ground and the soil so it is visible on
   * a plot, below `DEPTH.world` so the character, the animals and the buildings
   * all pass in front of it rather than being outlined by it.
   */
  private buildTarget(): void {
    this.target = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE)
      .setStrokeStyle(1, COLOR.hover, TARGET_ALPHA)
      .setOrigin(0.5)
      .setDepth(DEPTH.decor)
      .setVisible(false);
  }

  /**
   * Moves the target highlight onto the faced tile.
   *
   * Hidden entirely until the character is on screen — see `Player.ready`.
   * Nothing here is sent anywhere: facing and adjacency are client-side UX
   * gates and the server never learns either (CLAUDE.md §5.1).
   */
  private updateTarget(): void {
    if (!this.target) return;

    const player = this.player;
    if (!player?.ready) {
      this.target.setVisible(false);
      return;
    }

    const centre = tileCentre(facedTile(player, player.facing));
    this.target.setPosition(centre.x, centre.y).setVisible(true);
  }

  private buildBadge(): void {
    this.badge = this.add
      .text(0, 0, '', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: `${11 * PIXEL_SCALE}px`,
        color: COLOR.paper,
        backgroundColor: COLOR.ink,
        padding: { x: 4 * PIXEL_SCALE, y: 2 * PIXEL_SCALE },
      })
      .setOrigin(0.5, 1)
      .setScale(1 / PIXEL_SCALE)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
  }

  /**
   * Integer zoom, centred on the map.
   *
   * Never a fractional zoom: 16px art resampled by 2.3x is mush regardless of
   * `pixelArt: true`. On a viewport too small for PIXEL_SCALE we step down to
   * the largest integer that fits rather than shrinking by a fraction.
   */
  private fitCamera(): void {
    const map = this.map;
    if (!map) return;

    const usableHeight = Math.max(1, this.scale.height - HUD_MARGIN);
    const fit = Math.min(
      this.scale.width / map.widthInPixels,
      usableHeight / map.heightInPixels,
    );
    const zoom = Math.max(1, Math.min(PIXEL_SCALE, Math.floor(fit)));

    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.centerOn(map.widthInPixels / 2, map.heightInPixels / 2 - HUD_MARGIN / (2 * zoom));

    // The badge counteracts the camera zoom, so it has to be re-scaled whenever
    // that zoom changes or it silently drifts off 1:1.
    this.badge?.setScale(1 / zoom).setFontSize(11 * zoom);
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  /** The tile under a world point, or null. Used by hover AND by clicks. */
  private tileAt(worldX: number, worldY: number): Tile | null {
    for (const tile of this.tiles.values()) {
      if (Phaser.Geom.Rectangle.Contains(tile.rect, worldX, worldY)) return tile;
    }
    return null;
  }

  /**
   * Recomputed every frame from the pointer's current position, rather than
   * accumulated from enter/leave events. A dropped event cannot leave a tile
   * stuck highlighted, and the highlight always marks the tile a click would
   * actually hit.
   */
  private updateHover(): void {
    const pointer = this.input.activePointer;
    const over = this.tileAt(pointer.worldX, pointer.worldY);
    this.hoveredId = over?.view.id ?? null;

    /*
     * The cursor promises only what a click actually does now (T-9.06): buy a
     * locked plot, or work the one tile the character is facing. Every other
     * plot is out of reach — walk to it — and a pointer over those would be
     * offering something that no longer happens.
     */
    const clickable =
      over !== null && (!over.view.unlocked || over.view.id === this.facedPlot()?.view.id);
    this.input.setDefaultCursor(clickable ? 'pointer' : 'default');
  }

  /* ---------------------------------------------------------------- *
   * Fetching
   * ---------------------------------------------------------------- */

  private async refresh(): Promise<void> {
    try {
      const state = await fetchFarm();
      // Measure the offset rather than trusting the local clock (§4.1).
      this.clockOffset = state.serverNow - Date.now();
      this.state = state;

      hud.setPlayer(state.player);
      // Gold the box paid while this poll was being served (T-11.03).
      hud.reportShippingPaid(state.shippingPaid);
      this.house?.setTier(state.farm.houseTier);
      // Which building the farm draws, from the same poll the shop reads
      // (T-12.02b). Nothing here decides a tier — buying one is a server
      // round trip and this is the next poll after it.
      this.coop?.setTier(state.farm.coopTier);
      this.barn?.setTier(state.farm.barnTier);
      // The shop's coop/barn rows read their tier from here (T-12.02).
      hud.setBuildings(state.farm.coopTier, state.farm.barnTier);
      /*
       * Idle mode's standing orders (T-13.05/06). The poll is the ONLY thing
       * that seeds the panel — no settings fetch of its own — which is also
       * what re-locks the character after a reload, before the player has
       * touched anything.
       */
      hud.setIdle(state.idle);
      this.player?.setInputLocked(state.idle.enabled);
      /*
       * What the farmer got through while the tab was shut (T-13.08). Said
       * once because the server says it once: the read that applied the shift
       * carries the summary, and the watermark it settled means the next poll
       * has nothing pending and nothing to report.
       */
      const away = idleSummaryMessage(state.idleSummary);
      if (away) hud.toast(away);
      this.syncTiles(state.plots, state.serverNow);
      this.syncAnimals(state.animals);
      await this.refreshPrices();
      this.layout();
      this.fitCamera();
      void hud.refreshInventory();
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      hud.toast(messageFor(err), 'error');
    }
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  private syncTiles(plots: readonly PlotView[], serverNow: number): void {
    for (const view of plots) {
      const existing = this.tiles.get(view.id);
      if (existing) {
        // The authoritative answer, replacing any optimistic guess (§4.1).
        setView(existing, view, serverNow);
        continue;
      }

      /*
       * An outline, not a filled square. Drawing an opaque rectangle over the
       * plot would hide the ground art and the soil below. Fill is used only to
       * dim locked plots.
       */
      const marker = this.add
        .rectangle(0, 0, TILE_SIZE, TILE_SIZE)
        .setStrokeStyle(1, COLOR.hover, 0)
        .setOrigin(0.5);

      /*
       * The soil underlay. One flat 16x16 tile (T-7.05's sampled ground
       * colours), swapped between dry and wet and hidden entirely on ground
       * that has never been hoed — so the three states of §5.2 are visible at a
       * glance without a legend.
       */
      const soil = this.add
        .image(0, 0, GROUND_SOIL_DRY.key)
        .setOrigin(0.5, 0.5)
        .setVisible(false);

      /*
       * T-7.07: unlike the old pack's single shared `CROPS_SHEET`, each crop
       * now has its own sheet (`CROPS[cropId].sheet`) — the texture key is set
       * per-plot in `setView` below whenever a crop is actually planted. The
       * texture given here is only a placeholder so the sprite has something
       * valid to construct from while invisible.
       *
       * The old pack's frames were 16x32 bottom-anchored (art in the bottom
       * half, transparent padding above); a bottom-anchored origin placed at
       * the tile's bottom edge was needed to land that art on the tile
       * correctly. The new pack's frames are square 16x16 (T-7.04, geometry
       * confirmed by T-7.08's measurement pass) — exactly one tile's worth of
       * pixels with no padding — so the sprite is centred on the tile's
       * centre instead. (The two would coincidentally produce the same pixels
       * for a same-size frame, but centring does not depend on frame height
       * matching TILE_SIZE, which the old bottom-anchored math silently did.)
       */
      const crop = this.add
        .sprite(0, 0, CROPS[CROP_IDS[0]!].sheet.key, 0)
        .setOrigin(0.5, 0.5)
        .setVisible(false);

      // Soil first: it is a full opaque tile, so anything that must be seen —
      // the crop, the outline — has to be added after it.
      const container = this.add.container(0, 0, [soil, marker, crop]);

      const tile: Tile = {
        view,
        viewAt: serverNow,
        container,
        marker,
        soil,
        crop,
        rect: new Phaser.Geom.Rectangle(0, 0, TILE_SIZE, TILE_SIZE),
        lastFrame: -1,
      };
      setView(tile, view, serverNow);
      this.tiles.set(view.id, tile);
    }
  }

  /**
   * Creates, updates and removes animal sprites from the authoritative list.
   *
   * Position comes from the animal's INDEX in the server's ordering (by
   * `acquiredAt`), not from anything stored — animals have no coordinates, and
   * the index is stable, so a cow does not wander between polls.
   */
  private syncAnimals(views: readonly AnimalView[]): void {
    const seen = new Set<string>();

    /*
     * Indexed WITHIN its own kind, because each kind stands in its own yard
     * (T-12.02). Using the position in the combined list would leave a gap in
     * the coop yard for every cow bought before a chicken — the slot exists,
     * nothing ever stands in it, and the flock looks scattered.
     *
     * `views` is ordered by `acquiredAt` server-side, so these counters are
     * stable across polls: an animal keeps the spot it was given.
     */
    const nextSlot = new Map<AnimalKind, number>();

    for (const view of views) {
      seen.add(view.id);

      // Counted for EVERY animal, not just new ones: an animal already on
      // screen still occupies its slot, and skipping it would hand its spot to
      // the next arrival and stack the two sprites.
      const index = nextSlot.get(view.kind) ?? 0;
      nextSlot.set(view.kind, index + 1);

      const existing = this.animals.get(view.id);
      if (existing) {
        existing.apply(view);
        continue;
      }

      this.animals.set(view.id, new Animal(this, view, pastureSlot(view.kind, index)));
    }

    // An animal is never deleted server-side (§5.3), so this only fires if one
    // somehow leaves the farm. Cleaning up anyway beats leaking a sprite.
    for (const [id, animal] of this.animals) {
      if (seen.has(id)) continue;
      animal.destroy();
      this.animals.delete(id);
    }
  }

  /**
   * Positions tiles on the farm's REAL grid coordinates, in map pixels.
   *
   * Plot (5,7) is at world (80,112) — the same cell the map editor marked —
   * however many plots are unlocked and whatever the viewport size. This is the
   * whole reason the old `min(plot.x)` re-centring had to go.
   */
  private layout(): void {
    for (const tile of this.tiles.values()) {
      const left = tile.view.x * TILE_SIZE;
      const top = tile.view.y * TILE_SIZE;

      tile.container.setPosition(left + TILE_SIZE / 2, top + TILE_SIZE / 2);
      // Sorted by bottom edge, like map objects, so a tree can stand in front.
      tile.container.setDepth(DEPTH.world + top + TILE_SIZE);
      // The click rect follows the drawing, always. Same numbers, one place.
      tile.rect.setTo(left, top, TILE_SIZE, TILE_SIZE);
    }
  }

  private redraw(now: number): void {
    let hoveredTile: Tile | null = null;

    for (const tile of this.tiles.values()) {
      const { view } = tile;
      const hovered = this.hoveredId === view.id;
      if (hovered) hoveredTile = tile;

      if (!view.unlocked) {
        // Locked plots are dimmed rather than hidden, so the farm reads as a
        // field with room to grow instead of a hole in the map.
        tile.marker.setFillStyle(COLOR.locked, 0.45);
        tile.marker.setStrokeStyle(1, COLOR.hover, hovered ? 0.9 : 0);
        tile.soil.setVisible(false);
        tile.crop.setVisible(false);
        tile.lastFrame = -1;

        if (hovered) {
          const cost = this.plotPrices.get(view.id);
          tile.container.setData(
            'label',
            cost === undefined ? 'Not for sale' : `Clear · ${cost.toLocaleString()}g`,
          );
        }
        continue;
      }

      tile.marker.setFillStyle(COLOR.locked, 0);
      // Drawn for every unlocked plot, planted or not: bare tilled soil is a
      // state the player has to be able to see, since it is what the hoe makes
      // and what a seed needs.
      drawSoil(tile, soilAt(view, now));

      if (view.cropId === null || view.plantedAt === null) {
        /*
         * Guarded on the sprite's own visibility rather than on `lastFrame`.
         * `lastFrame` is a cache of which frame is showing, and an optimistic
         * update can reset it while the sprite is still on screen — gating the
         * hide on the cache then leaves a harvested crop drawn in an empty plot.
         */
        if (tile.crop.visible) tile.crop.setVisible(false);
        tile.lastFrame = -1;
        tile.marker.setStrokeStyle(1, COLOR.hover, hovered ? 0.9 : 0);
        continue;
      }

      const crop = CROPS[view.cropId];
      const { stage, isRipe, readyInMs, isPaused } = this.interpolate(tile, now);
      const frame = crop.stageFrames[stage] ?? crop.stageFrames[0]!;

      // Each crop has its own sheet (T-7.07) — the texture key can change
      // between plantings on the same plot, not just the frame.
      if (tile.crop.texture.key !== crop.sheet.key) {
        tile.crop.setTexture(crop.sheet.key);
      }
      if (frame !== tile.lastFrame) {
        tile.crop.setFrame(frame).setVisible(true);
        tile.lastFrame = frame;
      }

      // A ripe plot is outlined even when it is not hovered — that is the one
      // thing a player scanning the farm needs to spot without pointing at it.
      if (isRipe) tile.marker.setStrokeStyle(1, COLOR.ripe, hovered ? 1 : 0.8);
      else tile.marker.setStrokeStyle(1, COLOR.hover, hovered ? 0.9 : 0);

      /*
       * A paused crop says so. The countdown alone would be a lie by omission:
       * it is frozen, and the player's fix is a watering can, not patience.
       */
      if (hovered) {
        const remaining = formatRemaining(readyInMs);
        tile.container.setData(
          'label',
          isRipe ? 'READY' : isPaused ? `DRY · ${remaining}` : remaining,
        );
      }
    }

    this.updateBadge(hoveredTile);
  }

  private updateBadge(tile: Tile | null): void {
    const badge = this.badge;
    if (!badge) return;

    if (!tile || !tile.view.unlocked || tile.view.cropId === null) {
      badge.setVisible(false);
      return;
    }

    const label = tile.container.getData('label') as string | undefined;
    if (!label) {
      badge.setVisible(false);
      return;
    }

    badge
      .setText(label)
      .setPosition(tile.rect.centerX, tile.rect.top - 2)
      .setVisible(true);
  }

  /** Smooths a plot's growth between polls. The rules live in `plots.ts`. */
  private interpolate(tile: Tile, now: number): PlotDisplay {
    return displayAt(tile.view, tile.viewAt, now);
  }

  /* ---------------------------------------------------------------- *
   * Intents
   * ---------------------------------------------------------------- */

  /**
   * The action key: E, Space, or a click on the tile the character faces.
   *
   * The character is the only thing that farms now (§5.1). Which intent that
   * means is `actions.ts`'s decision, from the equipped hotbar item and the
   * faced plot; this method is the plumbing around it — refuse while a swing is
   * playing, show a refusal, play the swing, send, reconcile.
   */
  private bindActionKeys(): void {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;

    for (const code of ACTION_KEYS) {
      keyboard.addKey(code, false).on('down', () => {
        // A shop quantity being typed is not an action key (§2, same rule the
        // hotbar follows).
        if (!isTypingInDom()) this.act();
      });
    }
  }

  /**
   * Records every tile a map object stands on.
   *
   * Tiled anchors a tile-object to its BOTTOM-LEFT corner, so the rows it
   * covers run UP from `object.y` — the same convention `buildMapObjects` draws
   * with (`setOrigin(0, 1)`). Getting that backwards puts the interactable
   * tiles one object-height below the art, which looks fine until someone
   * stands where the chest is drawn and nothing happens.
   */
  private rememberObjectTiles(
    into: Set<string>,
    object: Phaser.Types.Tilemaps.TiledObject,
    /** Overrides the map object's size, for art drawn smaller than its cell. */
    drawn?: { readonly width: number; readonly height: number },
  ): void {
    const left = Math.floor((object.x ?? 0) / TILE_SIZE);
    const bottom = Math.floor(((object.y ?? 0) - 1) / TILE_SIZE);
    const wide = Math.max(1, Math.round((drawn?.width ?? object.width ?? TILE_SIZE) / TILE_SIZE));
    const tall = Math.max(1, Math.round((drawn?.height ?? object.height ?? TILE_SIZE) / TILE_SIZE));

    for (let dx = 0; dx < wide; dx++) {
      for (let dy = 0; dy < tall; dy++) into.add(tileKey(left + dx, bottom - dy));
    }
  }

  /**
   * What the character is facing: a plot, the chest, or nothing.
   *
   * One tile can only be one of them, which is why this returns a union rather
   * than answering two questions separately — `actions.ts` then has a single
   * thing to decide about.
   */
  private facedTarget(now: number): Target | null {
    const player = this.player;
    if (!player?.ready) return null;

    const { tileX, tileY } = facedTile(player, player.facing);
    if (this.chestTiles.has(tileKey(tileX, tileY))) return { kind: 'chest' };
    if (this.shippingTiles.has(tileKey(tileX, tileY))) return { kind: 'shipping' };
    if (this.merchantTiles.has(tileKey(tileX, tileY))) return { kind: 'merchant' };

    // Animals stand in their own yards, well clear of the plot field and the
    // objects above, so the order between these two never actually decides
    // anything — but animals come first for the same reason they did on the
    // old click path: they are the smaller target.
    const animal = this.facedAnimal(tileX, tileY);
    if (animal) return { kind: 'animal', view: animal };

    const tile = this.plotAt(tileX, tileY);
    return tile ? { kind: 'plot', view: tile.view, isRipe: this.interpolate(tile, now).isRipe } : null;
  }

  /**
   * The animal standing on a tile, as the SERVER last described it.
   *
   * Hit-tested against the sprite's own `bounds()` — one tile, whatever the
   * art's width — so the tile a player can walk up to is exactly the tile they
   * can see it on. The view comes back out of `this.state` rather than off the
   * sprite so the gate reads the same snapshot every other decision here does.
   */
  private facedAnimal(tileX: number, tileY: number): AnimalView | null {
    const centre = tileCentre({ tileX, tileY });

    for (const animal of this.animals.values()) {
      if (!Phaser.Geom.Rectangle.Contains(animal.bounds(), centre.x, centre.y)) continue;
      return this.state?.animals.find((a) => a.id === animal.id) ?? null;
    }
    return null;
  }

  /** The plot on a tile, or null. */
  private plotAt(tileX: number, tileY: number): Tile | null {
    for (const tile of this.tiles.values()) {
      if (tile.view.x === tileX && tile.view.y === tileY) return tile;
    }
    return null;
  }

  /** The plot on the faced tile, or null when the character faces open ground. */
  private facedPlot(): Tile | null {
    const player = this.player;
    if (!player?.ready) return null;

    const { tileX, tileY } = facedTile(player, player.facing);
    return this.plotAt(tileX, tileY);
  }

  private act(): void {
    const player = this.player;
    // The swing IS the cooldown: one action per animation, so a held key
    // cannot queue a backlog the player stopped asking for.
    if (!player || player.isSwinging) return;

    /*
     * The farm is the farmer's while idle mode is on (T-13.06). Refused here
     * rather than by unbinding the keys: the same handler serves the action
     * key and a click on the faced tile, and a player who taps one deserves to
     * be told why nothing happened rather than to wonder if the key is broken.
     *
     * A UX gate only — the endpoints stay open, because a client that stopped
     * asking is not a server that stopped allowing (§4.1). Manual and simulated
     * work cannot interleave regardless: every farm mutation runs the pending
     * catch-up first, in its own committed transaction (T-13.04).
     */
    if (hud.isIdleEnabled()) {
      hud.toast('Your farmer is working. Switch idle mode off to take over.');
      return;
    }

    const dispatch: Dispatch = actionFor(this.equipped, this.facedTarget(this.serverNow()));

    if (dispatch.kind === 'nothing') return;
    if (dispatch.kind === 'refused') {
      hud.toast(dispatch.message);
      return;
    }
    // Opening a panel is not an intent: nothing is sent and nothing is swung.
    if (dispatch.kind === 'open') {
      const open = {
        chest: () => hud.openChest(),
        shipping: () => hud.openShipping(),
        shop: () => hud.openShop(),
      };
      void open[dispatch.what]();
      return;
    }

    // Collecting and feeding have no swing: the pack ships hoe and watering
    // strips and nothing for kneeling at a cow (T-8.09), and a wrong-looking
    // animation is worse than none.
    if (isAnimalIntent(dispatch)) {
      void this.sendAnimal(dispatch);
      return;
    }

    // Cosmetic, and it starts before the request rather than after it: the
    // swing is what covers the round trip now that nothing is predicted.
    const swing = swingFor(dispatch);
    if (swing) player.playToolAnimation(swing);

    void this.send(dispatch);
  }

  /**
   * Sends one intent and reconciles.
   *
   * **Nothing is drawn optimistically any more** (T-9.06). The old click-to-act
   * path guessed at the outcome to cover the round trip; the tool swing now
   * covers it, and it covers it honestly — the plot changes when the server
   * says it changed. Four intents would have meant four guesses about soil,
   * wetness, growth and produce, and every one of them is a chance to draw
   * something the server then contradicts (§4.1). The poll is authoritative and
   * this awaits it directly.
   */
  private async send(intent: FarmIntent): Promise<void> {
    const { plotId } = intent;
    if (this.busy.has(plotId)) return;
    this.busy.add(plotId);

    // One key per user action, reused if this action is retried (§4.5).
    const key = idempotencyKey();

    try {
      switch (intent.kind) {
        case 'till':
          await till(plotId, key);
          break;
        case 'plant':
          await plant(plotId, intent.cropId, key);
          hud.toast(`Planted ${CROPS[intent.cropId].name}.`);
          break;
        case 'water':
          await water(plotId, key);
          break;
        case 'harvest': {
          const result = await harvest(plotId, key);
          hud.toast(`Harvested ${result.quantity} × ${itemName(result.itemId)}.`);
          break;
        }
      }
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      hud.toast(messageFor(err), 'error');
    } finally {
      this.busy.delete(plotId);
      await this.refresh();
    }
  }

  /**
   * Sends one animal intent and reconciles (T-12.03).
   *
   * The mirror of `send` for the two intents that address an animal rather than
   * a plot. **Which of the two this is was decided by `actionFor`**, from what
   * is in hand — this function does not re-read the animal's state and pick,
   * the way the click handler it replaced used to.
   *
   * Not optimistic, like everything else since T-9.06. A collection's outcome
   * is an item count the client would have to invent to draw early, and
   * inventing item counts is exactly what §4.1 forbids; the round trip is short
   * and the icon disappearing on the response reads fine.
   */
  private async sendAnimal(intent: AnimalIntent): Promise<void> {
    const { animalId } = intent;
    if (this.busy.has(animalId)) return;
    this.busy.add(animalId);

    // One key per user action, reused if this action is retried (§4.5).
    const key = idempotencyKey();

    try {
      if (intent.kind === 'collect') {
        const result = await collectAnimal(animalId, key);
        hud.toast(`Collected ${result.quantity} × ${itemName(result.itemId)}.`);
      } else {
        const result = await feedAnimal(animalId, key);
        hud.toast(`Fed. ${itemName(result.itemId)} used.`);
      }
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      hud.toast(messageFor(err), 'error');
    } finally {
      this.busy.delete(animalId);
      await this.refresh();
    }
  }

  /**
   * Buying a locked plot.
   *
   * The click carries a plot id and nothing else — the price is the server's to
   * decide, and the number shown on hover came from the server too. Not
   * optimistic: a plot opening is a gold change, and gold is never drawn before
   * the server confirms it (§4.1).
   */
  private async onLockedPlotClicked(plotId: string): Promise<void> {
    const cost = this.plotPrices.get(plotId);
    if (cost === undefined) {
      hud.toast('That plot is not for sale.', 'error');
      return;
    }

    if (this.busy.has(plotId)) return;
    this.busy.add(plotId);

    try {
      const result = await unlockPlot(plotId, idempotencyKey());
      hud.toast(`Cleared a new plot for ${result.cost.toLocaleString()}g.`);
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      hud.toast(messageFor(err), 'error');
    } finally {
      this.busy.delete(plotId);
      await this.refresh();
    }
  }

  /**
   * Re-reads what the remaining plots cost.
   *
   * A failure here is cosmetic — the hover label falls back to "not for sale"
   * and the click is refused client-side — so it stays quiet rather than
   * toasting on every poll.
   */
  private async refreshPrices(): Promise<void> {
    try {
      const { plots } = await fetchExpansion();
      this.plotPrices.clear();
      for (const plot of plots) this.plotPrices.set(plot.plotId, plot.cost);
    } catch {
      // Leave the last known prices in place.
    }
  }

  shutdown(): void {
    this.pollTimer?.remove();
    this.player?.destroy();
    this.player = null;
    this.house?.destroy();
    this.house = null;
    this.coop?.destroy();
    this.coop = null;
    this.barn?.destroy();
    this.barn = null;
    for (const animal of this.animals.values()) animal.destroy();
    this.animals.clear();
    this.input.setDefaultCursor('default');
  }
}

/**
 * Where the character starts: standing just below the deepest plot, in the
 * column of the very first one.
 *
 * Derived from the same generated layout the plots themselves come from, so
 * moving the field in the map editor and re-running `pnpm plots` moves the
 * spawn with it. A hardcoded tile would quietly end up inside the soil — or
 * off the map — the first time the farm was re-authored.
 */
function spawnPoint(): { x: number; y: number } {
  const first = PLOT_POSITIONS[0] ?? { x: 0, y: 0 };
  const deepest = PLOT_POSITIONS.reduce((max, plot) => Math.max(max, plot.y), first.y);

  return {
    x: first.x * TILE_SIZE + TILE_SIZE / 2,
    // Feet on the bottom edge of the row below the field.
    y: (deepest + 2) * TILE_SIZE,
  };
}

/**
 * Point a tile at a view, recording the instant that view describes.
 *
 * Every growth field on a view is measured from the `serverNow` of whatever
 * produced it — a poll response, or an optimistic guess made between two polls
 * — so the reference is stored with it and the interpolation reads both.
 */
function setView(tile: Tile, view: PlotView, referenceNow: number): void {
  tile.view = view;
  tile.viewAt = referenceNow;
}

/** The soil texture for a state; `untilled` hides the sprite entirely. */
function drawSoil(tile: Tile, soil: SoilState): void {
  if (soil === 'untilled') {
    if (tile.soil.visible) tile.soil.setVisible(false);
    return;
  }

  const key = soil === 'wet' ? GROUND_SOIL_WET.key : GROUND_SOIL_DRY.key;
  if (tile.soil.texture.key !== key) tile.soil.setTexture(key);
  if (!tile.soil.visible) tile.soil.setVisible(true);
}

/**
 * Which tileset a map object's gid belongs to, **from the map's own table**.
 *
 * NOT `fromGid`, which walks the manifest's global allocation. The two agree
 * only while the manifest is exactly what it was when the map was saved, and
 * they had already drifted: adding or removing a sheet shifts every gid after
 * it, and the map keeps the numbers it was authored with. Sixteen of the map's
 * thirty-nine tilesets were past the drift point by T-11.03, which is why the
 * shipping box had silently stopped being drawn at all — `fromGid` returned
 * null for it and the object was skipped with a console warning nobody reads.
 *
 * A Tiled map carries its own tileset table for exactly this reason, and the
 * editor writes `name: run.key`, so the name IS the texture key (`buildMap`
 * already relies on that when registering them). Reading the map through the
 * map cannot drift.
 */
function locateInMap(
  map: Phaser.Tilemaps.Tilemap,
  gid: number,
): { key: string; frame: number } | null {
  for (const tileset of map.tilesets) {
    const frame = gid - tileset.firstgid;
    if (frame >= 0 && frame < tileset.total) return { key: tileset.name, frame };
  }
  return null;
}

/** A tile's identity in a Set. Two numbers, one string, no allocation games. */
function tileKey(tileX: number, tileY: number): string {
  return `${tileX},${tileY}`;
}

/** An item's display name, falling back to a readable form of its id. */
function itemName(itemId: string): string {
  return ITEMS[itemId]?.name ?? itemId.replace(/_/g, ' ');
}

function formatRemaining(ms: number): string {
  const total = Math.ceil(ms / 1000);
  if (total >= 3600) return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
  if (total >= 60) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${total}s`;
}
