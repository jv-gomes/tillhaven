import { CUES, type CueId, type Voice } from './audio.js';

/**
 * The twenty lines that hand `audio.ts`'s cue table to WebAudio.
 *
 * Separate from the table for the reason `Farm.playBurst` is separate from
 * `effects.ts`: the numbers are testable in node and this is not — there is no
 * `AudioContext` outside a browser, and the client's tests run without a DOM.
 *
 * **Nothing here exists until the player acts.** Browsers refuse to start an
 * audio context without a user gesture, and a page that tries is a page with a
 * console warning on every load. `context()` builds it lazily on the first cue,
 * which by construction is a keypress or a click.
 */

const STORAGE_KEY = 'tillhaven:muted';

/** Master volume applied over every voice's own gain. */
const MASTER = 0.5;

let ctx: AudioContext | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    // Private-mode Safari throws on `localStorage`. Unmuted is the safe answer:
    // the player can always mute again, and a game that silently refuses to
    // make sound is harder to diagnose than one that makes it.
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

/**
 * Turns sound off or on, and remembers it.
 *
 * Persisted in `localStorage` rather than on the player row, deliberately: it
 * is a property of the DEVICE, not the account. Someone playing on a laptop in
 * an office and a phone at home wants different answers, and a server round
 * trip for a mute button is a round trip for nothing (§4.1 — this decides
 * nothing about the farm).
 */
export function setMuted(next: boolean): void {
  muted = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // See `readMuted`. The setting still applies for this session.
  }
  if (next) void ctx?.suspend();
  else void ctx?.resume();
}

function context(): AudioContext | null {
  if (muted) return null;
  if (ctx) {
    // Autoplay policy can suspend a context that was created too early, or one
    // whose tab was backgrounded. Resuming is free when it is already running.
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;

  ctx = new Ctor();
  return ctx;
}

/**
 * A burst of white noise, as an `AudioBuffer`.
 *
 * Built per voice rather than cached, because the longest is 160ms of mono
 * samples — a few kilobytes — and a cache would need invalidating against a
 * sample rate that can change when the output device does.
 */
function noiseSource(audio: AudioContext, seconds: number): AudioBufferSourceNode {
  const frames = Math.max(1, Math.floor(audio.sampleRate * seconds));
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

  const source = audio.createBufferSource();
  source.buffer = buffer;
  return source;
}

function playVoice(audio: AudioContext, v: Voice, at: number): void {
  const gain = audio.createGain();
  /*
   * An exponential ramp to near-silence rather than a linear one to zero:
   * `exponentialRampToValueAtTime` cannot reach 0 (it is undefined there), and
   * a linear fade on a 70ms blip is audibly a click at the end. 0.0001 is
   * -80dB, which is silence.
   */
  gain.gain.setValueAtTime(v.gain * MASTER, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + v.seconds);

  let node: AudioNode = gain;
  if (v.lowpass !== null) {
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(v.lowpass, at);
    gain.connect(filter);
    node = filter;
  }
  node.connect(audio.destination);

  if (v.wave === 'noise') {
    const source = noiseSource(audio, v.seconds);
    source.connect(gain);
    source.start(at);
    source.stop(at + v.seconds);
    return;
  }

  const osc = audio.createOscillator();
  osc.type = v.wave;
  osc.frequency.setValueAtTime(v.from, at);
  if (v.to !== v.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, v.to), at + v.seconds);
  osc.connect(gain);
  osc.start(at);
  osc.stop(at + v.seconds);
}

/**
 * Plays a cue. Silent and harmless when muted, unsupported, or in node.
 *
 * Never throws: a game that crashes because a browser would not give it an
 * oscillator is worse in every way than a quiet one.
 */
export function play(cue: CueId): void {
  const audio = context();
  if (!audio) return;

  try {
    const at = audio.currentTime;
    for (const v of CUES[cue]) playVoice(audio, v, at + v.delay);
  } catch {
    // An exhausted or closed context. Nothing to recover, nothing to report.
  }
}
