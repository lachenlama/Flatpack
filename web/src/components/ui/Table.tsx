"use client";

import { useMemo, useState, type ReactNode } from "react";
import s from "./ui.module.css";

/** Column definition for {@link Table}. */
export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Provide to make the column sortable (number or string key). */
  sortValue?: (row: T) => number | string;
  /** Right-align and use mono tabular figures (numbers). */
  numeric?: boolean;
}

/** Props of {@link Table}. */
export interface TableProps<T> {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Accessible caption (visible, small). */
  caption?: ReactNode;
  /** Initial sort column key. */
  defaultSort?: string;
  /** Initial sort direction (default "desc"). */
  defaultDir?: "asc" | "desc";
}

/** A sortable, accessible data table (client component). Sorted columns announce `aria-sort`. */
export function Table<T>({ columns, rows, rowKey, caption, defaultSort, defaultDir = "desc" }: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ? { key: defaultSort, dir: defaultDir } : null);
  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return rows;
    const f = col.sortValue;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sign;
    });
  }, [rows, columns, sort]);

  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? s.right : ""}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : c.sortValue ? "none" : undefined}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      className={s.sortBtn}
                      onClick={() => setSort({ key: c.key, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
                    >
                      {c.header}
                      <span aria-hidden="true">{active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? `${s.right} ${s.mono}` : ""}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
