import '../styles/base.css';
import '../styles/auth.css';
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

import type { ZodTypeAny } from 'zod';
import {
  CROPS,
  ANIMAL_CHICKEN_RED,
  CHAR_PROMO_IDLE,
  CHAR_ANIMS,
  DECOR_STREET_LAMP,
  STREET_LAMP_LOOK,
} from '@tillhaven/shared/config';
import { sprite, animatedSprite } from '../lib/sprite.js';
import { messageFor, fieldErrors, codeOf } from '../net/errors.js';
import { heroSkyAt } from './heroSky.js';

/**
 * Shared behaviour for /login and /register.
 *
 * Validation here uses the SAME Zod schemas the server parses with
 * (packages/shared/src/schemas). That is a convenience for the person filling
 * in the form — it tells them about a short password before a round trip. It is
 * not a security control. The server re-parses everything regardless, because
 * the client is never trusted (CLAUDE.md §4.1).
 */

export interface AuthFormOptions {
  readonly schema: ZodTypeAny;
  /** Called once the payload has parsed client-side. */
  readonly onSubmit: (values: Record<string, string>) => Promise<void>;
  /**
   * Which field an error code belongs against, so the message lands next to
   * the input that caused it rather than in a generic banner.
   */
  readonly fieldForCode?: Readonly<Record<string, string>>;
  readonly notice?: string;
}

function fieldOf(form: HTMLFormElement, name: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`[data-field="${name}"]`);
}

function setError(form: HTMLFormElement, name: string, message: string | null): void {
  const field = fieldOf(form, name);
  if (!field) return;
  field.classList.toggle('is-invalid', message !== null);
  const slot = field.querySelector<HTMLElement>('[data-error]');
  if (slot) slot.textContent = message ?? '';
}

function clearErrors(form: HTMLFormElement): void {
  for (const field of form.querySelectorAll<HTMLElement>('[data-field]')) {
    field.classList.remove('is-invalid');
    const slot = field.querySelector<HTMLElement>('[data-error]');
    if (slot) slot.textContent = '';
  }
}

export function initAuthForm(opts: AuthFormOptions): void {
  decorate();

  const form = document.querySelector<HTMLFormElement>('[data-form]');
  const notice = document.querySelector<HTMLElement>('[data-notice]');
  if (!form) return;

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const submitLabel = submit?.textContent ?? '';

  if (notice) {
    notice.textContent = opts.notice ?? '';
    notice.hidden = !opts.notice;
  }

  let inFlight = false;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Guards the double-click, which would otherwise create two accounts or
    // burn a login rate-limit slot for nothing.
    if (inFlight) return;

    clearErrors(form);
    if (notice) {
      notice.textContent = '';
      notice.hidden = true;
    }

    const values = Object.fromEntries(
      [...new FormData(form).entries()].map(([k, v]) => [k, String(v)]),
    );

    /*
     * Client-side validation against the SAME schema the server parses with.
     * This is a convenience — it saves a round trip to learn the password is
     * too short. The server re-parses everything regardless (§4.1).
     */
    const result = opts.schema.safeParse(values);
    if (!result.success) {
      showIssues(form, result.error.issues);
      return;
    }

    inFlight = true;
    setPending(submit, true, 'Working…');

    void opts
      .onSubmit(values)
      .catch((err: unknown) => {
        const field = opts.fieldForCode?.[codeOf(err) ?? ''];
        const message = messageFor(err);

        if (field) {
          setError(form, field, message);
          form.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus();
        } else {
          // Anything not tied to one input goes in the notice.
          if (notice) {
            notice.textContent = message;
            notice.hidden = false;
          }
        }

        // Field-level detail from the server's Zod failure, if any.
        for (const [name, msg] of Object.entries(fieldErrors(err))) {
          setError(form, name, msg);
        }
      })
      .finally(() => {
        inFlight = false;
        setPending(submit, false, submitLabel);
      });
  });

  // Clear a field's error as soon as the person starts fixing it.
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name]')) {
    input.addEventListener('input', () => setError(form, input.name, null));
  }
}

function showIssues(
  form: HTMLFormElement,
  issues: readonly { path: readonly (string | number)[]; message: string }[],
): void {
  let focused = false;
  for (const issue of issues) {
    const name = issue.path[0];
    if (typeof name !== 'string') continue;
    setError(form, name, issue.message);
    if (!focused) {
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();
      focused = true;
    }
  }
}

function setPending(
  button: HTMLButtonElement | null | undefined,
  pending: boolean,
  label: string,
): void {
  if (!button) return;
  button.disabled = pending;
  button.textContent = label;
}

/** Sprites shared by both auth pages: the wordmark mark and the header scene. */
function decorate(): void {
  const wordmark = document.querySelector<HTMLElement>('[data-sprite="wordmark"]');
  if (wordmark) {
    wordmark.replaceWith(
      sprite(CROPS.leek.sheet, CROPS.leek.stageFrames.at(-1)!, { scale: 1 }),
    );
  }

  const scene = document.querySelector<HTMLElement>('[data-scene]');
  if (scene) buildScene(scene);
}

/**
 * The layers an idle farmer is made of, in paint order.
 *
 * `CHAR_PROMO_IDLE` is the skin strip alone — its note in `assets.ts` says so —
 * and on its own it renders a bare figure with no eyes, hair or clothes. Same
 * fix, same reason and the same fixed appearance as `landing.ts`'s walking
 * farmer: stack the strips the way the game composes a character.
 */
const IDLE_FARMER_LAYERS = ['skin/1', 'eyes/female-brown', 'hair/lyria-brown', 'clothes/green'];

function idleFarmer(scale: number): HTMLElement {
  const box = document.createElement('span');
  box.className = 'farmer';
  box.style.width = `${CHAR_PROMO_IDLE.frameWidth * scale}px`;
  box.style.height = `${CHAR_PROMO_IDLE.frameHeight * scale}px`;

  for (const layer of IDLE_FARMER_LAYERS) {
    const strip = animatedSprite(
      { ...CHAR_PROMO_IDLE, key: `char-idle-${layer.replace('/', '-')}`, path: `/assets/character/idle/${layer}.png` },
      0,
      CHAR_ANIMS.idle.framesPerDirection,
      CHAR_ANIMS.idle.fps,
      { scale },
    );
    strip.classList.add('farmer__layer');
    box.append(strip);
  }
  return box;
}

/** The lit/unlit lamp, cropped from the pack's two-lamp sheet. */
function lampSprite(state: 'off' | 'lit', scale: number): HTMLElement {
  const { x, y, width, height } = STREET_LAMP_LOOK[state];
  const box = document.createElement('span');
  box.className = `sprite auth__lamp-${state}`;
  box.style.width = `${width * scale}px`;
  box.style.height = `${height * scale}px`;
  box.style.backgroundImage = `url("${DECOR_STREET_LAMP.path}")`;
  box.style.backgroundSize = `${DECOR_STREET_LAMP.width * scale}px ${DECOR_STREET_LAMP.height * scale}px`;
  box.style.backgroundPosition = `-${x * scale}px -${y * scale}px`;
  return box;
}

/**
 * The card's header: a small window onto the same farm, at the same hour.
 *
 * **It runs the landing page's clock, deliberately.** `heroSkyAt` is the same
 * pure function the hero band uses, which is the same one `game/dayNight.ts`
 * uses, so a visitor who reads the pitch at dusk and then clicks "Log in" does
 * not walk into a different afternoon. It is the cheapest possible way to make
 * three separate pages feel like one place.
 */
function buildScene(scene: HTMLElement): void {
  const lamp = document.createElement('span');
  lamp.className = 'auth__lamp';
  lamp.append(lampSprite('off', 2), lampSprite('lit', 2));

  const tint = document.createElement('span');
  tint.className = 'auth__tint';

  scene.append(
    sprite(CROPS.strawberry.sheet, CROPS.strawberry.stageFrames.at(-1)!, { scale: 2 }),
    idleFarmer(2),
    lamp,
    animatedSprite(ANIMAL_CHICKEN_RED, 0, 4, 5, { scale: 2 }),
    sprite(CROPS.potato.sheet, CROPS.potato.stageFrames.at(-1)!, { scale: 2 }),
    tint,
  );

  const paint = (): void => {
    const sky = heroSkyAt(Date.now());
    tint.style.opacity = String(sky.tint);
    lamp.style.setProperty('--glow', String(sky.lamp));
  };

  paint();
  // Frozen after the first paint under reduced motion — see `landing.ts`.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.setInterval(paint, 250);
  }
}
