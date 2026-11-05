import type { ReactNode } from "react";
import s from "./ui.module.css";

/** Plain-English empty state with an optional call to action. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}
