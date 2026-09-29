import assert from "node:assert/strict";
import { attendanceRouteErrorMessage } from "../lib/attendance-errors.js";

assert.equal(
  attendanceRouteErrorMessage(
    new Error("Failed query: insert into attendance ... params: private values"),
  ),
  "Attendance could not be saved. Please try again; contact your coach if it continues.",
);
assert.equal(
  attendanceRouteErrorMessage(new Error("no such table: attendance")),
  "Attendance storage is not ready yet. Publish the latest app version, then reload this page.",
);
assert.equal(
  attendanceRouteErrorMessage(new Error("Database is temporarily unavailable")),
  "Database is temporarily unavailable",
);

console.log("PASS: server errors are sanitized without hiding setup guidance");
