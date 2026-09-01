import {
  ANIMALS,
  ANIMAL_CHICKEN_IDLE_ROW,
  ANIMAL_COW_FEMALE_BROWN,
  ANIMAL_COW_IDLE_ROW,
  ANIMAL_COW_SHEETS,
  ANIMAL_VARIANTS,
  ITEMS,
  SHEETS,
  type AnimalVariant,
  type SheetSpec,
} from '@tillhaven/shared/config';
import type { AnimalView } from '@tillhaven/shared/types';

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

const SHEETS_BY_KEY = new Map(SHEETS.map((s) => [s.key, s]));

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
 * The row an animal's idle loop plays from, for whichever sheet `sheetFor`
 * picked.
 *
 * Chickens (adult and baby share one 4x7 layout) and cows (4x9) were
 * measured independently in T-7.10 and happen to both land on row 0 — see
 * `ANIMAL_CHICKEN_IDLE_ROW` / `ANIMAL_COW_IDLE_ROW` in the shared manifest
 * for what that row actually shows and how it was measured. This function is
 * the one place that distinction is looked up, so a future sheet whose idle
 * row is NOT 0 only needs a change here, not in every caller.
 */
export function idleRowFor(sheet: SheetSpec): number {
  return COW_SHEET_KEYS.has(sheet.key) ? ANIMAL_COW_IDLE_ROW : ANIMAL_CHICKEN_IDLE_ROW;
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
