import { useEffect, useRef, useState } from 'react';
import { loadConfig } from '../lib/starfield';
import StarfieldBG from './StarfieldBG';
import SuperMeleeTitle from './SuperMeleeTitle';
import BlueMenuPanel from './BlueMenuPanel';

const STYLE_LAB_STAGE_W = 1220;
const STYLE_LAB_STAGE_H = 860;

interface Props {
  onBack: () => void;
  onBGBuilder: () => void;
  onTypography: () => void;
}

function VoidHeader({
  children,
  className = '',
  level = 2,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  level?: 1 | 2 | 3 | 4;
  style?: React.CSSProperties;
}) {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4';
  return (
    <Tag className={`menu-header menu-header--void ${className}`.trim()} style={style}>
      <span className="menu-header__label">{children}</span>
    </Tag>
  );
}

function VoidSaveSample() {
  const rows = [
    { slot: '05', label: 'Oct 24,2158: Sent Ilwrath Away' },
    { slot: '06', label: 'Nov 16,2158: Fitted with Bomb' },
    { slot: '07', label: 'Dec 08,2158: Attack on Sa Matra' },
    { slot: '08', label: 'Dec 09,2158: Through the first line' },
    { slot: '09', label: 'May 06,2155: New Game' },
  ];

  return (
    <div className="void-save-list pixel-surface">
      <VoidHeader level={3} className="sample-panel__title">Load Game</VoidHeader>
      {rows.map(row => (
        <button
          key={row.slot}
          type="button"
          className="void-save-row demo-save-row"
          data-style-lab-nav="true"
          data-style-lab-zone="primary"
        >
          <div className="void-save-cell void-save-cell--slot">{row.slot}</div>
          <div className="void-save-cell">{row.label}</div>
        </button>
      ))}
    </div>
  );
}

function UtilityLink({
  children,
  className,
  href,
  onNavigate,
  zone = 'rail',
}: {
  children: React.ReactNode;
  className: string;
  href: string;
  onNavigate: () => void;
  zone?: 'primary' | 'rail';
}) {
  return (
    <a
      href={href}
      className={className}
      data-style-lab-nav="true"
      data-style-lab-zone={zone}
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

export default function StyleLab({ onBack, onBGBuilder, onTypography }: Props) {
  const bgConfig = loadConfig();
  const rootRef = useRef<HTMLDivElement>(null);
  const [stageScale, setStageScale] = useState(1);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    function updateScale() {
      const pad = window.innerWidth <= 900 ? 24 : 40;
      const availW = Math.max(320, window.innerWidth - pad);
      const availH = Math.max(320, window.innerHeight - pad);
      setStageScale(Math.min(1, availW / STYLE_LAB_STAGE_W, availH / STYLE_LAB_STAGE_H));
    }

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  function getNavigableElements(): HTMLElement[] {
    if (!rootRef.current) return [];
    return Array.from(rootRef.current.querySelectorAll<HTMLElement>('[data-style-lab-nav="true"]'));
  }

  function getZoneElements(zone: 'primary' | 'rail'): HTMLElement[] {
    return getNavigableElements().filter(
      item => item.dataset.styleLabZone === zone,
    );
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
    const activeZone = activeElement?.dataset?.styleLabZone as 'primary' | 'rail' | undefined;

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
        if (isOnContainer) {
          focusZone('rail');
        } else if (activeZone === 'primary') {
          focusZone('rail');
        } else {
          focusNavigable(activeIndex + 1);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (isOnContainer) {
          focusZone('primary', 'end');
        } else if (activeZone === 'rail') {
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
      className="screen utility-screen"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <StarfieldBG config={bgConfig} />

      <div
        className="utility-stage"
        style={{ width: STYLE_LAB_STAGE_W * stageScale, height: STYLE_LAB_STAGE_H * stageScale }}
      >
        <div
          className="utility-stage__scaled"
          style={{ width: STYLE_LAB_STAGE_W, height: STYLE_LAB_STAGE_H, transform: `scale(${stageScale})` }}
        >
          <div className="utility-page">
            <div className="primary-deck-layout utility-deck">
              <section className="primary-deck col utility-deck__primary">
                <div className="page-intro page-intro--tight">
                  <SuperMeleeTitle />
                  <VoidHeader level={2} className="page-title">Styles</VoidHeader>
                  <VoidHeader level={3} className="zone-header">Primary Deck</VoidHeader>
                </div>

                <div className="menu-panel menu-panel--void pixel-surface sample-panel">
                  <VoidSaveSample />
                </div>

                <div className="menu-panel menu-panel--void pixel-surface sample-panel">
                  <VoidHeader level={3} className="sample-panel__title">Typography</VoidHeader>
                  <div className="col sample-stack">
                    <SuperMeleeTitle className="title-sample" />
                    <VoidHeader level={4} className="sample-panel__title">Netplay</VoidHeader>
                    <div className="type-sample type-sample--tiny">
                      ABCDEFGHIJKLMNOPQRSTUVWXYZ<br />
                      0123456789 .,:;!?+-=*/&amp;#()%[]
                    </div>
                  </div>
                </div>

                <div className="panel sample-panel sample-panel--compact">
                  <VoidHeader level={3} className="sample-panel__subtitle">Keyboard-First Rules</VoidHeader>
                  <div className="rule-grid">
                    <div>Every page exposes a clear default focus target.</div>
                    <div>Active state visible without hover.</div>
                    <div>Mouse clicks mirror keyboard actions.</div>
                    <div>Focus feels like game selection, not browser chrome.</div>
                  </div>
                </div>
              </section>

              <aside className="command-rail utility-rail">
                <VoidHeader level={3} className="zone-header">Command Rail</VoidHeader>
                <VoidHeader level={4} className="zone-header">Blue Menu</VoidHeader>
                <BlueMenuPanel
                  buttonClassName="style-lab__nav-button"
                  items={[
                    { label: 'Captain Zog', tone: 'captain', navAttrs: { 'data-style-lab-nav': 'true', 'data-style-lab-zone': 'rail' } },
                    { label: 'Open Games', selected: true, navAttrs: { 'data-style-lab-nav': 'true', 'data-style-lab-zone': 'rail' } },
                    { label: 'Join By Code', navAttrs: { 'data-style-lab-nav': 'true', 'data-style-lab-zone': 'rail' } },
                    { label: 'Withdraw', navAttrs: { 'data-style-lab-nav': 'true', 'data-style-lab-zone': 'rail' } },
                  ]}
                />

                <div className="menu-panel menu-panel--bevel pixel-surface rail-panel">
                  <div className="menu-header rail-label rail-label--bevel">Beveled Buttons</div>
                  <button type="button" className="menu-option demo-button style-lab__nav-button" data-style-lab-nav="true" data-style-lab-zone="rail">Confirm Fleet</button>
                  <button type="button" className="menu-option demo-button style-lab__nav-button" data-style-lab-nav="true" data-style-lab-zone="rail">Copy Code</button>
                  <button type="button" className="menu-option demo-button style-lab__nav-button" data-style-lab-nav="true" data-style-lab-zone="rail">Un-Confirm</button>
                </div>

                <VoidHeader level={4} className="zone-header">Utilities</VoidHeader>
                <div className="utility-link-list">
                  <UtilityLink
                    className="ui-button ui-button--bevel utility-link utility-link--large"
                    href="/bg-builder"
                    onNavigate={onBGBuilder}
                  >
                    Background
                  </UtilityLink>
                  <UtilityLink
                    className="ui-button ui-button--bevel utility-link utility-link--large"
                    href="/typography"
                    onNavigate={onTypography}
                  >
                    Typography
                  </UtilityLink>
                </div>

                <div className="utility-rail__spacer" />

                <UtilityLink
                  className="ui-button ui-button--bevel utility-link utility-link--large"
                  href="/"
                  onNavigate={onBack}
                >
                  Back
                </UtilityLink>
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
