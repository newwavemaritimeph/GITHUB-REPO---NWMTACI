"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/* ------------------------------------------------------------------- toast */

type Toast = { id: number; tone: "success" | "info" | "warning" | "danger"; message: string };
const ToastContext = createContext<((tone: Toast["tone"], message: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <span aria-hidden="true">{toast.tone === "success" ? "✓" : toast.tone === "danger" ? "!" : toast.tone === "warning" ? "▲" : "i"}</span>
            <p>{toast.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return push ?? (() => undefined);
}

/* ------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-layer">
      <button className="modal-scrim" aria-label="Close dialog" onClick={onClose} />
      <div className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ drawer */

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-layer drawer-layer">
      <button className="modal-scrim" aria-label="Close panel" onClick={onClose} />
      <aside className="drawer-card" role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/* -------------------------------------------------------------- primitives */

export function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  const derived = tone ?? String(children).toLowerCase().replace(/[^a-z]+/g, "-");
  return <span className={`pill pill-${derived}`}>{children}</span>;
}

export function Field({
  label,
  hint,
  children,
  full = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`field ${full ? "field-full" : ""}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function EmptyState({ icon = "◎", title, text, action }: { icon?: string; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty-block">
      <span aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="segmented" role="tablist">
      {options.map((option) => (
        <button
          key={option}
          role="tab"
          aria-selected={option === value}
          className={option === value ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-input">
      <span aria-hidden="true">⌕</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search">
          ✕
        </button>
      )}
    </label>
  );
}

export function StatCard({
  label,
  value,
  note,
  tone = 0,
  icon = "↗",
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: number;
  icon?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className={`stat-icon tone-${tone % 6}`} aria-hidden="true">
        {icon}
      </div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {note && <small className="stat-note">{note}</small>}
    </>
  );
  if (onClick) {
    return (
      <button className="stat-card stat-clickable" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <article className="stat-card">{content}</article>;
}

export function DataTable({ columns, children, minWidth = 860 }: { columns: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="data-table">
      <table style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Avatar({ name, tone = "blue" }: { name: string; tone?: "blue" | "orange" }) {
  const label = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return <span className={`avatar avatar-${tone}`}>{label}</span>;
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" title={label}>
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

/* --------------------------------------------------------------- currency */

export function useMoneyInput(initial = "") {
  const [raw, setRaw] = useState(initial);
  const centavos = useMemo(() => {
    const parsed = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }, [raw]);
  return { raw, setRaw, centavos, reset: () => setRaw("") };
}
