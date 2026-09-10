/**
 * Every nine-slice frame and button plate the UI reskin cuts out of the pack
 * (Phase U).
 *
 * **Why cutting is necessary at all.** `border-image` slices a nine-slice from
 * the *source image's own outer edges*. The pack's button plate is a 48x16
 * region at (0,16) of an 848x544 atlas, so asking `border-image` for a 3px
 * slice of that atlas takes pixels from four unrelated corners of the sheet —
 * which is exactly what `hud.css` tried, what it saw, and why it fell back to a
 * hand-drawn CSS bevel. Give each frame its own file and the problem is not
 * worked around, it is gone.
 *
 * **Every number here was measured, not read off a screen** (CLAUDE.md §9).
 * `scripts/measure-ui.mjs --check` re-derives each rectangle's slice insets
 * from the pixels and fails if this table disagrees, and `prepare-assets.mjs`
 * decodes each crop it writes and compares it to the source rectangle. So a
 * stale number here is caught twice before it can become a smeared corner on
 * every panel in the game.
 *
 * **What `slice` means.** The distance from each edge to the first pair of
 * identical adjacent rows/columns — the definition of where `border-image` can
 * stretch losslessly, not a guess at where the art "looks like" it turns a
 * corner. CSS consumes it as `border-image-slice: T R B L fill`.
 */

/* ------------------------------------------------------------------ *
 * Button plates
 * ------------------------------------------------------------------ */

/**
 * The plate grid, measured: eleven colour families down the left edge of
 * `button.png`, each an "up" plate at y=16+48k and a "pressed" plate 17px
 * below it, both 48px wide. Pitch 48, every up plate exactly 764 opaque px and
 * every pressed plate 716 — the uniformity is what says the grid is real
 * rather than a pattern imposed on it.
 *
 * The pressed plate is **15 tall, not 16**: the art drops the button by a pixel
 * rather than redrawing it, which is why `:active` in `ui.css` shifts the
 * element down 1px as well. Faking the press with a CSS transform instead would
 * fight the art, which already contains the press.
 *
 * **The names are the palette.** Plate 0's fill measures #ae4924 — the exact
 * value `hud.css` records as "the pack's signature rust… sampled #ae4924", and
 * plate 1's #c46120 is `--soil` verbatim. The HUD's colours were sampled off
 * these plates in T-15.26, so putting the plates back under the buttons is
 * closing a loop, not introducing a new palette.
 */
const PLATE_FAMILIES = [
  { name: 'rust', fill: '#ae4924', note: 'the signature plate — primary actions' },
  { name: 'soil', fill: '#c46120', note: '= --soil; secondary actions' },
  { name: 'sand', fill: '#d9a88a', note: 'light neutral; quiet/disabled actions' },
  { name: 'cyan', fill: '#2eafc7', note: 'the one cool family in the pack' },
  { name: 'moss', fill: '#a4c93c', note: 'confirm / positive' },
  { name: 'lime', fill: '#c0d83c', note: 'confirm, brighter' },
  { name: 'blush', fill: '#ffb8a8', note: 'soft warning' },
  { name: 'pink', fill: '#ffaab0', note: 'destructive / cancel' },
  { name: 'amber', fill: '#ff9d0e', note: 'gold and currency' },
  { name: 'honey', fill: '#eea841', note: 'gold, softer' },
  { name: 'clay', fill: '#e6965b', note: 'warm neutral' },
];

const PLATE_SRC = 'UI/button.png';

const plateCrops = PLATE_FAMILIES.flatMap((family, k) => [
  {
    src: PLATE_SRC,
    out: `ui-plate-${family.name}.png`,
    x: 0,
    y: 16 + 48 * k,
    w: 48,
    h: 16,
    slice: { top: 3, right: 3, bottom: 5, left: 3 },
    note: `${family.note} (fill ${family.fill})`,
  },
  {
    src: PLATE_SRC,
    out: `ui-plate-${family.name}-down.png`,
    x: 0,
    y: 33 + 48 * k,
    w: 48,
    h: 15,
    slice: { top: 3, right: 3, bottom: 4, left: 3 },
    note: `${family.name}, pressed — 15 tall, the art drops it a pixel`,
  },
]);

/** Exported so `ui.css` and the credits page can name the families. */
export const UI_PLATE_FAMILIES = PLATE_FAMILIES;


/* ------------------------------------------------------------------ *
 * Panels, frames and wells
 * ------------------------------------------------------------------ */

const frameCrops = [
  {
    src: 'UI/Inventory/inventory.png',
    out: 'ui-panel.png',
    x: 0,
    y: 64,
    w: 48,
    h: 48,
    slice: { top: 6, right: 6, bottom: 6, left: 6 },
    note:
      'THE panel frame — rounded, warm, and the only piece in the pack whose ' +
      'insets are symmetric on all four sides, so it scales to any panel shape ' +
      'without a visible bias. Every window in the HUD is this.',
  },
  {
    src: 'UI/Inventory/Banner.png',
    out: 'ui-well.png',
    x: 0,
    y: 48,
    w: 48,
    h: 48,
    slice: { top: 4, right: 4, bottom: 4, left: 4 },
    note:
      'A frame with a transparent middle — an inset well for grids and lists ' +
      'to sit in, so a panel can have depth without a second background colour.',
  },
  /*
   * The inventory cell, and its lit twin.
   *
   * **These come from `Slots.png`, not from the `inventory.png` kit** — and the
   * kit's cell was tried first. It is a pale cream frame, which is invisible
   * against `ui-panel.png`'s cream interior: a grid of twelve of them read as
   * an empty rectangle with faint scratches on it. The pack's orange square is
   * `--soil` (#c46120) and reads instantly against the panel it sits in.
   *
   * `UI_SLOT` in `assets.ts` already pointed at exactly these two squares, and
   * described them as "the same square lit and unlit… exactly a hotbar's two
   * states". Phase U keeps that reading and cuts them so they can be sliced —
   * the old code stretched one fixed 18px square with `background-size`, which
   * is why the cell size was locked to a multiple of 18.
   */
  {
    src: 'UI/Inventory/Slots.png',
    out: 'ui-slot.png',
    x: 151,
    y: 6,
    w: 18,
    h: 18,
    slice: { top: 2, right: 2, bottom: 2, left: 2 },
    note: 'inventory cell, unlit (#c46120)',
  },
  {
    src: 'UI/Inventory/Slots.png',
    out: 'ui-slot-lit.png',
    x: 182,
    y: 6,
    w: 18,
    h: 18,
    slice: { top: 2, right: 2, bottom: 2, left: 2 },
    note: 'the same cell, lit (#d9884c) — hover, and the selected hotbar slot',
  },
  {
    src: 'UI/Inventory/Banner.png',
    out: 'ui-select.png',
    x: 67,
    y: 3,
    w: 42,
    h: 42,
    slice: { top: 5, right: 5, bottom: 5, left: 5 },
    note:
      'Corner brackets on a transparent middle: the selected hotbar slot, and ' +
      'the focus ring. It overlays a cell rather than replacing it, so ' +
      'selection and contents are separate layers.',
  },
  {
    src: 'UI/Inventory/Banner.png',
    out: 'ui-focus.png',
    x: 67,
    y: 211,
    w: 42,
    h: 42,
    slice: { top: 5, right: 5, bottom: 5, left: 5 },
    note: 'The dashed variant of the above — keyboard focus, distinct from selection.',
  },
  {
    src: 'UI/dialogue box.png',
    out: 'ui-dialogue.png',
    x: 0,
    y: 0,
    w: 48,
    h: 48,
    slice: { top: 5, right: 5, bottom: 5, left: 5 },
    note:
      'The scalloped box. HAND-CUT: this sheet has no transparent gutters at ' +
      'all, so the 48x48 rectangle cannot be recovered by decomposition — it ' +
      'was found by sweeping candidate sizes and taking the one whose insets ' +
      'come out symmetric (40 and 46 do not; 48 does). Used for dialogue and ' +
      'for the item tooltips, which is why it is worth the hand-cut.',
    handCut: true,
  },
  {
    src: 'UI/Inventory/Slots.png',
    out: 'ui-rail.png',
    x: 6,
    y: 105,
    w: 164,
    h: 28,
    slice: { top: 10, right: 8, bottom: 5, left: 8 },
    note:
      'The timber plank: panel frames, headers, and the hotbar. Asymmetric on ' +
      'purpose — the art is lit from above, so the top inset is twice the ' +
      'bottom. Used WITHOUT `fill` for panels, so the element background shows ' +
      'through the ring as a light interior; WITH `fill` where a dark bar is ' +
      'wanted.',
  },
  {
    src: 'UI/Clock/Extras.png',
    out: 'ui-plaque.png',
    x: 2,
    y: 9,
    w: 60,
    h: 18,
    slice: { top: 0, right: 3, bottom: 4, left: 3 },
    note:
      'A timber plaque with a tan (#ffd2a1) inner panel — the gold counter and ' +
      'the level pip. This is the one piece in the pack that already IS the ' +
      'wooden-frame-with-light-inset the design reference is built from, so it ' +
      'is used as drawn rather than assembled out of a ring and a background.',
  },
];


/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

/**
 * Pill tags from `Inventory/Extras.png`, a 12x8 grid of 32x32 cells holding a
 * 27x27 pill each. Tabs, badges and price chips — the pack ships no tab widget,
 * and these are what it offers instead.
 *
 * **Each one is cut to its own file even though they come off a tidy grid**,
 * for the reason the whole phase exists: `border-image` slices from the source
 * image's outer edges, so a pill addressed as a cell of a 384x256 sheet would
 * take its corners from the sheet's corners. A background-position can address
 * a cell; a nine-slice cannot.
 *
 * The measured insets are `top: 0, bottom: 0` and that is correct rather than a
 * detection failure: these are horizontal capsules with **flat** top and bottom
 * edges and rounded ends, so the first pair of identical rows is the first pair.
 * They stretch horizontally to any label width. They are **not** meant to
 * stretch vertically — the pill has internal shading — so `ui.css` pins the
 * height to 27 source pixels.
 */
const TAG_CELLS = [
  { name: 'red', x: 3, y: 3, fill: '#f6464e' },
  { name: 'pink', x: 35, y: 3, fill: '#ffaab0' },
  { name: 'grey', x: 67, y: 3, fill: '#d9d9d9' },
  { name: 'cyan', x: 3, y: 67, fill: '#2eafc7' },
  { name: 'honey', x: 35, y: 67, fill: '#eea841' },
  { name: 'green', x: 67, y: 67, fill: '#7ec433' },
];

const tagCrops = TAG_CELLS.map((tag) => ({
  src: 'UI/Inventory/Extras.png',
  out: `ui-tag-${tag.name}.png`,
  x: tag.x,
  y: tag.y,
  w: 27,
  h: 27,
  slice: { top: 0, right: 4, bottom: 0, left: 5 },
  note: `pill tag, ${tag.fill}`,
}));

/** Exported so the credits page and `ui.css` can name the set. */
export const UI_TAG_COLOURS = TAG_CELLS;


/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

export const UI_CROPS = [...plateCrops, ...frameCrops, ...tagCrops];
