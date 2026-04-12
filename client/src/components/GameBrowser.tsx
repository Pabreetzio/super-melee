import { useEffect, useRef, useState } from 'react';
import type { RoomSummary } from 'shared/types';
import { client } from '../net/client';
import { loadConfig } from '../lib/starfield';
import StarfieldBG from './StarfieldBG';
import SuperMeleeTitle from './SuperMeleeTitle';

interface Props {
  commanderName: string;
  rooms: RoomSummary[];
  joinError?: string;
  onCommanderNameChange: (name: string) => void;
  onBack?: () => void;
}

function VoidHeader({
  children,
  className = '',
  level = 2,
}: {
  children: React.ReactNode;
  className?: string;
  level?: 1 | 2 | 3 | 4;
}) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
  return (
    <Tag className={`menu-header menu-header--void ${className}`.trim()}>
      <span className="menu-header__label">{children}</span>
    </Tag>
  );
}

function NavLink({
  children,
  href,
  className,
  onNavigate,
}: {
  children: React.ReactNode;
  href: string;
  className: string;
  onNavigate: () => void;
}) {
  return (
    <a
      href={href}
      className={className}
      data-net-nav="true"
      data-net-zone="rail"
      onClick={e => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}

export default function GameBrowser({ commanderName, rooms, joinError, onCommanderNameChange, onBack }: Props) {
  const bgConfig = loadConfig();
  const rootRef = useRef<HTMLDivElement>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(commanderName);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isEditingName) setNameDraft(commanderName);
  }, [commanderName, isEditingName]);

  function joinRoom(code: string, password?: string) {
    setError('');
    client.send({ type: 'join_room', code, password });
  }

  function createRoom() {
    client.send({ type: 'create_room', visibility: 'public' });
  }

  function commitCommanderName() {
    const trimmed = nameDraft.trim();
    setIsEditingName(false);
    if (!trimmed || trimmed === commanderName) return;
    onCommanderNameChange(trimmed);
  }

  function handleRoomClick(room: RoomSummary) {
    if (room.state !== 'waiting') return;
    if (room.visibility === 'private') {
      setJoinPassword('');
      setJoinTarget(room.code);
      return;
    }
    joinRoom(room.code);
  }

  function getNavigableElements(): HTMLElement[] {
    if (!rootRef.current) return [];
    return Array.from(rootRef.current.querySelectorAll<HTMLElement>('[data-net-nav="true"]'));
  }

  function getZoneElements(zone: 'primary' | 'rail'): HTMLElement[] {
    return getNavigableElements().filter(item => item.dataset.netZone === zone);
  }

  function focusNavigable(index: number) {
    const items = getNavigableElements();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    items[clamped]?.focus();
  }

  function focusZone(zone: 'primary' | 'rail', direction: 'start' | 'end' = 'start') {
    const items = getZoneElements(zone);
    if (!items.length) return;
    const target = direction === 'end' ? items[items.length - 1] : items[0];
    target?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const items = getNavigableElements();
    if (!items.length) return;

    const activeElement = document.activeElement as HTMLElement | null;
    const activeIndex = items.findIndex(item => item === activeElement);
    const isOnContainer = activeElement === rootRef.current;
    const activeZone = activeElement?.dataset.netZone as 'primary' | 'rail' | undefined;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusNavigable(isOnContainer ? 0 : activeIndex + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusNavigable(isOnContainer ? items.length - 1 : activeIndex - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (isOnContainer || activeZone === 'primary') {
          focusZone('rail');
        } else {
          focusNavigable(activeIndex + 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (isOnContainer || activeZone === 'rail') {
          focusZone('primary', 'end');
        } else {
          focusNavigable(activeIndex - 1);
        }
        break;
      case 'Home':
        e.preventDefault();
        focusNavigable(0);
        break;
      case 'End':
        e.preventDefault();
        focusNavigable(items.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <div
      ref={rootRef}
      className="screen utility-screen utility-screen--scrolling utility-screen--top"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <StarfieldBG config={bgConfig} />

      <div className="utility-page">
        <div className="primary-deck-layout">
          <section className="primary-deck col utility-deck__primary">
            <div className="page-intro page-intro--tight">
              <SuperMeleeTitle />
              <VoidHeader level={2} className="page-title">Netplay</VoidHeader>
            </div>

            <div className="menu-panel menu-panel--void pixel-surface sample-panel">
              <VoidHeader level={3} className="sample-panel__title">Open Games</VoidHeader>

              <div className="void-save-list pixel-surface">
                {rooms.length === 0 ? (
                  <div className="netplay-empty-state">
                    No open games yet. Host one from the command rail.
                  </div>
                ) : (
                  rooms.map(room => {
                    const canJoin = room.state === 'waiting';
                    const bodyLabel = [
                      room.hostName,
                      room.opponentName ? `vs ${room.opponentName}` : 'Awaiting opponent',
                      room.visibility === 'private' ? 'Private' : 'Public',
                      canJoin ? 'Open' : 'In Progress',
                    ].join('  |  ');

                    return (
                      <button
                        key={room.code}
                        type="button"
                        className="void-save-row demo-save-row netplay-room-row"
                        data-net-nav="true"
                        data-net-zone="primary"
                        onClick={() => handleRoomClick(room)}
                        disabled={!canJoin}
                      >
                        <div className="void-save-cell void-save-cell--slot">{room.code}</div>
                        <div className="void-save-cell netplay-room-row__body">{bodyLabel}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {joinError || error ? (
              <div className="panel sample-panel sample-panel--compact">
                <div className="netplay-message netplay-message--error">{joinError || error}</div>
              </div>
            ) : null}

            {joinTarget ? (
              <div className="panel sample-panel sample-panel--compact">
                <VoidHeader level={3} className="sample-panel__subtitle">Private Room</VoidHeader>
                <div className="netplay-message">
                  Room {joinTarget} needs a password.
                </div>
                <div className="netplay-password-row">
                  <input
                    value={joinPassword}
                    onChange={e => setJoinPassword(e.target.value)}
                    className="netplay-password-input"
                    placeholder="Password"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        joinRoom(joinTarget, joinPassword || undefined);
                        setJoinTarget(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="ui-button ui-button--bevel utility-link utility-link--large netplay-inline-action"
                    onClick={() => {
                      joinRoom(joinTarget, joinPassword || undefined);
                      setJoinTarget(null);
                    }}
                  >
                    Join
                  </button>
                  <button
                    type="button"
                    className="ui-button ui-button--bevel utility-link utility-link--large netplay-inline-action"
                    onClick={() => setJoinTarget(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <aside className="command-rail utility-rail">
            <VoidHeader level={3} className="zone-header">Captain</VoidHeader>
            <div className="menu-panel menu-panel--void pixel-surface sample-panel sample-panel--compact">
              {isEditingName ? (
                <input
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  className="netplay-captain-input"
                  maxLength={30}
                  autoFocus
                  onBlur={commitCommanderName}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitCommanderName();
                    if (e.key === 'Escape') {
                      setNameDraft(commanderName);
                      setIsEditingName(false);
                    }
                  }}
                />
              ) : (
                <div className="netplay-captain-name">{commanderName}</div>
              )}
            </div>

            <div className="menu-panel menu-panel--blue pixel-surface rail-panel">
              <button
                type="button"
                className="menu-option demo-button"
                data-net-nav="true"
                data-net-zone="rail"
                aria-current="true"
              >
                Open Games
              </button>
              <button
                type="button"
                className="menu-option demo-button"
                data-net-nav="true"
                data-net-zone="rail"
                onClick={createRoom}
              >
                Host Game
              </button>
              <button
                type="button"
                className="menu-option demo-button"
                data-net-nav="true"
                data-net-zone="rail"
                onClick={() => {
                  setNameDraft(commanderName);
                  setIsEditingName(true);
                }}
              >
                Change Name
              </button>
            </div>

            <div className="utility-rail__spacer" />

            {onBack ? (
              <NavLink
                href="/"
                className="ui-button ui-button--bevel utility-link utility-link--large"
                onNavigate={onBack}
              >
                Back
              </NavLink>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
