import {
  ANIMALS,
  ANIMAL_CHICKEN_BABY_SHEETS,
  ANIMAL_CHICKEN_POSE_ROWS,
  ANIMAL_COW_FEMALE_BROWN,
  ANIMAL_COW_POSE_ROWS,
  ANIMAL_COW_SHEETS,
  ANIMAL_VARIANTS,
  ITEMS,
  SHEETS,
  ICON_SHEETS,
  type AnimalVariant,
  type SheetSpec,
} from '@tillhaven/shared/config';
import type { AnimalView } from '@tillhaven/shared/types';
import type { Direction } from './entities/movement.js';

/**
 * Which sprite an animal is drawn from, and what floats above it.
 *
 * Split out of `Animal.ts` because these are the two rules T-2.06 is actually
 * about — a chick swapping to the adult sheet at maturity, and the states a
 * player has to be able to read at a glance — and they should be provable
 * without standing up a Phaser scene.
 *
 * Everything here is decided from the `AnimalView` the SERVER sent. Nothing is
 * inferred from a local clock, so the icon over an animal's head can never
 * promise produce the server is about to refuse (§4.4).
 */

// Both manifest lists: item icons live in `ICON_SHEETS` since T-34.04, which
// is what keeps them from consuming gids.
const SHEETS_BY_KEY = new Map([...SHEETS, ...ICON_SHEETS].map((s) => [s.key, s]));

function sheetByKey(key: string | null | undefined): SheetSpec | undefined {
  return key ? SHEETS_BY_KEY.get(key) : undefined;
}

/**
 * Sheet per cosmetic variant, resolved from the shared variant registry.
 *
 * Variants are cosmetic and nothing else (CLAUDE.md §5.3): a red hen and a
 * blonde one lay the same egg on the same interval. `ANIMAL_VARIANTS` is the
 * ONLY place a variant is allowed to change anything, and all it changes is
 * which sheet key it names; this map is that key resolved to the manifest
 * entry, so the client never carries a second copy of the pairing (§10).
 */
export const VARIANT_SHEET: Readonly<Record<AnimalVariant, SheetSpec>> =
  Object.fromEntries(
    Object.values(ANIMAL_VARIANTS)
      .map((v) => [v.id, sheetByKey(v.sheet)] as const)
      .filter((entry): entry is readonly [AnimalVariant, SheetSpec] => entry[1] !== undefined),
  ) as Record<AnimalVariant, SheetSpec>;

/**
 * Pre-maturity sprite, per VARIANT rather than per kind: a chick is the same
 * colour as the hen it grows into, so a black hen must not hatch yellow.
 * Cows are bought adult and have no entry at all.
 */
export const BABY_SHEET: Readonly<Partial<Record<AnimalVariant, SheetSpec>>> =
  Object.fromEntries(
    Object.values(ANIMAL_VARIANTS)
      .map((v) => [v.id, sheetByKey(v.babySheet)] as const)
      .filter((entry): entry is readonly [AnimalVariant, SheetSpec] => entry[1] !== undefined),
  );

/**
 * The sheet to draw an animal from right now.
 *
 * Maturing IS this function changing its answer: a chicken below its maturity
 * instant comes back as its own chick sheet, and at maturity as its adult
 * variant. A variant with no baby art simply never has a baby phase.
 */
export function sheetFor(view: AnimalView): SheetSpec {
  if (!view.isMature) {
    const baby = BABY_SHEET[view.variant];
    if (baby) return baby;
  }
  return VARIANT_SHEET[view.variant] ?? ANIMAL_COW_FEMALE_BROWN;
}

/**
 * Cow sheets, by key — the only way to tell "this is a cow sheet" from a
 * `SheetSpec` alone, since `sheetFor` erases which kind picked it.
 */
const COW_SHEET_KEYS: ReadonlySet<string> = new Set(ANIMAL_COW_SHEETS.map((s) => s.key));

/**
 * Baby chicken sheets, by key.
 *
 * **They share the adult's 4x7 GEOMETRY but not its row semantics**, and
 * T-16.05 learned that the hard way: `ANIMAL_CHICKEN_POSE_ROWS.peckDeep` is
 * row 4, and on a chick sheet row 4 is `ANIMAL_CHICKEN_BABY_HATCH_ROW` — the
 * egg-hatch sequence. Driving the routine over a chick therefore turned it
 * back into an egg every few seconds, on screen, in the coop.
 *
 * Only row 4 of the chick sheet has ever actually been measured (T-7.10 named
 * it; the rest were never examined), so selecting any other row is a guess.
 * Chicks get the idle row and nothing else until someone measures them —
 * "measure, never guess" (§9), applied to the sheet that has not been.
 */
const BABY_CHICKEN_SHEET_KEYS: ReadonlySet<string> = new Set(
  ANIMAL_CHICKEN_BABY_SHEETS.map((s) => s.key),
);

/**
 * The row an animal's idle loop plays from, for whichever sheet `sheetFor`
 * picked.
 *
 * Chickens (adult and baby share one 4x7 layout) and cows (4x9) were measured
 * independently in T-7.10 and happen to both land on row 0.
 *
 * Now a thin wrapper over `poseRowFor` (T-15.11) rather than a second lookup:
 * it kept its own `COW_SHEET_KEYS` branch until there was more than one pose,
 * at which point two functions answering "which row" was one too many. `left`
 * because that is the facing both sheets draw unflipped.
 */
export function idleRowFor(sheet: SheetSpec): number {
  return poseRowFor(sheet, 'idle', 'left').row;
}

/**
 * A pose an animal can be drawn in while wandering (T-15.11, widened T-16.05).
 *
 * These are the states the wander simulation can actually be in
 * (`animalWander.ts`) — a row nothing can select is a row that should stay
 * unwired, the rule T-7.10 applied when it measured every row and wired one.
 *
 * It was four until T-16.05. The chicken sheet has seven measured rows and only
 * three were reachable, because the four poses here were the ones a *cow* could
 * be in. Chickens now have a routine (D-15) that visits all seven, which is
 * what they get instead of walking.
 */
export type AnimalPose =
  | 'idle'
  | 'idleAlt'
  | 'idleAlt2'
  | 'walk'
  | 'peck'
  | 'peckDeep'
  | 'nest'
  | 'lying';

/**
 * How the chosen row should be played.
 *
 * `hold` exists for a specific wrong-looking thing T-16.04 found: the cow sheet
 * has **no standing-still row** — rows 0/1/2 are the walk cycle, and
 * `poseRowFor` hands them back for a resting cow too because they are also the
 * only source of a facing. Looping them while the animal is stationary is a cow
 * marching on the spot, which is what the farm did from T-15.13 until now.
 *
 * `once` exists for the chicken's `lieDown` row, which T-7.10 measured as a
 * standing-to-lying TRANSITION baked into one row rather than a repeated lying
 * pose. Looping it is a bird that flails up and down forever.
 */
export type PosePlayback = 'loop' | 'once' | 'hold';

/**
 * Which row to draw, and whether to mirror it.
 *
 * **The two sheets disagree about what a row means, and this is the one place
 * that knows it** — the promise `idleRowFor`'s original comment already made,
 * now that there is more than one pose to keep it for.
 *
 * Cows carry genuine front (row 1) and back (row 2) views alongside their side
 * view, measured by width in T-15.10 (13px vs 22px). Chickens carry no facings
 * at all: every row is a side view of the same width, and no row is any other
 * row mirrored. So a chicken facing up or down reuses its side pose — which is
 * invisible at T-15.12's few-pixel wander radius — while a cow gets the right
 * row for the way it is looking.
 *
 * Both sheets draw their side view facing LEFT, so `flipX` is set for `right`
 * and never for `left`.
 */
export function poseRowFor(
  sheet: SheetSpec,
  pose: AnimalPose,
  facing: Direction,
): { readonly row: number; readonly flipX: boolean; readonly play: PosePlayback } {
  const flipX = facing === 'right';

  if (COW_SHEET_KEYS.has(sheet.key)) {
    const rows = ANIMAL_COW_POSE_ROWS;
    if (pose === 'lying' || pose === 'nest') {
      // The cow has a real lying pose per facing; chewing is the side one with
      // a mouth detail, so it stands in for "settled" rather than a fifth pose.
      // It loops: unlike the chicken's, these rows are a settled animal
      // chewing, not a transition into one.
      if (facing === 'up') return { row: rows.lieBack, flipX: false, play: 'loop' };
      if (facing === 'down') return { row: rows.lieFront, flipX: false, play: 'loop' };
      return { row: rows.lieSide, flipX, play: 'loop' };
    }

    /*
     * Walking and standing share the walk rows: the row IS the facing, and
     * there is no standing-still row on the sheet to switch to. So a stationary
     * cow holds a single frame of its walk row instead of cycling it — see
     * `PosePlayback`. Every pose that is not `walk` is a stationary one.
     */
    const play: PosePlayback = pose === 'walk' ? 'loop' : 'hold';
    if (facing === 'up') return { row: rows.walkBack, flipX: false, play };
    if (facing === 'down') return { row: rows.walkFront, flipX: false, play };
    return { row: rows.walkSide, flipX, play };
  }

  /*
   * A chick holds its idle row whatever it was asked for — see
   * `BABY_CHICKEN_SHEET_KEYS`. This is the same layout as an adult chicken and
   * emphatically not the same rows.
   */
  if (BABY_CHICKEN_SHEET_KEYS.has(sheet.key)) {
    return { row: ANIMAL_CHICKEN_POSE_ROWS.idle, flipX, play: 'loop' };
  }

  /*
   * Adult chickens (T-16.05). `flipX` regardless of pose: every row is a
   * left-facing side view and no row carries a facing (D-10), so the mirror is
   * the only turning a chicken can do.
   *
   * `walk` falls through to the plain idle row rather than getting one of its
   * own, and that is D-15 stated in code: the sheet has no walk cycle, and
   * `roamTilesUp/Down` are zero for chickens so nothing ever asks for it. The
   * branch exists so a future sheet that DOES walk has somewhere to go.
   */
  const rows = ANIMAL_CHICKEN_POSE_ROWS;
  switch (pose) {
    case 'idleAlt':
      return { row: rows.idleAlt, flipX, play: 'loop' };
    case 'idleAlt2':
      return { row: rows.idleAlt2, flipX, play: 'loop' };
    case 'peck':
      return { row: rows.peck, flipX, play: 'loop' };
    case 'peckDeep':
      return { row: rows.peckDeep, flipX, play: 'loop' };
    case 'nest':
      return { row: rows.nest, flipX, play: 'loop' };
    case 'lying':
      // Measured in T-7.10 as a standing-to-lying TRANSITION baked into one
      // row, not a lying pose repeated four times. Played once, holding on the
      // settled frame.
      return { row: rows.lieDown, flipX, play: 'once' };
    default:
      return { row: rows.idle, flipX, play: 'loop' };
  }
}

/**
 * Every pose the wander can ask for (T-15.13, widened T-16.05).
 *
 * Registration walks this list, so a pose missing from it is an animation that
 * is never created and therefore an `anims.play` that silently does nothing.
 */
export const ANIMAL_POSES: readonly AnimalPose[] = [
  'idle',
  'idleAlt',
  'idleAlt2',
  'walk',
  'peck',
  'peckDeep',
  'nest',
  'lying',
];

/**
 * Facings that need their own animation.
 *
 * All four, even though a chicken resolves every one of them to the same row:
 * `poseRowFor` is the only thing entitled to know that (D-10), and enumerating
 * per facing means a sheet that DOES distinguish them — the cow — needs no
 * special case. Duplicate rows are deduplicated by `animationRowsFor`.
 */
export const ANIMAL_FACINGS: readonly Direction[] = ['down', 'up', 'left', 'right'];

/**
 * Every (row, playback) pair an animal on this sheet can ever be drawn in —
 * exactly the set of Phaser animations that has to exist for it.
 *
 * **Pure and here rather than inside `Animal.ts`, so it can be asserted.** The
 * failure this guards is uniquely quiet: `anims.play` on a key that was never
 * created does nothing at all — no throw, no warning, just an animal frozen on
 * whatever frame it happened to be showing. Nothing in a Phaser scene can be
 * unit-tested in this repo (no jsdom), so the fact worth pinning had to be
 * lifted out of the scene to somewhere a test can reach.
 *
 * **Why every row gets a `hold` variant whether or not `poseRowFor` asks for
 * one.** Reduced motion (T-15.29) forces `hold` on whichever row the pose
 * resolves to, and a chicken's idle row is only ever requested as a `loop`.
 * Registering strictly what the wander requests would leave that key missing —
 * and missing only for players who set the preference, which is the last group
 * that would be looked at.
 */
export function animationRowsFor(
  sheet: SheetSpec,
): ReadonlyArray<{ readonly row: number; readonly play: PosePlayback }> {
  const wanted = new Map<string, { row: number; play: PosePlayback }>();
  for (const pose of ANIMAL_POSES) {
    for (const facing of ANIMAL_FACINGS) {
      const { row, play } = poseRowFor(sheet, pose, facing);
      wanted.set(`${row}:${play}`, { row, play });
      wanted.set(`${row}:hold`, { row, play: 'hold' });
    }
  }
  return [...wanted.values()];
}

/** The starting frame index of an animal's idle loop within its own sheet. */
export function idleFrameFor(sheet: SheetSpec): number {
  return idleRowFor(sheet) * sheet.cols;
}

export interface Badge {
  readonly sheet: SheetSpec;
  readonly frame: number;
  /** Which state it is announcing, for tests and for anything that labels it. */
  readonly reason: 'produce' | 'feed';
}

/**
 * The icon to float over an animal, or null when it wants nothing.
 *
 * Produce wins when both apply, because it is the one the player can act on
 * immediately — an animal can hold produce it earned before its food ran out.
 * "Unfed" is not lost in that case: the sprite is also desaturated, so the two
 * states use different channels rather than competing for one.
 */
export function badgeFor(view: AnimalView): Badge | null {
  const def = ANIMALS[view.kind];
  if (!def) return null;

  const reason: Badge['reason'] | null = view.hasProduce
    ? 'produce'
    : view.isFed
      ? null
      : 'feed';
  if (reason === null) return null;

  const itemId = reason === 'produce' ? def.produceItemId : def.feedItemId;
  const item = ITEMS[itemId];
  const sheet = item ? SHEETS_BY_KEY.get(item.icon.sheet) : undefined;

  return item && sheet ? { sheet, frame: item.icon.frame, reason } : null;
}
