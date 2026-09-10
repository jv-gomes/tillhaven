import { describe, it, expect } from 'vitest';
import { CROP_IDS, IDLE_TASK_TYPES } from '@tillhaven/shared/config';
import { idleSettingsSchema } from '@tillhaven/shared/schemas';
import { idleBody, idleChange, type IdleForm } from './idlePanel.js';

/**
 * What the idle switch actually sends (T-13.06).
 *
 * The endpoint is a PUT that REPLACES the standing orders and refuses a
 * malformed task list outright — duplicates included, deliberately, because
 * `["till","till"]` is a client bug that should not ship quietly. So the one
 * thing worth pinning here is that whatever state the checkboxes end up in,
 * the body built from them is something the server will accept and something
 * that means what the player sees.
 */

const CROP = CROP_IDS[0]!;

describe('idleBody', () => {
  it('sends the tasks that are ticked, in config order', () => {
    const body = idleBody({ enabled: true, tasks: ['harvest', 'till'], cropId: null });

    // Not the order they were listed in — the order the schema and the
    // simulator both read them in.
    expect(body.tasks).toEqual(['till', 'harvest']);
    expect(body.enabled).toBe(true);
  });

  it('sends every task when every box is ticked', () => {
    const body = idleBody({ enabled: true, tasks: [...IDLE_TASK_TYPES], cropId: CROP });

    expect(body.tasks).toEqual(IDLE_TASK_TYPES);
  });

  /**
   * The endpoint refuses a repeated task rather than collapsing it, so a form
   * that somehow offered the same chore twice would fail the whole save. Built
   * from `IDLE_TASK_TYPES` rather than filtered, which makes that impossible by
   * construction rather than by remembering to dedupe.
   */
  it('cannot send a task twice', () => {
    const body = idleBody({ enabled: true, tasks: ['till', 'till', 'water'], cropId: null });

    expect(body.tasks).toEqual(['till', 'water']);
  });

  it('drops anything that is not a task this build knows', () => {
    // `'chop'` was one of the rejects until T-20.06 made it a real chore. It is
    // kept here as an ACCEPTED value so the test still proves the filter passes
    // what it should as well as dropping what it should.
    const body = idleBody({ enabled: true, tasks: ['till', 'chop', 'mine'], cropId: null });

    expect(body.tasks).toEqual(['till', 'chop']);
  });

  it('carries the chosen crop through', () => {
    expect(idleBody({ enabled: true, tasks: ['plant'], cropId: CROP }).cropId).toBe(CROP);
  });

  /**
   * "Sow nothing" is a real setting, not an omission — the dropdown's first row
   * — and anything unrecognised reads the same way, which is the reading the
   * server's own column parser takes.
   */
  it('reads no crop, and an unknown crop, as sowing nothing', () => {
    for (const cropId of [null, '', 'moon-wheat']) {
      expect(idleBody({ enabled: true, tasks: [], cropId }).cropId).toBeNull();
    }
  });

  /**
   * Switching off keeps the chores the player chose. The next time they switch
   * on, the farmer does what it did before rather than nothing — and the
   * endpoint stores what it is sent, so forgetting them here would quietly
   * clear them.
   */
  it('keeps the chosen chores when the switch is off', () => {
    const body = idleBody({ enabled: false, tasks: ['till', 'water'], cropId: CROP });

    expect(body.enabled).toBe(false);
    expect(body.tasks).toEqual(['till', 'water']);
    expect(body.cropId).toBe(CROP);
  });
});

/**
 * T-18.07 (BUG-09) — the switch cannot be turned on into a state that does
 * nothing.
 *
 * `enabled` with an empty chore list took the farm away from the player
 * (movement and the action key are gated on `enabled` alone) and gave back a
 * farmer with nothing in its task list. `idleSettingsSchema` refuses the pair
 * outright now; this is the panel's half, which is about never producing it in
 * the first place and saying why when the player reaches for it.
 */
describe('idleChange', () => {
  const form = (over: Partial<IdleForm> = {}): IdleForm => ({
    enabled: true,
    tasks: [],
    cropId: null,
    ...over,
  });

  it('fills in every chore when the switch goes on with none ticked', () => {
    const change = idleChange(form({ cropId: CROP }), 'switch');

    expect(change.kind).toBe('send');
    expect(change.kind === 'send' && change.form.tasks).toEqual([...IDLE_TASK_TYPES]);
  });

  /**
   * Found in the browser, not here: the endpoint refuses `plant` without a
   * `cropId` (`IDLE_CROP_REQUIRED`), so a default of all four made the switch
   * fail with a red toast for anyone who had not already chosen a crop —
   * which is everyone, the first time. Two rules that are each right and whose
   * intersection was not considered.
   */
  it('leaves planting out of the default when no crop is chosen', () => {
    const change = idleChange(form(), 'switch');

    expect(change.kind === 'send' && change.form.tasks).toEqual(
      IDLE_TASK_TYPES.filter((t) => t !== 'plant'),
    );
    expect(change.kind === 'send' && change.form.tasks.length).toBeGreaterThan(0);
  });

  it('never defaults to a body the endpoint would refuse', () => {
    // The pairing that matters: sowing implies a crop, at every entry point
    // that can fill the list in.
    for (const cropId of [null, '', 'moon-wheat', CROP]) {
      for (const source of ['switch', 'crop'] as const) {
        const change = idleChange(form({ cropId }), source);
        const body = idleBody((change as { form: IdleForm }).form);
        if (body.tasks.includes('plant')) {
          expect(body.cropId, `${source} / ${cropId}`).not.toBeNull();
        }
        expect(body.tasks.length, `${source} / ${cropId}`).toBeGreaterThan(0);
      }
    }
  });

  it('refuses to let the last chore be unticked while the farmer works', () => {
    const change = idleChange(form(), 'tasks');

    expect(change.kind).toBe('refuse');
    // The message has to offer the way out, or the player is told "no" with
    // nothing to do about it — idle is still on and still doing nothing.
    expect(change.kind === 'refuse' && change.message).toMatch(/turn idle off/i);
  });

  it('leaves a chosen chore list exactly as it is', () => {
    for (const source of ['switch', 'tasks', 'crop'] as const) {
      const change = idleChange(form({ tasks: ['water'] }), source);
      expect(change.kind === 'send' && change.form.tasks, source).toEqual(['water']);
    }
  });

  /**
   * Switching OFF with nothing ticked is ordinary — a farmer that is not
   * working needs no chores — and it must not be reinterpreted as "work on
   * everything", which would turn the Stop button into a Start button.
   */
  it('never fills in chores while the switch is off', () => {
    for (const source of ['switch', 'tasks', 'crop'] as const) {
      const change = idleChange(form({ enabled: false }), source);
      expect(change.kind, source).toBe('send');
      expect(change.kind === 'send' && change.form.tasks, source).toEqual([]);
    }
  });

  /**
   * A farm already carrying the bad state from before this rule: the player
   * opens the panel, sees the switch on with nothing ticked, and changes the
   * crop. Refusing that would strand them; filling the chores in is the same
   * reading the switch takes.
   */
  it('rescues a legacy enabled-with-no-chores farm from the crop dropdown', () => {
    const change = idleChange(form({ cropId: CROP }), 'crop');

    expect(change.kind).toBe('send');
    expect(change.kind === 'send' && change.form.tasks).toEqual([...IDLE_TASK_TYPES]);
    expect(change.kind === 'send' && change.form.cropId).toBe(CROP);
  });

  /** The body built from a filled-in form is one the endpoint now accepts. */
  it('produces a body the schema will take', () => {
    const change = idleChange(form({ cropId: CROP }), 'switch');
    const parsed = idleSettingsSchema.safeParse({
      ...idleBody((change as { form: IdleForm }).form),
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(parsed.success).toBe(true);
  });

  /** ...and the state this task removed is one it will not. */
  it('describes a state the schema refuses, which is the point', () => {
    const parsed = idleSettingsSchema.safeParse({
      enabled: true,
      tasks: [],
      cropId: null,
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(parsed.success).toBe(false);
  });
});
