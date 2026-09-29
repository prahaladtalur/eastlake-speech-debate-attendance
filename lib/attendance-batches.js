// D1 allows 100 bound parameters per statement; 20 rows leave room for query-level values.
export const ATTENDANCE_ROWS_PER_BATCH = 20;

/** @template T @param {readonly T[]} rows @returns {T[][]} */
export function chunkAttendanceRows(rows) {
  const batches = [];
  for (let index = 0; index < rows.length; index += ATTENDANCE_ROWS_PER_BATCH) {
    batches.push(rows.slice(index, index + ATTENDANCE_ROWS_PER_BATCH));
  }
  return batches;
}

/**
 * @template TRow, TStatement, TResult
 * @param {readonly TRow[]} rows
 * @param {(batch: TRow[]) => TStatement} createStatement
 * @param {(statements: TStatement[]) => Promise<TResult>} executeBatch
 * @param {TStatement[]} [leadingStatements=[]]
 * @returns {Promise<TResult | []>}
 */
export function insertAttendanceInBatches(
  rows,
  createStatement,
  executeBatch,
  leadingStatements = [],
) {
  if (rows.length === 0 && leadingStatements.length === 0) {
    return Promise.resolve([]);
  }

  // D1's batch API is transactional: one failed chunk rolls back every chunk.
  return executeBatch(
    [
      ...leadingStatements,
      ...chunkAttendanceRows(rows).map((batch) => createStatement(batch)),
    ],
  );
}
