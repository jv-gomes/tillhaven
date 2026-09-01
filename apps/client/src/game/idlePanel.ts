import {
  CROPS,
  CROP_IDS,
  IDLE_TASK_TYPES,
  IdleTask,
  isCropId,
  type CropId,
} from '@tillhaven/shared/config';
import type { IdleView } from '@tillhaven/shared/types';
import { messageFor } from '../net/errors.js';
import { setIdle } from '../net/farm.js';

/**
 * Idle mode's switch (T-13.06, CLAUDE.md §5.3).
 *
 * The headline feature's one control: turn the farmer loose, choose which
 * chores it does and what it sows. Everything it decides is a SETTING — the
 * work itself is simulated server-side from timestamps (§4.2), so this panel
 * never runs anything, counts anything, or knows how much has been done.
 *
 * **The lock follows the server, never the checkbox.** Switching idle on takes
 * the farm away from the player: movement and the action key go dead while the
 * farmer works. So `enabled` here is only ever assigned from a server response
 * — the PUT's own answer, or the farm poll's. Flipping it optimistically would
 * mean a refused or dropped request locks a player out of their own farm with
 * no farmer working to show for it, and the only way back is a reload.
 */

/** What the controls currently read. Strings, because that is what a form has. */
export interface IdleForm {
  readonly enabled: boolean;
  readonly tasks: readonly string[];
  readonly cropId: string | null;
}

export interface IdleBody {
  readonly enabled: boolean;
  readonly tasks: readonly IdleTask[];
  readonly cropId: CropId | null;
}

/**
 * The form as a request body.
 *
 * Rebuilt from `IDLE_TASK_TYPES` rather than from the checkbox order, which
 * does two things the endpoint actually requires: it drops anything that is not
 * a task this build knows, and it **deduplicates** — `idleSettingsSchema`
 * REFUSES a repeated task rather than collapsing it, on the grounds that
 * `["till","till"]` is a client bug that should not ship quietly. Reading the
 * shared config here is not a second copy of the server's rule (§4.4); it is
 * the same list, so the two cannot disagree about what a task is.
 */
export function idleBody(form: IdleForm): IdleBody {
  const chosen = new Set(form.tasks);

  return {
    enabled: form.enabled,
    tasks: IDLE_TASK_TYPES.filter((task) => chosen.has(task)),
    // Anything that is not a crop reads as "sow nothing", which is a real
    // setting — the same reading the server's column parser takes.
    cropId: form.cropId !== null && isCropId(form.cropId) ? (form.cropId as CropId) : null,
  };
}

/** Sentinel for the dropdown's "sow nothing" row. Not a crop id, deliberately. */
const NO_CROP = '';

const TASK_LABELS: Record<IdleTask, string> = {
  [IdleTask.TILL]: 'Till bare soil',
  [IdleTask.PLANT]: 'Plant seeds',
  [IdleTask.WATER]: 'Water crops',
  [IdleTask.HARVEST]: 'Harvest what is ready',
};

export interface IdleHost {
  toast(message: string, kind?: 'info' | 'error'): void;
  /** The server's answer, after every successful change. */
  onChanged(view: IdleView): void;
  /**
   * Announced rather than inferred, because the popover closes three ways —
   * the button, its own ×, and Escape — and a bar button that tracked only the
   * first would soon be lying about what is on screen.
   */
  onOpenChange(open: boolean): void;
}

const OFF: IdleView = { enabled: false, tasks: [], cropId: null, nextAction: null };

export class IdlePanel {
  private root!: HTMLElement;
  private popover!: HTMLElement;
  private banner!: HTMLElement;
  private switchEl!: HTMLInputElement;
  private cropEl!: HTMLSelectElement;
  private readonly taskEls = new Map<IdleTask, HTMLInputElement>();
  private host!: IdleHost;

  /** The server's last word. Never assigned from a control (see the note above). */
  private view: IdleView = OFF;
  private open = false;
  /**
   * A PUT is out. Polls stop writing to the controls while one is, or the
   * checkbox a player just ticked flips back under their finger when a poll
   * lands before the response does.
   */
  private inFlight = false;

  mount(host: IdleHost): HTMLElement {
    this.host = host;

    this.root = document.createElement('div');
    this.root.className = 'idle';
    this.root.innerHTML = `
      <section class="idle__panel" data-popover hidden aria-label="Idle mode">
        <header class="idle__head">
          <span class="idle__title">Idle mode</span>
          <button class="idle__close" type="button" data-close aria-label="Close idle settings">×</button>
        </header>

        <label class="idle__switch">
          <input type="checkbox" data-enabled>
          <span>Let my farmer work</span>
        </label>

        <p class="idle__hint">
          Your farmer keeps working while you are away. You cannot walk or use
          tools yourself while it does.
        </p>

        <fieldset class="idle__group">
          <legend class="idle__legend">Chores</legend>
          <div class="idle__tasks" data-tasks></div>
        </fieldset>

        <label class="idle__group">
          <span class="idle__legend">Sow</span>
          <select class="idle__select" data-crop></select>
        </label>
      </section>

      <div class="idle__banner" data-banner hidden role="status">
        <span>Idle mode — your farmer is working</span>
        <button class="idle__stop" type="button" data-stop>Stop</button>
      </div>
    `;

    this.popover = this.root.querySelector('[data-popover]')!;
    this.banner = this.root.querySelector('[data-banner]')!;
    this.switchEl = this.root.querySelector('[data-enabled]')!;
    this.cropEl = this.root.querySelector('[data-crop]')!;

    const tasks = this.root.querySelector('[data-tasks]')!;
    for (const task of IDLE_TASK_TYPES) {
      const label = document.createElement('label');
      label.className = 'idle__task';

      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset['task'] = task;

      const text = document.createElement('span');
      text.textContent = TASK_LABELS[task];

      label.append(box, text);
      tasks.append(label);
      this.taskEls.set(task, box);
      box.addEventListener('change', () => void this.submit());
    }

    const nothing = document.createElement('option');
    nothing.value = NO_CROP;
    nothing.textContent = 'Nothing';
    this.cropEl.append(nothing);
    for (const id of CROP_IDS) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = CROPS[id].name;
      this.cropEl.append(option);
    }

    this.switchEl.addEventListener('change', () => void this.submit());
    this.cropEl.addEventListener('change', () => void this.submit());

    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    // The one control that is reachable without opening anything: the farm is
    // not the player's while this is on, so giving it back must never be more
    // than one click away.
    this.root.querySelector('[data-stop]')!.addEventListener('click', () => void this.stop());

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) this.hide();
    });

    return this.root;
  }

  get isEnabled(): boolean {
    return this.view.enabled;
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  private show(): void {
    this.setOpen(true);
  }

  private hide(): void {
    this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.popover.hidden = !open;
    this.host.onOpenChange(open);
  }

  /**
   * The farm poll's answer (T-13.05 puts it on every farm read).
   *
   * This is what makes the settings survive a reload without a fetch of their
   * own: the state the panel shows is the state the server just reported, on a
   * request the game was making anyway.
   */
  setView(view: IdleView): void {
    if (this.inFlight) return;
    this.view = view;
    this.render();
  }

  private render(): void {
    this.switchEl.checked = this.view.enabled;
    for (const [task, box] of this.taskEls) box.checked = this.view.tasks.includes(task);
    this.cropEl.value = this.view.cropId ?? NO_CROP;
    this.banner.hidden = !this.view.enabled;
  }

  /** The banner's Stop, and anything else that wants idle off now. */
  private async stop(): Promise<void> {
    this.switchEl.checked = false;
    await this.submit();
  }

  private async submit(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    const body = idleBody({
      enabled: this.switchEl.checked,
      tasks: [...this.taskEls]
        .filter(([, box]) => box.checked)
        .map(([task]) => task),
      cropId: this.cropEl.value === NO_CROP ? null : this.cropEl.value,
    });

    try {
      const saved = await setIdle(body);
      /*
       * The server's answer, not the form's. It canonicalises the task order,
       * and it is the only thing allowed to decide whether the farm is the
       * player's right now — `nextAction` is not in this response, and the next
       * poll fills it in.
       */
      this.view = { ...saved, nextAction: this.view.nextAction };
      this.render();
      this.host.onChanged(this.view);
    } catch (err) {
      // Put the controls back to what the server last confirmed, so a refusal
      // never leaves a ticked box describing a farmer that is not doing it.
      this.render();
      this.host.toast(messageFor(err), 'error');
    } finally {
      this.inFlight = false;
    }
  }
}
