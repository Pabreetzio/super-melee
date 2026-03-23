import { useState, useEffect } from 'react';
import type { FullRoomState, FleetSlot, ShipId } from 'shared/types';
import { client } from '../net/client';
import { SHIP_NAMES } from '../engine/ships';
import ShipPicker from './ShipPicker';
import { SHIP_ICON } from './ShipPicker';

const FLEET_SIZE = 14;
const COLS = 7;

interface Props {
  room: FullRoomState;
  yourSide: 0 | 1;
  onLeave: () => void;
  /** Solo vs AI mode — fleet is local only, called with final fleet on confirm */
  onSoloEngage?: (fleet: FleetSlot[]) => void;
  /** Local 2P mode — both fleets are local, called with both on confirm */
  onLocal2PEngage?: (fleet0: FleetSlot[], fleet1: FleetSlot[]) => void;
}

export default function FleetBuilder({
  room, yourSide, onLeave, onSoloEngage, onLocal2PEngage,
}: Props) {
  const isSolo    = !!onSoloEngage;
  const isLocal2P = !!onLocal2PEngage;
  const isOffline = isSolo || isLocal2P;

  const me  = yourSide === 0 ? room.host : room.opponent!;
  const opp = yourSide === 0 ? room.opponent : room.host;

  // ── Local fleet state ───────────────────────────────────────────────────────
  // Always track MY fleet locally for instant UI feedback.
  // In multiplayer: also send updates to server. In offline modes: server-free.
  const [localFleet0, setLocalFleet0] = useState<FleetSlot[]>(() =>
    Array.from({ length: FLEET_SIZE }, (_, i) => me.fleet[i] ?? null)
  );
  // P2 fleet — only used in local 2P mode
  const [localFleet1, setLocalFleet1] = useState<FleetSlot[]>(() =>
    Array(FLEET_SIZE).fill(null) as FleetSlot[]
  );

  // Re-sync if room changes (rematch, reconnect)
  useEffect(() => {
    setLocalFleet0(Array.from({ length: FLEET_SIZE }, (_, i) => me.fleet[i] ?? null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.code]);

  // ── Picker state ────────────────────────────────────────────────────────────
  // Which fleet/slot the picker is editing. p2 = true means P2's fleet.
  const [pickerTarget, setPickerTarget] = useState<{ slot: number; p2: boolean } | null>(null);

  function pickShip(ship: ShipId | null) {
    if (!pickerTarget) return;
    const { slot, p2 } = pickerTarget;
    if (p2) {
      setLocalFleet1(prev => { const f = [...prev]; f[slot] = ship; return f; });
    } else {
      setLocalFleet0(prev => { const f = [...prev]; f[slot] = ship; return f; });
      if (!isOffline) client.send({ type: 'fleet_update', slot, ship });
    }
    setPickerTarget(null);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────
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

  function renderFleetGrid(fleet: FleetSlot[], editable: boolean, p2 = false) {
    const rows = [];
    for (let r = 0; r < 2; r++) {
      const cells = [];
      for (let c = 0; c < COLS; c++) {
        const slot = r * COLS + c;
        const ship = fleet[slot] ?? null;
        const icon = ship ? SHIP_ICON[ship] : null;
        cells.push(
          <div
            key={slot}
            onClick={editable ? () => setPickerTarget({ slot, p2 }) : undefined}
            style={{
              width: 80, height: 64,
              border: '1px solid var(--border)',
              borderRadius: 4,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: ship ? 'var(--bg2)' : 'var(--bg)',
              cursor: editable ? 'pointer' : 'default',
              gap: 2, padding: 4,
            }}
            title={editable ? 'Click to change' : undefined}
          >
            {ship ? (
              <>
                {icon && (
                  <img
                    src={icon}
                    alt={ship}
                    style={{ width: 32, height: 32, objectFit: 'contain', imageRendering: 'pixelated' }}
                  />
                )}
                <span style={{ fontSize: 9, color: 'var(--text-hi)', textAlign: 'center', lineHeight: 1.2 }}>
                  {SHIP_NAMES[ship] ?? ship}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 18, color: 'var(--text-dim)' }}>{editable ? '+' : '—'}</span>
            )}
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

  // ── Confirm logic ────────────────────────────────────────────────────────────
  const canConfirm = isOffline || !!opp;
  const bothHere   = isOffline || !!opp;
  const myConfirmed = isOffline ? false : me.confirmed;

  // Opponent fleet for display (server-provided in multiplayer, local in 2P)
  const oppDisplayFleet: FleetSlot[] = isLocal2P
    ? localFleet1
    : Array.from({ length: FLEET_SIZE }, (_, i) => opp?.fleet[i] ?? null);

  // ── Render ───────────────────────────────────────────────────────────────────
  const title = isLocal2P
    ? 'Fleet Assembly — Local 2P'
    : isSolo
    ? 'Fleet Assembly — vs AI'
    : `Fleet Assembly — Room ${room.code}`;

  const p1Label = isLocal2P ? 'Player 1' : me.commanderName;
  const p2Label = isLocal2P ? 'Player 2' : (opp?.commanderName ?? 'Awaiting opponent...');
  const p2Color = isLocal2P ? 'var(--success)' : 'var(--accent2)';

  return (
    <div className="screen" style={{ justifyContent: 'flex-start', paddingTop: 30, gap: 20 }}>
      <div style={{ width: '100%', maxWidth: 800 }}>
        {/* Header */}
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>{title}</h2>
          <div className="row" style={{ gap: 10 }}>
            {!isOffline && (
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {yourSide === 0 ? 'You are HOST' : 'You are GUEST'}
              </span>
            )}
            <button className="danger" onClick={onLeave}>
              {isOffline ? 'Back' : 'Withdraw'}
            </button>
          </div>
        </div>

        {/* P1 fleet */}
        <div className="panel col" style={{ marginBottom: 16, gap: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="col" style={{ gap: 4 }}>
              <div className="row" style={{ gap: 10 }}>
                <h3 style={{ color: 'var(--accent)' }}>{p1Label}</h3>
                {!isOffline && myConfirmed && (
                  <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ CONFIRMED</span>
                )}
                {isLocal2P && (
                  <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                    Arrows · RCtrl=fire · RShift=special
                  </span>
                )}
              </div>
              {!isOffline && <TeamNameInput value={me.teamName} />}
            </div>
            <span style={{ color: 'var(--accent2)', fontSize: 14 }}>
              Fleet Value: {fleetValue(localFleet0)} pts
            </span>
          </div>
          {renderFleetGrid(localFleet0, true, false)}
        </div>

        {/* P2 / opponent fleet */}
        <div className="panel col" style={{ marginBottom: 16, gap: 12, opacity: bothHere ? 1 : 0.4 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 10 }}>
              <h3 style={{ color: p2Color }}>{p2Label}</h3>
              {!isOffline && opp?.confirmed && (
                <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ CONFIRMED</span>
              )}
              {isSolo && opp?.confirmed && (
                <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ READY</span>
              )}
              {isLocal2P && (
                <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>
                  WASD · V=fire · B=special
                </span>
              )}
            </div>
            {(isOffline || opp) && (
              <span style={{ color: 'var(--accent2)', fontSize: 14 }}>
                Fleet Value: {fleetValue(oppDisplayFleet)} pts
              </span>
            )}
          </div>

          {bothHere
            ? renderFleetGrid(oppDisplayFleet, isLocal2P, true)
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
          {isLocal2P ? (
            <button className="success" onClick={() => onLocal2PEngage!(localFleet0, localFleet1)}>
              Start Local Battle
            </button>
          ) : isSolo ? (
            <button className="success" onClick={() => onSoloEngage!(localFleet0)}>
              Engage AI
            </button>
          ) : !myConfirmed ? (
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

          {!isOffline && yourSide === 0 && (
            <RematchResetToggle value={room.rematchReset} />
          )}
        </div>

        {!isOffline && myConfirmed && opp?.confirmed && (
          <p style={{ color: 'var(--accent)', marginTop: 12, fontSize: 14 }}>
            Both commanders confirmed. Initiating engagement...
          </p>
        )}
      </div>

      {pickerTarget !== null && (
        <ShipPicker
          onPick={pickShip}
          onClose={() => setPickerTarget(null)}
          currentFleet={pickerTarget.p2 ? localFleet1 : localFleet0}
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
