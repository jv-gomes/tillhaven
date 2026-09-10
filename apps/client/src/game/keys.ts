import Phaser from 'phaser';

/**
 * The action key, shared by every scene that has one (T-16.15).
 *
 * Lived in `Farm.ts` until the Interior gained a character and needed the same
 * binding. Two copies of "which key acts" is exactly the kind of duplication
 * that survives until someone rebinds one of them.
 *
 * Phaser key CODES, like the movement keys in `Player.ts` — not the DOM
 * `event.code` strings the hotbar matches on. The two look interchangeable and
 * are not: `addKey('KeyE')` binds nothing at all and fails silently, which cost
 * a debugging round in T-8.06.
 */
export const ACTION_KEYS: readonly number[] = [
  Phaser.Input.Keyboard.KeyCodes.E,
  Phaser.Input.Keyboard.KeyCodes.SPACE,
];
