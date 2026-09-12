import '../styles/base.css';
import '../styles/legal.css';
/*
 * `ui.css` AFTER `base.css`, and that order is the point (Phase U3).
 *
 * It carries the three `@font-face` blocks and the pack's own primitives,
 * scoped to `.hud, .ui-scope` — a hook `ui.css` has declared since Phase U and
 * nothing outside the game had ever used. The site uses it now for the night
 * register: the hero, the auth card and the boot curtain wear the same timber
 * the HUD does.
 *
 * Later file wins at equal specificity, so `.ui-plate` beats `.btn` when an
 * element carries both. The APPLIED section's HUD class names (`.shop`,
 * `.pack`, …) never match anything here and cost nothing.
 */
import '../styles/ui.css';

import { CROPS } from '@tillhaven/shared/config';
import { sprite } from '../lib/sprite.js';

/** Terms and Privacy. Prose only — the wordmark mark is the sole sprite. */
const wordmark = document.querySelector<HTMLElement>('[data-sprite="wordmark"]');
if (wordmark) {
  wordmark.replaceWith(sprite(CROPS.leek.sheet, CROPS.leek.stageFrames.at(-1)!, { scale: 1 }));
}
