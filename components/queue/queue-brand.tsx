/** Shared queue header pieces (Bright Wave): the logo with the name, and the wave band. */
export function QueueBrand({ sub }: { sub: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a small static logo; next/image adds nothing here
  return <div className="q-brand"><img src="/new-wave-emblem.png" alt="" /><div><b>New Wave Maritime</b><small>{sub}</small></div></div>;
}
export function QueueWave({ light = "#35CCFA", deep = "#0571D0" }: { light?: string; deep?: string }) {
  return <svg className="q-wave" viewBox="0 0 400 40" preserveAspectRatio="none" aria-hidden="true">
    <path d="M0 20 C 60 0, 120 40, 200 20 S 340 0, 400 20 L400 40 L0 40Z" fill={light} opacity=".45" />
    <path d="M0 28 C 80 10, 140 40, 220 26 S 340 14, 400 28 L400 40 L0 40Z" fill={deep} opacity=".35" />
  </svg>;
}
export function QueueHead({ sub, turn }: { sub: string; turn?: boolean }) {
  return <header className={`q-head${turn ? " turn" : ""}`}><QueueBrand sub={sub} /><QueueWave light={turn ? "#9EE3F1" : "#35CCFA"} deep={turn ? "#FFFFFF" : "#0571D0"} /></header>;
}
