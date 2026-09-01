import Phaser from 'phaser';
import {
  FURNITURE,
  FURNITURE_SHEET,
  PIXEL_SCALE,
  TILE_SIZE,
  fitsInRoom,
  getFurniture,
  overlaps,
} from '@tillhaven/shared/config';
import type { InteriorRoom } from '@tillhaven/shared/types';
import { hud } from '../hud.js';
import { DEPTH } from '../depth.js';
import { messageFor, codeOf } from '../../net/errors.js';
import { idempotencyKey } from '../../net/api.js';
import {
  buyFurniture,
  fetchCatalogue,
  fetchInterior,
  moveFurniture,
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
 * The room is drawn, not tiled: `Interior.png` is furniture only, with no floor
 * or wall art in the pack, so there is nothing to lay out. Rectangles in the
 * game's palette are honest about that and are trivially replaced the day
 * interior tiles exist.
 */

/** Room colours, matching the HUD's paper-and-ink palette. */
const COLOR = {
  floor: 0x8a5a3b,
  floorAlt: 0x7d5034,
  wall: 0x50331f,
  grid: 0x000000,
  valid: 0x79bf56,
  invalid: 0xae4924,
} as const;

/** Wall height above the floor, in cells. Decoration only — nothing stands there. */
const WALL_CELLS = 2;

const HUD_MARGIN = 56;

interface Piece {
  view: PlacedFurniture;
  readonly sprite: Phaser.GameObjects.Image;
}

export class Interior extends Phaser.Scene {
  private room: InteriorRoom = { width: 10, height: 8 };
  private readonly pieces = new Map<string, Piece>();

  private floor?: Phaser.GameObjects.Graphics;
  private ghost?: Phaser.GameObjects.Rectangle;
  private hint?: Phaser.GameObjects.Text;

  /** The piece being dragged, if any. */
  private dragging: string | null = null;
  private busy = false;

  private catalogue: CatalogueEntry[] = [];
  private owned: OwnedFurniture[] = [];

  constructor() {
    super('Interior');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#241309');

    registerFurnitureFrames(this);
    this.buildGhost();
    this.buildHint();

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) =>
      this.onPointerDown(p),
    );
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) =>
      void this.onPointerUp(p),
    );

    this.input.keyboard?.on('keydown-ESC', () => this.leave());

    hud.onLeaveHouse(() => this.leave());
    hud.onDecorate(
      (furnitureId) => void this.place(furnitureId),
      (furnitureId) => void this.buy(furnitureId),
    );
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera());

    void this.refresh();
  }

  override update(): void {
    this.updateGhost();
  }

  /** Back to the farm, which has been asleep rather than destroyed. */
  private leave(): void {
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
      this.drawRoom();
      this.syncPieces(view.placements);
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

  private drawRoom(): void {
    this.floor?.destroy();
    const g = this.add.graphics().setDepth(DEPTH.ground);

    // Wall band along the top, so the room reads as a room rather than a grid.
    g.fillStyle(COLOR.wall, 1);
    g.fillRect(0, 0, this.roomWidthPx(), WALL_CELLS * TILE_SIZE);

    // Chequered floor: two shades make the cells legible without a grid line
    // over every one of them.
    for (let y = 0; y < this.room.height; y++) {
      for (let x = 0; x < this.room.width; x++) {
        g.fillStyle((x + y) % 2 === 0 ? COLOR.floor : COLOR.floorAlt, 1);
        g.fillRect(
          x * TILE_SIZE,
          (y + WALL_CELLS) * TILE_SIZE,
          TILE_SIZE,
          TILE_SIZE,
        );
      }
    }

    g.lineStyle(1, COLOR.grid, 0.18);
    g.strokeRect(0, 0, this.roomWidthPx(), this.roomHeightPx());

    this.floor = g;
  }

  /** Cell (0,0) is the first FLOOR cell, below the wall band. */
  private cellToWorld(x: number, y: number): { x: number; y: number } {
    return { x: x * TILE_SIZE, y: (y + WALL_CELLS) * TILE_SIZE };
  }

  private worldToCell(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: Math.floor(worldX / TILE_SIZE),
      y: Math.floor(worldY / TILE_SIZE) - WALL_CELLS,
    };
  }

  private fitCamera(): void {
    const usableHeight = Math.max(1, this.scale.height - HUD_MARGIN);
    const fit = Math.min(
      this.scale.width / this.roomWidthPx(),
      usableHeight / this.roomHeightPx(),
    );
    const zoom = Math.max(1, Math.min(PIXEL_SCALE * 2, Math.floor(fit)));

    const camera = this.cameras.main;
    camera.setZoom(zoom);
    camera.centerOn(
      this.roomWidthPx() / 2,
      this.roomHeightPx() / 2 - HUD_MARGIN / (2 * zoom),
    );

    this.hint?.setScale(1 / zoom).setFontSize(10 * zoom);
    this.hint?.setPosition(this.roomWidthPx() / 2, this.roomHeightPx() + 6);
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
        .image(0, 0, FURNITURE_SHEET.key, frameName(view.furnitureId))
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
    // Sorted by the bottom of the footprint, so a chair in front of a dresser
    // draws over it.
    piece.sprite.setDepth(DEPTH.world + cell.y);
  }

  private pieceAt(worldX: number, worldY: number): Piece | null {
    const cell = this.worldToCell(worldX, worldY);

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
      .text(0, 0, 'Drag furniture to move it · right-click to put it away · Esc to leave', {
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontSize: `${10 * PIXEL_SCALE}px`,
        color: '#b59d84',
      })
      .setOrigin(0.5, 0)
      .setScale(1 / PIXEL_SCALE)
      .setDepth(DEPTH.overlay);
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

    const held = this.dragging ? this.pieces.get(this.dragging) : null;
    if (!held) {
      ghost.setVisible(false);
      return;
    }

    const def = getFurniture(held.view.furnitureId);
    if (!def) return;

    const pointer = this.input.activePointer;
    const cell = this.worldToCell(pointer.worldX, pointer.worldY);
    const legal = this.isLegal(held.view.id, def, cell.x, cell.y);
    const at = this.cellToWorld(cell.x, cell.y);

    ghost
      .setPosition(at.x, at.y)
      .setSize(def.footprint.width * TILE_SIZE, def.footprint.height * TILE_SIZE)
      .setFillStyle(legal ? COLOR.valid : COLOR.invalid, 0.35)
      .setVisible(true);
  }

  private isLegal(
    placementId: string,
    def: ReturnType<typeof getFurniture> & object,
    x: number,
    y: number,
  ): boolean {
    if (!fitsInRoom(def, x, y)) return false;

    for (const other of this.pieces.values()) {
      if (other.view.id === placementId) continue;
      const otherDef = getFurniture(other.view.furnitureId);
      if (!otherDef) continue;

      if (overlaps({ def, x, y }, { def: otherDef, x: other.view.x, y: other.view.y })) {
        return false;
      }
    }
    return true;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const piece = this.pieceAt(pointer.worldX, pointer.worldY);
    if (!piece) return;

    if (pointer.rightButtonDown()) {
      void this.putAway(piece.view.id);
      return;
    }

    this.dragging = piece.view.id;
    piece.sprite.setAlpha(0.6);
  }

  private async onPointerUp(pointer: Phaser.Input.Pointer): Promise<void> {
    const id = this.dragging;
    this.dragging = null;
    if (!id) return;

    const piece = this.pieces.get(id);
    if (!piece) return;
    piece.sprite.setAlpha(1);

    const cell = this.worldToCell(pointer.worldX, pointer.worldY);
    if (cell.x === piece.view.x && cell.y === piece.view.y) return;

    await this.commit(() => moveFurniture(id, cell.x, cell.y, idempotencyKey()));
  }

  private async putAway(placementId: string): Promise<void> {
    await this.commit(async () => {
      await removeFurniture(placementId, idempotencyKey());
    });
  }

  /**
   * Puts a piece down from the tray, in the first cell it will actually fit.
   *
   * Searching beats dropping it at 0,0 and reporting `PLOT_OCCUPIED`: the
   * player asked to place a chair, not to be told where they cannot. The search
   * uses the same shared predicates the server validates with, so the cell it
   * picks is one the server will accept.
   */
  async place(furnitureId: string): Promise<void> {
    const def = getFurniture(furnitureId);
    if (!def) return;

    for (let y = 0; y <= this.room.height - def.footprint.height; y++) {
      for (let x = 0; x <= this.room.width - def.footprint.width; x++) {
        if (!this.isLegal('', def, x, y)) continue;
        await this.commit(() => placeFurniture(furnitureId, x, y, idempotencyKey()));
        return;
      }
    }

    hud.toast('There is no room for that.', 'error');
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
 * The pieces do not line up with the sheet's 16px grid — they were measured
 * from alpha bounds — so each is a custom frame over its crop window, exactly
 * as the houses are.
 */
export function registerFurnitureFrames(scene: Phaser.Scene): void {
  const texture = scene.textures.get(FURNITURE_SHEET.key);

  for (const def of Object.values(FURNITURE)) {
    const name = frameName(def.id);
    if (texture.has(name)) continue;
    texture.add(name, 0, def.crop.x, def.crop.y, def.crop.width, def.crop.height);
  }
}
