import { api, idempotencyKey } from './api.js';

/**
 * The goal board (T-30.08).
 *
 * Everything here is the server's arithmetic. `earned` is derived from
 * counters the server holds, `claimed` is a unique index, and the reward is
 * read from shared config on both sides — the client never asserts any of it
 * (§4.1).
 */

export interface MilestoneRewardView {
  readonly gold: number;
  readonly items: readonly { readonly itemId: string; readonly quantity: number }[];
}

export interface MilestoneView {
  readonly id: string;
  readonly title: string;
  readonly hint: string;
  readonly earned: boolean;
  readonly claimed: boolean;
  /** Progress in the requirement's own units, already capped at `target`. */
  readonly progress: number;
  readonly target: number;
  readonly reward: MilestoneRewardView;
}

export interface ClaimResult {
  readonly milestoneId: string;
  readonly reward: MilestoneRewardView;
  /** Lifetime experience and level after the claim, for the HUD (T-30.02). */
  readonly experience: number;
  readonly farmLevel: number;
}

export function fetchProgression(): Promise<{ milestones: MilestoneView[] }> {
  return api.get<{ milestones: MilestoneView[] }>('/progression');
}

export function claimMilestone(
  milestoneId: string,
  key = idempotencyKey(),
): Promise<ClaimResult> {
  return api.post<ClaimResult>('/progression/claim', { milestoneId, idempotencyKey: key });
}

/**
 * What the board should show next: the goals still worth working toward.
 *
 * Claimable first — a reward waiting to be collected is the most useful thing
 * the panel can point at — then unearned goals in table order. Already-claimed
 * milestones drop out entirely rather than accumulating as a wall of ticks the
 * player has to read past.
 */
export function nextGoals(milestones: readonly MilestoneView[], count = 3): MilestoneView[] {
  const claimable = milestones.filter((m) => m.earned && !m.claimed);
  const pending = milestones.filter((m) => !m.earned);
  return [...claimable, ...pending].slice(0, count);
}
