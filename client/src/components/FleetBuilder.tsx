import { useState } from 'react';
import type { FullRoomState, FleetSlot, ShipId } from 'shared/types';
import { client } from '../net/client';
import { SHIP_NAMES } from '../engine/ships';
import ShipPicker from './ShipPicker';

const FLEET_SIZE = 14;
const COLS = 7;

interface Props {
  room: FullRoomState;
  yourSide: 0 | 1;
  onLeave: () => void;
  /** If provided, we're in solo-vs-AI mode. Fleet changes are local only.
   *  Called with the player's final fleet when they hit "Engage AI". */
  onSoloEngage?: (fleet: FleetSlot[]) => void;
}

export default function FleetBuilder({ room, yourSide, onLeave, onSoloEngage }: Props) {
  const isSolo = !!onSoloEngage;
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);

  // In solo mode the player's fleet lives in local state so we never hit the server.
  const [localFleet, setLocalFleet] = useState<FleetSlot[]>(() =>
    Array(FLEET_SIZE).fill(null) as FleetSlot[]
  );

  const me  = yourSide === 0 ? room.host : room.opponent!;
  const opp = yourSide === 0 ? room.opponent : room.host;

  // Displayed player fleet: local in solo, server-provided in multiplayer
  const myDisplayFleet: FleetSlot[] = isSolo
    ? localFleet
    : Array.from({ length: FLEET_SIZE }, (_, i) => me.fleet[i] ?? null);

  function pickShip(slot: number, ship: ShipId | null) {
    if (isSolo) {
      setLocalFleet(prev => { const f = [...prev]; f[slot] = ship; return f; });
    } else {
      client.send({ type: 'fleet_update', slot, ship });
    }
    setPickerSlot(null);
  }

  function fleetValue(fleet: FleetSlot[]): number {
    const costs: Partial<Record<ShipId, number>> = {
      androsynth: 22, arilou: 18, chenjesu: 24, chmmr: 26, druuge: 14,
      human: 16, ilwrath: 14, melnorme: 20, mmrnmhrm: 20, mycon: 18,
      orz: 22, pkunk: 12, shofixti: 8, slylandro: 14, spathi: 16,
      supox: 18, syreen: 18, thraddash: 16, umgah: 14, urquan: 28,
      utwig: 22, vux: 20, yehat: 20, zoqfotpik: 16,
      blackurq: 28, kohrah: 10, samatra: 0,
    };
    return fleet.reduce((sum, s) => sum + (s ? (costs[s] ?? 0) : 0), 0);
  }

  function renderFleetGrid(fleet: FleetSlot[], editable: boolean) {
    const rows = [];
    for (let r = 0; r < 2; r++) {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        const slot = r * COLS + c;
        const ship = fleet[slot] ?? null;
        cells.push(
          <div
            key={slot}
            onClick={editable ? () => setPickerSlot(slot) : undefined}
            style={{
              width: 80, height: 60,
              border: '1px solid var(--border)',
              borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: ship ? 'var(--bg2)' : 'var(--bg)',
              cursor: editable ? 'pointer' : 'default',
              fontSize: 10,
              textAlign: 'center',
              padding: 4,
              color: ship ? 'var(--text-hi)' : 'var(--text-dim)',
              transition: 'border-color 0.1s',
            }}
            title={editable ? 'Click to change' : undefined}
          >
            {ship ? (SHIP_NAMES[ship] ?? ship) : (editable ? '+' : '—')}
          </div>
        );
      }
      rows.push(
        <div key={r} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {cells}
        </div>
      );
    }
    return <div className="col" style={{ gap: 6 }}>{rows}</div>;
  }

  // In solo mode AI is always "confirmed". In multiplayer, wait for real opponent.
  const canConfirm = isSolo || !!opp;
  const bothHere   = isSolo || !!opp;

  return (
    <div className="screen" style={{ justifyContent: 'flex-start', paddingTop: 30, gap: 20 }}>
      <div style={{ width: '100%', maxWidth: 800 }}>
        {/* Header */}
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>
            {isSolo ? 'Fleet Assembly — vs AI' : `Fleet Assembly — Room ${room.code}`}
          </h2>
          <div className="row" style={{ gap: 10 }}>
            {!isSolo && (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {yourSide === 0 ? 'You are HOST' : 'You are GUEST'}
              </span>
            )}
            <button className="danger" onClick={onLeave}>
              {isSolo ? 'Back' : 'Withdraw'}
            </button>
          </div>
        </div>

        {/* My fleet */}
        <div className="panel col" style={{ marginBottom: 16, gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="col" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 10 }}>
                <h3 style={{ color: 'var(--accent)' }}>{me.commanderName}</h3>
              </div>
              {!isSolo && <TeamNameInput value={me.teamName} />}
            </div>
            <span style={{ color: 'var(--accent2)', fontSize: 14 }}>
              Fleet Value: {fleetValue(myDisplayFleet)} pts
            </span>
          </div>
          {renderFleetGrid(myDisplayFleet, true)}
        </div>

        {/* Opponent fleet (AI or real) */}
        <div className="panel col" style={{ marginBottom: 16, gap: 12, opacity: bothHere ? 1 : 0.4 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 10 }}>
              <h3 style={{ color: 'var(--accent2)' }}>
                {opp ? opp.commanderName : 'Awaiting opponent...'}
              </h3>
              {opp?.confirmed && (
                <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ CONFIRMED</span>
              )}
            </div>
            {opp && (
              <span style={{ color: 'var(--accent2)', fontSize: 14 }}>
                Fleet Value: {fleetValue(Array.from({ length: FLEET_SIZE }, (_, i) => opp.fleet[i] ?? null))} pts
              </span>
            )}
          </div>
          {opp
            ? renderFleetGrid(Array.from({ length: FLEET_SIZE }, (_, i) => opp.fleet[i] ?? null), false)
            : <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                Share room code <strong style={{ color: 'var(--accent)' }}>{room.code}</strong> with your opponent.
              </p>
          }
          {isSolo && (
            <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>
              AI fleet is preset. The AI will field these ships against yours.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="row" style={{ gap: 12 }}>
          {isSolo ? (
            <button
              className="success"
              onClick={() => onSoloEngage!(localFleet)}
            >
              Engage AI
            </button>
          ) : !me.confirmed ? (
            <button
              className="success"
              disabled={!canConfirm}
              onClick={() => client.send({ type: 'confirm' })}
            >
              {bothHere ? 'Confirm Fleet' : 'Waiting for opponent...'}
            </button>
          ) : (
            <button onClick={() => client.send({ type: 'cancel_confirm' })}>
              Un-confirm
            </button>
          )}

          {!isSolo && yourSide === 0 && (
            <RematchResetToggle value={room.rematchReset} />
          )}
        </div>

        {!isSolo && me.confirmed && opp?.confirmed && (
          <p style={{ color: 'var(--accent)', marginTop: 12, fontSize: 14 }}>
            Both commanders confirmed. Initiating engagement...
          </p>
        )}
      </div>

      {pickerSlot !== null && (
        <ShipPicker
          onPick={(ship) => pickShip(pickerSlot, ship)}
          onClose={() => setPickerSlot(null)}
          currentFleet={myDisplayFleet}
        />
      )}
    </div>
  );
}

function TeamNameInput({ value }: { value: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  function commit() {
    setEditing(false);
    client.send({ type: 'team_name', name: draft });
  }

  if (editing) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={20}
          autoFocus
          onBlur={commit}
          onKeyDown={e => e.key === 'Enter' && commit()}
          style={{ width: 180 }}
        />
      </div>
    );
  }

  return (
    <span
      style={{ cursor: 'pointer', color: 'var(--text-dim)', fontSize: 12 }}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="Click to rename fleet"
    >
      {value} ✏
    </span>
  );
}

function RematchResetToggle({ value }: { value: boolean }) {
  return (
    <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 12 }}>
      <input
        type="checkbox"
        checked={value}
        onChange={e => client.send({ type: 'rematch_reset', value: e.target.checked })}
      />
      Reset fleets on rematch
    </label>
  );
}
