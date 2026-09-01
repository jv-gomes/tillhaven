import { describe, it, expect } from 'vitest';
import { CROP_IDS, IDLE_TASK_TYPES } from '@tillhaven/shared/config';
import { idleBody } from './idlePanel.js';

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
    const body = idleBody({ enabled: true, tasks: ['till', 'chop', 'mine'], cropId: null });

    expect(body.tasks).toEqual(['till']);
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
