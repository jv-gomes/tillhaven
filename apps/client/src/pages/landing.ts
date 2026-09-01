import '../styles/base.css';
import '../styles/landing.css';

import {
  CROPS,
  CROP_IDS,
  ANIMALS,
  ANIMAL_KINDS,
  ITEMS,
  ANIMAL_COW_FEMALE_BROWN,
  ANIMAL_CHICKEN_RED,
  ANIMAL_CHICKEN_BABY_YELLOW,
  CHAR_PROMO_WALK,
  CHAR_ANIMS,
  OBJ_TINY_HOUSE,
  OBJ_TINY_HOUSE_LOOK,
  OBJ_MAPLE_TREE,
  MAPLE_TREE,
  VIP_BENEFITS,
  VIP_DURATION_MS,
  STARTING_PLOTS,
  MINUTE,
  HOUR,
  DAY,
  type CropId,
  type CropDef,
  // Imported from the config entry point, not the package root: the root barrel
  // re-exports the Zod schemas, which would drag ~60kB of validator onto a
  // marketing page that never validates anything.
} from '@tillhaven/shared/config';

import { sprite, animatedSprite } from '../lib/sprite.js';

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

function humanDuration(ms: number): string {
  if (ms <= 0) return 'instant';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;

  const [value, unit] = ms < DAY ? [ms / HOUR, 'hr'] : [ms / DAY, 'day'];
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  // "1 days" reads as a bug even when the number is right.
  return `${shown} ${unit}${unit === 'day' && value !== 1 ? 's' : ''}`;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function specRow(dl: HTMLElement, label: string, value: string): void {
  const row = el('div');
  row.append(el('dt', undefined, label), el('dd', undefined, value));
  dl.append(row);
}

/* ------------------------------------------------------------------ *
 * Signature element: the live plot
 *
 * Growth is DERIVED from wall-clock time every frame rather than accumulated
 * per tick — the same rule the server follows (CLAUDE.md §4.2). That is what
 * makes the demo survive a backgrounded tab: when the browser stops calling
 * rAF, nothing is lost, because nothing was being counted.
 * ------------------------------------------------------------------ */

/**
 * Real crops take hours. To show growth on a page someone reads for ninety
 * seconds, the demo clock runs fast — and says so, next to the real duration,
 * so the page never implies a leek is ready in a minute.
 */
const DEMO_SPEED = 240;

/** Staggered starts so the row shows several stages at once, not six clones. */
const DEMO_PLOTS: readonly { crop: CropId; offsetMs: number }[] = [
  { crop: 'leek', offsetMs: 0 },
  { crop: 'potato', offsetMs: 40_000 },
  { crop: 'strawberry', offsetMs: 95_000 },
  { crop: 'leek', offsetMs: 20_000 },
  { crop: 'onion', offsetMs: 150_000 },
  { crop: 'potato', offsetMs: 70_000 },
];

interface DemoCell {
  readonly def: CropDef;
  readonly offsetMs: number;
  readonly cell: HTMLElement;
  readonly art: HTMLElement;
  readonly fill: HTMLElement;
  readonly timer: HTMLElement;
  /** Last rendered stage, so the sprite is only rewritten when it changes. */
  stage: number;
}

function buildPlot(root: HTMLElement): void {
  const soil = root.querySelector<HTMLElement>('[data-plot-soil]');
  const clockSlot = root.querySelector<HTMLElement>('[data-plot-clock]');
  const speedEl = root.querySelector<HTMLElement>('[data-plot-speed]');
  const awayEl = root.querySelector<HTMLElement>('[data-plot-away]');
  if (!soil || !clockSlot || !speedEl || !awayEl) return;

  // Re-bound so the narrowing survives into the hoisted `render` below.
  const clockEl: HTMLElement = clockSlot;

  speedEl.textContent = `Demo clock ×${DEMO_SPEED}`;

  const startedAt = Date.now();
  const cells: DemoCell[] = [];

  for (const { crop, offsetMs } of DEMO_PLOTS) {
    const def = CROPS[crop];

    const cell = el('div', 'plot__cell');
    const art = el('span', 'plot__crop');
    art.append(sprite(def.sheet, def.stageFrames[0]!, { scale: 3 }));

    const bar = el('div', 'plot__bar');
    const fill = el('div', 'plot__fill');
    fill.style.width = '0%';
    bar.append(fill);

    const label = el('div', 'plot__label');
    label.append(def.name);
    const timer = el('span', 'plot__timer', '--:--');
    label.append(timer);

    cell.append(art, bar, label);
    soil.append(cell);

    cells.push({ def, offsetMs, cell, art, fill, timer, stage: -1 });
  }

  /**
   * Renders the row for a given wall-clock instant. Pure in `now`: calling it
   * twice with the same value produces the same output, and skipping calls
   * loses nothing.
   */
  function render(now: number): void {
    const elapsed = (now - startedAt) * DEMO_SPEED;

    for (const c of cells) {
      const age = elapsed + c.offsetMs;
      const cycle = c.def.growthDurationMs;
      // Loop the demo so a long-lived tab keeps showing growth rather than a
      // row of finished crops.
      const t = age % (cycle + 12_000 * DEMO_SPEED);
      const ripe = t >= cycle;
      const progress = ripe ? 1 : t / cycle;

      const lastStage = c.def.stageFrames.length - 1;
      const stage = ripe
        ? lastStage
        : Math.min(lastStage, Math.floor(progress * c.def.stageFrames.length));

      if (stage !== c.stage) {
        c.stage = stage;
        c.art.replaceChildren(
          sprite(c.def.sheet, c.def.stageFrames[stage]!, { scale: 3 }),
        );
      }

      c.fill.style.width = `${Math.round(progress * 100)}%`;
      c.cell.classList.toggle('is-ripe', ripe);
      c.timer.textContent = ripe
        ? 'Ready'
        : humanDuration(Math.ceil((cycle - t) / DEMO_SPEED) * DEMO_SPEED);
    }

    clockEl.textContent = clock(now - startedAt);
  }

  let frame = 0;
  const loop = (): void => {
    render(Date.now());
    frame = requestAnimationFrame(loop);
  };
  loop();

  /*
   * The moment the page is actually selling. The browser pauses rAF for a
   * hidden tab, so on return we render once from the current clock and report
   * what changed — the same reconciliation the game does on reconnect.
   */
  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      cancelAnimationFrame(frame);
      return;
    }

    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    loop();

    if (away > 3_000) {
      const ready = cells.filter((c) => c.cell.classList.contains('is-ripe')).length;
      awayEl.textContent =
        `Away ${clock(away)} · grew ${humanDuration(away * DEMO_SPEED)} · ` +
        `${ready} ${ready === 1 ? 'plot' : 'plots'} ready`;
      awayEl.hidden = false;
    }
  });
}

/* ------------------------------------------------------------------ *
 * Growth stage timeline
 * ------------------------------------------------------------------ */

function buildStages(container: HTMLElement, caption: HTMLElement): void {
  // All four crops share the same stage count (T-7.08); potato is simply the
  // one this diagram has always used.
  const def = CROPS.potato;

  def.stageFrames.forEach((frame, i) => {
    const stage = el('div', 'stage');
    const art = el('div', 'stage__art');
    art.append(sprite(def.sheet, frame, { scale: 3 }));

    const last = i === def.stageFrames.length - 1;
    stage.append(
      art,
      el('span', 'stage__n', last ? 'Ready' : `Stage ${i + 1}`),
    );
    container.append(stage);
  });

  caption.textContent =
    `${def.name} · ${def.stageFrames.length} stages · ` +
    `${humanDuration(def.growthDurationMs)} from seed to harvest`;
}

/* ------------------------------------------------------------------ *
 * Catalogue
 * ------------------------------------------------------------------ */

function entry(art: HTMLElement[], name: string, blurb: string): HTMLElement {
  const card = el('article', 'entry');
  const artBox = el('div', 'entry__art');
  artBox.append(...art);

  const body = el('div', 'entry__body');
  body.append(el('h3', 'entry__name', name), el('p', 'entry__blurb', blurb));

  card.append(artBox, body);
  return card;
}

const CROP_BLURBS: Readonly<Record<CropId, string>> = {
  leek: 'The starter crop. Turns over inside a lunch break and pays for the next handful of seeds.',
  potato: 'Plant a tray in the morning and it is done by mid-afternoon. The reliable middle of the season.',
  strawberry: 'Two berries per plant instead of one, which is what makes the pricier seed worth it.',
  onion: 'An overnight crop. Sow before bed, wake up to three per plot.',
};

function buildCrops(container: HTMLElement): void {
  for (const id of CROP_IDS) {
    const def = CROPS[id];
    const produce = ITEMS[def.produceItemId];
    const seed = ITEMS[def.seedItemId];

    const card = entry(
      [
        sprite(def.sheet, def.seedFrame, { scale: 3, title: `${def.name} seeds` }),
        sprite(def.sheet, def.stageFrames.at(-1)!, { scale: 3, title: def.name }),
      ],
      def.name,
      CROP_BLURBS[id],
    );

    const dl = el('dl', 'spec');
    specRow(dl, 'Seed', `${seed?.shopBuyPrice ?? 0}g`);
    specRow(dl, 'Grows in', humanDuration(def.growthDurationMs));
    specRow(dl, 'Yield', `${def.yieldAmount} per plot`);
    specRow(dl, 'Sells for', `${produce?.shopSellPrice ?? 0}g each`);
    card.querySelector('.entry__body')?.append(dl);

    container.append(card);
  }
}

const ANIMAL_ART: Readonly<Record<string, () => HTMLElement[]>> = {
  cow: () => [animatedSprite(ANIMAL_COW_FEMALE_BROWN, 0, 4, 3, { scale: 3 })],
  chicken: () => [
    sprite(ANIMAL_CHICKEN_BABY_YELLOW, 0, { scale: 3, title: 'Chick' }),
    animatedSprite(ANIMAL_CHICKEN_RED, 0, 4, 5, { scale: 3 }),
  ],
};

const ANIMAL_BLURBS: Readonly<Record<string, string>> = {
  cow: 'Slow and steady. One cow covers the cost of a lot of seed, provided you keep the hay up.',
  chicken: 'Arrives as a chick and lays once grown. Cheap enough to start a flock early.',
};

function buildAnimals(container: HTMLElement): void {
  for (const kind of ANIMAL_KINDS) {
    const def = ANIMALS[kind];
    const produce = ITEMS[def.produceItemId];
    const feed = ITEMS[def.feedItemId];

    const card = entry(
      ANIMAL_ART[kind]?.() ?? [],
      def.name,
      ANIMAL_BLURBS[kind] ?? '',
    );

    const dl = el('dl', 'spec');
    specRow(dl, 'Costs', `${def.purchasePrice}g`);
    specRow(dl, 'Produces', `${produce?.name ?? '—'} every ${humanDuration(def.productionIntervalMs)}`);
    specRow(
      dl,
      'Grows up in',
      def.maturityDurationMs === 0 ? 'Arrives grown' : humanDuration(def.maturityDurationMs),
    );
    specRow(dl, 'Feed', `${feed?.name ?? '—'} · ${humanDuration(def.feedDurationMs)}`);
    card.querySelector('.entry__body')?.append(dl);

    container.append(card);
  }
}

/* ------------------------------------------------------------------ *
 * VIP
 * ------------------------------------------------------------------ */

function buildVip(list: HTMLElement): void {
  const speedup = 100 - VIP_BENEFITS.durationPercent;
  const days = Math.round(VIP_DURATION_MS / DAY);

  const lines: readonly [string, string][] = [
    [`${speedup}% off every timer`, 'Crops and animals finish faster. They produce the same things, just sooner.'],
    [`+${VIP_BENEFITS.bonusPlotSlots} plots`, `On top of the ${STARTING_PLOTS} you start with and everything you unlock with gold.`],
    [
      `+${VIP_BENEFITS.bonusInventorySlots} bag slots, +${VIP_BENEFITS.bonusChestSlots} chest slots`,
      'Room to let a harvest pile up before you sort it out.',
    ],
    ['Harvest and collect in one go', 'Clear every ripe plot and every ready animal with a single action.'],
    ['Cosmetics', `Decorations and character options you cannot get otherwise — and cannot trade away. ${days} days, one payment.`],
  ];

  for (const [title, detail] of lines) {
    const li = el('li');
    const span = el('span');
    span.append(el('strong', undefined, title), ` ${detail}`);
    li.append(span);
    list.append(li);
  }
}

/* ------------------------------------------------------------------ *
 * Small decorative scenes
 * ------------------------------------------------------------------ */

/**
 * The same maple the farm map plants, from the one shared constant
 * (`MAPLE_TREE.stillFrame`) rather than a second copy of the number.
 *
 * T-9.05 measured the sheet and corrected the label this used to carry: frame
 * 2 is the YOUNG spring maple, third along a growth row that starts with a
 * sprout — the mature trees are a row further down. The frame is unchanged,
 * because it is the tree the farm shows and these are the farm's trees; only
 * the claim about what it is was wrong.
 */
const MAPLE_TREE_FRAME = MAPLE_TREE.stillFrame;

function buildCloserScene(scene: HTMLElement): void {
  // Walking home past the maples at the end of the day.
  scene.append(
    sprite(OBJ_MAPLE_TREE, MAPLE_TREE_FRAME, { scale: 2 }),
    sprite(OBJ_MAPLE_TREE, MAPLE_TREE_FRAME, { scale: 2 }),
    houseSprite(2),
    animatedSprite(CHAR_PROMO_WALK, 0, CHAR_ANIMS.walk.framesPerDirection, CHAR_ANIMS.walk.fps, {
      scale: 2,
    }),
    animatedSprite(ANIMAL_CHICKEN_RED, 0, 4, 5, { scale: 2 }),
  );
}

/**
 * The tiny house kit holds many wall/roof/door parts spanning the whole
 * image, so a house is a cropped window onto it rather than a single frame —
 * same pattern as `House.ts` uses in the actual game scene. `OBJ_TINY_HOUSE_LOOK`
 * is the one complete, ready-to-use house silhouette T-7.04 measured on this
 * sheet (see its doc comment in the shared config).
 */
function houseSprite(scale: number): HTMLElement {
  const { x, y, width, height } = OBJ_TINY_HOUSE_LOOK;
  const box = el('span', 'sprite');
  box.style.width = `${width * scale}px`;
  box.style.height = `${height * scale}px`;
  box.style.backgroundImage = `url("${OBJ_TINY_HOUSE.path}")`;
  box.style.backgroundSize = `${OBJ_TINY_HOUSE.width * scale}px ${OBJ_TINY_HOUSE.height * scale}px`;
  box.style.backgroundPosition = `-${x * scale}px -${y * scale}px`;
  return box;
}

function buildWordmark(slot: HTMLElement): void {
  slot.replaceWith(sprite(CROPS.leek.sheet, CROPS.leek.stageFrames.at(-1)!, { scale: 1 }));
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

function mount(): void {
  const plot = document.querySelector<HTMLElement>('[data-plot]');
  if (plot) buildPlot(plot);

  const stages = document.querySelector<HTMLElement>('[data-stages]');
  const stagesCaption = document.querySelector<HTMLElement>('[data-stages-caption]');
  if (stages && stagesCaption) buildStages(stages, stagesCaption);

  const crops = document.querySelector<HTMLElement>('[data-crops]');
  if (crops) buildCrops(crops);

  const animals = document.querySelector<HTMLElement>('[data-animals]');
  if (animals) buildAnimals(animals);

  const vip = document.querySelector<HTMLElement>('[data-vip]');
  if (vip) buildVip(vip);

  const scene = document.querySelector<HTMLElement>('[data-closer-scene]');
  if (scene) buildCloserScene(scene);

  const wordmark = document.querySelector<HTMLElement>('[data-sprite="wordmark"]');
  if (wordmark) buildWordmark(wordmark);
}

mount();
