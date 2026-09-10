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

/**
 * What the switch means when it is turned on with nothing ticked (T-18.07).
 *
 * Every chore the farmer can actually be told to do, because that is
 * overwhelmingly what "let my farmer work" means — a player who wants a subset
 * unticks from a working farm, and can see what they are turning off while they
 * do it. The alternative reading, "work, but do nothing", is the bug this
 * replaces: BUG-09 let the switch go on with an empty list, which took the farm
 * away (movement and the action key go dead on `enabled` alone) in exchange for
 * a farmer that provably could not act.
 *
 * **`plant` is left out when no crop is chosen, and that is not a detail.** The
 * endpoint refuses `plant` without a `cropId` (`IDLE_CROP_REQUIRED`, T-13.06) —
 * a farmer told to sow and not told what is a farmer standing in a field doing
 * nothing, which is the same class of bug as this one. So a default of all four
 * makes the whole PUT fail, and the player turns the switch on and gets a red
 * toast instead of a farmer. Found in the browser, not by a test: both rules
 * are individually right and only their intersection is wrong, and nothing on
 * either side of it knew the other existed.
 *
 * Picking a crop FOR them was the other option and is worse — it spends seeds
 * they did not choose to spend, on a crop they did not choose.
 */
export function defaultTasks(cropId: string | null): readonly IdleTask[] {
  const sowing = cropId !== null && isCropId(cropId);
  return sowing ? IDLE_TASK_TYPES : IDLE_TASK_TYPES.filter((task) => task !== IdleTask.PLANT);
}

/** Which control the player just touched. Decides what an empty list means. */
export type IdleSource = 'switch' | 'tasks' | 'crop';

export type IdleChange =
  | { readonly kind: 'send'; readonly form: IdleForm }
  | { readonly kind: 'refuse'; readonly message: string };

/**
 * What to do with the controls as they now read — the whole of T-18.07's rule,
 * pure and in one place.
 *
 * `enabled` with no chores is not a state this panel may produce, and there are
 * exactly two ways to reach for it. Turning the switch ON with nothing ticked
 * is a player saying "work" and meaning all of it, so it fills in
 * `defaultTasks`. Unticking the LAST chore on a working farm is the other, and
 * it is refused rather than silently reinterpreted: quietly re-ticking a box
 * the player just cleared, or switching idle off as a side effect of a
 * checkbox, are both the control doing something it was not asked to.
 *
 * Switching OFF passes through untouched whatever the list is — the chores are
 * remembered so the next switch-on does what the last one did.
 */
export function idleChange(form: IdleForm, source: IdleSource): IdleChange {
  if (!form.enabled || form.tasks.length > 0) return { kind: 'send', form };

  if (source === 'tasks') {
    return { kind: 'refuse', message: 'Your farmer needs at least one chore. Turn idle off instead.' };
  }

  // The switch, or the crop dropdown on a farm already in the bad state from
  // before this rule existed. Both read as "work" — fill in the chores.
  return { kind: 'send', form: { ...form, tasks: [...defaultTasks(form.cropId)] } };
}

/** Sentinel for the dropdown's "sow nothing" row. Not a crop id, deliberately. */
const NO_CROP = '';

const TASK_LABELS: Record<IdleTask, string> = {
  [IdleTask.TILL]: 'Till bare soil',
  [IdleTask.PLANT]: 'Plant seeds',
  [IdleTask.WATER]: 'Water crops',
  [IdleTask.HARVEST]: 'Harvest what is ready',
  [IdleTask.CHOP]: 'Chop trees (needs an axe)',
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
      box.addEventListener('change', () => void this.submit('tasks'));
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

    this.switchEl.addEventListener('change', () => void this.submit('switch'));
    this.cropEl.addEventListener('change', () => void this.submit('crop'));

    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.hide());
    // The one control that is reachable without opening anything: the farm is
    // not the player's while this is on, so giving it back must never be more
    // than one click away.
    this.root.querySelector('[data-stop]')!.addEventListener('click', () => void this.stop());

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open) return;
      /*
       * Consume the press (T-18.13, BUG-11). Phaser's keyboard plugin listens
       * on `window`; these panels listen on `document`, which is the last hop
       * before it — so stopping here is what keeps one Escape to one layer.
       * Without it, closing this panel ALSO ran the Interior scene's handler
       * and walked the player out of the house in the same press.
       *
       * `stopPropagation`, not `stopImmediatePropagation`: the other panels'
       * listeners are on this same node and are harmless (each checks its own
       * `open`), and silencing them would make this depend on registration
       * order, which is the thing that made the bug hard to see.
       */
      event.stopPropagation();
      this.hide();
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

  /** Public since T-18.13: `hud.closePanels()` shuts everything on a scene change. */
  hide(): void {
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
    // 'switch' because that is what Stop is: the same control, one click away.
    await this.submit('switch');
  }

  private async submit(source: IdleSource): Promise<void> {
    if (this.inFlight) return;

    const change = idleChange(
      {
        enabled: this.switchEl.checked,
        tasks: [...this.taskEls].filter(([, box]) => box.checked).map(([task]) => task),
        cropId: this.cropEl.value === NO_CROP ? null : this.cropEl.value,
      },
      source,
    );

    /*
     * Refused before anything goes out (T-18.07). `render()` puts the box the
     * player just cleared back, exactly the way the catch below puts the
     * controls back after a server refusal — one way to undo a change, whether
     * this side or the far side said no.
     */
    if (change.kind === 'refuse') {
      this.render();
      this.host.toast(change.message, 'error');
      return;
    }

    this.inFlight = true;
    const body = idleBody(change.form);
    // The chores may have been filled in for the player; show what is being
    // sent before the round trip, not after.
    for (const [task, box] of this.taskEls) box.checked = body.tasks.includes(task);

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
