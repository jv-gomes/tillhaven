/**
 * Art credits (T-7.01).
 *
 * The asset pack's licence makes credit MANDATORY (see ATTRIBUTION.md for
 * the verbatim terms). Any credits screen, about page, or store listing must
 * read from here — never a hardcoded string somewhere in a page, which is
 * exactly the kind of copy that silently disappears in a redesign.
 */
export interface Credit {
  /** What is being credited. */
  readonly work: string;
  /** The name the licence asks to be credited, verbatim. */
  readonly author: string;
  /** The link the licence asks for. */
  readonly url: string;
}

export const CREDITS: readonly Credit[] = [
  {
    work: 'All game art (Farm RPG Asset Pack)',
    author: 'EmanuelleDev',
    url: 'https://emanuelledev.itch.io',
  },
] as const;
