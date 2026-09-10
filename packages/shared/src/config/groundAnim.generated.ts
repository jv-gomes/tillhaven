/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by the map editor's **Animations** panel (`pnpm dev:mapmaker` →
 * "Save animations"), which posts to a dev-only Vite endpoint that serialises
 * this file from validated data. To change an animation, edit it there and save
 * — hand edits here are overwritten by the next save.
 *
 * **This is the WHAT; the map is only the WHERE.** `farm.json` stamps an
 * `animId` on a cell and nothing else, so re-timing an animation or swapping a
 * frame is an edit to this file and does not touch a single map. That is why
 * this is committed shared config rather than map data (CLAUDE.md §4.4): the
 * mapmaker writes it and the Farm scene reads it, and the two cannot disagree.
 *
 * Frames index the existing asset manifest by sheet key, so nothing here can
 * renumber `TILESET_RUNS` or force a map regeneration.
 */

import type { GroundAnimation } from './groundAnim.js';

export const AUTHORED_GROUND_ANIMATIONS: readonly GroundAnimation[] = [
  {
    id: "water-ripple",
    name: "Rippling water",
    fps: 4,
    frames: [
      { sheet: "water-tile", frame: 0 },
      { sheet: "water-tile", frame: 0 },
    ],
  },
  {
    id: "grass-top-left",
    name: "Shore corner (top left)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 8 },
      { sheet: "tileset-grass-water-spring", frame: 20 },
      { sheet: "tileset-grass-water-spring", frame: 32 },
      { sheet: "tileset-grass-water-spring", frame: 44 },
    ],
  },
  {
    id: "grass-left",
    name: "Shore edge (left)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 56 },
      { sheet: "tileset-grass-water-spring", frame: 68 },
      { sheet: "tileset-grass-water-spring", frame: 80 },
      { sheet: "tileset-grass-water-spring", frame: 92 },
    ],
  },
  {
    id: "grass-bot-left",
    name: "Shore corner (bottom left)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 152 },
      { sheet: "tileset-grass-water-spring", frame: 164 },
      { sheet: "tileset-grass-water-spring", frame: 176 },
      { sheet: "tileset-grass-water-spring", frame: 188 },
    ],
  },
  {
    id: "grass-top-right",
    name: "Shore corner (top right)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 11 },
      { sheet: "tileset-grass-water-spring", frame: 23 },
      { sheet: "tileset-grass-water-spring", frame: 35 },
      { sheet: "tileset-grass-water-spring", frame: 47 },
    ],
  },
  {
    id: "grass-right",
    name: "Shore edge (right)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 107 },
      { sheet: "tileset-grass-water-spring", frame: 119 },
      { sheet: "tileset-grass-water-spring", frame: 131 },
      { sheet: "tileset-grass-water-spring", frame: 143 },
    ],
  },
  {
    id: "grass-bot",
    name: "Shore edge (bottom)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 153 },
      { sheet: "tileset-grass-water-spring", frame: 165 },
      { sheet: "tileset-grass-water-spring", frame: 177 },
      { sheet: "tileset-grass-water-spring", frame: 189 },
    ],
  },
  {
    id: "grass-bot-right",
    name: "Shore corner (bottom right)",
    fps: 4,
    frames: [
      { sheet: "tileset-grass-water-spring", frame: 155 },
      { sheet: "tileset-grass-water-spring", frame: 167 },
      { sheet: "tileset-grass-water-spring", frame: 179 },
      { sheet: "tileset-grass-water-spring", frame: 191 },
    ],
  },
];
