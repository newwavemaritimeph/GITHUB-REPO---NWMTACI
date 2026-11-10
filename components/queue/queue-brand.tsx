/** Queue logo (Harbor Navy, owner 10 Nov 2026): the emblem in a white circle with a light cyan ring, then the name. */
export function QueueBadge() {
  // eslint-disable-next-line @next/next/no-img-element -- a small static logo; next/image adds nothing here
  return <span className="q-badge"><img src="/new-wave-emblem.png" alt="" /></span>;
}
export function QueueBrand({ sub }: { sub: string }) {
  return <div className="q-brand"><QueueBadge /><div className="q-brand-text"><b>New Wave Maritime</b><small>{sub}</small></div></div>;
}
/** The navy band at the top of the phone pages. */
export function QueueHead({ sub }: { sub: string }) {
  return <header className="q-head"><QueueBrand sub={sub} /></header>;
}
