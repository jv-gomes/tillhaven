/**
 * Third-party credits (T-7.01, extended in Phase U).
 *
 * The asset pack's licence makes credit MANDATORY (see ATTRIBUTION.md for
 * the verbatim terms). Any credits screen, about page, or store listing must
 * read from here — never a hardcoded string somewhere in a page, which is
 * exactly the kind of copy that silently disappears in a redesign.
 *
 * **Phase U added fonts, and with them a second licence with obligations of its
 * own.** The OFL requires the licence text to travel with the font and forbids
 * reusing the Reserved Font Name on a modified copy, so each font row carries
 * the path to the licence file that ships beside it. `config.test.ts` checks
 * that every bundled `.woff2` in `apps/client/public/fonts/` has a row here and
 * that the row's `licenceFile` exists — a font added without its paperwork
 * fails the build rather than shipping unattributed.
 */
export type CreditKind = 'art' | 'font' | 'software';

export interface Credit {
  /** What is being credited. */
  readonly work: string;
  /** The name the licence asks to be credited, verbatim. */
  readonly author: string;
  /** The link the licence asks for. */
  readonly url: string;
  /** Which section of the credits page this belongs under. */
  readonly kind: CreditKind;
  /** The licence's short name, for display. */
  readonly licence: string;
  /**
   * Path (as served) to the licence text shipped alongside the work, when the
   * licence requires one to travel with it. The OFL does; the art pack does not
   * (its terms are recorded in ATTRIBUTION.md and credited on the page).
   */
  readonly licenceFile?: string;
  /**
   * The files this credit covers, relative to the client's `public/`. Used by
   * the test that proves nothing ships uncredited.
   */
  readonly files?: readonly string[];
}

export const CREDITS: readonly Credit[] = [
  {
    work: 'All game art (Farm RPG Asset Pack)',
    author: 'EmanuelleDev',
    url: 'https://emanuelledev.itch.io',
    kind: 'art',
    licence: 'Commercial use permitted; resale and redistribution forbidden; credit mandatory',
  },
  {
    work: 'Pixelify Sans (interface text)',
    author: 'The Pixelify Sans Project Authors',
    url: 'https://github.com/eifetx/Pixelify-Sans',
    kind: 'font',
    licence: 'SIL Open Font License 1.1',
    licenceFile: '/fonts/pixelify-sans-OFL.txt',
    files: ['fonts/pixelify-sans-latin.woff2', 'fonts/pixelify-sans-latin-ext.woff2'],
  },
  {
    work: 'Silkscreen (labels and buttons)',
    author: 'The Silkscreen Project Authors',
    url: 'https://github.com/googlefonts/silkscreen',
    kind: 'font',
    licence: 'SIL Open Font License 1.1',
    licenceFile: '/fonts/silkscreen-OFL.txt',
    files: [
      'fonts/silkscreen-400-latin.woff2',
      'fonts/silkscreen-400-latin-ext.woff2',
      'fonts/silkscreen-700-latin.woff2',
      'fonts/silkscreen-700-latin-ext.woff2',
    ],
  },
  {
    work: 'Bitter (body text)',
    author: 'The Bitter Project Authors',
    url: 'https://github.com/solmatas/BitterPro',
    kind: 'font',
    licence: 'SIL Open Font License 1.1',
    licenceFile: '/fonts/bitter-OFL.txt',
    files: ['fonts/bitter-latin.woff2', 'fonts/bitter-latin-ext.woff2'],
  },
  {
    work: 'Phaser (game engine)',
    author: 'Phaser Studio',
    url: 'https://phaser.io',
    kind: 'software',
    licence: 'MIT',
  },
  {
    work: 'Fastify, Drizzle ORM, Zod, Socket.IO, Vite',
    author: 'their respective authors',
    url: 'https://github.com/tillhaven',
    kind: 'software',
    licence: 'MIT / Apache-2.0 — see pnpm-lock.yaml',
  },
] as const;

/** The credits for one section of the page, in declaration order. */
export function creditsOfKind(kind: CreditKind): readonly Credit[] {
  return CREDITS.filter((c) => c.kind === kind);
}
