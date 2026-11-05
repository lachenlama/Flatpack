"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import s from "./ui.module.css";

/** Props of {@link Modal}. */
export interface ModalProps {
  open: boolean;
  /** Called on Esc / backdrop / close button. Omit with `dismissable={false}` for a blocking modal. */
  onClose?: () => void;
  title: string;
  /** Default true. When false there is no close button and Esc is ignored. */
  dismissable?: boolean;
  children: ReactNode;
}

/** Accessible modal built on the native <dialog> (focus trap, Esc, backdrop). */
export function Modal({ open, onClose, title, dismissable = true, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.modal}
      aria-label={title}
      onCancel={(e) => {
        if (!dismissable) e.preventDefault();
        else onClose?.();
      }}
      onClose={() => {
        if (open && dismissable) onClose?.();
      }}
    >
      <div className={s.modalHead}>
        <h2>{title}</h2>
        {dismissable ? (
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            {"✕"}
          </Button>
        ) : null}
      </div>
      {open ? children : null}
    </dialog>
  );
}
