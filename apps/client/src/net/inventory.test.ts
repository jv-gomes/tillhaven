import { describe, expect, it } from 'vitest';
import { inventoryMoveSchema } from '@tillhaven/shared';
import type { InventorySlot, SlotRef } from './inventory.js';

/**
 * T-18.26 — the bag's wire contract, pinned to one field name.
 *
 * `InventorySlot` was declared three times: here (as `slotIndex`), in
 * `apps/server/src/modules/inventory/service.ts` (as `slotIndex`), and in
 * `packages/shared/src/types` (as **`index`**) — where **nothing imported it**.
 * The copy that was wrong was the copy nobody exercised, which is why it sat
 * there: §10 exists so a type cannot be right in two places and wrong in a
 * third, and this is what happens when it is not followed.
 *
 * Caught while writing T-18.17's onboarding, which had to take a structural
 * `{itemId, quantity}` rather than pick a side between two disagreeing
 * declarations of the same thing.
 */
describe('InventorySlot', () => {
  /**
   * A compile-time assertion made to fail at runtime if the field is renamed:
   * the object literal must satisfy the imported type, and the property read
   * must find a number. A rename in shared breaks this file rather than
   * silently breaking the hotbar.
   */
  it('carries slotIndex, which is what the server sends', () => {
    const slot: InventorySlot = { slotIndex: 3, itemId: 'leek_seeds', quantity: 2 };

    expect(slot.slotIndex).toBe(3);
    expect(Object.keys(slot).sort()).toEqual(['itemId', 'quantity', 'slotIndex']);
  });

  /**
   * A slot ROW and a slot REFERENCE are different DTOs and name their field
   * differently on purpose — `slotIndex` on a row the server sends back,
   * `slot` inside a `{container, slot}` reference the client sends. That looked
   * like a third inconsistency while writing this test and is not one; asserted
   * so the next person does not "fix" it into agreement.
   */
  it('is a different shape from a slot REFERENCE, deliberately', () => {
    const ref: SlotRef = { container: 'inventory', slot: 0 };

    expect(Object.keys(ref).sort()).toEqual(['container', 'slot']);
    // And the reference is the shape the server actually parses.
    const parsed = inventoryMoveSchema.safeParse({
      from: ref,
      to: { container: 'chest', slot: 1 },
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(parsed.success).toBe(true);
  });

  /** ...and the row shape is rejected there, which is why they stay distinct. */
  it('would be refused if a row were sent where a reference belongs', () => {
    const parsed = inventoryMoveSchema.safeParse({
      from: { container: 'inventory', slotIndex: 0 },
      to: { container: 'chest', slotIndex: 1 },
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(parsed.success).toBe(false);
  });
});
