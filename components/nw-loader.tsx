/* eslint-disable @next/next/no-img-element -- a small static emblem; next/image adds nothing here. */
/**
 * New Wave loader, "Rising Tide" (owner, 10 Nov 2026): the emblem fills with colour from the
 * bottom behind a moving wave edge. NwDots is the small version for buttons and inline text.
 */
export function NwLoader({ label = "Loading", sub }: { label?: string; sub?: string }) {
  return (
    <div className="nw-loader" role="status" aria-live="polite">
      <span className="nw-tide" aria-hidden="true">
        <img src="/new-wave-emblem.png" alt="" />
        <span className="nw-tide-fill"><span><img src="/new-wave-emblem.png" alt="" /></span></span>
      </span>
      <strong>{label} <NwDots /></strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function NwDots() {
  return <span className="nw-dots" aria-hidden="true"><i /><i /><i /></span>;
}
