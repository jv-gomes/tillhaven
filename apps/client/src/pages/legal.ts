import '../styles/base.css';
import '../styles/legal.css';

import { CROPS } from '@tillhaven/shared/config';
import { sprite } from '../lib/sprite.js';

/** Terms and Privacy. Prose only — the wordmark mark is the sole sprite. */
const wordmark = document.querySelector<HTMLElement>('[data-sprite="wordmark"]');
if (wordmark) {
  wordmark.replaceWith(sprite(CROPS.leek.sheet, CROPS.leek.stageFrames.at(-1)!, { scale: 1 }));
}
