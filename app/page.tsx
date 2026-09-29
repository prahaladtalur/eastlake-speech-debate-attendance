import AttendanceApp from "./attendance-app";
import { getRequestedMondayDate } from "@/lib/attendance-date";

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

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const view = params?.view === "student" ? "student" : "admin";
  const initialDate = getRequestedMondayDate(params?.meeting, eastlakeDate());
  const initialEventType = Array.isArray(params?.event)
    ? params.event[0]
    : params?.event;

  return (
    <AttendanceApp
      initialDate={initialDate}
      initialView={view}
      initialEventType={initialEventType}
    />
  );
}
