import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The boot curtain's contract (U3-5).
 *
 * There is no jsdom in this repo, so this is a source-text test — the same
 * shape as `styles/railButtons.test.ts`, and for the same stated reason: a
 * text test for a structural property is the best available, and better than
 * nothing guarding it.
 *
 * **What it guards is an ordering, and orderings rot silently.** The curtain
 * only works if its markup is inline in `play.html` (so it paints before the
 * module graph is parsed), if `main.ts` does NOT remove it on boot the way it
 * removed the old `#fallback`, and if `Preload` hands it every state it can
 * reach. Break any one and the page still loads — it just shows a blue
 * rectangle again for as long as Phaser takes, which is exactly the failure
 * nobody noticed for twenty phases.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, '..', '..');

const PLAY = readFileSync(join(CLIENT, 'play.html'), 'utf8');
const PRELOAD = readFileSync(join(HERE, 'scenes', 'Preload.ts'), 'utf8');
const MAIN = readFileSync(join(HERE, 'main.ts'), 'utf8');
const BOOT = readFileSync(join(HERE, 'boot.ts'), 'utf8');

describe('the curtain is in the HTML, not the bundle', () => {
  it.each(['id="boot"', 'id="boot-mark"', 'id="boot-bar"', 'id="boot-fill"', 'id="boot-label"'])(
    'play.html carries %s',
    (id) => {
      expect(PLAY).toContain(id);
    },
  );

  /**
   * The failure copy has to be in the markup too. If it were appended by
   * JavaScript, the one case it exists for — a bundle that never runs — is
   * precisely the case where it could not appear.
   */
  it('ships the could-not-start copy and a way out, in the markup', () => {
    expect(PLAY).toMatch(/id="boot-fail"[^>]*hidden/);
    expect(PLAY).toContain('could not start');
    expect(PLAY).toContain('href="/"');
  });

  it('styles the curtain inline, since no stylesheet has loaded yet', () => {
    const head = PLAY.slice(0, PLAY.indexOf('</head>'));
    expect(head).toContain('#boot {');
    expect(head).toContain('#boot-bar {');
  });

  /**
   * The bar is the pack's, and its geometry is measured rather than guessed —
   * 42 source pixels per track (a column scan finds four per row) and 9 tall,
   * at a whole scale. A fractional scale would put the end caps on half pixels.
   */
  it('draws the bar from the pack art at a whole scale', () => {
    expect(PLAY).toContain("url('/assets/ui-bars.png')");
    const width = /#boot-bar\s*\{[^}]*width:\s*(\d+)px/.exec(PLAY)?.[1];
    const height = /#boot-bar\s*\{[^}]*height:\s*(\d+)px/.exec(PLAY)?.[1];
    expect(width, 'no #boot-bar width').toBeDefined();
    expect(Number(width) % 42, `${width}px is not a whole multiple of the 42px track`).toBe(0);
    expect(Number(height) % 9, `${height}px is not a whole multiple of the 9px band`).toBe(0);
    // Same multiple for both, or the art is stretched.
    expect(Number(width) / 42).toBe(Number(height) / 9);
  });
});

describe('nothing else takes the curtain down', () => {
  /**
   * `main.ts` removed `#fallback` the moment it ran, because that element's
   * only job was to prove the module had not. The curtain has a second job and
   * must survive until `Preload` is finished with it.
   */
  it('main.ts does not remove it on boot', () => {
    expect(MAIN).not.toMatch(/getElementById\(['"]boot['"]\)[^\n]*remove/);
    expect(MAIN).not.toMatch(/getElementById\(['"]fallback['"]\)/);
  });

  it('only boot.ts removes it', () => {
    expect(BOOT).toContain('.remove()');
    for (const src of [MAIN, PRELOAD]) {
      expect(src).not.toContain("getElementById('boot')");
    }
  });
});

describe('Preload drives it through every state it can reach', () => {
  it('reports progress to the curtain', () => {
    expect(PRELOAD).toContain('boot.progress(');
  });

  it('dismisses it only after the assets are there', () => {
    const create = PRELOAD.slice(PRELOAD.indexOf('create(): void {'));
    expect(create).toContain('boot.done(');
    // `done` must come after the verification calls, not before them.
    expect(create.indexOf('boot.done(')).toBeGreaterThan(create.indexOf('this.verifyTilemaps()'));
  });

  /**
   * **The failure path must not fall through to the farm.** A missing asset
   * used to overwrite a Phaser label and `return`; the equivalent now is
   * failing the curtain and returning, and a `boot.fail` that kept going would
   * start a scene with textures that are not there.
   */
  it('fails the curtain and stops, rather than starting the farm anyway', () => {
    const create = PRELOAD.slice(PRELOAD.indexOf('create(): void {'));
    const fail = create.indexOf('boot.fail(');
    expect(fail, 'Preload never calls boot.fail').toBeGreaterThan(-1);

    // The next STATEMENT after the call must be `return`. Brace matching is no
    // good here: the failure message is a template literal, so the first `}`
    // after the call belongs to its `${…}`.
    const afterFail = create.slice(fail).split('\n').slice(1, 3).join('\n');
    expect(afterFail, 'boot.fail is not immediately followed by return').toMatch(/^\s*return;/m);
    expect(create.indexOf("this.scene.start('Farm')")).toBeGreaterThan(fail);
  });

  /** The Phaser primitives are gone, and so is the font that gave them away. */
  it('draws no progress UI of its own any more', () => {
    expect(PRELOAD).not.toContain('buildProgressUi');
    expect(PRELOAD).not.toContain('ui-monospace');
    expect(PRELOAD).not.toContain('add.rectangle');
  });
});

describe('the curtain survives being driven twice', () => {
  /**
   * `Preload` lives in a scene that can be restarted, and every method here
   * runs against an element that may already have been removed. A boot screen
   * that throws during teardown takes the game with it.
   */
  it('re-reads the DOM lazily rather than caching at construction', () => {
    expect(BOOT).toContain('private find()');
    expect(BOOT).toMatch(/if \(this\.root\) return;/);
  });

  it('guards against dismissing twice', () => {
    expect(BOOT).toContain('dismissed');
    expect(BOOT).toMatch(/if \(this\.dismissed\) return;/);
  });

  it('respects reduced motion by cutting instead of fading', () => {
    expect(BOOT).toContain('prefersReducedMotion()');
    expect(PLAY).toContain('prefers-reduced-motion: reduce');
  });
});
