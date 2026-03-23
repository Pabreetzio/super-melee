import { useState } from 'react';
import type { RoomSummary, RoomVisibility } from 'shared/types';
import { client } from '../net/client';

interface Props {
  commanderName: string;
  rooms: RoomSummary[];
  onSolo: () => void;
  onLocal2P: () => void;
}

export default function GameBrowser({ commanderName, rooms, onSolo, onLocal2P }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [visibility, setVisibility] = useState<RoomVisibility>('public');
  const [password, setPassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [error, setError] = useState('');

  function createRoom() {
    client.send({
      type: 'create_room',
      visibility,
      password: visibility === 'private' && password ? password : undefined,
    });
    setShowCreate(false);
  }

  function joinRoom(code: string, pw?: string) {
    setError('');
    client.send({ type: 'join_room', code, password: pw });
  }

  function joinByCode() {
    if (!joinCode.trim()) return;
    joinRoom(joinCode.trim().toUpperCase(), joinPassword || undefined);
  }

  function handleRoomClick(room: RoomSummary) {
    if (room.state !== 'waiting') return;
    if (room.visibility === 'private') {
      setJoinTarget(room.code);
    } else {
      joinRoom(room.code);
    }
  }

  return (
    <div className="screen" style={{ justifyContent: 'flex-start', paddingTop: 40 }}>
      <div style={{ width: '100%', maxWidth: 760 }}>
        {/* Header */}
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
          <h2>Engagement Roster</h2>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            Commander: <span style={{ color: 'var(--accent)' }}>{commanderName}</span>
          </span>
        </div>

        {/* Create panel */}
        {/* Local modes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div className="panel row" style={{ gap: 12, alignItems: 'center' }}>
            <div className="col" style={{ gap: 4, flex: 1 }}>
              <span style={{ fontSize: 13, color: 'var(--text-hi)' }}>vs AI</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Build your fleet, then engage the AI.
              </span>
            </div>
            <button onClick={onSolo}>Assemble Fleet</button>
          </div>
          <div className="panel row" style={{ gap: 12, alignItems: 'center' }}>
            <div className="col" style={{ gap: 4, flex: 1 }}>
              <span style={{ fontSize: 13, color: 'var(--text-hi)' }}>Local 2P</span>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Same keyboard. Arrows vs WASD.
              </span>
            </div>
            <button onClick={onLocal2P}>Assemble Fleets</button>
          </div>
        </div>

        {showCreate ? (
          <div className="panel col" style={{ marginBottom: 20, gap: 12 }}>
            <h3>Open New Engagement</h3>
            <div className="row" style={{ gap: 20 }}>
              <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="radio" checked={visibility === 'public'}
                  onChange={() => setVisibility('public')} />
                Public
              </label>
              <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="radio" checked={visibility === 'private'}
                  onChange={() => setVisibility('private')} />
                Private (password-locked)
              </label>
            </div>
            {visibility === 'private' && (
              <input
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Password"
                style={{ width: 220 }}
              />
            )}
            <div className="row">
              <button className="success" onClick={createRoom}>Open Engagement</button>
              <button onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginBottom: 20, gap: 10 }}>
            <button className="success" onClick={() => setShowCreate(true)}>
              + Open Engagement
            </button>
            <div className="row" style={{ gap: 6 }}>
              <input
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={4}
                style={{ width: 90, textTransform: 'uppercase' }}
              />
              <input
                value={joinPassword}
                onChange={e => setJoinPassword(e.target.value)}
                placeholder="Password (if any)"
                style={{ width: 160 }}
              />
              <button onClick={joinByCode}>Join by Code</button>
            </div>
          </div>
        )}

        {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

        {/* Password prompt modal for private room click */}
        {joinTarget && (
          <div className="panel col" style={{ marginBottom: 20, gap: 10 }}>
            <p>Room <strong>{joinTarget}</strong> requires a password.</p>
            <input
              value={joinPassword}
              onChange={e => setJoinPassword(e.target.value)}
              placeholder="Password"
              style={{ width: 220 }}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  joinRoom(joinTarget, joinPassword || undefined);
                  setJoinTarget(null);
                }
              }}
            />
            <div className="row">
              <button className="success" onClick={() => {
                joinRoom(joinTarget, joinPassword || undefined);
                setJoinTarget(null);
              }}>Join</button>
              <button onClick={() => setJoinTarget(null)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Room table */}
        <div className="panel" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-dim)', fontSize: 11 }}>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>CODE</th>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>HOST</th>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>FLEET VALUE</th>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>OPPONENT</th>
                <th style={{ padding: '8px 12px', textAlign: 'left' }}>STATUS</th>
                <th style={{ padding: '8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {rooms.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-dim)' }}>
                    No engagements in progress. Be the first to open one.
                  </td>
                </tr>
              )}
              {rooms.map(room => (
                <tr key={room.code} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px', color: 'var(--accent)', fontWeight: 'bold' }}>
                    {room.visibility === 'private' && <span title="Password required">🔒 </span>}
                    {room.code}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{room.hostName}</td>
                  <td style={{ padding: '8px 12px', color: 'var(--accent2)' }}>
                    {room.hostFleetValue} pts
                  </td>
                  <td style={{ padding: '8px 12px', color: room.opponentName ? 'var(--text)' : 'var(--text-dim)' }}>
                    {room.opponentName ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span className={`status-dot ${room.state === 'waiting' ? 'green' : 'yellow'}`} />
                    {' '}{room.state === 'waiting' ? 'Open' : 'In progress'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    {room.state === 'waiting' && (
                      <button onClick={() => handleRoomClick(room)}>Join</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
