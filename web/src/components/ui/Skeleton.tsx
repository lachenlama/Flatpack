import s from "./ui.module.css";

/** Loading placeholder block. `<Skeleton width={120} height={24} />` */
export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number | string }) {
  return <span className={s.skeleton} style={{ width, height }} aria-hidden="true" />;
}
