import { type PropsWithChildren, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        <span>C</span>
      </span>
      <span>
        <strong>キャラ好みラボ</strong>
        <small>好み観測装置</small>
      </span>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div>{action}</div>}
    </header>
  );
}

export function Card({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <section className={`card ${className}`.trim()}>{children}</section>;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: PropsWithChildren<{
  icon: string;
  title: string;
  action?: ReactNode;
}>) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Spinner({ label = "読み込み中" }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: PropsWithChildren<{ tone?: "info" | "warning" | "danger" | "success" }>) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: PropsWithChildren<{
  title: string;
  onClose(): void;
  wide?: boolean;
}>) {
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((item) => !item.hidden && item.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const inerted = [...document.body.children].filter((item) => item !== backdrop.current);
    for (const item of inerted) item.setAttribute("inert", "");
    document.addEventListener("keydown", handleKeyDown);
    const firstControl =
      dialog.current?.querySelector<HTMLElement>(
        "input:not([disabled]),select:not([disabled]),textarea:not([disabled])",
      ) ?? dialog.current?.querySelector<HTMLElement>("button:not([disabled])");
    if (firstControl) firstControl.focus();
    else dialog.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      for (const item of inerted) item.removeAttribute("inert");
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <div className="modal-backdrop" ref={backdrop}>
      <button type="button" className="modal-backdrop-dismiss" onClick={onClose} aria-label="ダイアログを終了" />
      <section
        ref={dialog}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
