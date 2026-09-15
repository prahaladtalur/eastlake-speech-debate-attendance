import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import AttendanceApp from "../app/attendance-app";
import "../app/globals.css";

const API_BASE_URL = "https://eastlake-speech-debate-attendance.dtalur.chatgpt.site";

function eastlakeDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

(window as Window & { __EASTLAKE_API_BASE__?: string }).__EASTLAKE_API_BASE__ =
  API_BASE_URL;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AttendanceApp initialDate={eastlakeDate()} />
  </StrictMode>,
);
