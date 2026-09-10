import '../styles/base.css';
import '../styles/legal.css';
import '../styles/credits.css';

import { CROPS, creditsOfKind, type Credit, type CreditKind } from '@tillhaven/shared/config';
import { sprite } from '../lib/sprite.js';

/**
 * The credits page (Phase U).
 *
 * **Nothing here is typed by hand.** Every row is built from `CREDITS` in
 * `packages/shared/src/config/credits.ts`, because both of the project's
 * licences make credit mandatory and a credit that lives in markup is one that
 * quietly disappears in a redesign — the config's own comment says exactly
 * that, and this page is the first thing that could have made it untrue.
 *
 * The page reuses `legal.css` (the Terms/Privacy shell) rather than inventing a
 * third page layout; `credits.css` adds only the row.
 */

const wordmark = document.querySelector<HTMLElement>('[data-sprite="wordmark"]');
if (wordmark) {
  wordmark.replaceWith(sprite(CROPS.leek.sheet, CROPS.leek.stageFrames.at(-1)!, { scale: 1 }));
}

/** One credit, as a row: what it is, who made it, and under what terms. */
function row(credit: Credit): HTMLElement {
  const item = document.createElement('article');
  item.className = 'credit';

  const work = document.createElement('h3');
  work.className = 'credit__work';
  work.textContent = credit.work;

  const author = document.createElement('p');
  author.className = 'credit__author';
  author.append('by ');
  const link = document.createElement('a');
  link.href = credit.url;
  link.textContent = credit.author;
  // Outbound, and to a link a licence requires — so it must not be nofollowed
  // away, but it should not hand the opener a window reference either.
  link.rel = 'noopener';
  link.target = '_blank';
  author.append(link);

  const licence = document.createElement('p');
  licence.className = 'credit__licence';
  licence.textContent = credit.licence;

  item.append(work, author, licence);

  if (credit.licenceFile) {
    const full = document.createElement('a');
    full.className = 'credit__licencefile';
    full.href = credit.licenceFile;
    full.textContent = 'Read the licence';
    // The OFL requires its text to ship with the font. This is that text,
    // served from the same directory as the .woff2 files it covers.
    full.rel = 'license';
    item.append(full);
  }

  return item;
}

for (const section of document.querySelectorAll<HTMLElement>('[data-credits]')) {
  const kind = section.dataset.credits as CreditKind;
  const credits = creditsOfKind(kind);

  if (credits.length === 0) {
    // A section with nothing in it is a heading promising content that is not
    // there; drop it rather than render an empty promise.
    section.remove();
    continue;
  }

  const list = document.createElement('div');
  list.className = 'credits__list';
  for (const credit of credits) list.append(row(credit));
  section.append(list);
}
