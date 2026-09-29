"use client";

import Check from "lucide-react/dist/esm/icons/check.mjs";
import CircleHelp from "lucide-react/dist/esm/icons/circle-help.mjs";
import Download from "lucide-react/dist/esm/icons/download.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isMondayDate } from "@/lib/attendance-date";
import { cn } from "@/lib/utils";

const TARGET_PERCENT = 75;

const EVENT_TYPE_OPTIONS = [
  { value: "speech", label: "Speech" },
  { value: "policy", label: "Policy" },
  { value: "public_forum", label: "Public Forum" },
  { value: "lincoln_douglas", label: "Lincoln–Douglas" },
] as const;

const EVENT_TYPE_ORDER = [
  ...EVENT_TYPE_OPTIONS.map((option) => option.value),
  "unassigned",
] as const;

const ADMIN_TABS = [
  { value: "attendance", label: "Attendance" },
  { value: "roster", label: "Roster" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "history", label: "History" },
] as const;

type AdminTab = (typeof ADMIN_TABS)[number]["value"];

type EventType = (typeof EVENT_TYPE_ORDER)[number];

function isEventType(value: unknown): value is EventType {
  return (
    typeof value === "string" &&
    EVENT_TYPE_ORDER.includes(value as EventType)
  );
}

function eventTypeLabel(eventType: EventType) {
  return (
    EVENT_TYPE_OPTIONS.find((option) => option.value === eventType)?.label ??
    "Choose an event"
  );
}

function normalizeEventType(value: unknown): EventType {
  return isEventType(value) ? value : "unassigned";
}

type Member = {
  id: number;
  name: string;
  eventType: EventType;
  eligibleFrom: string;
  createdAt: string;
};

function groupMembersByEventType(memberList: Member[]) {
  return EVENT_TYPE_ORDER.map((eventType) => ({
    eventType,
    members: memberList.filter((member) => member.eventType === eventType),
  })).filter((group) => group.members.length > 0);
}

type Meeting = {
  id: number;
  meetingDate: string;
  countsTowardAttendance: boolean;
  createdAt: string;
  updatedAt: string;
};

type AttendanceRecord = {
  id: number;
  meetingId: number;
  memberId: number;
  present: boolean;
  updatedAt: string;
};

type MemberStats = {
  member: Member;
  firstPresentDate: string | null;
  eligibleMeetings: number;
  present: number;
  percent: number | null;
};

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

type WebMcpContext = {
  registerTool: (
    tool: WebMcpTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

function attendanceApiUrl() {
  const configuredBase =
    typeof window !== "undefined"
      ? (window as Window & { __EASTLAKE_API_BASE__?: string })
          .__EASTLAKE_API_BASE__
      : undefined;
  return configuredBase
    ? `${configuredBase.replace(/\/$/, "")}/api/attendance`
    : "/api/attendance";
}

function localDateString() {
  const date = new Date();
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function formatMeetingDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return date.toISOString().slice(0, 10);
}

function mondayDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  return addDays(value, -daysSinceMonday);
}

function recentMondays(value: string, count: number) {
  const currentMonday = mondayDate(value);
  return Array.from({ length: count }, (_, index) =>
    addDays(currentMonday, index * -7),
  );
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function statusLabel(percent: number | null) {
  if (percent === null) return "Not started";
  return percent >= TARGET_PERCENT ? "Passing" : "Below 75%";
}

function formatPercent(percent: number | null) {
  if (percent === null) return "—";
  const rounded = Number(percent.toFixed(1));
  if (percent < TARGET_PERCENT && rounded >= TARGET_PERCENT) {
    return `${Math.floor(percent * 100) / 100}%`;
  }
  return `${rounded}%`;
}

function statusTone(percent: number | null) {
  if (percent === null) return "text-slate-500";
  return percent >= TARGET_PERCENT ? "text-emerald-700" : "text-orange-700";
}

function meetingCountsTowardRate(meeting: Meeting) {
  return isMondayDate(meeting.meetingDate) && meeting.countsTowardAttendance;
}

function csvCell(value: string | number) {
  const text = String(value);
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function downloadAttendanceSpreadsheet(
  members: Member[],
  meetings: Meeting[],
  memberStatsById: Map<number, MemberStats>,
  attendanceLookup: Map<number, Map<number, boolean>>,
) {
  const sortedMeetings = [...meetings].sort((left, right) =>
    left.meetingDate.localeCompare(right.meetingDate),
  );
  const headers = [
    "Name",
    "Event",
    "First marked here",
    "Counted Mondays",
    "Here",
    "Attendance %",
    ...sortedMeetings.map(
      (meeting) =>
        `${formatDate(meeting.meetingDate)} (${meetingCountsTowardRate(meeting) ? "counted" : "not counted"})`,
    ),
  ];
  const rows = members.map((member) => {
    const stat = memberStatsById.get(member.id);
    return [
      member.name,
      eventTypeLabel(member.eventType),
      stat?.firstPresentDate ? formatDate(stat.firstPresentDate) : "Not started",
      stat?.eligibleMeetings ?? 0,
      stat?.present ?? 0,
      stat?.percent === null || stat?.percent === undefined
        ? "Not started"
        : formatPercent(stat.percent),
      ...sortedMeetings.map((meeting) => {
        const status = attendanceLookup.get(meeting.id)?.get(member.id);
        if (status !== undefined) return status ? "Here" : "Away";
        return meeting.meetingDate < member.eligibleFrom ? "Not on roster" : "Not recorded";
      }),
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `eastlake-attendance-${localDateString()}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function AttendanceApp({
  initialDate,
  initialView = "admin",
}: {
  initialDate: string;
  initialView?: "admin" | "student";
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [meetingDate, setMeetingDate] = useState(() => mondayDate(initialDate));
  const meetingDateRef = useRef(meetingDate);
  const [statuses, setStatuses] = useState<Record<number, boolean>>({});
  const [memberName, setMemberName] = useState("");
  const [newMemberEventType, setNewMemberEventType] =
    useState<EventType>("speech");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const attendanceSaveInFlight = useRef(false);
  const [adding, setAdding] = useState(false);
  const [updatingMemberId, setUpdatingMemberId] = useState<number | null>(null);
  const [deletingMemberId, setDeletingMemberId] = useState<number | null>(null);
  const [countsTowardAttendance, setCountsTowardAttendance] = useState(true);
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("attendance");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectMeetingDate = useCallback((value: string) => {
    if (attendanceSaveInFlight.current) return;
    if (!isMondayDate(value)) return;
    meetingDateRef.current = value;
    setMeetingDate(value);

    const url = new URL(window.location.href);
    url.searchParams.set("meeting", value);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(attendanceApiUrl(), { cache: "no-store" });
      const payload = (await response.json()) as {
        members?: Member[];
        meetings?: Meeting[];
        attendance?: AttendanceRecord[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load attendance.");
      }

      setMembers(
        (payload.members ?? []).map((member) => ({
          ...member,
          eventType: normalizeEventType(member.eventType),
        })),
      );
      setMeetings(
        (payload.meetings ?? []).map((meeting) => ({
          ...meeting,
          countsTowardAttendance: meeting.countsTowardAttendance !== false,
        })),
      );
      setAttendance(payload.attendance ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load attendance.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The initial load intentionally hydrates client state from the shared API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (initialView === "student") return;

    const context = (document as Document & { modelContext?: WebMcpContext })
      .modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const registerTools = async () => {
      await context.registerTool(
        {
          name: "add_roster_member",
          title: "Add roster member",
          description:
            "Add a named person and event type to the shared Eastlake Speech & Debate attendance roster.",
          inputSchema: {
            type: "object",
            properties: {
              name: { type: "string", minLength: 1 },
              eventType: {
                type: "string",
                enum: EVENT_TYPE_OPTIONS.map((option) => option.value),
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const value = input && typeof input === "object" ? input : {};
            const name =
              "name" in value && typeof value.name === "string"
                ? value.name.trim()
                : "";
            const eventType =
              "eventType" in value ? normalizeEventType(value.eventType) : "speech";
            if (!name) throw new Error("name is required");

            const response = await fetch(attendanceApiUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "add_member",
                name,
                eventType,
                eligibleFrom: localDateString(),
              }),
            });
            const payload = (await response.json()) as {
              member?: Member;
              error?: string;
            };
            if (!response.ok) {
              throw new Error(payload.error ?? "Could not add that person.");
            }
            await loadData();
            setNotice(`${name} is on the roster.`);
            return { added: true, member: payload.member };
          },
        },
        { signal: lifecycle.signal },
      );

      await context.registerTool(
        {
          name: "save_attendance",
          title: "Save attendance",
          description:
            "Save Here or Away attendance for one Eastlake Speech & Debate meeting date.",
          inputSchema: {
            type: "object",
            properties: {
              meetingDate: {
                type: "string",
                pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              },
              countsTowardAttendance: { type: "boolean" },
              statuses: {
                type: "object",
                additionalProperties: { type: "boolean" },
              },
            },
            required: ["meetingDate", "statuses"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const value = input && typeof input === "object" ? input : {};
            const date =
              "meetingDate" in value && typeof value.meetingDate === "string"
                ? value.meetingDate
                : "";
            const statusesValue =
              "statuses" in value &&
              value.statuses &&
              typeof value.statuses === "object"
                ? value.statuses
                : null;

            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
              !isMondayDate(date) ||
              !statusesValue ||
              Object.keys(statusesValue).length === 0
            ) {
              throw new Error(
                "A Monday meetingDate and at least one member status are required",
              );
            }
            if (
              Object.values(statusesValue).some(
                (status) => typeof status !== "boolean",
              )
            ) {
              throw new Error("statuses must map member ids to booleans");
            }

            const response = await fetch(attendanceApiUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "save_meeting",
                meetingDate: date,
                countsTowardAttendance:
                  "countsTowardAttendance" in value &&
                  typeof value.countsTowardAttendance === "boolean"
                    ? value.countsTowardAttendance
                    : true,
                statuses: statusesValue,
              }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) {
              throw new Error(payload.error ?? "Could not save attendance.");
            }
            selectMeetingDate(date);
            await loadData();
            setNotice(`Attendance saved for ${formatDate(date)}.`);
            return {
              saved: true,
              meetingDate: date,
              memberCount: Object.keys(statusesValue).length,
            };
          },
        },
        { signal: lifecycle.signal },
      );
    };

    void registerTools().catch(() => undefined);
    return () => lifecycle.abort();
  }, [initialView, loadData, selectMeetingDate]);

  const attendanceLookup = useMemo(() => {
    const lookup = new Map<number, Map<number, boolean>>();
    for (const record of attendance) {
      if (!lookup.has(record.meetingId)) {
        lookup.set(record.meetingId, new Map());
      }
      lookup.get(record.meetingId)?.set(record.memberId, Boolean(record.present));
    }
    return lookup;
  }, [attendance]);

  const mondayMeetings = useMemo(
    () => meetings.filter((meeting) => isMondayDate(meeting.meetingDate)),
    [meetings],
  );

  const selectedMeeting = useMemo(
    () =>
      mondayMeetings.find((meeting) => meeting.meetingDate === meetingDate),
    [meetingDate, mondayMeetings],
  );

  const meetingOptions = useMemo(() => {
    const dates = new Set([
      ...recentMondays(initialDate, 26),
      ...mondayMeetings.map((meeting) => meeting.meetingDate),
    ]);
    return [...dates].sort((left, right) => right.localeCompare(left));
  }, [initialDate, mondayMeetings]);

  const eligibleMembers = useMemo(
    () => members.filter((member) => member.eligibleFrom <= meetingDate),
    [meetingDate, members],
  );

  useEffect(() => {
    const savedStatuses = selectedMeeting
      ? attendanceLookup.get(selectedMeeting.id)
      : undefined;
    const nextStatuses: Record<number, boolean> = {};

    for (const member of eligibleMembers) {
      nextStatuses[member.id] = savedStatuses?.get(member.id) ?? !selectedMeeting;
    }

    // The saved record is the source of truth whenever the date or API data changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatuses(nextStatuses);
    setCountsTowardAttendance(selectedMeeting?.countsTowardAttendance ?? true);
  }, [attendanceLookup, eligibleMembers, selectedMeeting]);

  const memberStats = useMemo<MemberStats[]>(() => {
    return members.map((member) => {
      const countedMeetings = mondayMeetings.filter(
        (meeting) =>
          meetingCountsTowardRate(meeting) &&
          meeting.meetingDate >= member.eligibleFrom,
      );
      const firstPresentDate =
        countedMeetings
          .filter(
            (meeting) =>
              attendanceLookup.get(meeting.id)?.get(member.id) === true,
          )
          .map((meeting) => meeting.meetingDate)
          .sort()[0] ?? null;
      const eligibleMeetings = firstPresentDate
        ? countedMeetings.filter(
            (meeting) => meeting.meetingDate >= firstPresentDate,
          )
        : [];
      const present = eligibleMeetings.filter(
        (meeting) => attendanceLookup.get(meeting.id)?.get(member.id) === true,
      ).length;

      return {
        member,
        firstPresentDate,
        eligibleMeetings: eligibleMeetings.length,
        present,
      percent:
        eligibleMeetings.length === 0
          ? null
          : (present / eligibleMeetings.length) * 100,
      };
    });
  }, [attendanceLookup, members, mondayMeetings]);

  const eligibleMemberGroups = useMemo(
    () => groupMembersByEventType(eligibleMembers),
    [eligibleMembers],
  );

  const rosterGroups = useMemo(
    () => groupMembersByEventType(members),
    [members],
  );

  const memberStatsById = useMemo(
    () => new Map(memberStats.map((stat) => [stat.member.id, stat])),
    [memberStats],
  );

  const presentCount = eligibleMembers.filter(
    (member) => statuses[member.id] === true,
  ).length;

  const selectedStudent = members.find(
    (member) => member.id === selectedStudentId,
  );
  const selectedStudentStats = selectedStudent
    ? memberStatsById.get(selectedStudent.id)
    : undefined;

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = memberName.trim();
    if (!name) {
      setError("Enter a name first.");
      return;
    }

    setAdding(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(attendanceApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_member",
          name,
          eventType: newMemberEventType,
          eligibleFrom: localDateString(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not add that person.");
      }

      setMemberName("");
      setNewMemberEventType("speech");
      await loadData();
      setNotice(`${name} is on the roster.`);
    } catch (addError) {
      setError(
        addError instanceof Error
          ? addError.message
          : "Could not add that person.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function updateMemberEventType(memberId: number, eventType: EventType) {
    if (eventType === "unassigned") return;

    setUpdatingMemberId(memberId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(attendanceApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_member",
          memberId,
          eventType,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not update that event type.");
      }

      await loadData();
      setNotice("Event type updated.");
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Could not update that event type.",
      );
    } finally {
      setUpdatingMemberId(null);
    }
  }

  async function deleteMember(memberId: number) {
    const member = members.find((currentMember) => currentMember.id === memberId);
    if (!member) return;

    const confirmed = window.confirm(
      `Remove ${member.name} from the roster? Their saved attendance will also be deleted.`,
    );
    if (!confirmed) return;

    setDeletingMemberId(memberId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(attendanceApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_member", memberId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not remove that person.");
      }

      await loadData();
      setNotice(`${member.name} was removed from the roster.`);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not remove that person.",
      );
    } finally {
      setDeletingMemberId(null);
    }
  }

  async function saveAttendanceChange(
    action: "save_member_attendance" | "set_meeting_counted" | "ensure_meeting",
    fields: Record<string, string | number | boolean>,
    successMessage: string,
    rollback?: {
      statuses?: Record<number, boolean>;
      countsTowardAttendance?: boolean;
    },
  ) {
    if (attendanceSaveInFlight.current) return;
    if (eligibleMembers.length === 0) {
      setError("Add at least one person before recording attendance.");
      return;
    }

    const saveDate = meetingDate;
    attendanceSaveInFlight.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(attendanceApiUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          meetingDate: saveDate,
          ...fields,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save attendance.");
      }

      await loadData();
      setNotice(successMessage);
    } catch (saveError) {
      if (rollback && meetingDateRef.current === saveDate) {
        if (rollback.statuses) setStatuses(rollback.statuses);
        if (rollback.countsTowardAttendance !== undefined) {
          setCountsTowardAttendance(rollback.countsTowardAttendance);
        }
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save attendance.",
      );
    } finally {
      attendanceSaveInFlight.current = false;
      setSaving(false);
    }
  }

  function setMemberStatus(memberId: number, present: boolean) {
    if (attendanceSaveInFlight.current) return;
    const previousStatuses = statuses;
    const nextStatuses = { ...statuses, [memberId]: present };
    setStatuses(nextStatuses);
    setNotice("");
    void saveAttendanceChange(
      "save_member_attendance",
      { memberId, present },
      `Attendance saved for ${formatDate(meetingDate)}.`,
      { statuses: previousStatuses },
    );
  }

  function setMeetingCountsTowardAttendance(nextValue: boolean) {
    if (attendanceSaveInFlight.current) return;
    const previousValue = countsTowardAttendance;
    setCountsTowardAttendance(nextValue);
    setNotice("");
    void saveAttendanceChange(
      "set_meeting_counted",
      { countsTowardAttendance: nextValue },
      `Attendance settings saved for ${formatDate(meetingDate)}.`,
      { countsTowardAttendance: previousValue },
    );
  }

  function recordEveryoneHere() {
    void saveAttendanceChange(
      "ensure_meeting",
      { countsTowardAttendance },
      `Attendance recorded for ${formatDate(meetingDate)}.`,
    );
  }

  function sessionPresentCount(meeting: Meeting) {
    const savedStatuses = attendanceLookup.get(meeting.id);
    return members.filter(
      (member) =>
        member.eligibleFrom <= meeting.meetingDate &&
        savedStatuses?.get(member.id) === true,
    ).length;
  }

  if (initialView === "student") {
    return (
      <main className="min-h-screen bg-[#f7f8f8] text-slate-950">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="size-2.5 rounded-full bg-[#e8652b]" aria-hidden="true" />
              <div>
                <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">
                  Eastlake Speech &amp; Debate
                </h1>
                <p className="mt-0.5 text-sm text-slate-500">Student attendance</p>
              </div>
            </div>
            {selectedStudent ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedStudentId(null)}
              >
                Choose name
              </Button>
            ) : null}
          </div>
        </header>

        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
          {loading ? (
            <p className="text-sm text-slate-500" role="status">Loading roster…</p>
          ) : error ? (
            <p className="text-sm text-red-700" role="alert">{error}</p>
          ) : selectedStudent && selectedStudentStats ? (
            <section aria-labelledby="student-heading">
              <p className="text-sm font-medium text-slate-500">
                {eventTypeLabel(selectedStudent.eventType)}
              </p>
              <h2 id="student-heading" className="mt-1 text-2xl font-semibold tracking-tight">
                {selectedStudent.name}
              </h2>

              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm text-slate-500">Attendance</p>
                  <p className={cn("mt-1 text-2xl font-semibold", statusTone(selectedStudentStats.percent))}>
                    {formatPercent(selectedStudentStats.percent)}
                  </p>
                  <p className={cn("mt-1 text-xs font-medium", statusTone(selectedStudentStats.percent))}>
                    {statusLabel(selectedStudentStats.percent)}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm text-slate-500">Meetings here</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {selectedStudentStats.present} / {selectedStudentStats.eligibleMeetings}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-sm text-slate-500">Attendance started</p>
                  <p className="mt-1 text-lg font-semibold">
                    {selectedStudentStats.firstPresentDate
                      ? formatDate(selectedStudentStats.firstPresentDate)
                      : "Not started"}
                  </p>
                </div>
              </div>

              <div className="mt-8">
                <h3 className="text-lg font-semibold tracking-tight">Counted Mondays</h3>
                {selectedStudentStats.firstPresentDate ? (
                  <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                    {mondayMeetings
                      .filter(
                        (meeting) =>
                          meetingCountsTowardRate(meeting) &&
                          meeting.meetingDate >= selectedStudentStats.firstPresentDate!,
                      )
                      .sort((left, right) => left.meetingDate.localeCompare(right.meetingDate))
                      .map((meeting) => {
                        const present = attendanceLookup.get(meeting.id)?.get(selectedStudent.id);
                        return (
                          <li key={meeting.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                            <span className="font-medium text-slate-800">
                              {formatDate(meeting.meetingDate)}
                            </span>
                            <span className={present ? "font-medium text-emerald-700" : "text-slate-500"}>
                              {present === true ? "Here" : present === false ? "Away" : "Not recorded"}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    Your attendance starts after you are first marked Here at a counted Monday meeting.
                  </p>
                )}
              </div>
              <p className="mt-8 rounded-lg bg-white px-4 py-3 text-sm leading-6 text-slate-600">
                If something looks wrong, contact your coach.
              </p>
            </section>
          ) : members.length === 0 ? (
            <p className="text-sm text-slate-500">The roster is empty right now.</p>
          ) : (
            <section aria-labelledby="choose-student-heading">
              <h2 id="choose-student-heading" className="text-2xl font-semibold tracking-tight">
                Choose your name
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                View your attendance percentage and counted meeting history.
              </p>
              <div className="mt-6 space-y-5">
                {rosterGroups.map((group) => (
                  <section key={group.eventType} aria-label={eventTypeLabel(group.eventType)}>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                      {eventTypeLabel(group.eventType)}
                    </h3>
                    <ul className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
                      {group.members.map((member) => (
                        <li key={member.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-3 text-left font-medium transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#e8652b]"
                            onClick={() => setSelectedStudentId(member.id)}
                          >
                            {member.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <p className="mt-6 text-xs leading-5 text-slate-500">
                This page uses a name picker without sign-in. Anyone with the link can choose a name.
              </p>
            </section>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8f8] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="size-2.5 rounded-full bg-[#e8652b]" aria-hidden="true" />
            <div>
              <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">
                Eastlake Speech &amp; Debate
              </h1>
              <p className="mt-0.5 text-sm text-slate-500">Attendance</p>
            </div>
          </div>
          <a
            className="text-sm font-medium text-slate-600 underline-offset-4 hover:underline"
            href="?view=student"
          >
            Student view
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as AdminTab)}
          className="mt-1"
        >
          <TabsList
            variant="line"
            aria-label="Attendance sections"
            className="grid h-11 w-full grid-cols-4 gap-1 border-b border-slate-200 px-0"
          >
            {ADMIN_TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                aria-label={tab.label}
                className="min-w-0 px-1.5 text-xs sm:px-2 sm:text-sm"
              >
                {tab.value === "spreadsheet" ? (
                  <>
                    <span className="sm:hidden">Data</span>
                    <span className="hidden sm:inline">Spreadsheet</span>
                  </>
                ) : (
                  tab.label
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="attendance" className="mt-6 min-w-0">
            <section aria-labelledby="attendance-heading">
              <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 id="attendance-heading" className="text-2xl font-semibold tracking-tight">
                    Who&apos;s here?
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    Mark each person; changes save automatically. {TARGET_PERCENT}%+ is passing.
                  </p>
                </div>
                <div className="grid gap-3">
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                    <span>Monday meeting</span>
                    <select
                      aria-label="Monday meeting"
                      className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-xs outline-none transition focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300 sm:w-[260px]"
                      value={meetingDate}
                      disabled={saving || loading}
                      onChange={(event) => selectMeetingDate(event.target.value)}
                    >
                      {meetingOptions.map((date) => (
                        <option key={date} value={date}>
                          {formatMeetingDate(date)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={countsTowardAttendance}
                      disabled={saving || loading}
                      onChange={(event) => setMeetingCountsTowardAttendance(event.target.checked)}
                      className="mt-0.5 size-4 accent-[#e8652b]"
                    />
                    <span>Count this meeting toward attendance</span>
                  </label>
                </div>
              </div>

              {notice ? (
                <div
                  className="mt-4 flex items-center gap-2 text-sm text-emerald-700"
                  role="status"
                  aria-live="polite"
                >
                  <Check className="size-4" aria-hidden="true" />
                  {notice}
                </div>
              ) : null}
              {error ? (
                <div className="mt-4 flex items-start gap-2 text-sm leading-6 text-red-700" role="alert">
                  <CircleHelp className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="mt-7 flex items-center justify-between gap-4">
                <p className="text-sm font-semibold text-slate-700">
                  {presentCount} of {eligibleMembers.length} here
                </p>
                <p className="text-sm text-slate-500">
                  {selectedMeeting ? "Editing saved Monday" : "New Monday"}
                </p>
              </div>
              {!selectedMeeting ? (
                <p className="mt-2 text-xs text-amber-800">
                  Everyone starts marked Here. Mark absences Away; changes save automatically.
                </p>
              ) : null}

              {loading ? (
                <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200" aria-label="Loading attendance" role="status">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-16 animate-pulse bg-slate-100/70" />
                  ))}
                </div>
              ) : eligibleMembers.length === 0 ? (
                <div className="mt-3 border-y border-slate-200 py-10 text-sm text-slate-500">
                  Add someone below to start taking attendance.
                </div>
              ) : (
                <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                  {eligibleMemberGroups.map((group) => (
                    <div key={group.eventType}>
                      <div className="flex items-center justify-between gap-4 bg-slate-50/80 px-3 py-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                          {eventTypeLabel(group.eventType)}
                        </h3>
                        <span className="text-xs text-slate-400">
                          {group.members.length}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-200">
                        {group.members.map((member) => {
                          const present = statuses[member.id] === true;
                          return (
                            <div key={member.id} className="flex items-center justify-between gap-4 px-3 py-4">
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className={cn(
                                    "size-2 shrink-0 rounded-full",
                                    present ? "bg-emerald-500" : "bg-slate-300",
                                  )}
                                  aria-hidden="true"
                                />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-slate-900">{member.name}</p>
                                  <p className="mt-1 text-sm text-slate-500">
                                    {present ? "Here" : "Away"}
                                  </p>
                                </div>
                              </div>
                              <div
                                className="flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5"
                                aria-label={`Attendance for ${member.name}`}
                              >
                                <Button
                                  type="button"
                                  disabled={saving || loading}
                                  size="sm"
                                  aria-pressed={present}
                                  variant={present ? "default" : "ghost"}
                                  className={cn(
                                    "h-9 min-w-16 px-3",
                                    present
                                      ? "bg-[#08182b] text-white hover:bg-[#102844]"
                                      : "text-slate-600",
                                  )}
                                  onClick={() => setMemberStatus(member.id, true)}
                                >
                                  Here
                                </Button>
                                <Button
                                  type="button"
                                  disabled={saving || loading}
                                  size="sm"
                                  aria-pressed={!present}
                                  variant={!present ? "secondary" : "ghost"}
                                  className="h-9 min-w-16 px-3 text-slate-600"
                                  onClick={() => setMemberStatus(member.id, false)}
                                >
                                  Away
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!selectedMeeting ? (
                <Button
                  type="button"
                  size="lg"
                  className="mt-6 h-11 w-full bg-[#e8652b] text-white hover:bg-[#d95822]"
                  disabled={saving || loading || eligibleMembers.length === 0}
                  onClick={recordEveryoneHere}
                >
                  {saving ? <RefreshCw className="animate-spin" aria-hidden="true" /> : null}
                  {saving ? "Saving…" : "Record everyone Here"}
                </Button>
              ) : null}
            </section>

          </TabsContent>

          <TabsContent value="roster" className="mt-6 min-w-0">
            <section aria-labelledby="roster-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h3 id="roster-heading" className="text-lg font-semibold tracking-tight">
                    Roster
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Add anyone who should be counted.</p>
                </div>
                <span className="text-sm text-slate-500">
                  {members.length} {members.length === 1 ? "person" : "people"}
                </span>
              </div>

              <form
                className="mt-5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
                onSubmit={addMember}
              >
                <label className="sr-only" htmlFor="member-name">
                  Add a person
                </label>
                <Input
                  id="member-name"
                  className="bg-white"
                  placeholder="Name"
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  disabled={adding}
                />
                <label className="sr-only" htmlFor="member-event-type">
                  Event type
                </label>
                <select
                  id="member-event-type"
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-xs outline-none transition focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                  value={newMemberEventType}
                  onChange={(event) =>
                    setNewMemberEventType(normalizeEventType(event.target.value))
                  }
                  disabled={adding}
                >
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  size="default"
                  className="bg-[#08182b] text-white hover:bg-[#102844] sm:size-icon"
                  aria-label="Add person"
                  disabled={adding}
                >
                  <Plus aria-hidden="true" />
                  <span className="sm:hidden">Add person</span>
                </Button>
              </form>
              <p className="mt-2 text-xs text-slate-500">
                Choose an event. Attendance starts at the first counted Monday they are marked Here.
              </p>

              <ul className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
                {members.length === 0 ? (
                  <li className="py-4 text-sm text-slate-500">No one added yet.</li>
                ) : (
                  rosterGroups.map((group) => (
                    <li key={group.eventType}>
                      <div className="flex items-center justify-between gap-4 bg-slate-50/80 px-3 py-2.5">
                        <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                          {eventTypeLabel(group.eventType)}
                        </h4>
                        <span className="text-xs text-slate-400">
                          {group.members.length}
                        </span>
                      </div>
                      <div className="divide-y divide-slate-200">
                        {group.members.map((member) => {
                          const stat = memberStatsById.get(member.id);
                          if (!stat) return null;

                          return (
                            <div
                              key={member.id}
                              className="flex items-center justify-between gap-3 px-3 py-4"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-slate-900">
                                  {stat.member.name}
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  {stat.percent === null
                                    ? "No counted meeting marked Here yet"
                                    : `${stat.present} of ${stat.eligibleMeetings}, since ${formatShortDate(stat.firstPresentDate!)}`}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
                                <label className="sr-only" htmlFor={`event-type-${member.id}`}>
                                  Event type for {stat.member.name}
                                </label>
                                <select
                                  id={`event-type-${member.id}`}
                                  aria-label={`Event type for ${stat.member.name}`}
                                  value={stat.member.eventType}
                                  disabled={updatingMemberId === member.id}
                                  onChange={(event) =>
                                    void updateMemberEventType(
                                      member.id,
                                      normalizeEventType(event.target.value),
                                    )
                                  }
                                  className="h-8 max-w-[138px] rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-xs outline-none transition focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <option value="unassigned">Choose event</option>
                                  {EVENT_TYPE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <span
                                  className={cn(
                                    "min-w-16 text-right text-sm font-semibold",
                                    statusTone(stat.percent),
                                  )}
                                >
                                  <span className="block">
                                    {stat.percent === null ? "New" : formatPercent(stat.percent)}
                                  </span>
                                  {stat.percent === null ? null : (
                                    <span className="block text-xs font-medium">
                                      {statusLabel(stat.percent)}
                                    </span>
                                  )}
                                </span>
                                <Button
                                  type="button"
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Delete ${member.name}`}
                                  title={`Delete ${member.name}`}
                                  className="text-red-800 hover:bg-red-50 hover:text-red-900"
                                  disabled={deletingMemberId === member.id || updatingMemberId === member.id}
                                  onClick={() => void deleteMember(member.id)}
                                >
                                  {deletingMemberId === member.id ? (
                                    <RefreshCw className="animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Trash2 aria-hidden="true" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>

          </TabsContent>

          <TabsContent value="spreadsheet" className="mt-6 min-w-0">
            <section aria-labelledby="spreadsheet-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 id="spreadsheet-heading" className="text-lg font-semibold tracking-tight">
                    All attendance data
                  </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Every person and saved meeting, including meetings excluded from percentages.
                </p>
                <p className="mt-1 text-xs text-slate-500 sm:hidden">
                  Swipe sideways to see all meeting columns.
                </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={members.length === 0}
                  onClick={() => downloadAttendanceSpreadsheet(members, meetings, memberStatsById, attendanceLookup)}
                >
                  <Download aria-hidden="true" />
                  Export CSV
                </Button>
              </div>
              {members.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Add someone to see the spreadsheet.</p>
              ) : (
              <div
                className="mt-4 max-h-[480px] overflow-auto rounded-lg border border-slate-200 bg-white"
                role="region"
                aria-label="Attendance spreadsheet. Scroll horizontally to see all dates."
                tabIndex={0}
              >
                  <table className="min-w-full border-collapse text-left text-xs">
                    <caption className="sr-only">Complete attendance data by person and meeting</caption>
                    <thead className="sticky top-0 z-10 bg-slate-50 text-slate-600">
                      <tr>
                        <th scope="col" className="sticky left-0 z-20 min-w-36 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 font-semibold">Name</th>
                        <th scope="col" className="min-w-28 border-b border-r border-slate-200 px-3 py-2 font-semibold">Event</th>
                        <th scope="col" className="min-w-28 border-b border-r border-slate-200 px-3 py-2 font-semibold">First Here</th>
                        <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-3 py-2 font-semibold">Here / Counted</th>
                        <th scope="col" className="min-w-20 border-b border-r border-slate-200 px-3 py-2 font-semibold">Percent</th>
                        {meetings
                          .slice()
                          .sort((left, right) => left.meetingDate.localeCompare(right.meetingDate))
                          .map((meeting) => (
                            <th key={meeting.id} scope="col" className="min-w-24 border-b border-r border-slate-200 px-3 py-2 font-semibold">
                              {formatShortDate(meeting.meetingDate)}
                              <span className="mt-1 block font-normal text-slate-400">
                                {meetingCountsTowardRate(meeting) ? "Counted" : "Not counted"}
                              </span>
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {members.map((member) => {
                        const stat = memberStatsById.get(member.id);
                        return (
                          <tr key={member.id}>
                            <th scope="row" className="sticky left-0 border-r border-slate-200 bg-white px-3 py-2 font-medium text-slate-900">{member.name}</th>
                            <td className="border-r border-slate-100 px-3 py-2">{eventTypeLabel(member.eventType)}</td>
                            <td className="border-r border-slate-100 px-3 py-2">{stat?.firstPresentDate ? formatShortDate(stat.firstPresentDate) : "Not started"}</td>
                            <td className="border-r border-slate-100 px-3 py-2">{stat ? `${stat.present} / ${stat.eligibleMeetings}` : "—"}</td>
                            <td className="border-r border-slate-100 px-3 py-2">{formatPercent(stat?.percent ?? null)}</td>
                            {meetings
                              .slice()
                              .sort((left, right) => left.meetingDate.localeCompare(right.meetingDate))
                              .map((meeting) => {
                                const status = attendanceLookup.get(meeting.id)?.get(member.id);
                                const value = status !== undefined
                                  ? status ? "Here" : "Away"
                                  : meeting.meetingDate < member.eligibleFrom ? "Not on roster" : "Not recorded";
                                return <td key={meeting.id} className="border-r border-slate-100 px-3 py-2 text-slate-600">{value}</td>;
                              })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

          </TabsContent>

          <TabsContent value="history" className="mt-6 min-w-0">
            <section aria-labelledby="history-heading">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 id="history-heading" className="text-lg font-semibold tracking-tight">
                    Saved Mondays
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">Open an earlier Monday to edit it.</p>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Refresh attendance"
                  onClick={() => void loadData()}
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </div>

              {mondayMeetings.length === 0 ? (
                <p className="mt-5 text-sm text-slate-500">No saved Mondays yet.</p>
              ) : (
                <ul className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
                  {mondayMeetings.slice(0, 6).map((meeting) => {
                    const total = members.filter(
                      (member) => member.eligibleFrom <= meeting.meetingDate,
                    ).length;
                    return (
                      <li key={meeting.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                        <span className="font-medium text-slate-800">
                          {formatDate(meeting.meetingDate)}
                        </span>
                        <span className="flex items-center gap-3 text-slate-500">
                          {sessionPresentCount(meeting)} of {total} here
                          {!meetingCountsTowardRate(meeting) ? <span className="text-xs text-amber-700">Not counted</span> : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={saving || loading}
                            className="h-7 px-2 text-slate-500"
                            onClick={() => {
                              selectMeetingDate(meeting.meetingDate);
                              setActiveTab("attendance");
                            }}
                          >
                            Edit
                          </Button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
