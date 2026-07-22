import Image from "next/image";

export function NewWaveLogo({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  return (
    <span className={`new-wave-logo ${compact ? "logo-compact" : ""} ${inverted ? "logo-inverted" : ""}`}>
      <span className="logo-image-wrap">
        <Image src="/new-wave-logo.png" alt="New Wave Maritime Training and Assessment Center, Inc." width={compact ? 46 : 68} height={compact ? 46 : 68} priority />
      </span>
      {!compact && <span className="logo-copy"><strong>New Wave</strong><span>Maritime Training and Assessment Center, Inc.</span></span>}
    </span>
  );
}
