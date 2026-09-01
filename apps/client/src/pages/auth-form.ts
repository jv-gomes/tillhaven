import '../styles/base.css';
import '../styles/auth.css';

import type { ZodTypeAny } from 'zod';
import {
  CROPS,
  ANIMAL_CHICKEN_RED,
  CHAR_PROMO_IDLE,
  CHAR_ANIMS,
} from '@tillhaven/shared/config';
import { sprite, animatedSprite } from '../lib/sprite.js';
import { messageFor, fieldErrors, codeOf } from '../net/errors.js';

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
  if (scene) {
    scene.append(
      sprite(CROPS.strawberry.sheet, CROPS.strawberry.stageFrames.at(-1)!, { scale: 2 }),
      animatedSprite(CHAR_PROMO_IDLE, 0, CHAR_ANIMS.idle.framesPerDirection, CHAR_ANIMS.idle.fps, {
        scale: 2,
      }),
      animatedSprite(ANIMAL_CHICKEN_RED, 0, 4, 5, { scale: 2 }),
      sprite(CROPS.potato.sheet, CROPS.potato.stageFrames.at(-1)!, { scale: 2 }),
    );
  }
}
