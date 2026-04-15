import { useEffect, useState } from 'react';
import type { FullRoomState, FleetSlot } from 'shared/types';
import StarfieldBG from './StarfieldBG';
import SuperMeleeTitle from './SuperMeleeTitle';
import { loadConfig } from '../lib/starfield';
import { SHIP_ICON, SHIP_COSTS } from './shipSelectionData';
import ShipMenuImage from './ShipMenuImage';
import BlueMenuPanel from './BlueMenuPanel';
import RailFitText from './RailFitText';

const LOGICAL_STAGE_W = 980;
const LOGICAL_STAGE_H = 760;
const LOGICAL_LEFT_W = 800;
const LOGICAL_SIDEBAR_W = 160;

interface Props {
  room: FullRoomState;
  yourSide: 0 | 1;
  localFleet: FleetSlot[];
  copyState: 'idle' | 'copied' | 'error';
  onCopyCode: () => void;
  onLeave: () => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onFleetPick: (slot: number) => void;
  onTeamName: (name: string) => void;
}

function fleetValue(fleet: FleetSlot[]): number {
  return fleet.reduce((sum, ship) => sum + (ship ? (SHIP_COSTS[ship] ?? 0) : 0), 0);
}

function SetupMenuButton({
  label,
  onClick,
  disabled,
  tone = 'default',
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'captain';
}) {
  return (
    <button
      type="button"
      className="ui-button ui-button--bevel super-melee-menu-button"
      onClick={onClick}
      disabled={disabled}
    >
      {tone === 'captain' ? (
        <RailFitText
          text={label}
          className="super-melee-menu-label super-melee-menu-label--captain"
          maxFontSize={18}
          minFontSize={10}
          lineHeight={1.15}
        />
      ) : (
        <span className="super-melee-menu-label">
          {label}
        </span>
      )}
    </button>
  );
}

function TeamNameEditor({
  value,
  editable,
  onCommit,
}: {
  value: string;
  editable: boolean;
  onCommit: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim() || value;
    if (next !== value) onCommit(next);
  }

  if (!editable) {
    return <div className="setup-team-name">{value}</div>;
  }

  if (editing) {
    return (
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        className="setup-team-name-input"
        maxLength={20}
        autoFocus
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="setup-team-name-button"
      onClick={() => setEditing(true)}
      title="Rename fleet"
    >
      {value}
    </button>
  );
}

function FleetPanel({
  captainName,
  teamName,
  value,
  fleet,
  roomCode,
  editable,
  confirmed,
  awaitingOpponent = false,
  onCopyCode,
  onEditTeamName,
  onPickSlot,
}: {
  captainName: string;
  teamName: string;
  value: number;
  fleet: FleetSlot[];
  roomCode?: string;
  editable: boolean;
  confirmed?: boolean;
  awaitingOpponent?: boolean;
  onCopyCode?: () => void;
  onEditTeamName?: (name: string) => void;
  onPickSlot?: (slot: number) => void;
}) {
  return (
    <section className={`setup-panel ${awaitingOpponent ? 'setup-panel--muted' : ''}`.trim()}>
      <div className="setup-summary">
        <div className="setup-summary__identity">
          <div className="setup-captain-name">{captainName}</div>
          <TeamNameEditor
            value={teamName}
            editable={editable}
            onCommit={name => onEditTeamName?.(name)}
          />
        </div>
        <div className="setup-summary__meta">
          <div>Fleet Value: {value}</div>
          {confirmed ? <div className="setup-status-note">Confirmed</div> : null}
        </div>
      </div>

      {awaitingOpponent ? (
        <div className="setup-message">
          Awaiting opponent. Share code{' '}
          <button
            type="button"
            onClick={onCopyCode}
            disabled={!roomCode}
            title={roomCode ? 'Copy room code' : undefined}
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 0,
              padding: 0,
              color: 'var(--accent)',
              font: 'inherit',
              fontWeight: 'bold',
              cursor: roomCode ? 'pointer' : 'default',
              letterSpacing: 'inherit',
              textDecoration: roomCode ? 'underline' : 'none',
              textUnderlineOffset: '0.15em',
            }}
          >
            {roomCode ?? '----'}
          </button>
          .
        </div>
      ) : (
        <div className="setup-fleet-grid">
          {Array.from({ length: 14 }, (_, slot) => {
            const ship = fleet[slot] ?? null;
            const icon = ship ? SHIP_ICON[ship] : null;
            return (
              <button
                key={slot}
                type="button"
                className={`setup-fleet-cell ${ship ? 'setup-fleet-cell--filled' : ''}`.trim()}
                onClick={editable ? () => onPickSlot?.(slot) : undefined}
                disabled={!editable}
                title={editable ? 'Choose ship' : ship ?? 'Empty slot'}
              >
                {icon ? (
                  <ShipMenuImage
                    src={icon}
                    alt={ship ?? ''}
                    scale={2.6}
                    maxFill="98%"
                  />
                ) : ship ? (
                  <span className="setup-fleet-cell__fallback">{ship}</span>
                ) : (
                  <span className="setup-fleet-cell__empty">{editable ? '+' : '—'}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function MultiplayerSetupScreen({
  room,
  yourSide,
  localFleet,
  copyState,
  onCopyCode,
  onLeave,
  onConfirm,
  onCancelConfirm,
  onFleetPick,
  onTeamName,
}: Props) {
  const bgConfig = loadConfig();
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    function updateScale() {
      const pad = 40;
      const availW = Math.max(320, window.innerWidth - pad);
      const availH = Math.max(320, window.innerHeight - pad);
      setStageScale(Math.min(availW / LOGICAL_STAGE_W, availH / LOGICAL_STAGE_H));
    }

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const hostFleet = yourSide === 0
    ? localFleet
    : Array.from({ length: 14 }, (_, i) => room.host.fleet[i] ?? null);
  const opponentFleet = yourSide === 1
    ? localFleet
    : Array.from({ length: 14 }, (_, i) => room.opponent?.fleet[i] ?? null);

  const hostCaptain = room.host.commanderName;
  const opponentCaptain = room.opponent?.commanderName ?? 'Awaiting Opponent';
  const myConfirmed = yourSide === 0 ? room.host.confirmed : !!room.opponent?.confirmed;
  const opponentConfirmed = yourSide === 0 ? !!room.opponent?.confirmed : room.host.confirmed;
  const hasOpponent = Boolean(room.opponent);

  const confirmLabel = myConfirmed
    ? 'Un-confirm'
    : hasOpponent
    ? 'Confirm Fleet'
    : 'Waiting...';

  return (
    <div className="super-melee-screen super-melee-screen--setup">
      <StarfieldBG config={bgConfig} />

      <div
        className="super-melee-stage"
        style={{ width: LOGICAL_STAGE_W * stageScale, height: LOGICAL_STAGE_H * stageScale }}
      >
        <div
          className="super-melee-stage__scaled"
          style={{ width: LOGICAL_STAGE_W, height: LOGICAL_STAGE_H, transform: `scale(${stageScale})` }}
        >
          <div className="super-melee-stage__layout" style={{ width: LOGICAL_STAGE_W }}>
            <div className="super-melee-stage__primary" style={{ width: LOGICAL_LEFT_W }}>
              <SuperMeleeTitle />

              <div className="setup-primary">
                <FleetPanel
                  captainName={hostCaptain}
                  teamName={room.host.teamName}
                  value={fleetValue(hostFleet)}
                  fleet={hostFleet}
                  editable={yourSide === 0}
                  confirmed={room.host.confirmed}
                  onEditTeamName={name => yourSide === 0 && onTeamName(name)}
                  onPickSlot={slot => yourSide === 0 && onFleetPick(slot)}
                />

                <FleetPanel
                  captainName={opponentCaptain}
                  teamName={room.opponent?.teamName ?? 'Awaiting Opponent'}
                  value={fleetValue(opponentFleet)}
                  fleet={opponentFleet}
                  roomCode={room.code}
                  editable={yourSide === 1 && hasOpponent}
                  confirmed={opponentConfirmed}
                  awaitingOpponent={!hasOpponent}
                  onCopyCode={onCopyCode}
                  onEditTeamName={name => yourSide === 1 && onTeamName(name)}
                  onPickSlot={slot => yourSide === 1 && onFleetPick(slot)}
                />

                {myConfirmed && opponentConfirmed ? (
                  <div className="setup-message setup-message--success">
                    Both captains confirmed. Initiating engagement...
                  </div>
                ) : null}
              </div>
            </div>

            <div className="super-melee-sidebar" style={{ width: LOGICAL_SIDEBAR_W }}>
              <div className="super-melee-menu-group super-melee-menu-group--top">
                <BlueMenuPanel
                  className="setup-blue-menu"
                  items={[
                    { label: hostCaptain, tone: 'captain' },
                  ]}
                />
                <SetupMenuButton label="Copy Link" onClick={onCopyCode} />
              </div>

              <div className="menu-panel menu-panel--bevel pixel-surface setup-room-card">
                <div className="setup-room-card__label">Room Code</div>
                <div className="setup-room-card__code">{room.code}</div>
                <div className="setup-room-card__status">
                  {copyState === 'copied'
                    ? 'Copied room link'
                    : copyState === 'error'
                    ? 'Copy link failed'
                    : hasOpponent
                    ? 'Opponent connected'
                    : 'Waiting for opponent'}
                </div>
              </div>

              <div className="super-melee-menu-group super-melee-menu-group--bottom">
                <BlueMenuPanel
                  className="setup-blue-menu"
                  items={[
                    { label: opponentCaptain, tone: 'captain' },
                  ]}
                />
                <SetupMenuButton
                  label={confirmLabel}
                  onClick={myConfirmed ? onCancelConfirm : onConfirm}
                  disabled={!myConfirmed && !hasOpponent}
                />
                <SetupMenuButton label="Withdraw" onClick={onLeave} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
