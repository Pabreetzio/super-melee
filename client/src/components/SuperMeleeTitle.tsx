interface Props {
  className?: string;
}

export default function SuperMeleeTitle({ className = '' }: Props) {
  return (
    <h1 className={`super-melee-title ${className}`.trim()}>
      SUPER-MELEE
    </h1>
  );
}
