import type { ElementType, HTMLAttributes, ReactNode } from "react";
import s from "./ui.module.css";

/** Props of {@link Card}. */
export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small caps heading inside the card. */
  title?: ReactNode;
  /** Element to render (default `section`). */
  as?: ElementType;
}

/** A paper-2 inset panel with a hairline border and optional small-caps title. */
export function Card({ title, as: Tag = "section", className, children, ...rest }: CardProps) {
  return (
    <Tag className={[s.card, className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {title ? <h3 className={s.cardTitle}>{title}</h3> : null}
      {children}
    </Tag>
  );
}
