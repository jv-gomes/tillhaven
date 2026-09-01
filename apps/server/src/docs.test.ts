import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANIMALS,
  ANIMAL_KINDS,
  CHEST_TIERS,
  HOUSE_TIERS,
  ITEMS,
  ITEM_IDS,
  STARTING_GOLD,
} from '@tillhaven/shared';

/**
 * `docs/economy.md` against the code it documents.
 *
 * CLAUDE.md §5.6 is blunt about it: *an idle economy dies from unlogged
 * faucets*. A ledger nobody is forced to update stops being true within a
 * fortnight, so these tests make the document a build dependency rather than
 * a good intention — a new gold path, or a changed price, fails CI until it is
 * written down.
 *
 * They check that the ledger is COMPLETE and NUMERICALLY HONEST. They cannot
 * check that it is well-reasoned; that is what T-6.01 is for.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = HERE;
const LEDGER_PATH = join(HERE, '..', '..', '..', 'docs', 'economy.md');

const ledger = await readFile(LEDGER_PATH, 'utf8');

/** Every .ts file under the server's src, excluding tests and test helpers. */
async function sourceFiles(dir: string, out: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== 'test') await sourceFiles(path, out);
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

describe('the economy ledger', () => {
  /**
   * The one that matters. Anything that WRITES player gold has to be named in
   * the ledger — not "gold is mentioned somewhere", but that specific file.
   *
   * Reading gold is fine and common (`select({ gold: ... })`, `toSelfPlayer`),
   * so the pattern deliberately matches only the `.set({ gold: ... })` and
   * insert-with-gold forms that actually move it.
   */
  it('names every file that writes player gold', async () => {
    const writesGold = /\.set\(\s*\{[^}]*\bgold:/s;
    const insertsGold = /\bgold:\s*STARTING_GOLD\b/;

    const undocumented: string[] = [];

    for (const path of await sourceFiles(SERVER_SRC)) {
      const source = await readFile(path, 'utf8');
      if (!writesGold.test(source) && !insertsGold.test(source)) continue;

      // As written in the ledger: relative to apps/server/src.
      const named = relative(SERVER_SRC, path);
      if (!ledger.includes(named)) undocumented.push(named);
    }

    expect(
      undocumented,
      'these files move gold but are not listed in docs/economy.md — add them to ' +
        '"Where gold moves in the code" before merging',
    ).toEqual([]);
  });

  it('records the starting gold the code actually grants', () => {
    expect(ledger).toContain(`| New account | ${STARTING_GOLD} |`);
  });

  /**
   * Prices drift silently. Every buyable and every sellable item's price has to
   * appear in the ledger, so retuning one without updating the document fails
   * here rather than being discovered when the economy is already inflating.
   */
  it('records the current price of everything the shop trades', () => {
    const missing: string[] = [];

    for (const id of ITEM_IDS) {
      const item = ITEMS[id]!;
      if (item.shopBuyPrice !== null && !ledger.includes(`| ${item.shopBuyPrice} |`)) {
        missing.push(`${id} buy ${item.shopBuyPrice}`);
      }
      if (item.shopSellPrice !== null && !ledger.includes(`${item.shopSellPrice} each`)) {
        missing.push(`${id} sell ${item.shopSellPrice}`);
      }
    }

    expect(missing, 'prices changed without updating docs/economy.md').toEqual([]);
  });

  it('records what every animal costs', () => {
    for (const kind of ANIMAL_KINDS) {
      const def = ANIMALS[kind];
      const printed = def.purchasePrice.toLocaleString('en-US');
      expect(
        ledger.includes(`| ${def.name} | ${printed} |`) ||
          ledger.includes(`| ${def.name} | ${def.purchasePrice} |`),
        `${kind} costs ${def.purchasePrice}, which is not in the ledger`,
      ).toBe(true);
    }
  });

  /**
   * The upgrade tiers are config-only until T-3.02 and T-3.04 wire them up, but
   * their totals are already quoted in the ledger — so they have to stay true.
   */
  it('records the true total of every upgrade track', () => {
    const chestTotal = CHEST_TIERS.reduce((sum, t) => sum + t.cost, 0);
    const houseTotal = HOUSE_TIERS.reduce((sum, t) => sum + t.cost, 0);

    expect(ledger).toContain(`${chestTotal.toLocaleString('en-US')}g for all three`);
    expect(ledger).toContain(`${houseTotal.toLocaleString('en-US')}g for both`);
  });

  it('still carries the rule that it must be updated with any price change', () => {
    expect(ledger).toMatch(/Update this file in the same commit as any price change/i);
  });

  /**
   * Modelled numbers are not measured numbers, and a reader who mistakes one
   * for the other will tune against fiction. The ledger has to say so.
   */
  it('says plainly that its figures are modelled rather than measured', () => {
    expect(ledger).toMatch(/modelled from config/i);
  });
});
