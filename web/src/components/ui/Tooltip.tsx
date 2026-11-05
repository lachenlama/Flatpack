import { useId, type ReactNode } from "react";
import s from "./ui.module.css";

/**
 * CSS tooltip that also opens on keyboard focus. Wrap any focusable element, or use {@link InfoTip} for a "?" trigger.
 * @param content text shown on hover/focus (e.g. the source of a number)
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <span className={s.tipWrap} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className={s.tip}>
        {content}
      </span>
    </span>
  );
}

/** A small "i" button that reveals `content`. Use next to labels to cite where a number comes from. */
export function InfoTip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <button type="button" className={s.tipTrigger} aria-label="More information">
        i
      </button>
    </Tooltip>
  );
}
