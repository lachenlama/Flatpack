"use client";

import { Chip, Table } from "../../components/ui/index.ts";

const rows = [
  { id: "NVDA", w: 30.1, units: "0.0482" },
  { id: "MSFT", w: 25, units: "0.0263" },
  { id: "GOOGL", w: 20, units: "0.0706" },
  { id: "META", w: 15, units: "0.0249" },
  { id: "MU", w: 9.9, units: "0.1181" },
];

/**
 * `Table` takes render functions, so it must be used from a client component (like this one). Server pages pass plain data
 * into a small client wrapper.
 */
export function DemoTable() {
  return (
    <Table
      caption="Sortable table"
      rowKey={(r) => r.id}
      rows={rows}
      defaultSort="w"
      columns={[
        { key: "id", header: "Token", cell: (r) => <Chip>{r.id}</Chip>, sortValue: (r) => r.id },
        { key: "w", header: "Weight", numeric: true, cell: (r) => `${r.w}%`, sortValue: (r) => r.w },
        { key: "u", header: "Units / share", numeric: true, cell: (r) => r.units },
      ]}
    />
  );
}
