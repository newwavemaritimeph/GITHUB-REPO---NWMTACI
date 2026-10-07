"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

type NavItem = readonly [label: string, href: string];

/**
 * Public header navigation with a real mobile toggle.
 *
 * Below the desktop breakpoint the links are hidden behind a button that
 * reports its state through aria-expanded, closes on Escape, and closes when a
 * link is chosen. Section links (any href with a #hash) are never marked as the
 * current page, so only the page itself gets the underline.
 */
export function PublicNav({ items, current }: { items: readonly NavItem[]; current: string }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      <nav id={menuId} aria-label="Public navigation" className={open ? "is-open" : undefined}>
        {items.map(([label, href]) => {
          const active = !href.includes("#") && href === current;
          return (
            <Link
              key={href}
              href={href}
              className={active ? "is-active" : undefined}
              aria-current={active ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
