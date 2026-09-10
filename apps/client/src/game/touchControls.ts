import { NO_INPUT, type MoveInput } from './entities/movement.js';
import { stickToInput } from './touchInput.js';

/**
 * The on-screen stick and action button (T-28.02, D-19).
 *
 * The DOM half of the model `touchInput.ts` argues for. Everything with a
 * decision in it lives over there and is tested without a touchscreen; this
 * file is pointer plumbing and layout.
 *
 * **Built only where it is needed.** `(pointer: coarse)` — a finger as the
 * primary pointer — is the same query that used to show the "Tillhaven needs a
 * keyboard" note, so exactly the devices that were told they could not play get
 * the controls instead. A laptop constructs nothing at all, and a tablet with a
 * keyboard attached reports a fine pointer and is left alone.
 *
 * **Pointer events, not touch events.** One code path covers finger, stylus and
 * mouse, and `setPointerCapture` means a thumb that slides off the stick keeps
 * driving it rather than sticking the character mid-walk — which is the single
 * most common way a virtual stick goes wrong.
 */

/** How far, in CSS pixels, the visible knob may travel from centre. */
const STICK_RADIUS = 52;

export interface TouchControlsHost {
  /** Runs the action key's work. The same `act()` E and Space call. */
  act(): void;
  /**
   * Where to attach. **Must be the HUD root, not `document.body`.**
   *
   * The HUD palette (`--ink`, `--paper`, `--barn`, …) is declared on `.hud`,
   * shadowing the site tokens of the same names on `:root`. Mounting outside it
   * resolves every one of them to nothing — which is not a subtle degradation:
   * the first run of this file put a bare letter E on the screen where a rust
   * plate belonged, and an invisible knob inside a visible stick.
   */
  parent: HTMLElement;
}

export class TouchControls {
  private root: HTMLElement | null = null;
  private knob!: HTMLElement;
  private input: MoveInput = NO_INPUT;
  private pointerId: number | null = null;

  /** True on devices this was built for. */
  static wanted(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  /** The stick's current state, in the same shape the keyboard produces. */
  current(): MoveInput {
    return this.input;
  }

  mount(host: TouchControlsHost): void {
    if (this.root || !TouchControls.wanted()) return;

    const root = document.createElement('div');
    root.className = 'touch';
    /*
     * Hidden from assistive technology on purpose. These are a second way to
     * reach controls that already exist — a screen reader user is not driving a
     * virtual thumbstick, and announcing "button" twice for every action is
     * noise. The keyboard path remains the accessible one.
     */
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="touch__stick" data-stick>
        <span class="touch__knob" data-knob></span>
      </div>
      <button class="touch__act" type="button" data-act tabindex="-1">E</button>
    `;
    host.parent.append(root);

    this.root = root;
    this.knob = root.querySelector<HTMLElement>('[data-knob]')!;

    const stick = root.querySelector<HTMLElement>('[data-stick]')!;
    stick.addEventListener('pointerdown', (event) => this.grab(stick, event));
    stick.addEventListener('pointermove', (event) => this.drag(stick, event));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      stick.addEventListener(type, (event) => this.release(event));
    }

    const act = root.querySelector<HTMLElement>('[data-act]')!;
    /*
     * `pointerdown`, not `click`. A click waits for the release, which on a
     * touchscreen is a visible delay on the one control that should feel
     * instant — and the keyboard's action fires on `down` too, so this matches.
     */
    act.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      host.act();
    });
  }

  private grab(stick: HTMLElement, event: PointerEvent): void {
    event.preventDefault();
    this.pointerId = event.pointerId;
    stick.setPointerCapture(event.pointerId);
    this.drag(stick, event);
  }

  private drag(stick: HTMLElement, event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    event.preventDefault();

    const box = stick.getBoundingClientRect();
    const dx = (event.clientX - (box.left + box.width / 2)) / STICK_RADIUS;
    const dy = (event.clientY - (box.top + box.height / 2)) / STICK_RADIUS;

    this.input = stickToInput({ x: dx, y: dy });
    this.moveKnob(dx, dy);
  }

  private release(event: PointerEvent): void {
    if (this.pointerId !== event.pointerId) return;
    this.pointerId = null;
    // Releasing must stop the character, or a lifted thumb leaves it walking
    // into a fence for as long as the player is not looking.
    this.input = NO_INPUT;
    this.moveKnob(0, 0);
  }

  /** Draws the knob at the clamped displacement, so it cannot leave its well. */
  private moveKnob(dx: number, dy: number): void {
    const magnitude = Math.hypot(dx, dy);
    const scale = magnitude > 1 ? 1 / magnitude : 1;
    this.knob.style.transform =
      `translate(${dx * scale * STICK_RADIUS}px, ${dy * scale * STICK_RADIUS}px)`;
  }
}

export const touchControls = new TouchControls();
