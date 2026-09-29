/** @param {unknown} error */
export function attendanceRouteErrorMessage(error) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${detail}`;

  if (combined.toLowerCase().includes("failed query:")) {
    return "Attendance could not be saved. Please try again; contact your coach if it continues.";
  }

  if (
    combined.includes("no such table") ||
    combined.includes("members") ||
    combined.includes("meetings") ||
    combined.includes("event_type") ||
    combined.includes("counts_toward_attendance")
  ) {
    return "Attendance storage is not ready yet. Publish the latest app version, then reload this page.";
  }

  return message;
}
