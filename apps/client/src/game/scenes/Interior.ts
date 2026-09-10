import Phaser from 'phaser';
import {
  FURNITURE,
  INTERIOR_BOUNDS,
  INTERIOR_HEIGHT,
  INTERIOR_MAP,
  INTERIOR_ROOM,
  INTERIOR_SPAWN_TILE,
  INTERIOR_WIDTH,
  PIXEL_SCALE,
  TILE_SIZE,
  WALL_ROWS,
  FLOOR_TOP,
  getFurniture,
  interiorBlockedTiles,
  solidFurnitureTiles,
  type FurnitureDef,
  isInteriorDoorTile,
  placementProblem,
  type PlacedPiece,
  isBedFurniture,
  tilesToCells,
} from '@tillhaven/shared/config';
import type { Appearance } from '@tillhaven/shared/schemas';
import { BlockMap, playerWorld } from '../collision.js';
import { Player } from '../entities/Player.js';
import { facedTile } from '../entities/targeting.js';
import { playerBounds, type Bounds, type World } from '../entities/movement.js';
import { ACTION_KEYS } from '../keys.js';
import type { InteriorRoom } from '@tillhaven/shared/types';
import { hud } from '../hud.js';
import { isModalOpen } from '../../lib/focus.js';
import { DEPTH, groundDepth } from '../depth.js';
import { NightOverlay } from '../dayNight.js';
import { centreOffset, fitZoom } from '../camera.js';
import { messageFor, codeOf } from '../../net/errors.js';
import { sleep as sleepApi } from '../../net/farm.js';
import { idempotencyKey } from '../../net/api.js';
import {
  buyFurniture,
  fetchCatalogue,
  fetchInterior,
  placeFurniture,
  removeFurniture,
  type CatalogueEntry,
  type OwnedFurniture,
  type PlacedFurniture,
} from '../../net/house.js';

/**
 * Inside the house.
 *
 * **The farm is asleep, not shut down.** Phaser's `sleep`/`wake` keeps the Farm
 * scene's objects, its cached state and its measured clock offset alive, so
 * stepping inside and back out does not re-fetch the world or lose a plot's
 * interpolated growth. `scene.start` would tear all of that down and rebuild it
 * — which is the difference between a doorway and a page load.
 *
 * **The room is an authored tilemap** since T-16.13. It was drawn with
 * `Graphics` — a chequerboard and a flat wall band — because T-3.05 found no
 * floor or wall art in the pack. That was true of the OLD pack; this one ships
 * `TILESET_HOUSE`, `interiorLayout.ts` authors the room from it and
 * `generate-interior.ts` writes `interior.json`, exactly as the farm works.
 *
 * The room's SIZE now comes from that map too (D-17): `INTERIOR_ROOM` is
 * derived, so the cells the server validates against and the cells the player
 * can see are the same cells by construction.
 */

/**
 * Placement-feedback colours.
 *
 * The floor/wall/grid entries went with the drawn room in T-16.13; what is left
 * is the ghost, which is UI over the map rather than the map itself.
 */
const COLOR = {
  valid: 0x79bf56,
  invalid: 0xae4924,
} as const;

/**
 * Wall height above the floor, in cells.
 *
 * From the map (T-16.13), not chosen: `WALL_ROWS` is four because that is how
 * `TILESET_HOUSE` draws a wall — upper panel, dado rail, lower panel, skirting.
 * Cell (0,0) of the placement grid is the first FLOOR row, below it.
 */
const WALL_CELLS = WALL_ROWS;

/**
 * Room the HUD needs, top and bottom, before it has mounted and can be
 * measured (T-18.03). Same numbers and same reasoning as the Farm scene's.
 */
const HUD_CHROME_FALLBACK = { top: 71, bottom: 80 } as const;

interface Piece {
  view: PlacedFurniture;
  readonly sprite: Phaser.GameObjects.Image;
}

/**
 * The floor hint, in SCREEN pixels (T-18.24).
 *
 * Screen rather than world, because that is what the reader's eye measures and
 * the camera's zoom varies with the viewport. `fitCamera` divides by the zoom
 * to get there.
 */
const HINT_PX = 12;

/**
 * How far the hint sits ABOVE the room's bottom edge, in screen pixels.
 *
 * Inside the room rather than below it, which is a change T-18.24 forced
 * rather than chose: `fitCamera` reserves both HUD bars and gives the room
 * everything that is left, so on a 1366x768 screen the room's bottom edge and
 * the hotbar's top edge are twelve pixels apart. There is no "below the room"
 * to put anything in. On the floor it cannot be clipped at any viewport, and a
 * hint about the floor belongs on it.
 */
const HINT_INSET_PX = 6;

/**
 * Short enough to fit UNDER THE ROOM, which is the constraint that matters.
 *
 * Fixing the zoom bug alone left it a constant 1368px wide — wider than a
 * 1366px viewport, let alone the 768px room it sits below. Constant-but-still-
 * overflowing is a different bug from the one T-18.24 filed, and worth naming:
 * the arithmetic was only half the problem. At 12px monospace (~0.6em per
 * character) sixty characters is about 430px, which clears the room at every
 * zoom `fitCamera` picks.
 */
const HINT_TEXT =
  'WASD to walk · E to place, pick up, or sleep in bed · face the door to leave';

export class Interior extends Phaser.Scene {
  private room: InteriorRoom = INTERIOR_ROOM;
  private readonly pieces = new Map<string, Piece>();
  /**
   * Layered like the farm's, and for the same reason: the wall and the
   * furniture change on different clocks, and `set` replaces one without
   * losing the other (T-18.08).
   */
  private readonly blocks = new BlockMap();

  /** The authored room. Built once — the map never changes (T-16.13). */
  private map?: Phaser.Tilemaps.Tilemap;
  private ghost?: Phaser.GameObjects.Rectangle;
  private hint?: Phaser.GameObjects.Text;

  /**
   * The character (T-16.15). The room had none until now, which is why it had
   * neither collision nor a faced tile — there was nothing to collide and
   * nothing to face.
   */
  private player: Player | null = null;
  private appearance: Appearance | null = null;
  /** Solid tiles: the wall band. Furniture is walk-through — see `buildWorld`. */
  private world: World | null = null;
  private busy = false;
  /** The day/night tint (MVP re-scope), the same one the farm uses. */
  private night: NightOverlay | null = null;

  private catalogue: CatalogueEntry[] = [];
  private owned: OwnedFurniture[] = [];

  constructor() {
    super('Interior');
  }

  /** The appearance handed over by the Farm on the way in (T-16.15). */
  init(data: { appearance?: Appearance | null }): void {
    if (data?.appearance) this.appearance = data.appearance;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#241309');

    registerFurnitureFrames(this);
    this.buildRoom();
    this.buildWorld();
    this.buildPlayer();
    this.buildGhost();
    this.buildHint();
    this.night = new NightOverlay(this);
    this.bindActionKeys();

    this.input.keyboard?.on('keydown-ESC', () => {
      /*
       * One Escape, one layer (T-18.13, BUG-11).
       *
       * Every panel binds its own `keydown` on `document`, so a single press
       * reaches all of them AND this handler — which is how Escape managed to
       * close the chest *and* walk the player out of the house in one press.
       * Ordering between listeners on the same node is registration order,
       * which is not something a scene should be reasoning about, so this asks
       * the question directly instead: if a modal is open, the press was for
       * the modal.
       *
       * Then the existing rule, which was already right: disarm before
       * leaving, so it is never both "cancel that" and "walk out".
       */
      if (isModalOpen()) return;
      if (hud.armedFurniture()) hud.armFurniture(null);
      else this.leave();
    });

    hud.onLeaveHouse(() => this.leave());
    /*
     * In bed, the character stops being the player's to walk around — the
     * same lock idle mode uses on the farm, for the same reason. Without it
     * you could stand up and walk off while the server still had you asleep
     * and refused every action.
     */
    hud.onSleepChange((sleeping) => this.player?.setInputLocked(sleeping));
    hud.onDecorate(
      (furnitureId) => this.arm(furnitureId),
      (furnitureId) => void this.buy(furnitureId),
    );
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera());

    /*
     * Re-entering wakes rather than re-creates, so the character has to be put
     * back at the door — otherwise you walk out and come back standing wherever
     * you happened to leave from, on the wrong side of the room.
     */
    this.events.on(Phaser.Scenes.Events.WAKE, () => {
      /*
       * **`init` does NOT run again on wake**, which the comment here used to
       * claim (T-18.27). `scene.run` on a sleeping scene wakes it; `init` runs
       * on START only. So the appearance handed over at first entry was the
       * only one this scene ever saw, and a null one could never be replaced.
       *
       * Asking the HUD instead is current by construction — see
       * `currentAppearance`.
       */
      const look = this.currentAppearance();
      if (look) void this.player?.setAppearance(look);
      this.resetPlayer();
      void this.refresh();
    });

    void this.refresh();
  }

  override update(_time: number, delta: number): void {
    this.player?.update(delta);
    this.updateGhost();
    /*
     * **The house darkens with the farm outside it.** A room that stayed at
     * noon while the field beyond the door was midnight would make stepping
     * through the doorway a jump cut — and the doorway is the one place the two
     * scenes are seen a second apart.
     */
    this.night?.step(delta);
  }

  /* ---------------------------------------------------------------- *
   * The character (T-16.15)
   * ---------------------------------------------------------------- */

  private roomBounds(): Bounds {
    return playerBounds(INTERIOR_WIDTH * TILE_SIZE, INTERIOR_HEIGHT * TILE_SIZE);
  }

  /** Feet position of a map tile's bottom-centre, where a character stands. */
  private tileFeet(tile: { x: number; y: number }): { x: number; y: number } {
    return { x: tile.x * TILE_SIZE + TILE_SIZE / 2, y: (tile.y + 1) * TILE_SIZE };
  }

  /**
   * How the player looks, preferring the HUD's copy over the hand-over
   * (T-18.27).
   *
   * **The hand-over is null exactly when it matters most.**
   * `Farm.enterHouse()` passes `this.state?.player.appearance`, which comes
   * from the farm POLL — and on a brand-new account the poll that has landed
   * predates the character creator's save. So a player who made a character and
   * walked straight through their own front door arrived with `null`, no
   * layers, and nothing drawn but a shadow. The poll is 20 seconds; the walk is
   * about five.
   *
   * The HUD's copy is written by the creator's `onSaved` synchronously as well
   * as by the poll, so it is right in both orderings. The handed-over value is
   * kept as the fallback so T-16.15's contract still holds if the HUD has not
   * mounted.
   */
  private currentAppearance(): Appearance | null {
    return hud.currentAppearance() ?? this.appearance;
  }

  private buildPlayer(): void {
    const spawn = this.tileFeet(INTERIOR_SPAWN_TILE);
    this.player = new Player(this, { spawn, bounds: this.roomBounds() });
    if (this.world) this.player.setWorld(this.world);
    const look = this.currentAppearance();
    if (look) void this.player.setAppearance(look);
    // A scene built while the player is already in bed sees no `onSleepChange`
    // — that fires on transitions — so it asks.
    this.player.setInputLocked(hud.isSleeping());
  }

  /** Back to the doorway, facing into the room. */
  private resetPlayer(): void {
    const spawn = this.tileFeet(INTERIOR_SPAWN_TILE);
    this.player?.moveTo(spawn.x, spawn.y);
    this.player?.face('down');
  }

  /**
   * Solid tiles in the room.
   *
   * **Furniture is solid since T-18.08**, and the note that used to be here
   * explaining why it was not is worth keeping the substance of: the room is
   * twelve by six, three pieces can wall off a corner, and the only way to
   * remove a piece is to walk up to it and face it. Solid furniture without a
   * reachability check is a player locked in their own house by a wardrobe —
   * the trap D-14 describes, in a smaller room. `modules/house/reachability.ts`
   * is the counterpart to `modules/decor/reachability.ts` that was missing, and
   * building it is what made this safe.
   *
   * Two layers, because they change on different clocks: the WALL never moves
   * and is set once; FURNITURE moves whenever a piece is placed, and
   * `BlockMap.set` replaces one layer without disturbing the other.
   */
  private buildWorld(): void {
    // Walls and furniture are both authored by whole tile, so they convert
    // whole. The room gains nothing from sub-tile shapes — but the WORLD walks
    // the collision grid regardless, because `blocked` is one function and one
    // grid across both scenes.
    this.blocks.set('buildings', tilesToCells(interiorBlockedTiles()));
    this.world = playerWorld(this.blocks.blocked);
  }

  /**
   * Rebuilds the furniture layer from what is in the room now (T-18.08).
   *
   * Room cells offset by `FLOOR_TOP` into map tiles — placements are stored in
   * room space and collision is in map space, and forgetting that offset would
   * make the solid band sit four rows up in the wall, where nothing could reach
   * it and nothing would seem wrong.
   */
  private syncBlocks(): void {
    const pieces: { def: FurnitureDef; x: number; y: number }[] = [];
    for (const piece of this.pieces.values()) {
      const def = getFurniture(piece.view.furnitureId);
      if (def) pieces.push({ def, x: piece.view.x, y: piece.view.y });
    }

    this.blocks.set(
      'decor',
      tilesToCells(
        solidFurnitureTiles(pieces).map((cell) => ({ x: cell.x, y: cell.y + FLOOR_TOP })),
      ),
    );
  }

  private bindActionKeys(): void {
    for (const code of ACTION_KEYS) {
      this.input.keyboard?.addKey(code, false).on('down', () => this.act());
    }
  }

  /** The map tile the character is facing, clamped to the room. */
  private facedRoomTile(): { tileX: number; tileY: number } | null {
    const player = this.player;
    if (!player?.ready) return null;
    return facedTile(player, player.facing, INTERIOR_BOUNDS);
  }

  /**
   * A map tile as a placement CELL, or null if it is not on the floor.
   *
   * Cell (0,0) is the first floor row, so the two coordinate systems differ by
   * the wall band. Everything the server validates is in cells; everything the
   * character does is in tiles. This is the one place that converts.
   */
  private tileToCell(tileX: number, tileY: number): { x: number; y: number } | null {
    const cell = { x: tileX, y: tileY - WALL_CELLS };
    if (cell.y < 0 || cell.y >= this.room.height) return null;
    if (cell.x < 0 || cell.x >= this.room.width) return null;
    return cell;
  }

  /**
   * The action key, indoors.
   *
   * The same shape as `Farm.act()` and in the same order: decoration first,
   * then the door. Placing furniture is now exactly what placing farm
   * decoration is (T-15.24) — arm from the tray, face a tile, press the key —
   * rather than the pointer-drag it inherited from T-3.05, which was the only
   * mouse-primary interaction left in the game and contradicted §5.1.
   */
  private act(): void {
    const player = this.player;
    if (!player?.ready || this.busy) return;

    const faced = this.facedRoomTile();
    if (!faced) return;

    const cell = this.tileToCell(faced.tileX, faced.tileY);
    const armed = hud.armedFurniture();

    /*
     * An armed piece takes the key before anything else, exactly as
     * `Farm.actDecor()` runs before `Farm.act()`'s dispatch.
     *
     * That ordering is what stops facing the door with a fireplace in hand from
     * silently walking you outside — the door is in the wall band, so it is not
     * a placement cell, and you get told so. Leaving is what the key does when
     * your hands are empty.
     */
    if (armed) {
      if (!cell) {
        hud.toast(
          isInteriorDoorTile(faced.tileX, faced.tileY)
            ? 'Not in the doorway.'
            : 'That is the wall.',
          'error',
        );
        return;
      }
      /*
       * The ghost over this cell is already red (T-17.03). It was drawn from
       * the same two checks the service runs, so posting anyway asks the server
       * to repeat a refusal the player can see — and answers it with a toast
       * one network round trip later. The messages match the service's
       * deliberately: the player should not be able to tell which side spoke.
       */
      const def = getFurniture(armed);
      const problem = def ? placementProblem({ def, x: cell.x, y: cell.y }, this.placedPieces()) : null;
      if (problem) {
        hud.toast(
          problem === 'DOES_NOT_FIT' ? 'That does not fit there.' : 'Something is already there.',
          'error',
        );
        return;
      }

      void this.commitPlace(armed, cell.x, cell.y);
      return;
    }

    if (isInteriorDoorTile(faced.tileX, faced.tileY)) {
      this.leave();
      return;
    }

    if (!cell) return;
    const piece = this.pieceAtCell(cell.x, cell.y);
    if (!piece) return;

    /*
     * **A bed is slept in, not put away** (MVP re-scope).
     *
     * Every other piece answers the empty-handed action key by going back into
     * storage, which is the right default — but it would mean facing your bed
     * dismantled it, and sleeping is the only way to recover energy in this
     * MVP. So the bed takes the key first and the storage path keeps
     * everything else.
     *
     * **The cost is that a bed cannot be moved.** Putting furniture away is
     * only reachable through this branch, so taking the key from it takes the
     * only route into storage with it. That is the right trade for the MVP —
     * the bed starts in a sensible corner and sleeping is a mechanic, while
     * rearranging it is decoration — but it is a limitation, not an oversight,
     * and a "pick up" affordance in the decoration tray is what fixes it.
     */
    if (isBedFurniture(piece.view.furnitureId)) {
      void this.sleep();
      return;
    }

    void this.putAway(piece.view.id);
  }

  /* ---------------------------------------------------------------- *
   * Sleep (MVP re-scope)
   * ---------------------------------------------------------------- */

  /**
   * Lies down.
   *
   * **The scene posts and then defers.** It does not set a local `sleeping`
   * flag or show the banner itself — it hands the server's answer to the HUD,
   * which is also what every poll does, so there is exactly one path by which
   * the client learns it is asleep and a reload cannot land somewhere the
   * banner is missing.
   */
  private async sleep(): Promise<void> {
    if (this.busy) return;

    try {
      hud.applyEnergy((await sleepApi()).energy);
    } catch (err) {
      hud.toast(messageFor(err), 'error');
    }
  }

  private arm(furnitureId: string): void {
    hud.armFurniture(hud.armedFurniture() === furnitureId ? null : furnitureId);
  }

  /** Back to the farm, which has been asleep rather than destroyed. */
  private leave(): void {
    // Disarm on the way out, or a fireplace armed indoors is still armed when
    // the next action key lands on a plot (T-16.15).
    hud.clearFurnitureArm();
    hud.setInsideHouse(false);
    this.scene.sleep();
    this.scene.wake('Farm');
  }

  private async refresh(): Promise<void> {
    try {
      const [view, catalogue] = await Promise.all([
        fetchInterior(),
        this.catalogue.length === 0 ? fetchCatalogue() : Promise.resolve({ furniture: this.catalogue }),
      ]);

      this.catalogue = catalogue.furniture;
      this.room = view.room;
      this.owned = view.owned;
      this.buildRoom();
      this.syncPieces(view.placements);
      this.syncBlocks();
      this.fitCamera();
      hud.setDecorations(this.catalogue, this.owned);
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      hud.toast(messageFor(err), 'error');
    }
  }

  /* ---------------------------------------------------------------- *
   * The room
   * ---------------------------------------------------------------- */

  private roomWidthPx(): number {
    return this.room.width * TILE_SIZE;
  }

  private roomHeightPx(): number {
    return (this.room.height + WALL_CELLS) * TILE_SIZE;
  }

  /**
   * Builds the room from `interior.json` (T-16.13).
   *
   * Layer depths follow the farm's rule: the first tile layer is the ground and
   * everything after it sits above, so the wall draws over the floor it is
   * painted on top of. Furniture is added later at `DEPTH.world`, so a piece
   * against the back wall still reads as being in front of it.
   *
   * Built once. The map never changes, unlike the farm's building tiers, so a
   * rebuild on every poll would be work for nothing.
   */
  private buildRoom(): void {
    if (this.map) return;

    const map = this.make.tilemap({ key: INTERIOR_MAP.key });
    for (const tileset of map.tilesets) {
      map.addTilesetImage(tileset.name, tileset.name);
    }

    map.layers.forEach((layerData, index) => {
      const layer = map.createLayer(layerData.name, map.tilesets, 0, 0);
      layer?.setDepth(index === 0 ? DEPTH.ground : DEPTH.decor);
    });

    this.map = map;
  }

  /** Cell (0,0) is the first FLOOR cell, below the wall band. */
  private cellToWorld(x: number, y: number): { x: number; y: number } {
    return { x: x * TILE_SIZE, y: (y + WALL_CELLS) * TILE_SIZE };
  }


  /**
   * Same rule as the farm's (T-18.03): reserve BOTH bars, not just the top one.
   *
   * There is no decorative frame to trade away in here — a room is all content
   * — so this is only the second half of that change. It costs a zoom level on
   * a 768px-tall screen (4 to 3) and buys back the bottom of the room, which
   * the hotbar had been sitting on: at zoom 4 the floor is 640px tall in a band
   * with 617px of room, so the last row and a half were behind the strip.
   */
  private fitCamera(): void {
    const mounted = hud.chrome();
    const chrome = mounted.top > 0 ? mounted : HUD_CHROME_FALLBACK;
    const room = { width: this.roomWidthPx(), height: this.roomHeightPx() };
    const zoom = fitZoom(this.scale, room, chrome, PIXEL_SCALE * 2);

    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.centerOn(
      this.roomWidthPx() / 2,
      this.roomHeightPx() / 2 - centreOffset(chrome, zoom),
    );

    /*
     * The hint is a WORLD object under a zoomed camera, so its on-screen size
     * is `fontSize x scale x zoom` (T-18.24). This line read
     * `setScale(1 / zoom).setFontSize(10 * zoom)`, which cancels to a constant
     * ten WORLD pixels — and therefore `10 * zoom` on screen. At the zoom
     * `fitCamera` picks for a room this small that is 30-40px of monospace, and
     * the sentence ran off both edges of the viewport.
     *
     * Rendering the glyphs at their final screen size and scaling by `1 / zoom`
     * is the same arithmetic the other way round: constant on screen, and crisp,
     * because the texture is generated at the size it is displayed.
     */
    this.hint?.setFontSize(HINT_PX).setScale(1 / zoom);
    this.hint?.setPosition(
      this.roomWidthPx() / 2,
      this.roomHeightPx() - HINT_INSET_PX / zoom,
    );
  }

  /* ---------------------------------------------------------------- *
   * Furniture
   * ---------------------------------------------------------------- */

  private syncPieces(placements: readonly PlacedFurniture[]): void {
    const seen = new Set<string>();

    for (const view of placements) {
      seen.add(view.id);
      const existing = this.pieces.get(view.id);

      if (existing) {
        existing.view = view;
        this.position(existing);
        continue;
      }

      const def = getFurniture(view.furnitureId);
      // A placement whose piece has left the config is skipped rather than
      // crashing the room — the server treats it as occupying nothing too.
      if (!def) continue;

      const sprite = this.add
        .image(0, 0, def.sheet.key, frameName(view.furnitureId))
        // Bottom-anchored: a tall piece stands ON its footprint's last row.
        .setOrigin(0, 1);

      const piece: Piece = { view, sprite };
      this.position(piece);
      this.pieces.set(view.id, piece);
    }

    for (const [id, piece] of this.pieces) {
      if (seen.has(id)) continue;
      piece.sprite.destroy();
      this.pieces.delete(id);
    }
  }

  private position(piece: Piece): void {
    const def = getFurniture(piece.view.furnitureId);
    if (!def) return;

    const cell = this.cellToWorld(
      piece.view.x,
      piece.view.y + def.footprint.height,
    );
    piece.sprite.setPosition(cell.x, cell.y);
    /*
     * Sorted by the bottom of the footprint, so a chair in front of a dresser
     * draws over it. Via `groundDepth` rather than inlining `DEPTH.world + y`,
     * which was the last copy of the formula T-15.29 collapsed (T-18.01).
     *
     * **A FLAT piece goes to `DEPTH.groundDecal` instead** (T-18.08). A rug is
     * paint on the floor: it has no height, so it can occlude nothing, and
     * sorting it as though it stood up put the player behind their own carpet.
     * The farm already draws tilled soil this way for exactly this reason, and
     * the band is shared rather than duplicated.
     */
    piece.sprite.setDepth(def.flat ? DEPTH.groundDecal : groundDepth(cell.y));
  }

  /** The placed piece covering a CELL, or null. */
  private pieceAtCell(cellX: number, cellY: number): Piece | null {
    const cell = { x: cellX, y: cellY };

    for (const piece of this.pieces.values()) {
      const def = getFurniture(piece.view.furnitureId);
      if (!def) continue;

      if (
        cell.x >= piece.view.x &&
        cell.x < piece.view.x + def.footprint.width &&
        cell.y >= piece.view.y &&
        cell.y < piece.view.y + def.footprint.height
      ) {
        return piece;
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- *
   * Placing
   * ---------------------------------------------------------------- */

  private buildGhost(): void {
    this.ghost = this.add
      .rectangle(0, 0, TILE_SIZE, TILE_SIZE, COLOR.valid, 0.35)
      .setOrigin(0)
      .setDepth(DEPTH.overlay)
      .setVisible(false);
  }

  private buildHint(): void {
    this.hint = this.add
      .text(0, 0, HINT_TEXT, {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: `${HINT_PX}px`,
        /*
         * The floor's own darkest tone (`#994e4a`, the mortar line between the
         * planks), darkened a step for contrast. The old `#b59d84` was picked
         * against the diagonal hatch and is nearly invisible on the parquet
         * T-18.11 replaced it with — a colour is only readable relative to what
         * it sits on, so replacing the floor made re-picking this mandatory
         * rather than optional.
         */
        color: '#63302e',
      })
      // Bottom-anchored, so `fitCamera` can hang it off the room's bottom edge
      // without knowing how tall the rendered text turned out to be.
      .setOrigin(0.5, 1)
      .setScale(1 / PIXEL_SCALE)
      .setDepth(DEPTH.overlay);
    // `fitCamera` runs on every resize and immediately after this, and it owns
    // the real scale and position. The values here are only what it is born
    // with.
  }

  /**
   * Shows where the held piece would land, and whether it may.
   *
   * The legality check runs the SAME `fitsInRoom` and `overlaps` the server
   * uses — imported from shared config, not reimplemented — so the ghost cannot
   * promise a placement the server is about to refuse (§4.4).
   */
  private updateGhost(): void {
    const ghost = this.ghost;
    if (!ghost) return;

    const armed = hud.armedFurniture();
    const def = armed ? getFurniture(armed) : undefined;
    const faced = this.facedRoomTile();
    if (!def || !faced) {
      ghost.setVisible(false);
      return;
    }

    const cell = this.tileToCell(faced.tileX, faced.tileY);
    if (!cell) {
      // Facing the wall. Shown as illegal ON the faced tile rather than hidden,
      // because a ghost that vanishes reads as "the game stopped responding".
      const at = { x: faced.tileX * TILE_SIZE, y: faced.tileY * TILE_SIZE };
      ghost
        .setPosition(at.x, at.y)
        .setSize(TILE_SIZE, TILE_SIZE)
        .setFillStyle(COLOR.invalid, 0.35)
        .setVisible(true);
      return;
    }

    // The SAME rule the server validates with, imported from shared config
    // rather than reimplemented — so a green ghost cannot promise a placement
    // the server is about to refuse (§4.4), and since T-17.03 a red one cannot
    // post it either.
    const legal = this.isLegal('', def, cell.x, cell.y);
    const at = this.cellToWorld(cell.x, cell.y);

    ghost
      .setPosition(at.x, at.y)
      .setSize(def.footprint.width * TILE_SIZE, def.footprint.height * TILE_SIZE)
      .setFillStyle(legal ? COLOR.valid : COLOR.invalid, 0.35)
      .setVisible(true);
  }

  /**
   * The pieces currently in the room, in the shape `placementProblem` reads.
   *
   * A piece whose definition has left the config is skipped rather than
   * treated as occupying nothing — the same tolerance `refresh` already shows
   * it, and the server cannot enforce a footprint it can no longer look up
   * either.
   */
  private placedPieces(): PlacedPiece[] {
    const out: PlacedPiece[] = [];
    for (const piece of this.pieces.values()) {
      const def = getFurniture(piece.view.furnitureId);
      if (def) out.push({ id: piece.view.id, def, x: piece.view.x, y: piece.view.y });
    }
    return out;
  }

  private isLegal(
    placementId: string,
    def: ReturnType<typeof getFurniture> & object,
    x: number,
    y: number,
  ): boolean {
    // One rule, shared with the service and with `act()` — the ghost's colour
    // and the decision to post are now the same answer rather than two.
    return placementProblem({ def, x, y }, this.placedPieces(), placementId) === null;
  }

  private async putAway(placementId: string): Promise<void> {
    await this.commit(async () => {
      await removeFurniture(placementId, idempotencyKey());
    });
  }

  /**
   * Puts an armed piece down at the cell the character is facing (T-16.15).
   *
   * It used to search the room for the first cell that fitted, because the tray
   * was the only thing that could decide a position — there was no character to
   * ask. Searching was the best available answer to the wrong question: the
   * player asked to put a chair THERE, and the game put it wherever it found
   * room, which on a furnished floor is rarely where they were looking.
   */
  private async commitPlace(furnitureId: string, x: number, y: number): Promise<void> {
    const def = getFurniture(furnitureId);
    if (!def) return;

    await this.commit(() => placeFurniture(furnitureId, x, y, idempotencyKey()));
  }

  private async buy(furnitureId: string): Promise<void> {
    try {
      const result = await buyFurniture(furnitureId, idempotencyKey());
      hud.setGold(result.goldAfter);
    } catch (err) {
      /*
       * `FORBIDDEN` here means one thing and one thing only — a VIP exclusive
       * bought by an account that is not VIP. The shared map says "You cannot do
       * that", which is true and useless; the player needs to know it is the
       * star next to the name, not something they did wrong.
       */
      hud.toast(
        codeOf(err) === 'FORBIDDEN'
          ? 'That one is for VIP farms only.'
          : messageFor(err),
        'error',
      );
    } finally {
      await this.refresh();
    }
  }

  /**
   * Runs an intent and re-reads the room.
   *
   * Nothing is drawn optimistically: the room is small, the round trip is one
   * request, and a piece that snapped into place and then jumped back would be
   * worse than a piece that takes a moment to move.
   */
  private async commit(intent: () => Promise<unknown>): Promise<void> {
    if (this.busy) return;
    this.busy = true;

    try {
      await intent();
    } catch (err) {
      if (codeOf(err) === 'UNAUTHENTICATED') {
        window.location.assign('/login');
        return;
      }
      hud.toast(messageFor(err), 'error');
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }
}

function frameName(furnitureId: string): string {
  return `furniture-${furnitureId}`;
}

/**
 * Registers a texture frame per piece.
 *
 * The pieces do not line up with any 16px grid — they were measured from alpha
 * bounds (T-16.08) — so each is a custom frame over its crop window, exactly as
 * the houses and the decor are.
 *
 * Each frame is added to its OWN kit's texture since T-16.08, because the
 * catalogue is now spread across nine sheets rather than one. A frame name is
 * unique per piece, so it cannot collide across kits.
 */
export function registerFurnitureFrames(scene: Phaser.Scene): void {
  for (const def of Object.values(FURNITURE)) {
    const texture = scene.textures.get(def.sheet.key);
    const name = frameName(def.id);
    if (texture.has(name)) continue;
    texture.add(name, 0, def.crop.x, def.crop.y, def.crop.width, def.crop.height);
  }
}
