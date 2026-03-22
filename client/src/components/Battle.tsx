// Battle screen — canvas game loop shell
// Full physics simulation to be wired in once ship movement is implemented.

import { useEffect, useRef, useCallback } from 'react';
import type { FullRoomState, FleetSlot } from 'shared/types';
import { client } from '../net/client';
import { GameLoop, INPUT_THRUST, INPUT_LEFT, INPUT_RIGHT, INPUT_FIRE1, INPUT_FIRE2 } from '../engine/game';
import type { Element } from '../engine/element';
import { DISPLAY_WIDTH, DISPLAY_HEIGHT } from '../engine/physics';
import HUD from './HUD';

const CANVAS_W = DISPLAY_WIDTH;
const CANVAS_H = DISPLAY_HEIGHT;

interface Props {
  room:       FullRoomState;
  yourSide:   0 | 1;
  seed:       number;
  inputDelay: number;
  onBattleEnd: (winner: 0 | 1 | null) => void;
}

// Keyboard → input bit map
const KEY_MAP: Record<string, number> = {
  ArrowUp:    INPUT_THRUST,
  ArrowLeft:  INPUT_LEFT,
  ArrowRight: INPUT_RIGHT,
  ' ':        INPUT_FIRE1,
  Enter:      INPUT_FIRE2,
  // WASD for P2 feel when testing locally
  w: INPUT_THRUST,
  a: INPUT_LEFT,
  d: INPUT_RIGHT,
  f: INPUT_FIRE1,
  g: INPUT_FIRE2,
};

export default function Battle({ room, yourSide, seed, inputDelay, onBattleEnd }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const loopRef    = useRef<GameLoop | null>(null);
  const keysRef    = useRef(new Set<string>());
  const frameRef   = useRef<number | null>(null);

  const renderFrame = useCallback((elements: Element[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw planet (placeholder — centered circle)
    ctx.beginPath();
    ctx.arc(CANVAS_W / 2, CANVAS_H / 2, 40, 0, Math.PI * 2);
    ctx.fillStyle = '#221133';
    ctx.fill();
    ctx.strokeStyle = '#443355';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw elements (placeholder — colored dots)
    for (const el of elements) {
      const x = el.current.x % CANVAS_W;
      const y = el.current.y % CANVAS_H;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = el.playerSide === 0 ? '#4af' : el.playerSide === 1 ? '#f84' : '#888';
      ctx.fill();
    }
  }, []);

  // Compute local input from held keys
  const computeInput = useCallback((): number => {
    let bits = 0;
    for (const key of keysRef.current) {
      bits |= KEY_MAP[key] ?? 0;
    }
    return bits;
  }, []);

  useEffect(() => {
    const loop = new GameLoop(
      { seed, inputDelay, yourSide },
      {
        onFrame: (_frame, elements) => {
          loop.setLocalInput(computeInput());
          renderFrame(elements);
        },
        onShipDied: (side, slot) => {
          client.send({ type: 'ship_select', slot: 0 }); // TODO: show picker
          console.log(`Ship died: side=${side} slot=${slot}`);
        },
        onBattleEnd: () => {
          client.send({ type: 'battle_over_ack' });
        },
      }
    );

    loopRef.current = loop;
    loop.start();

    // Keyboard listeners
    const onDown = (e: KeyboardEvent) => { keysRef.current.add(e.key); };
    const onUp   = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);

    // Net: receive opponent input
    const unsub = client.onMessage(msg => {
      if (msg.type === 'battle_input') {
        loop.receiveOpponentInput(msg.frame, msg.input);
      } else if (msg.type === 'battle_over') {
        loop.stop();
        onBattleEnd(msg.winner);
      } else if (msg.type === 'checksum_mismatch') {
        console.error(`Desync detected at frame ${msg.frame}`);
        loop.stop();
        onBattleEnd(null);
      }
    });

    return () => {
      loop.stop();
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
      unsub();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [seed, inputDelay, yourSide, renderFrame, computeInput, onBattleEnd]);

  // Derive HUD data from room fleets (placeholder crew values)
  const myFleet  = (yourSide === 0 ? room.host.fleet : room.opponent?.fleet) ?? [];
  const oppFleet = (yourSide === 0 ? room.opponent?.fleet : room.host.fleet) ?? [];

  function firstShipName(fleet: FleetSlot[]): string {
    const first = fleet.find(Boolean);
    return first ?? 'Unknown';
  }

  const hudLeft  = { name: firstShipName(myFleet),  crew: 20, maxCrew: 20, energy: 20, maxEnergy: 20 };
  const hudRight = { name: firstShipName(oppFleet), crew: 20, maxCrew: 20, energy: 20, maxEnergy: 20 };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        style={{ display: 'block', background: '#000' }}
      />
      <HUD left={hudLeft} right={hudRight} />
    </div>
  );
}
