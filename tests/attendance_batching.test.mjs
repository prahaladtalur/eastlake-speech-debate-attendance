import assert from "node:assert/strict";
import {
  ATTENDANCE_ROWS_PER_BATCH,
  chunkAttendanceRows,
  insertAttendanceInBatches,
} from "../lib/attendance-batches.js";

const rows = Array.from({ length: 43 }, (_, index) => ({
  memberId: index + 1,
  present: true,
}));
const batches = chunkAttendanceRows(rows);
const D1_MAX_BOUND_PARAMETERS = 100;
const BOUND_PARAMETERS_PER_ATTENDANCE_ROW = 4;
const UPSERT_QUERY_LEVEL_PARAMETERS = 1;

assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 3]);
assert.deepEqual(batches.flat(), rows);
assert.ok(
  batches.every(
    (batch) =>
      batch.length <= ATTENDANCE_ROWS_PER_BATCH &&
      batch.length * BOUND_PARAMETERS_PER_ATTENDANCE_ROW +
        UPSERT_QUERY_LEVEL_PARAMETERS <=
        D1_MAX_BOUND_PARAMETERS,
  ),
  "Each D1 insert must stay below its 100-parameter limit",
);
assert.deepEqual(chunkAttendanceRows([]), []);

const createdStatements = [];
const savedRows = [];
const meetingWrite = { type: "meeting-upsert" };
await insertAttendanceInBatches(
  rows,
  (batch) => {
    createdStatements.push(batch);
    return batch;
  },
  async (statements) => {
    assert.equal(statements[0], meetingWrite);
    const transactionRows = [];
    for (const statement of statements.slice(1)) {
      transactionRows.push(...statement);
    }
    savedRows.push(...transactionRows);
  },
  [meetingWrite],
);
assert.equal(createdStatements.length, 3);
assert.deepEqual(savedRows, rows);

const rolledBackRows = [];
await assert.rejects(
  insertAttendanceInBatches(
    rows,
    (batch) => batch,
    async (statements) => {
      assert.equal(statements[0], meetingWrite);
      const transactionRows = [];
      for (const [index, statement] of statements.slice(1).entries()) {
        if (index === 1) throw new Error("simulated D1 batch failure");
        transactionRows.push(...statement);
      }
      rolledBackRows.push(...transactionRows);
    },
    [meetingWrite],
  ),
  /simulated D1 batch failure/,
);
assert.deepEqual(rolledBackRows, [], "failed transaction must not expose partial writes");

console.log("PASS: 43 attendance rows use safe, atomic 20-row D1 batches");
