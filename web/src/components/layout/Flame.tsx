/** 12px flame mark for the burn counter. Inline SVG in `currentColor`, decorative (the counter text carries the meaning). */
export function Flame({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M6.3 0.4c0.2 1.6-0.5 2.5-1.3 3.4C4.2 4.7 3 5.7 3 7.5 3 9.4 4.3 11 6.1 11c1.9 0 3.1-1.4 3.1-3.1 0-1.2-0.5-2-1.1-2.7-0.1 0.7-0.4 1.2-0.9 1.5 0.3-1.9-0.1-4-0.9-5.9z" />
    </svg>
  );
}
