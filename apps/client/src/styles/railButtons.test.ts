import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The icon rail's buttons must all be the same size, with their glyphs centred
 * (Phase U2).
 *
 * **This is a text test for a geometry bug, and that is the best available.**
 * There is no jsdom in this repo, so nothing here can call
 * `getBoundingClientRect`; measured in a real browser, the rail rendered eight
 * buttons at 44x44 and one at **50x52**. What a stylesheet test *can* do is pin
 * the three declarations whose absence caused it, each of which is invisible
 * when you read the rule and obvious when you see the result:
 *
 *   1. `box-sizing: border-box` — `<button>` gets it from the UA stylesheet and
 *      `<a>` does not. Credits is the rail's one anchor, so its 3/3/5/3
 *      border-image was added outside the width. Nothing else in the rail could
 *      have shown this, because nothing else in the rail is a link.
 *   2. `justify-content: center` — `.hud__btn` sets `align-items` only, so the
 *      default `flex-start` shoved every glyph against the left bevel. Harmless
 *      while the buttons had labels; wrong the moment they did not.
 *   3. A shared size token — so the button and the panel offset that has to
 *      clear it cannot disagree.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = readFileSync(join(HERE, 'ui.css'), 'utf8');
const HUD = readFileSync(join(HERE, 'hud.css'), 'utf8');

/** The declaration block for a selector, or null. */
function ruleFor(css: string, selector: string): string | null {
  // Matches the selector only when it is the whole selector list, so
  // `.hud__btn--icon.is-on` does not answer for `.hud__btn--icon`.
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(css);
  return m ? m[2]! : null;
}

describe('the rail icon buttons', () => {
  const rule = ruleFor(UI, '.hud__btn--icon');

  it('has a rule to check', () => {
    expect(rule, '.hud__btn--icon not found in ui.css').not.toBeNull();
  });

  /**
   * The bug that actually shipped. An anchor styled as a button is a size
   * mismatch waiting to happen the moment the button grows a border.
   */
  it('sets box-sizing, so the anchor matches the buttons', () => {
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  it('centres its glyph on both axes', () => {
    expect(rule).toMatch(/justify-content:\s*center/);
    expect(rule).toMatch(/align-items:\s*center/);
  });

  it('is square, from one token', () => {
    expect(rule).toMatch(/width:\s*var\(--rail-btn\)/);
    expect(rule).toMatch(/height:\s*var\(--rail-btn\)/);
  });

  /**
   * The token has to live on the HUD root, not on the button. Custom properties
   * inherit downward, so `--rail-clear` — which positions the panels that must
   * clear the rail — cannot read a value declared on a descendant. Declaring it
   * on the button "works" and silently leaves the panel offset frozen at the
   * old width.
   */
  it('derives the panel offset from the same token', () => {
    const root = ruleFor(UI, '.hud,\n.ui-scope');
    expect(root, 'HUD token block not found').not.toBeNull();
    expect(root).toMatch(/--rail-btn:/);
    expect(root).toMatch(/--rail-clear:\s*calc\(var\(--rail-btn\)/);
  });

  /**
   * The vertical half of the same idea, and the reason it exists.
   *
   * `--rail-clear` stopped left-anchored panels sitting under the rail. Nothing
   * did the same job downward, so `.idle__panel` — the one right-anchored panel
   * — ran straight through the status cluster and covered the level and energy
   * bars: 268x85 at 1440x900, 268x76 at 1280x720, 294x81 at 390x844. Both are
   * `z-index: auto` siblings, so DOM order decided the winner and `.idle` is
   * declared last.
   *
   * The lane must be derived from `--chrome-top`, which `hud.ts` MEASURES. The
   * failure this pins against is the one that caused the bug: nine panels were
   * anchored to a literal `top: 72px`, the height of a bar Phase U2 deleted, and
   * a stale constant is still a number so nothing complained.
   */
  it('gives panels a lane derived from the measured chrome, not a constant', () => {
    const root = ruleFor(UI, '.hud,\n.ui-scope');
    expect(root, 'HUD token block not found').not.toBeNull();
    expect(root).toMatch(/--chrome-top:/);
    expect(root).toMatch(/--status-bottom:/);
    expect(root).toMatch(/--hotbar-clear:/);
    expect(root).toMatch(/--panel-lane-top:\s*calc\(var\(--chrome-top\)/);
  });

  /**
   * No panel may re-declare its own top offset. Every one of them did, and that
   * is how nine copies of one stale number got there in the first place.
   *
   * The threshold is what keeps this honest rather than merely strict. Small
   * literal offsets are fine and are not what went wrong: `.hotbar__key` pins
   * its number badge at `top: 1px` inside a slot, which is a position within a
   * component, not an anchor against the viewport. Anything from 24px up is
   * claiming a place on screen, and that is the claim that has to be derived.
   */
  it('leaves no panel anchored to a literal top offset', () => {
    const literals = (HUD.match(/^\s*top:\s*(\d+)px;/gm) ?? []).filter(
      (line) => Number(line.match(/(\d+)px/)![1]) >= 24,
    );
    expect(
      literals,
      `panels must use var(--panel-lane-top); found ${literals.join(', ')}`,
    ).toEqual([]);
  });

  it('pins the glyph size rather than inheriting two sheets’ defaults', () => {
    // The bag comes from ui-hud.png and the rest from button.png; both resolve
    // to 32px only because two independent scale variables happen to agree.
    const glyph = ruleFor(UI, '.hud__btn--icon > .ui-icon,\n.hud__btn--icon > .hud__icon');
    expect(glyph, 'glyph sizing rule not found').not.toBeNull();
    expect(glyph).toMatch(/width:\s*32px/);
    expect(glyph).toMatch(/height:\s*32px/);
    expect(glyph).toMatch(/flex:\s*none/);
  });

  /**
   * Shrinking the rail on a short viewport must go through the token too, or
   * the buttons get smaller and the goal board stays where it was.
   */
  it('shrinks by the token on a short viewport', () => {
    expect(HUD).toMatch(/--rail-btn:\s*2\.25rem/);
    expect(HUD).not.toMatch(/\.hud__btn--icon\s*\{[^}]*width:\s*2\.25rem/);
  });
});

/* ------------------------------------------------------------------ *
 * The panel header contract
 * ------------------------------------------------------------------ */

/**
 * **The way out of a panel must anchor itself.**
 *
 * Six headers reached their right edge four different ways, and only two said
 * so: `.pack__close` and `.shipping__close` carried their own auto margin;
 * `.shop__close` was pushed by a sibling's, `.idle__close` by `flex: 1` on the
 * title, `.board__close` by `flex: 1` on the tabs. Being right-aligned by the
 * accident of being the last flex child holds exactly until the row runs out of
 * width — and it did:
 *
 *   1440x900  `.shop__close` spilled 25px past the panel's right edge
 *   390x844   `.shop__close` rendered at x 541-593, in a 390px viewport
 *   390x844   `.board__close` covered both board tabs, 44x25 over "Requests"
 *
 * On a phone that is a trap. Escape closes every panel and touch has no Escape,
 * so the shop could be opened and not closed.
 */
describe('panel headers keep their exit', () => {
  const CLOSES = [
    '.shop__close',
    '.pack__close',
    '.trade__close',
    '.shipping__close',
    '.board__close',
    '.idle__close',
  ];

  /** The rule that lists every close button together. */
  const shared = ruleFor(HUD, CLOSES.join(',\n'));

  it('declares every close button in one rule', () => {
    expect(shared, 'the shared close-button rule is missing or has drifted').not.toBeNull();
  });

  it('makes the exit unshrinkable and self-anchoring', () => {
    // `flex: none` is what stops it being squeezed; the auto margin is what
    // stops it depending on a sibling to push it.
    expect(shared).toMatch(/flex:\s*none/);
    expect(shared).toMatch(/margin-left:\s*auto/);
  });

  /**
   * A flex item's default `min-width: auto` refuses to shrink below its
   * content, which is the mechanism that pushed the exit out. The tab strips
   * are what must give way instead.
   */
  it('lets the tab strips give way rather than the exit', () => {
    const tabs = ruleFor(HUD, '.shop__tabs,\n.board__tabs');
    expect(tabs, 'the shared tab-strip rule is missing').not.toBeNull();
    expect(tabs).toMatch(/min-width:\s*0/);
    expect(tabs).toMatch(/flex-wrap:\s*wrap/);
  });

  /**
   * **One `margin-left: auto` per flex line.**
   *
   * Two siblings with it split the free space equally, which parked the trade's
   * countdown at a shifting midpoint — measured x 651-694 for "4m 59s", 661-684
   * for "59s", and a collapsed hole when empty. It was the only instance in the
   * file; it then came back once while fixing it, because the close button's
   * new auto margin met the History button's old one.
   *
   * Counting per container is not something a text test can do, so this pins
   * the narrower rule that actually bit: nothing that shares a header with a
   * close button may claim the free space with an auto margin. `flex: 1` is the
   * way to collect it (see `.trade__expiry`).
   */
  it('leaves no second auto margin in a panel header', () => {
    const HEADER_SIBLINGS = [
      '.shop__tabs',
      '.board__tabs',
      '.trade__expiry',
      '.trade__history-toggle',
      '.shop__title',
      '.idle__title',
    ];
    const offenders = HEADER_SIBLINGS.filter((sel) => {
      const rule = ruleFor(HUD, sel);
      if (rule === null) return false;
      // Comments in these rules quote the declaration they are explaining, so
      // the check has to read the declarations and not the prose about them.
      return /margin-left:\s*auto/.test(rule.replace(/\/\*[\s\S]*?\*\//g, ''));
    });
    expect(
      offenders,
      `these share a header with a close button and also claim the free space: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  /**
   * A header inside a scrolling panel must stay put, or the exit scrolls away
   * with the content. Measured on the idle panel at 1280x560: scrolling to the
   * bottom put the ✕ 46px ABOVE the panel's own top edge.
   *
   * `.shop` and `.trade` are absent on purpose — they are flex columns whose
   * inner list scrolls, so their headers never moved.
   */
  it('pins the headers that live inside a scroller', () => {
    const sticky = ruleFor(HUD, '.pack__head,\n.shipping__head,\n.idle__head,\n.board__head');
    expect(sticky, 'the sticky-header rule is missing').not.toBeNull();
    expect(sticky).toMatch(/position:\s*sticky/);
    expect(sticky).toMatch(/top:\s*0/);
  });
});
