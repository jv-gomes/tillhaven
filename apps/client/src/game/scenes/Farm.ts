import Phaser from 'phaser';
import {
  CROPS,
  CROP_IDS,
  ITEMS,
  FARM_MAP,
  FARM_WIDTH,
  FARM_HEIGHT,
  TILESET_SOIL,
  TILESET_WATER_ANIM,
  SOIL_DRY_FRAMES,
  WATER_ANIM_FRAMES,
  type TreeView,
  TOOL_WATERING_CAN_WOOD,
  OBJ_CHEST,
  OBJ_MAILBOX,
  OBJ_MAPLE_TREE,
  OBJ_NEWSSTAND,
  OBJ_SHIPPING_BOX,
  OBJ_SHIPPING_BOX_LOOK,
  SHIPPING_BOX_TILE,
  PIXEL_SCALE,
  PLOT_POSITIONS,
  TILE_SIZE,
  canPlaceDecor,
  ANIM_ID_PROPERTY,
  authoredCollisionCells,
  ANIM_LAYER_NAME,
  BUILTIN_GROUND_ANIMATIONS,
  SEA_ANIMATION_ID,
  animatedSheet,
  sheetAnimationFrames,
  getGroundAnimation,
  currentBuildingCells,
  tileToCells,
  tilesToCells,
  getDecor,
  reservedFarmTiles,
  pastureSlot,
  ANIMALS,
  solidDecorTiles,
  type DecorDef,
  HOUSE_ANCHOR,
  isHouseDoorTile,
  FARM_CONTENT,
} from '@tillhaven/shared/config';
import type { AnimalKind } from '@tillhaven/shared/config';


import type { AnimalView, FarmState, PlotView } from '@tillhaven/shared/types';
import {
  fetchFarm,
  fetchExpansion,
  plant,
  harvest,
  chop,
  till,
  water,
  unlockPlot,
} from '../../net/farm.js';
import { idempotencyKey } from '../../net/api.js';
import { isModalOpen, isTypingInDom } from '../../lib/focus.js';
import { touchControls } from '../touchControls.js';
import { messageFor, codeOf } from '../../net/errors.js';
import { hud } from '../hud.js';
import type { Equipped } from '../hotbar.js';
import { DEPTH, groundDepth } from '../depth.js';
import { NightOverlay } from '../dayNight.js';
import { burstDurationMs, burstFor } from '../effects.js';
import {
  floatFor,
  floatLifetimeMs,
  stackedOffsetY,
  type FloatKind,
  type FloatText,
} from '../floatText.js';
import { xpGained } from '../levelBar.js';
import { flashFor, popDurationMs, popFor, shakeFor } from '../tween.js';
import { cueForSwing } from '../audio.js';
import { play as playCue } from '../sound.js';
import { prefersReducedMotion } from '../motion.js';
import { centreOffset, fitZoom } from '../camera.js';
import { Player } from '../entities/Player.js';
import { facedTile, standingTile, tileCentre } from '../entities/targeting.js';
import { ACTION_KEYS } from '../keys.js';
import { NO_INPUT, playerBounds, type World } from '../entities/movement.js';
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
import { VILLAGERS, VillagerNpc } from '../entities/VillagerNpc.js';
import { addMapleTree, setTreeStanding } from '../entities/Tree.js';
import { CollisionOverlay } from '../entities/collisionOverlay.js';
import { idleSummaryMessage } from '../idleSummary.js';
import { DecorPiece } from '../entities/Decor.js';
import { fetchDecor, placeDecor, removeDecor } from '../../net/decor.js';
import {
  BlockMap,
  objectCells,
  objectTiles,
  playerWorld,
  terrainCells,
  type PlacedObject,
} from '../collision.js';
import { collectAnimal, feedAnimal } from '../../net/animals.js';
import {
  displayAt,
  plotBadgeFor,
  soilAt,
  soilFrame,
  soilMaskAt,
  thirstyCount,
  tileKey,
  type PlotDisplay,
  type SoilState,
} from '../plots.js';
import {
  actionFor,
  ANIMAL_SWING,
  isAnimalIntent,
  swingFor,
  swingForKind,
  type AnimalIntent,
  type Dispatch,
  type FarmIntent,
  type Swing,
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

const COLOR = {
  ripe: 0xfbf1e2,
  /** The placement ghost over ground a piece cannot go on (T-15.24). */
  refused: 0xd94f4f,
  hover: 0xfbf1e2,
  locked: 0x2a1018,
  ink: '#2a1018',
  paper: '#fbf1e2',
} as const;

/**
 * Fallback room the HUD needs at the top and bottom of the viewport.
 *
 * Only used before the HUD has mounted — after that, `hud.chrome()` measures
 * the real elements (T-15.27, T-18.03). It was the ONLY source until then, and
 * it had drifted: the bar renders at 71px, so the camera reserved 15px too
 * little and the top of the farm sat underneath it. A number that has to track
 * a stylesheet is a number that will not.
 */
const HUD_CHROME_FALLBACK = { top: 71, bottom: 80 } as const;

/**
 * How long the idle farmer may make no progress before collision is dropped
 * for the rest of that job (T-15.09).
 *
 * Two seconds: long enough that sliding along a wall, or waiting out a swing,
 * never trips it, and short enough that a genuinely pinned farmer is moving
 * again before the player has finished wondering why it stopped.
 */
const REPLAY_STUCK_MS = 2000;

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
  /**
   * The GROUND half of the plot: soil and outline, both flat (T-18.01).
   *
   * Held at `DEPTH.groundDecal`, not at a feet-Y — see that constant. The crop
   * is deliberately NOT in here: it stands up, so it sorts with everything else
   * that stands up.
   */
  readonly decal: Phaser.GameObjects.Container;
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
  /**
   * The "this needs water" marker (T-18.16). A sprite rather than a container
   * member because it sits ABOVE the crop, and the decal container is below it.
   */
  readonly thirst: Phaser.GameObjects.Sprite;
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
  /**
   * The last lifetime experience total the client has seen (T-30.04).
   *
   * Harvest and collect return a lifetime total, not a delta (see `xpGained`),
   * so the float needs something to subtract from. Seeded from the poll in
   * `refresh()` — **which is why the first harvest of a session shows the right
   * number rather than the player's entire career**: a zero seed would make the
   * first float read `+4,812 xp`.
   */
  private lastExperience = 0;
  /** What the hotbar says is in hand. Client-side state; never sent (§5.5). */
  private equipped: Equipped | null = null;
  private pollTimer?: Phaser.Time.TimerEvent;
  /** Plots with an intent in flight, so a double-click cannot double-send. */
  private readonly busy = new Set<string>();
  private hoveredId: string | null = null;

  private map?: Phaser.Tilemaps.Tilemap;
  /**
   * Which tiles the player cannot walk into (T-15.07).
   *
   * Layered so each source can be rebuilt on its own clock: `terrain` and
   * `objects` are fixed once the map loads, `buildings` changes when a tier is
   * bought, `animals` on every poll, `decor` on every placement.
   *
   * Distinct from the interaction sets below, and deliberately so: the chest is
   * both solid AND openable, but "cannot walk here" and "can act on this" are
   * different questions with different answers — a plot is walkable and
   * actionable, water is neither, a tree is solid and does nothing.
   */
  private readonly blocks = new BlockMap();

  /** What `blocks` looks like to `step()`. Rebuilt never — `blocked` is bound. */
  private world: World | null = null;

  /**
   * Placed decoration, by placement id (T-15.22).
   *
   * Fetched once on create and again after each mutation — deliberately NOT in
   * the 20-second poll. Decoration only changes when the player changes it, and
   * the farm-state endpoint is the hottest path in the game (§11); adding a
   * join to it so a fence can appear twenty seconds sooner is a bad trade.
   */
  private readonly decor = new Map<string, DecorPiece>();

  /** Idle-replay stuck detection (T-15.09). Reset whenever the job changes. */
  private replayStuckMs = 0;
  private replayLastX: number | null = null;
  private replayLastY: number | null = null;
  private replayUnstuck = false;

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
  /**
   * Tiles the mailbox stands on — the trade post since D-21 (T-22.01).
   *
   * Same rules as the chest: taken from the MAP rather than written down as a
   * constant, so moving the mailbox in the editor moves the trade post with it.
   */
  private readonly mailboxTiles = new Set<string>();
  /**
   * The collision overlay (T-23.01). Dev builds only — see `collisionOverlay.ts`.
   *
   * Null in production, which is what keeps `update` free of it: the whole
   * feature costs one null check per frame in a shipped build.
   */
  private collisionOverlay: CollisionOverlay | null = null;
  /*
   * The farm's trees (T-20.04). Three maps rather than one, because they are
   * keyed by different things and filled at different times:
   *
   * - `treeTiles`   tile the player faces -> the tree's own anchor tile. Built
   *                 once from the MAP, since that is what draws the trunk.
   * - `treeSprites` anchor tile -> the sprite to swap between tree and stump.
   * - `treeViews`   anchor tile -> the server's state for it, replaced every
   *                 poll. The server names trees by uuid and the map knows
   *                 nothing about uuids, so the anchor tile is the join —
   *                 `TREES` in shared config is what makes both sides agree on
   *                 it, and `farm.integration.test.ts` pins that the rows land
   *                 on exactly those positions.
   */
  private readonly treeTiles = new Map<string, string>();
  private readonly treeSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly treeViews = new Map<string, TreeView>();
  /** Countdown for the hovered plot only — one label instead of forty. */
  private badge?: Phaser.GameObjects.Text;
  /**
   * The water the farm floats on (MVP re-scope).
   *
   * A `TileSprite` **behind** the tilemap rather than more tiles inside it.
   * The map is 30x22 and the camera fits its content at an integer zoom, so on
   * anything wider than 4:3 there is bare page background either side of the
   * farm. Growing the tilemap would have worked too, and would have shifted
   * every tile coordinate — `PLOT_POSITIONS`, the `plots` table's x/y, every
   * decor placement — for a purely decorative margin. This costs one object.
   *
   * Sized to the camera's visible world rect on every fit, so it covers
   * whatever the viewport shows at whatever zoom, forever.
   */
  private water?: Phaser.GameObjects.TileSprite;
  /** Outline on the tile the character is facing. Cosmetic; gates nothing. */
  private target?: Phaser.GameObjects.Rectangle;
  /** Cosmetic. Gates nothing, and its position never leaves the browser. */
  private player: Player | null = null;
  /** Idle mode is running, per the last poll or toggle. */
  /** The day/night tint (MVP re-scope). Cosmetic; nothing reads it back. */
  private night: NightOverlay | null = null;

  private idleRunning = false;
  /** The player is in bed, per the HUD (MVP re-scope). */
  private sleeping = false;
  private readonly animals = new Map<string, Animal>();
  /** What each locked plot costs, from the server. Never computed here. */
  private readonly plotPrices = new Map<string, number>();
  private house: House | null = null;
  private coop: Coop | null = null;
  private barn: Barn | null = null;
  private villagers: VillagerNpc[] = [];
  /** Tiles the Chef stands on (T-33.03). */
  private readonly chefTiles = new Set<string>();
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

    // Before anything creates a plot: `soil` is constructed with a named frame
    // and Phaser would fall back to `__MISSING` if the name did not exist yet.

    this.buildMap();
    /*
     * Before the player. That used to be load-bearing — an equal depth was
     * broken by creation order — but since T-18.01 the player carries
     * `CHARACTER_BIAS` and wins those ties outright. The order is kept because
     * it is still the honest reading order for the scene, not because the draw
     * order depends on it.
     */
    this.house = new House(this, 0);
    this.coop = new Coop(this, 0);
    this.barn = new Barn(this, 0);
    this.buildVillagers();
    this.buildPlayer();
    this.buildTarget();
    this.buildBadge();
    // Decoration is fetched on its own, not in the farm poll (§11) — see
    // `refreshDecor`. Once here, then after every placement or pick-up.
    void this.refreshDecor();
    // Before the first fetch, not after it: `refresh()` also fits the camera,
    // but it is a network round trip away, and until it lands an unfitted
    // camera shows the map crammed into the top-left corner.
    this.createWater();
    // After the water and before the camera fit: it covers everything below
    // `DEPTH.night`, so what it is created next to does not matter — only that
    // it exists before the first frame is drawn, or the farm flashes daylight.
    this.night = new NightOverlay(this);
    this.fitCamera();

    hud.onEquippedChange((equipped) => {
      this.equipped = equipped;
    });

    this.bindActionKeys();

    // A shop trade changes the bag, so pull authoritative state again.
    /*
     * Fired by player ACTIONS (a shop purchase, an idle toggle) — never by the
     * 20-second poll, which has its own timer. So refreshing decoration here
     * keeps it off the hottest path (§11) while still restocking the tray the
     * moment something is bought.
     */
    hud.onStateChange(() => {
      void this.refresh();
      void this.refreshDecor();
    });

    /*
     * The level-up (T-30.05). The HUD detects it, because it is the only place
     * that sees every progress value — both the poll and the action responses
     * land there — and the scene reacts, because the camera is the scene's.
     */
    hud.onLevelUp(() => this.playLevelUp());

    /*
     * A claimed goal pays out at the character (T-30.09).
     *
     * Every other float in the game rises off the thing that produced it — the
     * plot, the animal, the shipping box. A milestone has no such thing: it is
     * paid by a panel for work done across the whole farm. The character is the
     * one place the player is certainly looking, and it is where the seeds have
     * just landed in the bag they are carrying.
     *
     * `standingTile`, not `facedTile`: the reward is not aimed at anything.
     */
    hud.onReward((reward) => {
      const player = this.player;
      if (!player?.ready) return;

      this.playFloats(standingTile(player), [
        { kind: 'gold', value: reward.gold },
        ...reward.items.map((stack) => ({
          kind: 'item' as const,
          value: stack.quantity,
          itemId: stack.itemId,
        })),
      ]);
    });

    /*
     * Switching idle on or off takes the character away from the player, or
     * gives it back — immediately, rather than at the next poll twenty seconds
     * later. The re-poll behind it is what brings the field itself up to date:
     * the PUT settles the watermark server-side, so the farm it describes has
     * already moved on.
     */
    hud.onIdleChange((view) => {
      this.idleRunning = view.enabled;
      this.lockInput();
      void this.refresh();
    });

    /*
     * Sleeping takes the character away for the same reason idle mode does,
     * and this scene has to honour it even though the bed is indoors: reload
     * while asleep and the game brings you back out here, where every action
     * would be refused with `ASLEEP` by a character that still walked around.
     */
    hud.onSleepChange((sleeping) => {
      this.sleeping = sleeping;
      this.lockInput();
    });
    // ...and the answer as it stands, because the listener only fires on a
    // change and the scene may be created into a game that is already asleep.
    this.sleeping = hud.isSleeping();

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
    // Cheap, and the only place `camera.worldView` is trustworthy.
    this.resizeWater();
    // Sized from the camera for the same reason, and stepped here rather than
    // on a timer so the catch-up rate is measured in frames actually drawn.
    this.night?.step(delta);

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
    const now = this.serverNow();
    this.redraw(now);
    /*
     * The SERVER clock, not Phaser's `_time` (changed in T-15.13).
     *
     * `_time` is milliseconds since this tab's game booted, so it differs
     * between two tabs on the same farm and resets on a reload. That was
     * harmless while `update` only bobbed a badge, but the wander derives an
     * animal's POSITION from it: on the local clock every reload would
     * teleport the whole flock, and two tabs would disagree about where the
     * cows are. On the shared clock the drift is the same curve everywhere,
     * and a tab that slept through a hundred legs picks up exactly where it
     * should.
     */
    for (const animal of this.animals.values()) animal.update(now);

    // Last, so it paints over everything it is describing.
    this.collisionOverlay?.draw(
      this.blocks,
      FARM_WIDTH,
      FARM_HEIGHT,
      this.player?.ready ? { x: this.player.x, y: this.player.y } : null,
      this.player?.ready ? facedTile(this.player, this.player.facing) : null,
    );
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

    // A different target, or the same one at a new instant, is a new job.
    const targetId = action.plotId ?? action.treeId ?? '';
    const key = `${targetId}@${action.at}`;
    if (!this.replay || `${this.replay.targetId}@${this.replay.at}` !== key) {
      /*
       * Where the farmer is heading: a plot's own cell, or — for a chop
       * (T-20.06) — the tree's anchor tile, found by id among the views the
       * poll brought. The trunk is what the character faces, and the anchor is
       * the tile the trunk stands on.
       */
      const plot = action.plotId ? this.tiles.get(action.plotId) : undefined;
      const tree = action.treeId
        ? [...this.treeViews.values()].find((v) => v.id === action.treeId)
        : undefined;
      const tile = plot
        ? { tileX: plot.view.x, tileY: plot.view.y }
        : tree
          ? { tileX: tree.x, tileY: tree.y }
          : null;
      this.replay = planReplay(player, action, tile);
      // A new job gets a fresh stuck-timer and its collision back (T-15.09).
      this.replayStuckMs = 0;
      this.replayLastX = null;
      player.setWorld(this.world);
      if (!this.replay) return;
    }

    const plan = this.replay;
    const now = this.serverNow();
    const stepPx = frameDistance(deltaMs);

    player.setDrive(replayInput(plan, player, now, stepPx));

    if (!hasArrived(plan, player, stepPx)) {
      this.checkReplayStuck(player, deltaMs, stepPx);
      return;
    }

    // Standing on the spot: look at the plot, then work it at the instant the
    // server named. Once — `at` stays in the past until the next poll replaces
    // the action, and a swing per frame would be a seizure.
    player.face(plan.facing);
    if (now >= plan.at && this.replaySwung !== key) {
      this.replaySwung = key;
      // Total since T-16.02, so the idle farmer now visibly plants and harvests
      // too — this line did not have to change for that, which is the point of
      // asking `swingForKind` rather than keeping a second list here.
      player.playToolAnimation(swingForKind(plan.kind));
      /*
       * The autonomous farmer kicks up the same dust the player does
       * (T-18.10). Nearly free: the replay already asks `swingForKind` what to
       * play, and `burstFor` is keyed off the same answer.
       *
       * The plot is read through `facedTile` rather than off the plan, which
       * carries a plot UUID and an approach position but no tile — and the
       * farmer has just been turned to face it on the line above, so this is
       * the same question the player's own path asks.
       */
      const worked = facedTile(player, plan.facing);
      const replaySwing = swingForKind(plan.kind);
      this.playBurst(replaySwing, worked.tileX, worked.tileY);
      const replayCue = cueForSwing(replaySwing);
      if (replayCue) playCue(replayCue);
    }
  }

  /**
   * The one-pixel white texture every burst is drawn from (T-18.10).
   *
   * Generated rather than shipped: a particle here is a single tinted pixel
   * scaled up, so an asset file would be one white dot and a manifest entry
   * that shifts every `firstgid` after it (T-7.09, T-8.03). Registered once and
   * guarded on existence, because Phaser's texture manager outlives a scene and
   * a restart would otherwise add it twice — the same guard `shippingBoxFrame`
   * already needs.
   */
  private particleTexture(): string {
    const key = 'fx-pixel';
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
      g.generateTexture(key, 2, 2);
      g.destroy();
    }
    return key;
  }

  /**
   * A puff of something at the tile that was just worked (T-18.10, G-4/F-6).
   *
   * **Held to `prefers-reduced-motion`.** A burst is a handful of objects
   * darting outward in the player's focus, which is squarely what the setting
   * is about — and unlike the maple loop and the animal wander (T-17.01) it is
   * triggered by the player rather than ambient, so it is *more* likely to be
   * noticed, not less. Under reduced motion the action still has its swing, its
   * toast and the tile changing under it.
   *
   * The emitter stops immediately and destroys itself once the last particle
   * has expired: `explode()` emits the whole burst in one frame, which is what
   * an impact is, and `burstDurationMs` is how long the debris can still be in
   * the air.
   *
   * Depth is `targetOutline`, the band between the ground decals and anything
   * that stands up. Dust must clear tilled soil — the tile it is landing on is
   * about to become soil, and a puff drawn under it would be invisible at
   * exactly the moment it fires — but it must not draw over the character
   * swinging the tool.
   */
  private playBurst(swing: Swing, tileX: number, tileY: number): void {
    if (prefersReducedMotion()) return;

    const burst = burstFor(swing);
    if (!burst) return;

    const emitter = this.add.particles(
      tileX * TILE_SIZE + TILE_SIZE / 2,
      tileY * TILE_SIZE + TILE_SIZE / 2,
      this.particleTexture(),
      {
        tint: [...burst.tints],
        speed: burst.speed,
        lifespan: burst.lifespanMs,
        gravityY: burst.gravityY,
        angle: burst.angle,
        scale: burst.scale,
        quantity: burst.count,
        emitting: false,
      },
    );

    emitter.setDepth(DEPTH.targetOutline);
    emitter.explode(burst.count);
    this.time.delayedCall(burstDurationMs(burst), () => emitter.destroy());
  }

  /**
   * The reward, rising off the thing that produced it (T-30.04).
   *
   * Every reward in this game has landed as a corner toast since T-18.19. That
   * is right for a **refusal** — a refusal is about the rule, not the tile —
   * and wrong for a reward, because the player pressed a key at one specific
   * tile and the answer appeared somewhere they were not looking. The toast
   * stays; this is what joins the number to the place.
   *
   * **Unlike `playBurst`, this runs under reduced motion.** A burst is pure
   * decoration and is suppressed outright; a float carries a *number the player
   * needs*, so the setting removes its travel (`risePx: 0`, decided in
   * T-30.03) rather than removing the label. Suppressing it here would take
   * information away from exactly the players most likely to want it stated
   * plainly.
   *
   * Fired AFTER the response, not before it like the burst — a burst is a
   * reaction to the player's own input and may honestly precede the answer,
   * but a float states what the server granted and must not guess (§4.1).
   */
  /**
   * The level-up (T-30.05).
   *
   * A knock and a wash of the level bar's own green — the same value the XP
   * float uses, so this reads as the existing system announcing itself louder
   * rather than as a new effect. Gentle on purpose: a level-up is good news,
   * and a hard shake is the vocabulary of damage (see `LEVEL_UP_SHAKE`).
   *
   * The flash survives reduced motion in shortened form while the shake does
   * not — a colour wash is not the kind of movement the setting is about, and
   * without it a reduced-motion player's only signal that they levelled is a
   * bar quietly resetting to empty.
   */
  private playLevelUp(): void {
    const reduced = prefersReducedMotion();

    const shake = shakeFor(reduced);
    if (shake) this.cameras.main.shake(shake.durationMs, shake.intensity);

    const flash = flashFor(reduced);
    this.cameras.main.flash(flash.durationMs, ...flash.rgb);

    playCue('open');
  }

  /**
   * The plot reacting to being harvested (T-30.05).
   *
   * Scales the crop sprite and lets it settle. `yoyo` rather than a second
   * tween so there is one object to cancel, and the sprite's own scale is
   * captured first: the field re-renders on every poll, so a pop that assumed
   * a resting scale of 1 would fight whatever the renderer had set.
   */
  private popSprite(sprite: Phaser.GameObjects.Sprite | undefined): void {
    const pop = popFor(prefersReducedMotion());
    if (!pop || !sprite) return;

    const restingX = sprite.scaleX;
    const restingY = sprite.scaleY;

    this.tweens.add({
      targets: sprite,
      scaleX: restingX * pop.scale,
      scaleY: restingY * pop.scale,
      duration: pop.durationMs,
      ease: pop.ease,
      yoyo: true,
      onComplete: () => sprite.setScale(restingX, restingY),
    });

    // The poll can replace this sprite mid-tween; restoring the scale on a
    // timer as well means a replaced object never gets left enlarged.
    this.time.delayedCall(popDurationMs(pop) + 50, () => sprite.setScale(restingX, restingY));
  }

  private playFloats(
    at: { readonly tileX: number; readonly tileY: number },
    entries: readonly { kind: FloatKind; value: number; itemId?: string }[],
  ): void {
    const reduced = prefersReducedMotion();
    const x = at.tileX * TILE_SIZE + TILE_SIZE / 2;
    const baseY = at.tileY * TILE_SIZE + TILE_SIZE / 2;

    /*
     * Only the floats that survived `floatFor` are stacked, so a zero-XP
     * harvest does not leave a gap where a label would have been. Indexing the
     * INPUT list instead would space the survivors as though the dropped one
     * were still there.
     */
    const floats = entries
      .map((e) => floatFor(e.kind, e.value, { itemId: e.itemId, reducedMotion: reduced }))
      .filter((f): f is FloatText => f !== null);

    floats.forEach((float, index) => {
      const label = this.add.text(x, baseY - stackedOffsetY(float, index), float.text, {
        fontFamily: 'monospace',
        fontSize: `${float.fontPx}px`,
        color: `#${float.tint.toString(16).padStart(6, '0')}`,
        stroke: '#2a1018',
        strokeThickness: 3,
      });

      label.setOrigin(0.5, 1);
      label.setDepth(DEPTH.targetOutline);
      /*
       * Rasterise at the size it will actually be seen at.
       *
       * The camera runs at an integer zoom, so a label drawn at 1x and then
       * scaled up by the camera is a blurry 8px bitmap stretched over 24
       * screen pixels — which the first browser run showed clearly against
       * pixel art that is crisp everywhere else. `setResolution` renders the
       * glyphs at the final size instead. Read from the camera rather than
       * hardcoded, so it stays right if D-12 ever changes the zoom.
       */
      label.setResolution(Math.max(1, Math.round(this.cameras.main.zoom)));

      this.tweens.add({
        targets: label,
        y: label.y - float.risePx,
        alpha: 0,
        duration: float.durationMs,
        ease: 'Quad.easeOut',
        onComplete: () => label.destroy(),
      });

      // A tween is not a guarantee of destruction — a scene shutdown mid-flight
      // would leave the object behind — so the lifetime is the backstop.
      this.time.delayedCall(floatLifetimeMs(float), () => label.destroy());
    });
  }

  /**
   * Frees the idle farmer if collision has pinned it somewhere (T-15.09, D-8).
   *
   * The replay walks straight octile lines with no obstacle avoidance.
   * `reachability.test.ts` proves the authored map cannot trap it — but that
   * proof covers the map as authored, and once T-15.24 lets players place solid
   * decor, the farm stops being something a test can enumerate ahead of time.
   *
   * So: if the farmer has made no progress for `REPLAY_STUCK_MS`, drop
   * collision for the rest of this job. The replay is COSMETIC (§4.1) — the
   * server already decided what was farmed and when, and this walk only
   * animates it. The honest failure mode is "the farmer clipped a corner",
   * never "the farm stopped working", and a farm that appears to freeze because
   * a fence was placed badly is the worse of the two by a distance.
   *
   * Progress is measured as movement, not as distance-to-target: a farmer
   * sliding along a wall is moving and will get there, while one pressed into a
   * corner is not.
   */
  private checkReplayStuck(player: Player, deltaMs: number, stepPx: number): void {
    const moved =
      this.replayLastX === null ||
      Math.abs(player.x - this.replayLastX) + Math.abs(player.y - (this.replayLastY ?? 0)) >
        stepPx / 4;

    this.replayLastX = player.x;
    this.replayLastY = player.y;

    if (moved) {
      this.replayStuckMs = 0;
      return;
    }

    this.replayStuckMs += deltaMs;
    if (this.replayStuckMs < REPLAY_STUCK_MS) return;

    // Once per job, not once per frame: setWorld(null) is idempotent but the
    // warning is not, and a stuck farmer would log sixty times a second.
    if (!this.replayUnstuck) {
      this.replayUnstuck = true;
      console.warn('[tillhaven] idle farmer stuck; walking through obstacles for this job');
    }
    player.setWorld(null);
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
    this.buildTileAnimations(map);
    this.buildGroundAnimations(map);
    this.buildTerrainCollision(map);
  }

  /**
   * Animates painted tiles whose SHEET is animated by construction.
   *
   * **Painting water animates it, with no stamping.** The shoreline and
   * open-water sheets each hold four frames of the same art a fixed offset
   * apart (see `ANIMATED_SHEETS`), so a tile painted from the first block is
   * already frame 1 of a loop and the other three can be derived. Before this,
   * the shore stood still while the backdrop behind it moved, and the only fix
   * available was one hand-authored `GroundAnimation` per shoreline tile plus a
   * stamp on every cell — a hundred placements to say one thing about the art.
   *
   * **The tile's index is mutated in place; no new game objects.** The
   * alternative — an `Image` per animated cell, the way `buildGroundAnimations`
   * necessarily works — would be a few hundred sprites over the ground layer,
   * each needing its own depth answer. Tiles that stay tiles keep the depth,
   * the culling and the collision they already had.
   *
   * **One timer per rate, not per tile**, for the reason the ground animations
   * give: dozens of clocks doing identical work, and any drift between them
   * reads as the water tearing.
   *
   * Resolved through the MAP's tileset table rather than `fromGid`, like
   * `buildTerrainCollision`: Phaser renumbers tile indices as it loads a map, so
   * the index on a placed tile is not necessarily the manifest gid it was
   * authored with.
   */
  private buildTileAnimations(map: Phaser.Tilemaps.Tilemap): void {
    /** Tiles to step, grouped by rate, each carrying the gids of its loop. */
    const byFps = new Map<number, { tile: Phaser.Tilemaps.Tile; gids: number[] }[]>();

    for (const layerData of map.layers) {
      for (const row of layerData.data) {
        for (const tile of row) {
          if (!tile || tile.index <= 0) continue;

          const tileset = tilesetOf(map, tile.index);
          if (!tileset) continue;

          const spec = animatedSheet(tileset.name);
          if (!spec) continue;

          // The list starts at the frame that was painted, whichever block of
          // the sheet it came from, so nothing on screen moves until the first
          // tick — the map file and a paused game agree.
          const frames = sheetAnimationFrames(tileset.name, tile.index - tileset.firstgid);
          if (!frames) continue;

          const entry = { tile, gids: frames.map((f) => tileset.firstgid + f) };
          const group = byFps.get(spec.fps);
          if (group) group.push(entry);
          else byFps.set(spec.fps, [entry]);
        }
      }
    }

    for (const [fps, tiles] of byFps) {
      let step = 0;
      this.time.addEvent({
        delay: 1000 / fps,
        loop: true,
        callback: () => {
          step += 1;
          for (const { tile, gids } of tiles) {
            // `gids` is never empty — `sheetAnimationFrames` returns the base as
            // frame 0 or returns null.
            tile.index = gids[step % gids.length]!;
          }
        },
      });
    }
  }

  /**
   * Marks the water solid (T-15.08).
   *
   * Resolved through the MAP's own tileset table rather than through `fromGid`,
   * the same reason `buildMapObjects` uses `locateInMap`: Phaser renumbers tile
   * indices as it loads a map, so the index on a placed tile is not necessarily
   * the manifest gid it was authored with. Reading the map's table is reading
   * what is actually on screen.
   *
   * Only the flat `water-tile` fill blocks. The shoreline column is grass with
   * a strip of water down its edge — it is the bank, and you stand on it.
   */
  private buildTerrainCollision(map: Phaser.Tilemaps.Tilemap): void {
    const ground = map.layers[0];
    if (!ground) return;

    /*
     * Key AND frame, since the collision shape is per-frame (T: sub-tile
     * collision). `locateInMap` already resolves both — the frame is the tile's
     * index within its own tileset, which is what `TILE_COLLISION_MASK` is
     * keyed by.
     */
    const at = (x: number, y: number): { key: string; frame: number } | null => {
      const tile = map.getTileAt(x, y, false, ground.name);
      if (!tile || tile.index <= 0) return null;
      const located = locateInMap(map, tile.index);
      return located ? { key: located.key, frame: located.frame } : null;
    };

    /*
     * The art's own shapes, plus whatever the MAP was told to block on top.
     *
     * Both go in the `terrain` layer because both are fixed once the map loads
     * — they update on the same clock, which is the whole reason `BlockMap` is
     * layered. A sixth layer would be a sixth thing to remember to rebuild.
     */
    const cells = [...terrainCells(at), ...authoredCollisionCells()];
    this.blocks.set('terrain', cells);

    /*
     * Dev-only cross-check: the tiles derived from the rendered map must match
     * the tiles `farmLayout.ts` says are water. The two are generated from the
     * same constants, so a mismatch means the committed map and the shared
     * config have drifted (T-15.00's failure mode) and the server is validating
     * decor against a farm that is not the one being drawn.
     */
    /*
     * The collision overlay (T-23.01), on F1. Dev only, and constructed only in
     * dev so production carries neither the Graphics object nor the key binding.
     *
     * F1 rather than a letter: every letter key is either movement, the action
     * key or a hotbar slot, and a debug toggle that also swings a hoe is worse
     * than no toggle.
     */
    if (import.meta.env.DEV) {
      this.collisionOverlay = new CollisionOverlay(this);
      this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.F1, false).on('down', () => {
        const on = this.collisionOverlay?.toggle() ?? false;
        hud.toast(`Collision overlay ${on ? 'on' : 'off'} — ${this.blocks.size} solid cells`);
      });
    }

    /*
     * The dev-only cross-check that used to live here is gone.
     *
     * It warned when the water in `farm.json` disagreed with `farmLayout.ts`,
     * which was the right alarm while the config was authoritative and the map
     * was painted from it. `pnpm layout` reverses that: `waterTiles()` is now
     * READ OUT of the map, so the two cannot disagree and the check could only
     * ever compare the map against itself.
     */
  }

  /**
   * Places the trees, chests and buildings from the map's `objects` layer.
   *
   * Tiled anchors tile-objects to their BOTTOM edge, which is exactly what
   * pixel-art scenery wants: `setOrigin(0, 1)` puts the sprite's feet on the
   * tile the author clicked, so a 48px tree stands on its cell instead of
   * floating two tiles above it.
   */
  /**
   * Plays the animations the MAP placed (the mapmaker's third authored thing).
   *
   * **One timer per animation id, not per cell.** A field of rippling water is
   * dozens of placements and they all show the same frame at the same moment;
   * a timer each would be dozens of clocks doing identical work, and any drift
   * between them would read as the water tearing.
   *
   * **`setTexture`, not `setFrame`**, because frames may come from different
   * sheets — that is the point of an ordered frame list. It is also the trap
   * the water backdrop already paid for once, from the other direction: on a
   * `TileSprite`, `setFrame` bakes into an internal fill-pattern canvas and the
   * water sat perfectly still while every debug reading said the frame was
   * changing.
   *
   * Drawn at `DEPTH.groundDecal` — flat on the floor, over the tile layers,
   * under anything that stands. The same band tilled soil uses, and for the
   * same reason: it has no height, so it can never occlude a character.
   */
  private buildGroundAnimations(map: Phaser.Tilemaps.Tilemap): void {
    const layer = map.getObjectLayer(ANIM_LAYER_NAME);
    if (!layer) return;

    const byAnimation = new Map<string, Phaser.GameObjects.Image[]>();

    for (const object of layer.objects) {
      if (object.x === undefined || object.y === undefined) continue;

      const animId = object.properties?.find(
        (p: { name?: string }) => p.name === ANIM_ID_PROPERTY,
      )?.value as string | undefined;
      if (!animId) continue;

      const animation = getGroundAnimation(animId);
      if (!animation) {
        console.warn(`[tillhaven] map places unknown ground animation "${animId}"`);
        continue;
      }

      const first = animation.frames[0]!;
      // No gid on these rectangles, so `y` is the TOP edge — the opposite
      // convention from a tile-object, in the same file.
      const image = this.add
        .image(object.x, object.y, first.sheet, first.frame)
        .setOrigin(0, 0)
        .setDepth(DEPTH.groundDecal);

      const group = byAnimation.get(animId);
      if (group) group.push(image);
      else byAnimation.set(animId, [image]);
    }

    for (const [animId, images] of byAnimation) {
      const animation = getGroundAnimation(animId)!;
      let step = 0;
      this.time.addEvent({
        delay: 1000 / animation.fps,
        loop: true,
        callback: () => {
          step = (step + 1) % animation.frames.length;
          const frame = animation.frames[step]!;
          for (const image of images) image.setTexture(frame.sheet, frame.frame);
        },
      });
    }
  }

  private buildMapObjects(map: Phaser.Tilemaps.Tilemap): void {
    const layer = map.getObjectLayer('objects');
    if (!layer) return;

    /*
     * What each object actually STANDS on, for collision (T-15.08).
     *
     * Collected here rather than derived from the object's declared size: the
     * map records a maple as 32x48 for a trunk 12px wide, so the declared box
     * would block a tree's whole canopy — which the player is supposed to walk
     * behind. `objectTiles` uses the measured footing from T-15.04 and ignores
     * any art that has none.
     */
    const solid: PlacedObject[] = [];

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
        const sprite = addMapleTree(this, object.x, object.y);
        solid.push({ key, anchorPx: { x: object.x, y: object.y } });

        /*
         * Remember it by its anchor TILE, the same coordinate `TREES` uses, so
         * the server's rows and these sprites describe the same forest.
         * Tiled anchors a tile-object at its bottom edge, so the anchor row is
         * one above `object.y` (see `objectAnchorPx`).
         */
        const anchor = tileKey(
          Math.floor(object.x / TILE_SIZE),
          Math.floor((object.y - 1) / TILE_SIZE),
        );
        this.treeSprites.set(anchor, sprite);
        /*
         * Which tiles chop from: the TRUNK, not the 32x48 cell. The measured
         * base is 12px and straddles a tile boundary, so it is two tiles — the
         * same two `objectFootprint` makes solid, which is what the player is
         * standing next to when they face it (T-18.05).
         */
        for (const t of objectTiles([{ key, anchorPx: { x: object.x, y: object.y } }])) {
          this.treeTiles.set(tileKey(t.x, t.y), anchor);
        }
        continue;
      }

      solid.push({ key, anchorPx: { x: object.x, y: object.y } });

      /*
       * Remember which tiles the chest covers, so the action key can tell when
       * the character is facing it (T-10.05). Taken from the map rather than
       * written down as a constant: the chest is placed in the editor, and a
       * second copy of its position here would be one that silently goes stale
       * the first time someone moves it (§9).
       */
      if (key === OBJ_CHEST.key) this.rememberObjectTiles(this.chestTiles, object);
      if (key === OBJ_NEWSSTAND.key) this.rememberObjectTiles(this.merchantTiles, object);
      if (key === OBJ_MAILBOX.key) this.rememberObjectTiles(this.mailboxTiles, object);
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

      sprite.setOrigin(0, 1).setDepth(groundDepth(object.y));
    }

    /*
     * The villagers block their own tiles too (T-18.02, T-33.03). Added here
     * rather than where the sprites are built because `set` replaces a layer
     * wholesale — one place owns the `objects` layer, and a second writer would
     * silently drop whichever ran first.
     *
     * Bare tiles rather than `objectCells` footings: an NPC is not a map object
     * with a measured base, it stands on exactly the tile config names — so each
     * converts whole, all nine cells of it.
     *
     * Read from `VILLAGERS` rather than naming the merchant, so T-33.03's second
     * face needed no edit here and a third will need none either.
     */
    this.blocks.set('objects', [
      ...objectCells(solid),
      ...VILLAGERS.flatMap((v) => tileToCells(v.tile)),
    ]);
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

    /*
     * Solid ground (T-15.08). `blocks.blocked` is bound to the instance, so the
     * player keeps reading the live map as layers are rebuilt on each poll —
     * no re-plumbing when a coop tier changes.
     *
     * **`COLLISION_CELL`, not `TILE_SIZE`.** This one line is what makes
     * collision sub-tile: `step` and `slide` in `movement.ts` are written
     * entirely in terms of `world.tileSize` with no hard-coded 16, so handing
     * them a third of a tile makes the character collide at a third of a tile.
     * Neither function changed for any of this.
     */
    this.world = playerWorld(this.blocks.blocked);
    this.player.setWorld(this.world);

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
   * Drawn on `DEPTH.targetOutline` — above the ground and the soil so it is
   * visible on a plot, below `DEPTH.world` so the character, the animals and the
   * buildings all pass in front of it rather than being outlined by it.
   */
  private buildTarget(): void {
    this.target = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE)
      .setStrokeStyle(1, COLOR.hover, TARGET_ALPHA)
      .setOrigin(0.5)
      .setDepth(DEPTH.targetOutline)
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

    const faced = facedTile(player, player.facing);
    const centre = tileCentre(faced);

    /*
     * While a piece is armed the marker becomes the placement ghost (T-15.24):
     * it grows to the piece's footprint and turns red where it cannot go.
     *
     * Sized and coloured from `canPlaceDecor`, the SAME function the server
     * gates on — so the ghost and the refusal agree. It is a courtesy, not a
     * gate: the server checks again regardless (§4.1), and the reachability
     * rule is server-only, so a red-free ghost can still be refused. That is
     * the right way round.
     */
    const armed = hud.armedDecor();
    const def = armed ? getDecor(armed) : undefined;

    if (def) {
      const w = def.footprint.width * TILE_SIZE;
      const h = def.footprint.height * TILE_SIZE;
      const legal = canPlaceDecor(
        def,
        faced.tileX,
        faced.tileY,
        this.reservedTiles(),
        [...this.decor.values()].map((p) => ({ def: p.def, x: p.tileX, y: p.tileY })),
      );

      this.target
        .setSize(w, h)
        .setPosition(faced.tileX * TILE_SIZE + w / 2, faced.tileY * TILE_SIZE + h / 2)
        .setStrokeStyle(1, legal.ok ? COLOR.ripe : COLOR.refused, 0.95)
        .setVisible(true);
      return;
    }

    this.target
      .setSize(TILE_SIZE, TILE_SIZE)
      .setStrokeStyle(1, COLOR.hover, TARGET_ALPHA)
      .setPosition(centre.x, centre.y)
      .setVisible(true);
  }

  /**
   * Ground decoration may not go on, for the tiers the farm currently has.
   *
   * Recomputed per frame while a piece is armed, which sounds wasteful and is
   * not: it is a few hundred Set inserts, only while the tray is open, and
   * caching it would need invalidating on every tier change and every poll.
   */
  private reservedTiles(): ReadonlySet<string> {
    const farm = this.state?.farm;
    return reservedFarmTiles({ coop: farm?.coopTier ?? 0, barn: farm?.barnTier ?? 0 });
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
   * Integer zoom, centred in the band between the HUD bar and the hotbar.
   *
   * Never a fractional zoom: 16px art resampled by 2.3x is mush regardless of
   * `pixelArt: true`. On a viewport too small for PIXEL_SCALE we step down to
   * the largest integer that fits rather than shrinking by a fraction.
   *
   * **Two things changed in T-18.03, and both are about what "fits" means.**
   *
   * It fits `FARM_CONTENT`, not the whole map. Requiring all 480x352 of the
   * bitmap meant a 1366x768 laptop — the most common size there is — computed a
   * fit of 1.988, floored to **1**, and rendered the farm at native size in the
   * middle of a dark blue screen, missing zoom 2 by four pixels of viewport
   * height. Those four pixels were a scalloped grass fringe. The fringe is
   * decoration and may be clipped; the farm may not.
   *
   * And it subtracts BOTH bars. The old fit knew only about the top bar, so the
   * zoom it handed back could put the bottom rows — the southern path, the
   * barn's door — underneath the hotbar. Reserving only the chrome you remember
   * is how the farm ended up under the top bar in the first place (T-15.27).
   *
   * Together those pull in opposite directions, which is the point: the first
   * buys roughly a zoom level, the second spends part of it on being honest
   * about the bottom of the screen. `hud.css` shrinks the chrome on short
   * viewports so 1366x768 clears the bar it would otherwise just miss.
   */
  /**
   * Lays the animated water down behind everything — the sea the farm floats on.
   *
   * **Driven by the `water-ripple` animation, so the map editor can change it.**
   * This used to read `WATER_ANIM_FRAMES` and `WATER_ANIM_FPS` straight out of
   * the manifest, which meant there was a built-in animation called "Rippling
   * water", derived from those same constants, that the sea ignored completely:
   * you could edit it in the editor, save, reload, and watch nothing happen,
   * with nothing anywhere explaining why. Resolving it through
   * `getGroundAnimation` means an authored override reaches the backdrop, which
   * is what somebody editing an animation named after the water expects.
   *
   * The built-in is the fallback rather than the source, so a library that
   * somehow lost the id still gets a sea instead of a crash.
   *
   * The frames are stepped by a timer rather than a Phaser animation because a
   * `TileSprite` draws one frame of a texture as a repeating pattern; it has no
   * animation of its own to play.
   *
   * **`setTexture`, not `setFrame`, and the difference is invisible until you
   * check.** A TileSprite bakes its frame into an internal fill-pattern canvas;
   * `setFrame` updates the object's frame reference without rebuilding that
   * canvas, so the water sat perfectly still while every debug reading said the
   * frame was changing. Caught by hashing the rendered canvas rather than by
   * asking the object what it thought it was doing.
   *
   * `setTexture` also takes the sheet per frame, so an overridden sea may draw
   * from more than one — which the old form, with the key hardcoded, could not.
   */
  private createWater(): void {
    const animation =
      getGroundAnimation(SEA_ANIMATION_ID) ??
      BUILTIN_GROUND_ANIMATIONS.find((a) => a.id === SEA_ANIMATION_ID)!;
    const frames = animation.frames;

    const first = frames[0] ?? { sheet: TILESET_WATER_ANIM.key, frame: WATER_ANIM_FRAMES[0]! };
    this.water = this.add
      .tileSprite(0, 0, 1, 1, first.sheet, first.frame)
      .setOrigin(0, 0)
      .setDepth(DEPTH.ground - 100)
      .setScrollFactor(1);

    // A one-frame sea is a still one. A timer swapping a texture for itself is
    // a full fill-pattern canvas rebuild, four times a second, for no change on
    // screen — and an author is allowed to want flat water.
    if (frames.length < 2) return;

    let step = 0;
    this.time.addEvent({
      delay: 1000 / animation.fps,
      loop: true,
      callback: () => {
        step = (step + 1) % frames.length;
        const frame = frames[step]!;
        this.water?.setTexture(frame.sheet, frame.frame);
      },
    });
  }

  /**
   * Stretches the water to cover whatever the camera can see.
   *
   * **Driven from `update`, not from `fitCamera`, and the reason is a real
   * bug.** `camera.worldView` is recomputed during preRender, so reading it
   * immediately after `setZoom`/`centerOn` returns the PREVIOUS frame's rect —
   * which put the water hundreds of pixels from the viewport at 390x844 and
   * left the page background showing. Running it each frame is two property
   * writes and is self-correcting through any resize, zoom or scroll.
   *
   * A generous margin absorbs the one frame between a resize and the next
   * preRender.
   */
  private resizeWater(): void {
    const water = this.water;
    if (!water) return;

    const view = this.cameras.main.worldView;
    const margin = TILE_SIZE * 8;
    const x = view.x - margin;
    const y = view.y - margin;
    const w = view.width + margin * 2;
    const h = view.height + margin * 2;

    // Only touch the object when something actually moved: a TileSprite
    // re-renders its pattern on resize.
    if (water.x !== x || water.y !== y) water.setPosition(x, y);
    if (water.width !== w || water.height !== h) water.setSize(w, h);
  }

  private fitCamera(): void {
    const map = this.map;
    if (!map) return;

    const mounted = hud.chrome();
    const chrome = mounted.top > 0 ? mounted : HUD_CHROME_FALLBACK;
    const zoom = fitZoom(this.scale, FARM_CONTENT, chrome, PIXEL_SCALE);

    /*
     * The content rect is concentric with the map — `BORDER_RING` is uniform —
     * so the map's centre is the content's centre and no separate origin is
     * needed. The shift puts that centre in the middle of the band BETWEEN the
     * two bars rather than the middle of the viewport; it reduces to the old
     * `- top / (2 * zoom)` when there is no bottom chrome.
     */
    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.centerOn(
      map.widthInPixels / 2,
      map.heightInPixels / 2 - centreOffset(chrome, zoom),
    );

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

  /**
   * One place that decides whether the player drives the character.
   *
   * **Two independent reasons to take it away, so neither may clear the
   * other.** Idle mode ending while the player is asleep must not hand the
   * keys back, and a poll that reports idle-off must not either — which is
   * exactly what a bare `setInputLocked(idle.enabled)` on each did.
   */
  private lockInput(): void {
    this.player?.setInputLocked(this.idleRunning || this.sleeping);
  }

  private async refresh(): Promise<void> {
    try {
      const state = await fetchFarm();
      // Measure the offset rather than trusting the local clock (§4.1).
      this.clockOffset = state.serverNow - Date.now();
      this.state = state;

      hud.setPlayer(state.player);
      /*
       * The authoritative experience total (T-30.04). Every action that grants
       * XP overwrites this immediately from its own response so the NEXT float
       * measures against the right baseline; this is the seed and the
       * reconciliation, and it is what makes an idle-mode session — where the
       * server grants XP with no client action at all — not show up as one
       * enormous float on the player's next harvest.
       */
      this.lastExperience = state.player.progress.experience;
      // Gold the box paid while this poll was being served (T-11.03).
      hud.reportShippingPaid(state.shippingPaid);
      /*
       * ...and the payout floats over the box that paid it. The one gold float
       * in the game, and the only reward whose "where" is a fixed object rather
       * than the tile the player is standing at.
       */
      if (state.shippingPaid > 0) {
        this.playFloats(
          { tileX: SHIPPING_BOX_TILE.x, tileY: SHIPPING_BOX_TILE.y },
          [{ kind: 'gold', value: state.shippingPaid }],
        );
      }
      this.house?.setTier(state.farm.houseTier);

      /*
       * The trees (T-20.04). Joined to their sprites by anchor tile, because
       * that is the one coordinate the map and the server both know — the map
       * has no uuids and the server has no gids.
       *
       * `setTreeStanding` is idempotent, so calling it for five trees three
       * times a minute costs nothing and, crucially, does not restart the leaf
       * loop on trees that have not changed.
       */
      for (const tree of state.trees) {
        const anchor = tileKey(tree.x, tree.y);
        this.treeViews.set(anchor, tree);
        const sprite = this.treeSprites.get(anchor);
        if (sprite) setTreeStanding(sprite, tree.isStanding);
      }
      // Which building the farm draws, from the same poll the shop reads
      // (T-12.02b). Nothing here decides a tier — buying one is a server
      // round trip and this is the next poll after it.
      this.coop?.setTier(state.farm.coopTier);
      this.barn?.setTier(state.farm.barnTier);
      /*
       * Walls follow the tier they were just given (T-15.08).
       *
       * `currentBuildingTiles`, never `BUILDING_FOOTPRINTS`: the latter is
       * each building's LARGEST footprint and exists so the map generator never
       * puts a tree where a Deluxe barn might go. Using it here would put
       * invisible walls around buildings the player has not bought.
       *
       * It returns TILES rather than boxes since T-23.03, because a building's
       * body is not a rectangle — the roof is walk-behind and a wing whose base
       * sits higher leaves yard in front of it. Hence no `footprintsTiles`.
       */
      this.blocks.set(
        'buildings',
        currentBuildingCells({
          house: state.farm.houseTier,
          coop: state.farm.coopTier,
          barn: state.farm.barnTier,
        }),
      );
      /*
       * The shop's coop/barn rows read their tier from here (T-12.02), and
       * since T-18.14 the herd count too — so a Buy button that is dead
       * because the coop is full can say "coop full — 4/4" instead of just
       * being dead. Counted off the same poll that draws the animals rather
       * than fetched, which is the same argument `setBuildings` already made
       * for the tiers.
       */
      const herd = { coop: 0, barn: 0 };
      for (const animal of state.animals) {
        const building = ANIMALS[animal.kind]?.building;
        if (building) herd[building] += 1;
      }
      hud.setBuildings(state.farm.coopTier, state.farm.barnTier, herd);
      /*
       * Idle mode's standing orders (T-13.05/06). The poll is the ONLY thing
       * that seeds the panel — no settings fetch of its own — which is also
       * what re-locks the character after a reload, before the player has
       * touched anything.
       */
      // F-2's HUD half (T-18.16). Off the same poll that draws the plots.
      hud.setThirsty(thirstyCount(state.plots, state.serverNow, Date.now()));
      /*
       * What to do next (T-18.17, F-5), off the same poll. Nothing is
       * persisted: the hint is a function of the farm, so it is always true and
       * it retires itself the moment a plot has been harvested. The HUD decides
       * it, because the answer needs the bag as well as the plots.
       */
      hud.setCoach(state.plots, state.serverNow);
      hud.setIdle(state.idle);
      this.idleRunning = state.idle.enabled;
      this.lockInput();
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
       * The soil underlay. One 16x16 tile swapped between dry and wet and
       * hidden entirely on ground that has never been hoed — so the three
       * states of §5.2 are visible at a glance without a legend.
       *
       * The frame also carries the patch's EDGES (`drawSoil`), which is what
       * T-7.05's flat sampled fills could not do: a hoed plot used to be a bare
       * terracotta square with no boundary against the grass. `dry-0` here is
       * only a valid starting frame for an invisible sprite; `redraw` sets the
       * real one before it is ever shown.
       */
      const soil = this.add
        .image(0, 0, TILESET_SOIL.key, SOIL_DRY_FRAMES[0]!)
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

      /*
       * Soil first: it is a full opaque tile, so the outline has to be added
       * after it to be seen.
       *
       * The CROP stays out of this container (T-18.01). Soil and outline are
       * paint on the floor and belong in the decal band; the crop is a plant
       * standing on the tile and sorts by its feet like a tree does. Putting
       * all three in one container is what drew an opaque square over the
       * character standing on the plot.
       */
      const decal = this.add.container(0, 0, [soil, marker]).setDepth(DEPTH.groundDecal);

      /*
       * The thirst badge (T-18.16, F-2). A watering can floating over a plot
       * whose crop has stopped growing for want of water.
       *
       * Outside the decal container and above the crop: it is a UI marker about
       * the tile, not paint on it, and a badge the plant grows over would fail
       * at exactly the stage where the crop is big enough to hide its own soil
       * — which is the case F-2 is about.
       */
      const thirst = this.add
        .sprite(0, 0, TOOL_WATERING_CAN_WOOD.key, 0)
        .setOrigin(0.5, 1)
        .setDepth(DEPTH.overlay)
        .setVisible(false);

      const tile: Tile = {
        view,
        viewAt: serverNow,
        decal,
        marker,
        soil,
        crop,
        thirst,
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
  /**
   * The tier of whichever building houses this kind (T-18.04).
   *
   * The yard is derived from the building's footprint, so it needs the tier the
   * farm actually has. Zero before the first poll lands, which is the smallest
   * coop — animals cannot exist before that response anyway.
   */
  private buildingTierFor(kind: AnimalKind): number {
    const farm = this.state?.farm;
    if (!farm) return 0;
    return ANIMALS[kind].building === 'coop' ? farm.coopTier : farm.barnTier;
  }

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

      const slot = pastureSlot(view.kind, index, this.buildingTierFor(view.kind));

      const existing = this.animals.get(view.id);
      if (existing) {
        /*
         * The coop's yard follows its roof, so upgrading MOVES the flock
         * (T-18.04). Rebuilt rather than nudged: `homePosition` seeds the wander
         * routine, so an animal that kept its old seed at a new home would drift
         * around a point it is no longer standing on. This only fires on a tier
         * change — every other poll takes the `apply` path.
         */
        if (existing.homePosition.x === slot.x && existing.homePosition.y === slot.y) {
          existing.apply(view);
          continue;
        }
        existing.destroy();
      }

      this.animals.set(view.id, new Animal(this, view, slot));
    }

    // An animal is never deleted server-side (§5.3), so this only fires if one
    // somehow leaves the farm. Cleaning up anyway beats leaking a sprite.
    for (const [id, animal] of this.animals) {
      if (seen.has(id)) continue;
      animal.destroy();
      this.animals.delete(id);
    }

    /*
     * ANIMALS ARE DELIBERATELY NOT SOLID (D-14, T-15.14).
     *
     * The plan for this phase said they should be. They must not be: the coop
     * yard is a 5x3 grid on 1x1 spacing and the largest possible flock is
     * exactly 15, so a full coop fills every slot. Make each one solid and the
     * three chickens in the middle row are walled in by other chickens —
     * unreachable, and therefore permanently unfeedable, with no way for the
     * player to fix it. (Proven, not assumed: the check is in
     * `collision.test.ts`.)
     *
     * So livestock is walk-through. It costs a little realism, and it buys a
     * farm that cannot lock the player out of their own animals at any herd
     * size. The `animals` block layer still exists for anything that later
     * needs it; nothing populates it.
     */
  }

  /**
   * Draws the player's placed decoration, and marks the solid pieces (T-15.22,
   * T-15.25).
   *
   * Rebuilt wholesale rather than diffed: there are a handful of pieces, they
   * change only when the player changes them, and a placement has no state to
   * preserve across a refresh — unlike an animal, which is mid-wander.
   */
  private async refreshDecor(): Promise<void> {
    let view;
    try {
      view = await fetchDecor();
    } catch {
      // A farm that draws no fences is much better than a farm that fails to
      // load because decoration did. Nothing here is authoritative.
      return;
    }

    for (const piece of this.decor.values()) piece.destroy();
    this.decor.clear();

    const placed: { def: DecorDef; x: number; y: number }[] = [];

    for (const row of view.placements) {
      const def = getDecor(row.decorId);
      // A piece whose definition has left the config draws nothing rather than
      // crashing the scene — the same tolerance the server shows it.
      if (!def) continue;

      this.decor.set(row.id, new DecorPiece(this, row.id, def, row.x, row.y));
      placed.push({ def, x: row.x, y: row.y });
    }

    // Only SOLID pieces block; you walk over a berry bush (D-9). Decor is
    // placed by whole tile, so it converts whole.
    this.blocks.set('decor', tilesToCells(solidDecorTiles(placed)));
    hud.setDecorOwned(view.owned);
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

      const centreX = left + TILE_SIZE / 2;
      tile.decal.setPosition(centreX, top + TILE_SIZE / 2);

      /*
       * The crop stands on the tile's bottom edge and sorts there, exactly like
       * a tree or a fence post: a character below it draws in front, a
       * character further up the tile draws behind. Its depth is set once here
       * because plots never move (T-18.01).
       */
      tile.crop.setPosition(centreX, top + TILE_SIZE / 2);
      tile.crop.setDepth(groundDepth(top + TILE_SIZE));

      // The click rect follows the drawing, always. Same numbers, one place.
      tile.rect.setTo(left, top, TILE_SIZE, TILE_SIZE);
    }
  }

  private redraw(now: number): void {
    let hoveredTile: Tile | null = null;

    /*
     * Every tilled plot, keyed by grid cell, so `soilMaskAt` can ask about a
     * neighbour it has not reached yet in the loop below.
     *
     * Built ONCE per frame rather than per tile: `redraw` runs from `update`,
     * and rebuilding this inside the loop would make it quadratic. Twenty plots
     * makes it twenty Set insertions a frame, which is not worth hoisting to
     * state-application time — until profiling says it is.
     *
     * **Locked plots are excluded**, since `view.tilled` on a plot you do not
     * own would suppress the rim on the edge facing it and let the field bleed
     * into ground that is not yours.
     */
    const tilled = new Set<string>();
    for (const { view } of this.tiles.values()) {
      if (view.unlocked && view.tilled) tilled.add(tileKey(view.x, view.y));
    }

    for (const tile of this.tiles.values()) {
      const { view } = tile;
      const hovered = this.hoveredId === view.id;
      if (hovered) hoveredTile = tile;

      if (!view.unlocked) {
        /*
         * Locked plots are OUTLINED, not blacked out (T-15.29).
         *
         * They used to be filled with near-black at 0.45. With four plots
         * unlocked out of twenty, that painted a single dark rectangle over the
         * middle of the farm — it read as a mud stain or a rendering fault
         * rather than as "sixteen plots you have not cleared yet", and it was
         * the most conspicuously wrong thing on the map.
         *
         * A faint wash plus a permanent outline says the same thing and says it
         * per plot: you can count them, and each one is visibly a cell you
         * could buy. The hover still brightens its own outline on top.
         */
        tile.marker.setFillStyle(COLOR.locked, 0.16);
        tile.marker.setStrokeStyle(1, COLOR.hover, hovered ? 0.9 : 0.3);
        tile.soil.setVisible(false);
        tile.crop.setVisible(false);
        tile.thirst.setVisible(false);
        tile.lastFrame = -1;

        if (hovered) {
          const cost = this.plotPrices.get(view.id);
          tile.decal.setData(
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
      drawSoil(tile, soilAt(view, now), soilMaskAt(tilled, view.x, view.y));

      if (view.cropId === null || view.plantedAt === null) {
        /*
         * Guarded on the sprite's own visibility rather than on `lastFrame`.
         * `lastFrame` is a cache of which frame is showing, and an optimistic
         * update can reset it while the sprite is still on screen — gating the
         * hide on the cache then leaves a harvested crop drawn in an empty plot.
         */
        if (tile.crop.visible) tile.crop.setVisible(false);
        // Bare soil is never thirsty: there is nothing in it to stop growing.
        if (tile.thirst.visible) tile.thirst.setVisible(false);
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
       * The thirst badge (T-18.16, F-2). Watering is the mechanic D-1 decided
       * the whole farming loop turns on, and until now the ONLY sign a crop had
       * stopped growing was the hover countdown reading `DRY`. A player who
       * does not hover never learns why nothing is happening — the game looks
       * broken and the fix is one keypress away.
       *
       * Shown per plot rather than only on hover, because "which of my twenty
       * plots needs the can" is the question, and hovering twenty tiles to find
       * out is not an answer.
       */
      const badge = plotBadgeFor({ stage, isRipe, readyInMs, isPaused, soil: soilAt(view, now) });
      if (badge) {
        tile.thirst.setPosition(tile.crop.x, tile.crop.y - TILE_SIZE / 2);
        tile.thirst.setVisible(true);
      } else if (tile.thirst.visible) {
        tile.thirst.setVisible(false);
      }

      /*
       * A paused crop says so. The countdown alone would be a lie by omission:
       * it is frozen, and the player's fix is a watering can, not patience.
       */
      if (hovered) {
        const remaining = formatRemaining(readyInMs);
        tile.decal.setData(
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

    const label = tile.decal.getData('label') as string | undefined;
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

    /*
     * Escape disarms a decoration in hand (T-15.24). Bound here with the action
     * keys rather than on the tray, because the player's attention is on the
     * farm while placing, not on the panel.
     */
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC, false).on('down', () => {
      // Same rule as the Interior's (T-18.13): a modal owns the press, so
      // Escape does not disarm a decoration while the shop is on screen.
      if (!isTypingInDom() && !isModalOpen() && hud.armedDecor()) hud.armDecor(null);
    });

    for (const code of ACTION_KEYS) {
      keyboard.addKey(code, false).on('down', () => {
        // A shop quantity being typed is not an action key (§2, same rule the
        // hotbar follows).
        if (!isTypingInDom()) this.act();
      });
    }

    /*
     * The touch controls (T-28.02, D-19). Mounted beside the key bindings
     * because they ARE a key binding — the stick feeds `Player.readInput` and
     * the button calls the same `act()` the loop above does, so a finger and a
     * keyboard reach identical code.
     *
     * `mount` is a no-op on a fine-pointer device, so a laptop builds nothing.
     */
    touchControls.mount({
      parent: hud.element(),
      act: () => {
        if (!isTypingInDom()) this.act();
      },
    });
  }

  /**
   * Everyone who lives here (T-18.02, T-33.03).
   *
   * **The shopkeeper's tile joins `merchantTiles` rather than getting a `Target`
   * arm of its own**: facing the vendor and facing their counter mean the same
   * thing, so `actions.ts`, its dispatch table and its tests already cover it
   * with no new surface. The Chef is the opposite case — there is no counter, so
   * the character IS the target and gets an arm. Their tiles are made solid in
   * `buildMapObjects`, which owns the `objects` block layer.
   */
  private buildVillagers(): void {
    this.villagers = VILLAGERS.map((def) => new VillagerNpc(this, def));

    for (const def of VILLAGERS) {
      const key = tileKey(def.tile.x, def.tile.y);
      if (def.id === 'merchant') this.merchantTiles.add(key);
      else this.chefTiles.add(key);
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
    // The Chef has no counter, so the villager themselves is what answers.
    if (this.chefTiles.has(tileKey(tileX, tileY))) return { kind: 'villager', npc: 'chef' };
    if (this.mailboxTiles.has(tileKey(tileX, tileY))) return { kind: 'mailbox' };
    // The farmhouse door (T-16.11, D-7). Resolved exactly like the chest — the
    // door is not a special input mode, it is another thing that answers on the
    // tile in front of you. TWO tiles, because the door art straddles a
    // boundary; see `houseDoorTile`.
    // Tier-aware since T-17.06: the door moves one tile left at tiers 1 and 2,
    // so a fixed column set would leave an upgraded house with a dead doorway.
    if (isHouseDoorTile(HOUSE_ANCHOR, tileX, tileY, this.state?.farm.houseTier ?? 0)) {
      return { kind: 'door' };
    }

    /*
     * A tree (T-20.04). Before plots for the same reason animals are: a maple
     * stands on grass, never on a plot, so the order never actually decides
     * anything — but the smaller, more specific target goes first.
     */
    const treeAnchor = this.treeTiles.get(tileKey(tileX, tileY));
    if (treeAnchor !== undefined) {
      const view = this.treeViews.get(treeAnchor);
      // No view means the poll has not landed yet, or this account predates the
      // T-20.01 migration and genuinely has no tree rows. Either way the honest
      // answer is "nothing here", not a crash.
      if (view) return { kind: 'tree', view };
    }

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
   * Steps inside the farmhouse (T-16.12, D-7).
   *
   * **`sleep`, never `start`.** T-3.05 proved the difference and it is the
   * whole reason going indoors is a doorway rather than a page load: sleeping
   * keeps this scene's game objects, its cached farm state and its measured
   * clock offset alive, so crops keep growing on the same interpolation and the
   * player comes back to the farm they left. `scene.start` would tear all of it
   * down and rebuild from a fresh fetch.
   *
   * `scene.run` rather than `wake`, because the first trip through the door has
   * no Interior scene to wake yet — `run` starts it if it has never run and
   * wakes it if it is asleep, which is exactly the two cases there are.
   *
   * Sleeping also stops the 20s poll: Phaser pauses a sleeping scene's clock,
   * so `pollTimer` does not fire indoors. The `WAKE` handler re-fetches once on
   * the way back, which is what makes the returning view authoritative again.
   */
  private enterHouse(): void {
    hud.setInsideHouse(true);
    this.scene.sleep();
    /*
     * The appearance travels with the player (T-16.15). The Interior has its
     * own character now and no reason to know about `/api/farm`; passing what
     * it needs beats a second scene fetching the whole world to find out what
     * colour someone's hair is.
     */
    this.scene.run('Interior', { appearance: this.state?.player.appearance ?? null });
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

  /**
   * Handles the action key for decoration, or returns false to let the normal
   * farm dispatch have it.
   *
   * Two cases, in priority order: a piece armed for placement, then an
   * empty-handed press facing something already placed. Anything else is not
   * about decoration and falls through.
   */
  private actDecor(): boolean {
    const player = this.player;
    if (!player?.ready) return false;

    const faced = facedTile(player, player.facing);
    const armed = hud.armedDecor();

    if (armed) {
      void this.sendPlaceDecor(armed, faced.tileX, faced.tileY);
      return true;
    }

    // Only empty-handed: holding a hoe and facing a fence should still swing at
    // the ground, not silently pocket the fence.
    if (this.equipped) return false;

    const piece = this.decorAt(faced.tileX, faced.tileY);
    if (!piece) return false;

    void this.sendRemoveDecor(piece.id);
    return true;
  }

  /** The placed piece covering a tile, or null. */
  private decorAt(tileX: number, tileY: number): DecorPiece | null {
    for (const piece of this.decor.values()) {
      const withinX = tileX >= piece.tileX && tileX < piece.tileX + piece.def.footprint.width;
      const withinY = tileY >= piece.tileY && tileY < piece.tileY + piece.def.footprint.height;
      if (withinX && withinY) return piece;
    }
    return null;
  }

  private async sendPlaceDecor(decorId: string, x: number, y: number): Promise<void> {
    try {
      await placeDecor(decorId, x, y);
      await this.refreshDecor();
    } catch (error) {
      // The server refuses for reasons the ghost cannot know — chiefly the
      // reachability check, which is server-only — so this is a real path, not
      // a should-never-happen.
      hud.toast(messageFor(error));
    }
  }

  private async sendRemoveDecor(placementId: string): Promise<void> {
    try {
      const result = await removeDecor(placementId);
      await this.refreshDecor();
      const def = getDecor(result.decorId);
      hud.toast(`Picked up the ${def?.name ?? 'decoration'}.`);
    } catch (error) {
      hud.toast(messageFor(error));
    }
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

    /*
     * Decoration takes the action key before anything else (T-15.24).
     *
     * Armed: place at the faced tile. Empty-handed and facing a placed piece:
     * pick it up. Both go through the same key, at the same tile, as every
     * other action on this farm — there is no second input mode to learn and
     * nothing is dragged with the pointer (§5.1).
     */
    if (this.actDecor()) return;

    const dispatch: Dispatch = actionFor(this.equipped, this.facedTarget(this.serverNow()));

    if (dispatch.kind === 'nothing') return;
    if (dispatch.kind === 'refused') {
      hud.toast(dispatch.message);
      return;
    }
    /*
     * Going indoors (T-16.11). Handled before `open` because it is not a panel:
     * nothing is sent, nothing is swung, and the scene changes.
     */
    if (dispatch.kind === 'enter') {
      this.enterHouse();
      return;
    }

    /*
     * Talking is not an intent either (T-33.03): nothing is sent, nothing is
     * swung, and the server never hears about it. Handled before `open` for the
     * same reason `enter` is — it is not a panel about something the player
     * owns, it is somebody answering.
     */
    if (dispatch.kind === 'talk') {
      playCue('open');
      hud.talkTo(dispatch.npc);
      return;
    }

    // Opening a panel is not an intent: nothing is sent and nothing is swung.
    if (dispatch.kind === 'open') {
      const open = {
        chest: () => hud.openChest(),
        shipping: () => hud.openShipping(),
        // The merchant talks first (T-33.02). Falls through to the shop on the
        // last line, or immediately if they have nothing to say.
        shop: () => hud.talkToMerchant(),
        trade: () => hud.openTrade(),
      };
      playCue('open');
      void open[dispatch.what]();
      return;
    }

    /*
     * Collecting and feeding kneel (T-16.02). They used to do nothing at all,
     * on the grounds that the pack had no animation for crouching at a cow —
     * `20. Petting` is exactly that, and had simply never been copied in.
     * Both actions play the same gesture: the art does not distinguish taking
     * an egg from putting feed down, and inventing a distinction it cannot
     * draw is how you get the wrong-looking animation that reasoning feared.
     */
    if (isAnimalIntent(dispatch)) {
      player.playToolAnimation(ANIMAL_SWING);
      const animalCue = cueForSwing(ANIMAL_SWING);
      if (animalCue) playCue(animalCue);
      /*
       * The tile the player is FACING, not the animal's home slot — which is
       * D-16's rule ("the tile the player can see it on") and the only one that
       * follows a cow as it roams. A float over an empty slot two tiles away
       * would be pointing at nothing.
       */
      void this.sendAnimal(dispatch, facedTile(player, player.facing));
      return;
    }

    // Cosmetic, and it starts before the request rather than after it: the
    // swing is what covers the round trip now that nothing is predicted.
    const swing = swingFor(dispatch);
    player.playToolAnimation(swing);
    /*
     * ...and the burst lands on the TILE, not on the character (T-18.10). The
     * swing says "I moved"; the dust says "I moved and something happened
     * there", which is the half the game had never had.
     *
     * Fired before the request, with the swing, and deliberately: it is a
     * reaction to the player's own input, not a report of the server's answer
     * (which the toast and the poll already carry). A refusal leaves a puff of
     * soil that meant nothing, which is a far smaller lie than a 200ms gap
     * between pressing a key and anything at all happening.
     */
    const faced = facedTile(player, player.facing);
    this.playBurst(swing, faced.tileX, faced.tileY);
    // The same value drives the particle and the sound (T-18.19), so an action
    // cannot end up with one and not the other.
    const cue = cueForSwing(swing);
    if (cue) playCue(cue);

    void this.send(dispatch, faced);
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
  private async send(
    intent: FarmIntent,
    at: { readonly tileX: number; readonly tileY: number },
  ): Promise<void> {
    /*
     * The thing this action is BUSY on. Every intent addressed a plot until
     * chopping (T-20.04), which addresses a tree — so the key is read off
     * whichever id the intent carries rather than assumed to be `plotId`.
     * Getting this wrong would key the guard on `undefined` and let a second
     * chop through while the first was still in flight.
     */
    const busyId = intent.kind === 'chop' ? intent.treeId : intent.plotId;
    if (this.busy.has(busyId)) return;
    this.busy.add(busyId);

    // One key per user action, reused if this action is retried (§4.5).
    const key = idempotencyKey();

    try {
      switch (intent.kind) {
        case 'till':
          await till(intent.plotId, key);
          break;
        case 'plant':
          await plant(intent.plotId, intent.cropId, key);
          hud.toast(`Planted ${CROPS[intent.cropId].name}.`);
          break;
        case 'water':
          await water(intent.plotId, key);
          break;
        case 'harvest': {
          const result = await harvest(intent.plotId, key);
          hud.toast(`Harvested ${result.quantity} × ${itemName(result.itemId)}.`);
          // The bar moves on the action that earned it, not on the next poll
          // 20 seconds later (T-30.02).
          hud.setExperience(result.experience);
          this.playFloats(at, [
            { kind: 'item', value: result.quantity, itemId: result.itemId },
            { kind: 'xp', value: xpGained(result.experience, this.lastExperience) },
          ]);
          // The plot itself reacts, not just the label above it (T-30.05).
          this.popSprite(this.tiles.get(intent.plotId)?.crop);
          this.lastExperience = result.experience;
          break;
        }
        case 'chop': {
          const result = await chop(intent.treeId, key);
          hud.toast(`Chopped ${result.quantity} × ${itemName(result.itemId)}.`);
          // Chopping grants no experience by design (`config/level.ts`), so the
          // wood is the only thing there is to say.
          this.playFloats(at, [
            { kind: 'item', value: result.quantity, itemId: result.itemId },
          ]);
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
      this.busy.delete(busyId);
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
  private async sendAnimal(
    intent: AnimalIntent,
    at: { readonly tileX: number; readonly tileY: number },
  ): Promise<void> {
    const { animalId } = intent;
    if (this.busy.has(animalId)) return;
    this.busy.add(animalId);

    // One key per user action, reused if this action is retried (§4.5).
    const key = idempotencyKey();

    try {
      if (intent.kind === 'collect') {
        const result = await collectAnimal(animalId, key);
        hud.toast(`Collected ${result.quantity} × ${itemName(result.itemId)}.`);
        hud.setExperience(result.experience);
        this.playFloats(at, [
          { kind: 'item', value: result.quantity, itemId: result.itemId },
          { kind: 'xp', value: xpGained(result.experience, this.lastExperience) },
        ]);
        this.lastExperience = result.experience;
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
    for (const v of this.villagers) v.destroy();
    this.villagers = [];
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

/**
 * The soil frame for a state and its neighbours; `untilled` hides the sprite.
 *
 * `mask` is which of the four orthogonal neighbours are also tilled, so the
 * frame carries a rim on exactly the edges where the tilled patch ENDS. Without
 * it, soil was a flat fill: a hoed plot was a bare terracotta square butted
 * against grass with no boundary of any kind, and a field of them was one
 * undifferentiated slab.
 */
function drawSoil(tile: Tile, soil: SoilState, mask: number): void {
  const frame = soilFrame(mask, soil);
  if (frame === null) {
    if (tile.soil.visible) tile.soil.setVisible(false);
    return;
  }

  // `frame.name` is the numeric index stringified for a spritesheet frame.
  if (tile.soil.texture.key !== TILESET_SOIL.key || tile.soil.frame.name !== String(frame)) {
    tile.soil.setTexture(TILESET_SOIL.key, frame);
  }
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
  const tileset = tilesetOf(map, gid);
  return tileset ? { key: tileset.name, frame: gid - tileset.firstgid } : null;
}

/**
 * The tileset a gid belongs to, in the MAP's numbering.
 *
 * Split out of `locateInMap` because animating a tile needs the `firstgid` back
 * to turn a frame into an index again, and re-deriving it by searching a second
 * time is the kind of duplication that ends up disagreeing.
 */
function tilesetOf(
  map: Phaser.Tilemaps.Tilemap,
  gid: number,
): Phaser.Tilemaps.Tileset | null {
  for (const tileset of map.tilesets) {
    const frame = gid - tileset.firstgid;
    if (frame >= 0 && frame < tileset.total) return tileset;
  }
  return null;
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
