import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `hidden` actually hides (T-24.03, BUG-24).
 *
 * The HTML `hidden` attribute works through a user agent rule,
 * `[hidden] { display: none }`, which any author rule that sets `display`
 * outranks. So a class like `.hud__btn { display: inline-flex }` silently
 * defeats `element.hidden = true`: the attribute lands in the DOM, the element
 * stays on screen, and every unit test still passes because jsdom applies no
 * stylesheet.
 *
 * That is not hypothetical. `.hud__btn` had no `[hidden]` rule from T-18.20
 * until T-24.03, so an account that already owned VIP was shown the button
 * offering to sell it — the one thing that button's comment says must not
 * happen. It was found only because a second bar button needed the same trick
 * and did not work either.
 *
 * This test reads the two files as text on purpose. The bug lives in the
 * INTERACTION between markup and stylesheet, and nothing that renders one
 * without the other can see it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, 'hud.css'), 'utf8');
const HUD_TS = readFileSync(join(HERE, '..', 'game', 'hud.ts'), 'utf8');

/**
 * Classes on elements the HUD's own markup starts as `hidden`.
 *
 * Markup rather than the whole module because an element written `hidden` is
 * one the code intends to toggle — that is what the attribute is FOR — while a
 * `foo.hidden = bar` somewhere in the file cannot be traced back to a class
 * without evaluating the program.
 */
function hiddenClasses(source: string): string[] {
  const found = new Set<string>();

  for (const tag of source.matchAll(/<[a-z]+\s[^>]*>/g)) {
    const attrs = tag[0];
    // A BARE `hidden`, not `data-hidden` and not `hidden="${…}"` in a value.
    if (!/\shidden(?=[\s>])/.test(attrs)) continue;

    const cls = /class="([^"]*)"/.exec(attrs);
    if (!cls) continue;
    for (const name of cls[1]!.split(/\s+/).filter(Boolean)) found.add(name);
  }

  return [...found];
}

/** True when `.name { … }` (the plain class rule) sets `display`. */
function setsDisplay(css: string, name: string): boolean {
  const block = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css);
  return block !== null && /(^|[;{\s])display\s*:/.test(block[1]!);
}

function hasHiddenRule(css: string, name: string): boolean {
  const block = new RegExp(`\\.${name}\\[hidden\\]\\s*\\{([^}]*)\\}`).exec(css);
  return block !== null && /display\s*:\s*none/.test(block[1]!);
}

describe('the hidden attribute in the HUD', () => {
  it('finds the classes the markup starts hidden', () => {
    const classes = hiddenClasses(HUD_TS);

    // A guard on the guard: if the regex stops matching, every assertion below
    // passes vacuously and the test becomes decoration.
    expect(classes).toContain('hud__btn');
    expect(classes.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every hideable class that sets display its own [hidden] rule', () => {
    const offenders = hiddenClasses(HUD_TS)
      .filter((name) => setsDisplay(CSS, name))
      .filter((name) => !hasHiddenRule(CSS, name));

    expect(offenders, `these classes set display and would ignore [hidden]: ${offenders}`).toEqual(
      [],
    );
  });

  /**
   * The specific regression. Pinned by name as well as by the rule above,
   * because this is the one that shipped: `.hud__btn` carries `display` and now
   * carries the override that makes `hidden` mean something.
   */
  it('hides a bar button that is marked hidden', () => {
    expect(setsDisplay(CSS, 'hud__btn')).toBe(true);
    expect(hasHiddenRule(CSS, 'hud__btn')).toBe(true);
  });
});

/**
 * T-29.01 — the backpack panel does not claim a layout it does not always have.
 *
 * `.pack__grid` is twelve fixed columns, chosen so the top row is exactly the
 * hotbar, and the hint used to say so. At 390px those twelve columns did not
 * fit: twelve slots landed outside the panel with **no scroll to reach them**
 * (`scrollWidth === clientWidth`), which on a VIP's 24-slot bag is half the
 * inventory, silently gone.
 *
 * The grid now reflows below 900px. That is only safe because `.slot.is-hotbar`
 * marks each hotbar slot individually, so the hint had to stop naming a row and
 * start naming the marker. These two facts have to move together — a reflow
 * without the copy change leaves the panel lying about itself — so they are
 * pinned together here.
 */
describe('the backpack grid and the sentence describing it', () => {
  const PANEL = readFileSync(join(HERE, '..', 'game', 'inventoryPanel.ts'), 'utf8');

  it('reflows the grid on a narrow viewport', () => {
    const narrow = /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.pack__grid\s*\{([^}]*)\}/.exec(
      CSS,
    );
    expect(narrow, 'no narrow-viewport rule for .pack__grid').not.toBeNull();
    expect(narrow![1]).toMatch(/grid-template-columns:\s*repeat\(auto-fill/);
  });

  it('lets the panel be narrower than its content wants', () => {
    // `width: max-content` outside the query would keep asking for twelve
    // columns, and a grid cannot reflow inside a container that refuses to
    // shrink. The override is what makes the rule above do anything at all.
    const narrowPack = /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.pack\s*\{([^}]*)\}/.exec(CSS);
    expect(narrowPack, 'no narrow-viewport rule for .pack').not.toBeNull();
    expect(narrowPack![1]).toMatch(/width:/);
  });

  it('describes the hotbar by its marker, not by a row that may not exist', () => {
    expect(PANEL).not.toContain('The top row is your hotbar');
    expect(PANEL).toMatch(/gold line underneath are your hotbar/);
  });

  /** The marker the hint now points at has to actually be drawn. */
  it('still draws the per-slot hotbar marker the hint names', () => {
    expect(CSS).toMatch(/\.slot\.is-hotbar\s*\{[^}]*box-shadow/);
  });
});
