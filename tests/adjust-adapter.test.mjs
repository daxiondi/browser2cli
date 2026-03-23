import test from "node:test";
import assert from "node:assert/strict";

const mod = await import(new URL("../dist/adapters/adjust-report-yesterday.js", import.meta.url));

test("selectPivotReport chooses the latest successful pivot_report response", () => {
  const picked = mod.selectPivotReport([
    { url: "https://suite.adjust.com/other", status: 200, response: {} },
    { url: "https://suite.adjust.com/reports-service/pivot_report", status: 500, response: { rows: [] } },
    { url: "https://suite.adjust.com/reports-service/pivot_report", status: 200, response: { rows: [{ day: "2026-03-22" }] } }
  ]);
  assert.equal(picked.status, 200);
  assert.equal(picked.response.rows[0].day, "2026-03-22");
});

test("extractRowsForDate filters rows for a target day across common date field names", () => {
  const rows = mod.extractRowsForDate(
    {
      rows: [
        { day: "2026-03-21", installs: 100 },
        { date: "2026-03-22", installs: 321 },
        { date_label: "2026-03-22", installs: 456 }
      ]
    },
    "2026-03-22"
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.installs), [321, 456]);
});

test("extractRowsForDate normalizes slash dates and datetime prefixes", () => {
  const rows = mod.extractRowsForDate(
    {
      rows: [
        { date: "2026/03/22", installs: 111 },
        { day: "2026-03-22T00:00:00Z", installs: 222 }
      ]
    },
    "2026-03-22"
  );
  assert.equal(rows.length, 2);
});
