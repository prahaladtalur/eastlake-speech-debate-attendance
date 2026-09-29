import assert from "node:assert/strict";
import {
  ATTENDANCE_ROWS_PER_BATCH,
  chunkAttendanceRows,
} from "../lib/attendance-batches.js";

const rows = Array.from({ length: 43 }, (_, index) => ({
  memberId: index + 1,
  present: true,
}));
const batches = chunkAttendanceRows(rows);
const D1_MAX_BOUND_PARAMETERS = 100;
const BOUND_PARAMETERS_PER_ATTENDANCE_ROW = 4;

assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 3]);
assert.deepEqual(batches.flat(), rows);
assert.ok(
  batches.every(
    (batch) =>
      batch.length <= ATTENDANCE_ROWS_PER_BATCH &&
      batch.length * BOUND_PARAMETERS_PER_ATTENDANCE_ROW <=
        D1_MAX_BOUND_PARAMETERS,
  ),
  "Each D1 insert must stay below its 100-parameter limit",
);
assert.deepEqual(chunkAttendanceRows([]), []);

console.log("PASS: 43 attendance rows split into safe 20-row batches");
