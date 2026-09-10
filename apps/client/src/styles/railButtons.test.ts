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
