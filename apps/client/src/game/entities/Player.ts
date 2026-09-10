import Phaser from 'phaser';
import {
  CHAR_ANIMS,
  CHAR_LAYER_ORDER,
  CHAR_ORIGIN,
  charAnimDurationMs,
  TOOL_ANIMS,
  type CharAnimKey,
  type ToolAnim,
} from '@tillhaven/shared/config';
import type { Appearance } from '@tillhaven/shared/schemas';
import { CONTACT_SHADOW, characterDepth, characterShadowDepth } from '../depth.js';
import { isModalOpen, isTypingInDom } from '../../lib/focus.js';
import { touchControls } from '../touchControls.js';
import { mergeInput } from '../touchInput.js';
import {
  charAnimKey,
  layerTextureKey,
  loadCharacter,
  registerCharacterAnimations,
  toolTextureKey,
  type FarmAnim,
} from './characterLayers.js';
import type { Swing } from '../actions.js';
import {
  NO_INPUT,
  step,
  type Bounds,
  type Direction,
  type MoveInput,
  type MoveState,
  type World,
} from './movement.js';

/**
 * The farm's player character: four stacked sprites, one per appearance layer.
 *
 * **Cosmetic, and deliberately so** (CLAUDE.md §5.1). Nothing on the farm cares
 * where this sprite is standing: plots are clicked, not walked to, and no
 * position is ever sent to the server. That is not a shortcut — a server that
 * validated proximity would need to track and trust a stream of client-reported
 * coordinates, which §4.1 rules out, in exchange for a rule an idle game does
 * not want anyway.
 *
 * The character does not exist until the server says what it looks like, so
 * this is built in two stages: the constructor makes an empty `Container` that
 * `movement.ts` can already drive, and `setAppearance()` fills it in once the
 * strips are loaded. Gating the whole SCENE on that load was the other option
 * and it is worse — the farm, its map and its camera have nothing to do with
 * the player's hair, and a brand-new account sits on the character creator for
 * as long as it likes before there is an appearance to load at all.
 *
 * The new pack draws all 4 directions explicitly as separate frame blocks
 * (`CHAR_DIRECTION_ORDER`), so there is no mirroring here: no `setFlipX`, and
 * therefore none of the layer-drift a flipped composite invites.
 */

export interface PlayerOptions {
  /** Feet position at spawn, in world (map) pixels. */
  readonly spawn: { readonly x: number; readonly y: number };
  readonly bounds: Bounds;
}

export class Player {
  private readonly scene: Phaser.Scene;
  private readonly container: Phaser.GameObjects.Container;
  private readonly bounds: Bounds;
  private readonly keys: Record<keyof MoveInput, Phaser.Input.Keyboard.Key[]>;
  private state: MoveState;
  private lastAnim = '';

  /**
   * The four layer sprites, bottom to top. Empty until `setAppearance`.
   * `layers[0]` is the animation LEADER — see `syncLayerFrames`.
   */
  private layers: Phaser.GameObjects.Sprite[] = [];
  private appearance: Appearance | null = null;
  /**
   * Guards the async gap in `setAppearance`. A second appearance chosen while
   * the first one's strips are still downloading must win, or the character
   * settles on whichever request happened to finish last.
   */
  private appearanceToken = 0;
  private destroyed = false;
  /**
   * True while idle mode has the farm (T-13.06). The keys are still bound and
   * still fire; `readInput` simply stops reading them, which is the same shape
   * as the typing guard rather than a second mechanism.
   */
  private inputLocked = false;
  /**
   * What the idle replay is "holding down" this frame (T-13.07).
   *
   * Read INSTEAD of the keyboard while locked, not alongside it, so there is
   * never a frame where the player and the farmer are both steering. It is the
   * same `MoveInput` shape a keyboard produces, which is the point: the replay
   * gets `step`'s speed, its diagonal scaling, its facing rule and its bounds
   * for free rather than reimplementing a second way to move a character.
   */
  private drive: MoveInput = NO_INPUT;

  /**
   * The tool in the character's hands, drawn above every appearance layer.
   *
   * A fifth sprite rather than a fifth entry in `CHAR_LAYER_ORDER`: only two of
   * the five animations have one, and the character creator composites the
   * same layer order with no tool in sight.
   */
  private toolSprite: Phaser.GameObjects.Sprite | null = null;
  /**
   * When the current swing ends, on the local clock — or null when not
   * swinging. A DEADLINE rather than Phaser's `ANIMATION_COMPLETE`, because a
   * listener on a sprite that an appearance change destroys mid-swing never
   * fires, and the failure mode of that is a character locked out of walking
   * for the rest of the session.
   */
  private swingUntil: number | null = null;

  /** Solid tiles, or null while the scene has not supplied any (T-15.08). */
  private world: World | null = null;

  /** Flat ellipse under the feet, so the character stands on the farm. */
  private readonly shadow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, options: PlayerOptions) {
    this.scene = scene;
    this.bounds = options.bounds;
    this.state = {
      x: options.spawn.x,
      y: options.spawn.y,
      facing: 'down',
      moving: false,
      running: false,
    };

    /*
     * The contact shadow, created before the container so it is always drawn
     * under it (T-15.29). Its own game object rather than a sprite inside the
     * container: the container's depth follows the feet, and a child would
     * inherit that and sort level with the character instead of beneath it.
     */
    this.shadow = scene.add
      .ellipse(
        this.state.x,
        this.state.y,
        CONTACT_SHADOW.radiusX * 2,
        CONTACT_SHADOW.radiusY * 2,
        CONTACT_SHADOW.colour,
        CONTACT_SHADOW.alpha,
      )
      .setDepth(characterShadowDepth(this.state.y));

    this.container = scene.add.container(this.state.x, this.state.y);
    this.keys = bindKeys(scene);
    this.draw();
  }

  /** Feet position, world pixels. Read-only to callers — nothing else moves it. */
  get x(): number {
    return this.state.x;
  }

  get y(): number {
    return this.state.y;
  }

  /** Which way the character is looking — what `targeting.ts` aims from. */
  get facing(): Direction {
    return this.state.facing;
  }

  /**
   * True once the character is actually on screen.
   *
   * There is a real window where it is not: the scene builds the player
   * immediately but the strips only load once the server reports an
   * appearance, and a brand-new account holds that open for as long as it
   * spends in the character creator. Anything drawn RELATIVE to the character
   * — the faced-tile highlight — has to stay hidden for exactly that window,
   * or it hovers over an empty farm pointing at nobody.
   */
  get ready(): boolean {
    return this.layers.length > 0;
  }

  /**
   * Loads this appearance's strips and rebuilds the character from them.
   *
   * Safe to call repeatedly with the same appearance (the creator's save and
   * the next farm poll both report it) — an unchanged appearance is a no-op
   * rather than a texture reload and a visible rebuild.
   */
  async setAppearance(appearance: Appearance, anims?: readonly CharAnimKey[]): Promise<void> {
    if (this.appearance && sameAppearance(this.appearance, appearance)) return;
    this.appearance = appearance;

    const token = ++this.appearanceToken;
    await loadCharacter(this.scene, appearance, anims);
    // The character may have been destroyed, or a newer appearance may have
    // overtaken this one, while those files were in flight.
    if (this.destroyed || token !== this.appearanceToken) return;

    registerCharacterAnimations(this.scene, appearance, anims);
    this.buildLayers(appearance);
    this.draw();
  }

  private buildLayers(appearance: Appearance): void {
    for (const sprite of this.layers) sprite.destroy();

    // Bottom to top, in the pack's stacking order — skin, clothes, eyes, hair.
    this.layers = CHAR_LAYER_ORDER.map((layer) =>
      this.scene.add
        .sprite(0, 0, layerTextureKey('idle', layer, appearance), 0)
        // Feet on the position, not the frame's blank bottom edge (CHAR_ART).
        .setOrigin(CHAR_ORIGIN.x, CHAR_ORIGIN.y),
    );

    this.container.add(this.layers);

    // Above every layer, and hidden until a swing asks for it.
    this.toolSprite?.destroy();
    this.toolSprite = this.scene.add
      .sprite(0, 0, toolTextureKey('hoe'), 0)
      .setOrigin(CHAR_ORIGIN.x, CHAR_ORIGIN.y)
      .setVisible(false);
    this.container.add(this.toolSprite);

    // A rebuild has no animation history; the next draw must actually play.
    this.lastAnim = '';
  }

  update(deltaMs: number): void {
    this.settleSwing();

    // A swing feeds NO_INPUT rather than skipping `step` entirely: a character
    // that was walking when it started still has to be brought to a stop, and
    // `step` is the only thing that owns `moving`/`running`.
    const input = this.swingUntil === null ? this.readInput() : NO_INPUT;
    const next = step(this.state, input, deltaMs, this.bounds, this.world ?? undefined);
    if (next !== this.state) {
      this.state = next;
      this.draw();
    }

    this.syncLayerFrames();
  }

  /** True while a tool swing owns the character. Movement is refused. */
  get isSwinging(): boolean {
    return this.swingUntil !== null;
  }

  /**
   * Plays one action animation, once, in the current facing, across every layer.
   *
   * Locks movement for exactly the animation's own length — `charAnimDurationMs`
   * reads the same measured `framesPerDirection`/`fps` Phaser plays the strip
   * at, so the lock cannot end early (character walks away mid-swing) or late
   * (character frozen holding a raised hoe). That matters more since T-16.02
   * than it did with two anims: the five strips run from 3 to 8 frames at three
   * different rates, so a hardcoded duration would be wrong for four of them.
   *
   * **Only some swings carry a tool.** `isToolAnim` is a narrowing guard over
   * `TOOL_ANIMS` rather than a truthiness check, because the overlay texture is
   * only loaded for those two — asking for `character/plant/tool/wood.png`
   * would resolve to an unregistered animation key, and `anims.play` on one of
   * those does nothing at all and logs nothing (the T-8.04 finding).
   *
   * Cosmetic, like everything else here. It gates nothing and tells the server
   * nothing; the server validates every intent on its own terms (§4.1).
   */
  playToolAnimation(anim: Swing): void {
    // Ignored rather than queued: a held key would otherwise build a backlog of
    // swings the player stopped asking for a second ago.
    if (this.swingUntil !== null || !this.appearance || this.layers.length === 0) return;

    const facing = this.state.facing;

    // Stop first: a swing starts from standing, and leaving `moving` set would
    // let the next `draw()` overwrite the swing with a walk cycle.
    this.state = { ...this.state, moving: false, running: false };
    this.swingUntil = this.scene.time.now + charAnimDurationMs(CHAR_ANIMS[anim]);

    for (const [index, layer] of CHAR_LAYER_ORDER.entries()) {
      const texture = layerTextureKey(anim, layer, this.appearance);
      this.layers[index]?.anims.play(charAnimKey(texture, facing), true);
    }

    if (isToolAnim(anim)) {
      const tool = toolTextureKey(anim);
      this.toolSprite?.setVisible(true).anims.play(charAnimKey(tool, facing), true);
    } else {
      // Bare-handed. Hiding is not optional: the sprite holds whatever it last
      // played, so a plant right after a till would show a floating hoe.
      this.toolSprite?.setVisible(false);
    }

    // The swing is not one of `draw()`'s animations, so the cache has to be
    // cleared or the return to idle is skipped as a no-op.
    this.lastAnim = '';
  }

  /** Ends a swing once its animation has had time to finish. */
  private settleSwing(): void {
    if (this.swingUntil === null || this.scene.time.now < this.swingUntil) return;

    this.swingUntil = null;
    this.toolSprite?.setVisible(false);
    // Non-looping animations hold on their last frame, so without this the
    // character stands there mid-swing until it next changes direction.
    this.lastAnim = '';
    this.draw();
  }

  /**
   * Keyboard state for this frame.
   *
   * Yields to the DOM: the HUD is real elements over the canvas (CLAUDE.md §2),
   * so typing a quantity into the shop must not also walk the character across
   * the farm. Phaser listens on the window and does not check what has focus.
   */
  /**
   * Hands the character over to the idle farmer, or takes it back (T-13.06).
   *
   * Feeding `NO_INPUT` rather than skipping `update` is the same choice a tool
   * swing makes: a character that was mid-stride when idle mode came on still
   * has to be brought to a stop, and `step` is the only thing that owns
   * `moving`/`running`.
   */
  setInputLocked(locked: boolean): void {
    this.inputLocked = locked;
    // Handing the farm back must not leave a stale key held down: the farmer's
    // last instruction was "keep walking east", and nobody is going to send the
    // one that cancels it.
    if (!locked) this.drive = NO_INPUT;
  }

  /**
   * The idle replay's steering for this frame (T-13.07).
   *
   * Ignored unless the character is locked, so a stray call cannot take the
   * farm away from a player who is holding it.
   */
  setDrive(input: MoveInput): void {
    this.drive = input;
  }

  /**
   * Points the character somewhere without moving it.
   *
   * `step` only updates facing while there is input — that is what stops a
   * character snapping back to face the camera the moment a key is released —
   * so an arrival has to say which way to look. Nothing else needs this: a
   * walking character is already facing where it is going.
   */
  /**
   * Teleports the character, keeping its facing.
   *
   * Only for putting someone back where a scene says they belong — re-entering
   * the house has to return them to the doorway (T-16.15), or they come back
   * standing wherever they left from. Never for movement: `step` owns that, and
   * a second thing writing position is how the two disagree.
   */
  moveTo(x: number, y: number): void {
    this.state = { ...this.state, x, y, moving: false, running: false };
    this.draw();
  }

  face(direction: Direction): void {
    if (this.state.facing === direction || this.swingUntil !== null) return;

    this.state = { ...this.state, facing: direction };
    this.draw();
  }

  /**
   * What the character bumps into, or `null` for the pre-T-15.06 behaviour of
   * being stopped only by the map's edges.
   *
   * Settable rather than constructor-only for two reasons: the block map is not
   * complete until the first farm poll returns building tiers, and the idle
   * replay turns collision off for itself when it gets stuck (T-15.09) rather
   * than stalling the farm over a clipped corner.
   */
  setWorld(world: World | null): void {
    this.world = world;
  }

  private readInput(): MoveInput {
    if (this.inputLocked) return this.drive;
    /*
     * A modal panel takes input (T-18.12, BUG-10). Checked here beside
     * `isTypingInDom` because it is the same category of question — is the
     * player working the DOM or the world — and because this is the ONE place
     * movement is read, so a guard anywhere else would be a second answer to
     * one question.
     *
     * NOT `setInputLocked`, which the audit suggested and which means something
     * else: locked hands the character to the idle farmer's `drive`, so a shop
     * opened during idle mode would have frozen the farmer mid-shift rather
     * than stopping the player.
     */
    if (isTypingInDom() || isModalOpen()) return NO_INPUT;

    /*
     * The virtual stick joins here, and ONLY here (T-28.02, D-19).
     *
     * This is the one place movement is read, so merging at this line is what
     * lets touch reuse every rule downstream unchanged — `movement.step`,
     * facing, and the faced-tile targeting §5.1 acts on. A touch path that
     * moved the character by any other route would be a second movement model,
     * and the two would drift.
     *
     * Merged rather than switched, so a tablet with a keyboard attached has
     * both. See `touchInput.mergeInput`.
     */
    return mergeInput(
      {
        up: isDown(this.keys.up),
        down: isDown(this.keys.down),
        left: isDown(this.keys.left),
        right: isDown(this.keys.right),
        run: isDown(this.keys.run),
      },
      touchControls.current(),
    );
  }

  private draw(): void {
    const { x, y, facing, moving, running } = this.state;

    this.container.setPosition(x, y);
    // Biased half a pixel over static scenery on the same ground line, so the
    // draw order stops depending on scene construction order (T-18.01).
    this.container.setDepth(characterDepth(y));
    this.shadow.setPosition(x, y).setDepth(characterShadowDepth(y));

    if (this.layers.length === 0 || !this.appearance) return;
    /*
     * The swing owns the animation until it ends. This is defence in depth
     * rather than the load-bearing guard it looks like: `playToolAnimation`
     * already clears `moving`/`running`, so `step` returns the same object and
     * `draw()` is not reached from `update()` at all during a swing (verified
     * — removing this line changes nothing there, even mid-walk). What it
     * actually catches is `setAppearance`, which calls `draw()` directly and
     * would otherwise drop a mid-swing character back to idle the moment the
     * creator saved a new shirt.
     */
    if (this.swingUntil !== null) return;

    // `running` already means "moving AND Shift" (movement.ts), so this is a
    // lookup, not a second place that decides what running is.
    const anim: FarmAnim = moving ? (running ? 'run' : 'walk') : 'idle';
    const key = `${anim}:${facing}`;
    if (key === this.lastAnim) return;
    this.lastAnim = key;

    // Each layer has its OWN texture per animation — idle and walk are
    // different files — so this is not four copies of one play call: it is how
    // the upper layers change strip at all.
    for (const [index, layer] of CHAR_LAYER_ORDER.entries()) {
      const texture = layerTextureKey(anim, layer, this.appearance);
      this.layers[index]?.anims.play(charAnimKey(texture, facing), true);
    }
  }

  /**
   * Forces the upper layers onto the leader's frame.
   *
   * All four run the same animation at the same frame rate and are started in
   * the same tick, so in practice they never disagree — but "in practice"
   * across four independently-advanced animation states is exactly the sort of
   * thing that produces a character whose hair is one frame behind its head,
   * and the failure would be subtle enough to ship. One comparison per layer
   * per frame buys the guarantee outright.
   */
  private syncLayerFrames(): void {
    const leader = this.layers[0];
    if (!leader) return;

    const frame = leader.frame.name;
    for (let i = 1; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (layer && layer.frame.name !== frame) layer.setFrame(frame);
    }

    // The tool is held IN a hand, so a frame of drift is not a subtle artefact
    // here — it is a hoe that has left the character's grip.
    const tool = this.toolSprite;
    if (tool?.visible && tool.frame.name !== frame) tool.setFrame(frame);
  }

  destroy(): void {
    // Stops a load still in flight from rebuilding a destroyed character.
    this.destroyed = true;
    this.swingUntil = null;

    for (const group of Object.values(this.keys)) {
      for (const key of group) key.destroy();
    }
    // Destroys the layer sprites with it — they are its children.
    this.container.destroy();
    // The shadow is NOT a child (it has to sort below the container), so it
    // does not go with it.
    this.shadow.destroy();
    this.layers = [];
    this.toolSprite = null;
  }
}

/**
 * Whether this swing draws an implement in the character's hands.
 *
 * A narrowing guard over the shared `TOOL_ANIMS`, so the one list that decides
 * which overlay strips `prepare-assets.mjs` copies is the same list that
 * decides whether to show one. Writing `anim === 'hoe' || anim === 'watering'`
 * here instead would be a second copy that goes stale the day D-4 adds a tier
 * or an axe arrives. The axe arrived in T-20.04 and this needed no edit, which
 * is the guard working.
 */
function isToolAnim(anim: Swing): anim is ToolAnim {
  return (TOOL_ANIMS as readonly string[]).includes(anim);
}

function sameAppearance(a: Appearance, b: Appearance): boolean {
  return (
    a.skin === b.skin &&
    a.clothes === b.clothes &&
    a.eyes.sex === b.eyes.sex &&
    a.eyes.color === b.eyes.color &&
    a.hair.style === b.hair.style &&
    a.hair.color === b.hair.color
  );
}

/**
 * WASD and the arrow keys, both.
 *
 * Capture is switched OFF (`addKey(code, false)`). With it on, Phaser calls
 * preventDefault on these keys at the window, which would stop the arrows from
 * moving the caret inside the HUD's own inputs.
 */
function bindKeys(scene: Phaser.Scene): Record<keyof MoveInput, Phaser.Input.Keyboard.Key[]> {
  const keyboard = scene.input.keyboard;
  const codes = Phaser.Input.Keyboard.KeyCodes;

  const bind = (...wanted: number[]): Phaser.Input.Keyboard.Key[] =>
    keyboard ? wanted.map((code) => keyboard.addKey(code, false)) : [];

  return {
    up: bind(codes.W, codes.UP),
    down: bind(codes.S, codes.DOWN),
    left: bind(codes.A, codes.LEFT),
    right: bind(codes.D, codes.RIGHT),
    // One code covers both Shift keys — the browser does not distinguish them
    // by keyCode, and a player who runs with the right one expects it to work.
    run: bind(codes.SHIFT),
  };
}

function isDown(keys: readonly Phaser.Input.Keyboard.Key[]): boolean {
  return keys.some((key) => key.isDown);
}
