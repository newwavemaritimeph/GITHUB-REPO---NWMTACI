import Image from "next/image";

export function NewWaveLogo({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  return (
    <span className={`new-wave-logo ${compact ? "logo-compact" : ""} ${inverted ? "logo-inverted" : ""}`}>
      <span className="logo-image-wrap">
        {/* Emblem only (wheel and wave), cut from the supplied logo at 2x so it
            stays crisp in the 60px badge. The wordmark is set in HTML beside it.
            Served under /brand/ so no browser keeps painting an older file that
            once lived at the previous path. */}
        <Image src="/brand/new-wave-emblem.png" alt="New Wave Maritime Training and Assessment Center, Inc." width={compact ? 46 : 68} height={compact ? 46 : 68} priority unoptimized />
      </span>
      {!compact && <span className="logo-copy"><strong>New Wave</strong><span>Maritime Training and Assessment Center, Inc.</span></span>}
    </span>
  );
}
