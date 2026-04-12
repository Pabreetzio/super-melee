import SuperMeleeTitle from './SuperMeleeTitle';
import StarfieldBG from './StarfieldBG';
import { loadConfig } from '../lib/starfield';

interface Props {
  onBack: () => void;
}

function FontLine({
  children,
  className = '',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`specimen-line ${className}`.trim()} style={style}>
      {children}
    </div>
  );
}

function LabSection({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children: React.ReactNode;
}) {
  return (
    <section className="specimen-panel">
      <h2 className="specimen-panel__title">{title}</h2>
      <div className="specimen-panel__meta">{meta}</div>
      {children}
    </section>
  );
}

export default function TypographyLab({ onBack }: Props) {
  const bgConfig = loadConfig();

  return (
    <div className="screen utility-screen utility-screen--scrolling">
      <StarfieldBG config={bgConfig} />

      <div className="utility-page specimen-page">
        <div className="specimen-page__header">
          <div className="specimen-page__intro">
            <SuperMeleeTitle />
            <p className="specimen-page__intro-copy">
              Typography utility for the extracted UQM bitmap fonts inside the SPA:
              Slides, StarCon, Tiny, and Micro.
            </p>
          </div>
          <a
            href="/styles"
            className="ui-button ui-button--bevel utility-link"
            onClick={e => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onBack();
            }}
          >
            Back
          </a>
        </div>

        <div className="specimen-grid">
          <LabSection title="UQMSlides" meta="Slides / intro-style title font">
            <FontLine className="font-slides" style={{ fontSize: '60px', color: '#ff66d9' }}>SUPER-MELEE</FontLine>
            <FontLine className="font-slides" style={{ fontSize: '38px', color: '#ffe38f' }}>THE UR-QUAN MASTERS</FontLine>
            <FontLine className="font-slides" style={{ fontSize: '34px', color: '#b6d9ff' }}>RETURN TO STARBASE</FontLine>

            <div className="specimen-caption">Scale test</div>
            <div className="specimen-box">
              <FontLine className="font-slides" style={{ fontSize: '18px', color: '#ffd0f2' }}>18px</FontLine>
              <FontLine className="font-slides" style={{ fontSize: '28px', color: '#ffd0f2' }}>28px</FontLine>
              <FontLine className="font-slides" style={{ fontSize: '40px', color: '#ffd0f2' }}>40px</FontLine>
              <FontLine className="font-slides" style={{ fontSize: '52px', color: '#ffd0f2' }}>52px</FontLine>
            </div>
          </LabSection>

          <LabSection title="UQMStarCon" meta="Race names / large UI headings">
            <FontLine className="font-starcon" style={{ fontSize: '52px', color: '#ff5fff' }}>SUPER-MELEE</FontLine>
            <FontLine className="font-starcon" style={{ fontSize: '36px' }}>SPATHI</FontLine>
            <FontLine className="font-starcon" style={{ fontSize: '36px' }}>ANDROSYNTH</FontLine>
            <FontLine className="font-starcon" style={{ fontSize: '36px' }}>UR-QUAN KZER-ZA</FontLine>
            <FontLine className="font-starcon" style={{ fontSize: '36px' }}>ZOQ-FOT-PIK</FontLine>
            <FontLine className="font-starcon" style={{ fontSize: '36px' }}>ARILOU LALEE&apos;LAY</FontLine>

            <div className="specimen-caption">Scale test</div>
            <div className="specimen-box">
              <FontLine className="font-starcon" style={{ fontSize: '9px', color: '#aef' }}>9px native</FontLine>
              <FontLine className="font-starcon" style={{ fontSize: '18px', color: '#aef' }}>18px 2x</FontLine>
              <FontLine className="font-starcon" style={{ fontSize: '27px', color: '#aef' }}>27px 3x</FontLine>
              <FontLine className="font-starcon" style={{ fontSize: '36px', color: '#aef' }}>36px 4x</FontLine>
            </div>

            <div className="specimen-caption">Menu labels</div>
            <div className="specimen-button-row">
              <span className="specimen-button font-starcon" style={{ fontSize: '14px' }}>Save</span>
              <span className="specimen-button font-starcon" style={{ fontSize: '14px' }}>Load</span>
              <span className="specimen-button font-starcon" style={{ fontSize: '14px' }}>Settings</span>
            </div>
          </LabSection>

          <LabSection title="UQMTiny" meta="Captain names / compact labels">
            <div className="specimen-box">
              <FontLine className="font-tiny" style={{ fontSize: '12px', color: '#fff' }}>ZEX&apos;S INTERN</FontLine>
              <FontLine className="font-tiny" style={{ fontSize: '12px', color: '#fff' }}>COMMANDER HAYES</FontLine>
              <FontLine className="font-tiny" style={{ fontSize: '12px', color: '#fff' }}>FWIFFO AGAIN</FontLine>
              <FontLine className="font-tiny" style={{ fontSize: '12px', color: '#fff' }}>READY FOR BATTLE</FontLine>
            </div>

            <div className="specimen-caption">Scaled up</div>
            <div className="specimen-box">
              <FontLine className="font-tiny" style={{ fontSize: '16px', color: '#ffd98a' }}>TOP FLEET</FontLine>
              <FontLine className="font-tiny" style={{ fontSize: '20px', color: '#ffd98a' }}>BOTTOM FLEET</FontLine>
              <FontLine className="font-tiny" style={{ fontSize: '24px', color: '#ffd98a' }}>OVERWRITE EXISTING NAME</FontLine>
            </div>

            <div className="specimen-caption">Status panel fit</div>
            <div className="status-specimen">
              <div className="font-starcon status-specimen__race">SPATHI</div>
              <div className="font-tiny status-specimen__captain">FWIFFO</div>
            </div>
          </LabSection>

          <LabSection title="UQMMicro" meta="Very small UI copy / labels">
            <div className="specimen-box">
              <FontLine className="font-micro" style={{ fontSize: '8px', color: '#b8ffd8' }}>CREW</FontLine>
              <FontLine className="font-micro" style={{ fontSize: '8px', color: '#ffb8b8' }}>BATT</FontLine>
              <FontLine className="font-micro" style={{ fontSize: '8px', color: '#c8d6ff' }}>P1 OR P2 CONTROLS NAVIGATE</FontLine>
              <FontLine className="font-micro" style={{ fontSize: '8px', color: '#c8d6ff' }}>LEFT FROM MENU ENTERS FLEET</FontLine>
            </div>

            <div className="specimen-caption">Micro scale ladder</div>
            <div className="specimen-box">
              <FontLine className="font-micro" style={{ fontSize: '8px', color: '#9fe8ff' }}>8px native</FontLine>
              <FontLine className="font-micro" style={{ fontSize: '12px', color: '#9fe8ff' }}>12px readable</FontLine>
              <FontLine className="font-micro" style={{ fontSize: '16px', color: '#9fe8ff' }}>16px enlarged</FontLine>
            </div>

            <div className="specimen-caption">Status labels</div>
            <div className="status-specimen">
              <div className="font-starcon status-specimen__race">CHMMR</div>
              <div className="font-tiny status-specimen__captain">CAPTAIN ZOG</div>
              <div className="font-micro status-specimen__labels">
                <span>CREW</span>
                <span>BATT</span>
              </div>
            </div>
          </LabSection>
        </div>

        <section className="specimen-panel specimen-page__section">
          <h2 className="specimen-panel__title">ASCII Check</h2>
          <div className="specimen-caption">Slides</div>
          <FontLine className="font-slides" style={{ fontSize: '30px' }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ</FontLine>
          <FontLine className="font-slides" style={{ fontSize: '30px' }}>abcdefghijklmnopqrstuvwxyz</FontLine>
          <FontLine className="font-slides" style={{ fontSize: '30px' }}>0123456789 !@#$%^&amp;*()-+=</FontLine>

          <div className="specimen-caption">StarCon</div>
          <FontLine className="font-starcon" style={{ fontSize: '24px' }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ</FontLine>
          <FontLine className="font-starcon" style={{ fontSize: '24px' }}>abcdefghijklmnopqrstuvwxyz</FontLine>
          <FontLine className="font-starcon" style={{ fontSize: '24px' }}>0123456789 !@#$%^&amp;*()-+=</FontLine>

          <div className="specimen-caption">Tiny</div>
          <FontLine className="font-tiny" style={{ fontSize: '16px' }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ</FontLine>
          <FontLine className="font-tiny" style={{ fontSize: '16px' }}>abcdefghijklmnopqrstuvwxyz</FontLine>
          <FontLine className="font-tiny" style={{ fontSize: '16px' }}>0123456789 !@#$%^&amp;*()-+=</FontLine>

          <div className="specimen-caption">Micro</div>
          <FontLine className="font-micro font-size-micro-display">ABCDEFGHIJKLMNOPQRSTUVWXYZ</FontLine>
          <FontLine className="font-micro font-size-micro-display">abcdefghijklmnopqrstuvwxyz</FontLine>
          <FontLine className="font-micro font-size-micro-display">0123456789 !@#$%^&amp;*()-+=</FontLine>
        </section>
      </div>
    </div>
  );
}
