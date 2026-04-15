import RailFitText from './RailFitText';

interface BlueMenuItem {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'default' | 'captain';
  className?: string;
  navAttrs?: Record<string, string>;
}

interface Props {
  items: BlueMenuItem[];
  className?: string;
  buttonClassName?: string;
}

export default function BlueMenuPanel({ items, className = '', buttonClassName = '' }: Props) {
  return (
    <div className={`menu-panel menu-panel--blue pixel-surface rail-panel ${className}`.trim()}>
      {items.map(item => (
        <button
          key={item.label}
          type="button"
          className={`menu-option demo-button ${item.tone === 'captain' ? 'menu-option--captain' : ''} ${buttonClassName} ${item.className ?? ''}`.trim()}
          onClick={item.onClick}
          disabled={item.disabled}
          aria-current={item.selected ? 'true' : undefined}
          {...item.navAttrs}
        >
          {item.tone === 'captain' ? (
            <RailFitText
              text={item.label}
              className="super-melee-menu-label super-melee-menu-label--captain"
              maxFontSize={18}
              minFontSize={10}
              lineHeight={1.15}
            />
          ) : (
            item.label
          )}
        </button>
      ))}
    </div>
  );
}
