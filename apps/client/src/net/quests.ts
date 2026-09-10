import type { MilestoneReward } from '@tillhaven/shared/config';
import { api, idempotencyKey } from './api.js';

/**
 * The quest endpoints (T-33.05).
 *
 * **A thin reader, like `net/progression.ts`.** Every field here is the
 * server's; nothing is computed on the way past. `status` in particular is the
 * server's answer and not a local inference from "do I have a row" — the client
 * has no rows.
 */

export type QuestStatus = 'available' | 'accepted' | 'completed';

export interface QuestView {
  readonly id: string;
  readonly giver: string;
  readonly title: string;
  readonly summary: string;
  readonly requires: readonly { readonly itemId: string; readonly quantity: number }[];
  readonly reward: MilestoneReward;
  readonly unlockLevel: number;
  readonly status: QuestStatus;
  /** Derived requests expire with the rotation; authored ones never do. */
  readonly rotating: boolean;
}

export interface QuestBoard {
  readonly quests: QuestView[];
  /** When the rotating half turns over. Epoch ms (§10). */
  readonly rotationEndsAt: number;
}

export interface TurnInResult {
  readonly questId: string;
  readonly reward: MilestoneReward;
  readonly experience: number;
  readonly farmLevel: number;
}

export async function fetchQuests(): Promise<QuestView[]> {
  const board = await api.get<QuestBoard>('/quests');
  return board.quests;
}

export function acceptQuest(questId: string, key = idempotencyKey()): Promise<QuestView> {
  return api.post<QuestView>('/quests/accept', { questId, idempotencyKey: key });
}

export function turnInQuest(questId: string, key = idempotencyKey()): Promise<TurnInResult> {
  return api.post<TurnInResult>('/quests/turn-in', { questId, idempotencyKey: key });
}
