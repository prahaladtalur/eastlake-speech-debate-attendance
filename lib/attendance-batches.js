// D1 allows 100 bound parameters per statement; 20 rows leaves room for query-level values.
export const ATTENDANCE_ROWS_PER_BATCH = 20;

/** @template T @param {readonly T[]} rows @returns {T[][]} */
export function chunkAttendanceRows(rows) {
  const batches = [];
  for (let index = 0; index < rows.length; index += ATTENDANCE_ROWS_PER_BATCH) {
    batches.push(rows.slice(index, index + ATTENDANCE_ROWS_PER_BATCH));
  }
  return batches;
}
