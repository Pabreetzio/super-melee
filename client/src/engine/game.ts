// Game loop — 24 fps deterministic lockstep
// Coordinates physics simulation, input buffering, and checksum generation.

import { RNG } from './rng';
import { applyGravity, stepElement } from './physics';
import type { Element } from './element';
import { DISAPPEARING } from './element';
import { client } from '../net/client';

export const BATTLE_FPS    = 24;
export const FRAME_MS      = 1000 / BATTLE_FPS; // 41.67 ms

// Input byte bit layout:
//   bit 0: thrust
//   bit 1: rotate left
//   bit 2: rotate right
//   bit 3: fire primary
//   bit 4: fire secondary
export const INPUT_THRUST  = 0x01;
export const INPUT_LEFT    = 0x02;
export const INPUT_RIGHT   = 0x04;
export const INPUT_FIRE1   = 0x08;
export const INPUT_FIRE2   = 0x10;

export interface BattleConfig {
  seed:       number;
  inputDelay: number; // frames
  yourSide:   0 | 1;
}

export interface BattleCallbacks {
  onFrame:     (frame: number, elements: Element[]) => void;
  onShipDied:  (side: 0 | 1, slot: number) => void;
  onBattleEnd: () => void;
}

export class GameLoop {
  private rng:         RNG;
  private frame        = 0;
  private inputDelay:  number;
  private yourSide:    0 | 1;
  private elements:    Element[] = [];
  private running      = false;

  // Input ring buffers: inputBuffer[side][frame] = input byte
  private inputBuffer: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];

  // Accumulated local input for the current frame (set by keyboard handlers)
  private localInput = 0;

  private callbacks: BattleCallbacks;
  private rafHandle: number | null = null;
  private lastTime  = 0;
  private frameAccum = 0;

  constructor(config: BattleConfig, callbacks: BattleCallbacks) {
    this.rng        = new RNG(config.seed);
    this.inputDelay = config.inputDelay;
    this.yourSide   = config.yourSide;
    this.callbacks  = callbacks;
  }

  /** Add an element to the sim */
  addElement(el: Element): void {
    this.elements.push(el);
  }

  /** Called by keyboard handler to set input state for next frame */
  setLocalInput(input: number): void {
    this.localInput = input;
  }

  /** Called by net layer when opponent input arrives */
  receiveOpponentInput(frame: number, input: number): void {
    const opSide = this.yourSide === 0 ? 1 : 0;
    this.inputBuffer[opSide].set(frame, input);
  }

  start(): void {
    this.running   = true;
    this.lastTime  = performance.now();
    this.rafHandle = requestAnimationFrame(this._tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  private _tick = (now: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this._tick);

    this.frameAccum += now - this.lastTime;
    this.lastTime = now;

    while (this.frameAccum >= FRAME_MS) {
      this.frameAccum -= FRAME_MS;
      this._advance();
    }
  };

  private _advance(): void {
    const sendFrame = this.frame + this.inputDelay;
    const mySide    = this.yourSide;
    const opSide    = mySide === 0 ? 1 : 0;

    // Enqueue and send local input for this frame + delay
    this.inputBuffer[mySide].set(sendFrame, this.localInput);
    client.send({ type: 'battle_input', frame: sendFrame, input: this.localInput });

    // Wait until both inputs are ready for the current frame
    const myInput = this.inputBuffer[mySide].get(this.frame);
    const opInput = this.inputBuffer[opSide].get(this.frame);
    if (myInput === undefined || opInput === undefined) {
      // Stall — waiting for opponent input
      return;
    }

    // Clean up consumed inputs
    this.inputBuffer[mySide].delete(this.frame);
    this.inputBuffer[opSide].delete(this.frame);

    // Simulate one frame
    this._simulateFrame(mySide === 0 ? myInput : opInput, mySide === 0 ? opInput : myInput);
    this.frame++;

    // Send checksum every frame
    const crc = this._computeChecksum();
    client.send({ type: 'checksum', frame: this.frame, crc });

    this.callbacks.onFrame(this.frame, this.elements);
  }

  private _simulateFrame(input0: number, input1: number): void {
    // 1. Apply inputs to player ships (stub — ships will implement their own update)
    for (const el of this.elements) {
      if (el.state_flags & DISAPPEARING) continue;

      // Gravity
      applyGravity(el);

      // Step position
      stepElement(el);

      // Life span countdown
      if (el.life_span > 0) {
        el.life_span--;
        if (el.life_span === 0) el.state_flags |= DISAPPEARING;
      }
    }

    // 2. Collision detection (stub — full sprite-based collision later)
    // TODO: iterate element pairs, call overlaps() + resolveCollision()

    // 3. Remove dead elements
    this.elements = this.elements.filter(el => !(el.state_flags & DISAPPEARING));

    // Suppress unused parameter warning until full implementation
    void input0; void input1;
  }

  private _computeChecksum(): number {
    // CRC32-style checksum over all non-background element state + RNG seed
    let crc = this.rng.getSeed();
    for (const el of this.elements) {
      crc ^= el.state_flags;
      crc ^= el.life_span << 8;
      crc ^= el.crew_level << 16;
      crc ^= el.current.x;
      crc ^= el.current.y << 8;
      crc = (crc >>> 0); // keep 32-bit
    }
    return crc;
  }
}
