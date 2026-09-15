"use client";

import {
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronRight,
  CircleHelp,
  ListChecks,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const TARGET_PERCENT = 75;

type Member = {
  id: number;
  name: string;
  eligibleFrom: string;
  createdAt: string;
};

type Meeting = {
  id: number;
  meetingDate: string;
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function statusLabel(percent: number | null) {
  if (percent === null) return "No sessions";
  return percent >= TARGET_PERCENT ? "Passing" : "Below 75%";
}

function statusClass(percent: number | null) {
  if (percent === null) return "border-slate-200 bg-slate-50 text-slate-500";
  return percent >= TARGET_PERCENT
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-orange-200 bg-orange-50 text-orange-700";
}

export default function AttendanceApp({ initialDate }: { initialDate: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [meetingDate, setMeetingDate] = useState(initialDate);
  const [statuses, setStatuses] = useState<Record<number, boolean>>({});
  const [memberName, setMemberName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/attendance", { cache: "no-store" });
      const payload = (await response.json()) as {
        members?: Member[];
        meetings?: Meeting[];
        attendance?: AttendanceRecord[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load attendance.");
      }

      setMembers(payload.members ?? []);
      setMeetings(payload.meetings ?? []);
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
    const context = (document as Document & { modelContext?: WebMcpContext })
      .modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const registerTools = async () => {
      await context.registerTool(
        {
          name: "add_roster_member",
          title: "Add roster member",
          description: "Add a named person to the shared Eastlake Speech & Debate attendance roster.",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string", minLength: 1 } },
            required: ["name"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const name =
              input && typeof input === "object" && "name" in input && typeof input.name === "string"
                ? input.name.trim()
                : "";
            if (!name) throw new Error("name is required");

            const response = await fetch("/api/attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "add_member", name, eligibleFrom: localDateString() }),
            });
            const payload = (await response.json()) as { member?: Member; error?: string };
            if (!response.ok) throw new Error(payload.error ?? "Could not add that person.");
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
          description: "Save Here or Away attendance for one Eastlake Speech & Debate meeting date.",
          inputSchema: {
            type: "object",
            properties: {
              meetingDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
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
            const date = "meetingDate" in value && typeof value.meetingDate === "string" ? value.meetingDate : "";
            const statusesValue = "statuses" in value && value.statuses && typeof value.statuses === "object" ? value.statuses : null;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !statusesValue || Object.keys(statusesValue).length === 0) {
              throw new Error("meetingDate and at least one member status are required");
            }
            if (Object.values(statusesValue).some((status) => typeof status !== "boolean")) {
              throw new Error("statuses must map member ids to booleans");
            }

            const response = await fetch("/api/attendance", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "save_meeting", meetingDate: date, statuses: statusesValue }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? "Could not save attendance.");
            setMeetingDate(date);
            await loadData();
            setNotice(`Attendance saved for ${formatDate(date)}.`);
            return { saved: true, meetingDate: date, memberCount: Object.keys(statusesValue).length };
          },
        },
        { signal: lifecycle.signal },
      );
    };

    void registerTools().catch(() => undefined);
    return () => lifecycle.abort();
  }, [loadData]);

  const attendanceLookup = useMemo(() => {
    const lookup = new Map<number, Map<number, boolean>>();
    for (const record of attendance) {
      if (!lookup.has(record.meetingId)) lookup.set(record.meetingId, new Map());
      lookup.get(record.meetingId)?.set(record.memberId, Boolean(record.present));
    }
    return lookup;
  }, [attendance]);

  const selectedMeeting = useMemo(
    () => meetings.find((meeting) => meeting.meetingDate === meetingDate),
    [meetingDate, meetings],
  );

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
      nextStatuses[member.id] = savedStatuses?.get(member.id) ?? false;
    }

    // The saved record is the source of truth whenever the date or API data changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatuses(nextStatuses);
  }, [attendanceLookup, eligibleMembers, selectedMeeting]);

  const memberStats = useMemo<MemberStats[]>(() => {
    return members.map((member) => {
      const eligibleMeetingIds = new Set(
        meetings
          .filter((meeting) => meeting.meetingDate >= member.eligibleFrom)
          .map((meeting) => meeting.id),
      );
      const present = attendance.filter(
        (record) =>
          record.memberId === member.id &&
          Boolean(record.present) &&
          eligibleMeetingIds.has(record.meetingId),
      ).length;
      const eligibleMeetings = eligibleMeetingIds.size;

      return {
        member,
        eligibleMeetings,
        present,
        percent:
          eligibleMeetings === 0
            ? null
            : Math.round((present / eligibleMeetings) * 100),
      };
    });
  }, [attendance, members, meetings]);

  const passingCount = memberStats.filter(
    (stat) => stat.percent !== null && stat.percent >= TARGET_PERCENT,
  ).length;
  const attentionCount = memberStats.filter(
    (stat) => stat.percent !== null && stat.percent < TARGET_PERCENT,
  ).length;
  const presentToday = eligibleMembers.filter(
    (member) => statuses[member.id] === true,
  ).length;

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
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
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_member",
          name,
          eligibleFrom: localDateString(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not add that person.");

      setMemberName("");
      await loadData();
      setNotice(`${name} is on the roster.`);
    } catch (addError) {
      setError(
        addError instanceof Error ? addError.message : "Could not add that person.",
      );
    } finally {
      setAdding(false);
    }
  }

  async function saveMeeting() {
    if (eligibleMembers.length === 0) {
      setError("Add at least one person before saving attendance.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_meeting",
          meetingDate,
          statuses: Object.fromEntries(
            eligibleMembers.map((member) => [
              String(member.id),
              statuses[member.id] === true,
            ]),
          ),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save attendance.");

      await loadData();
      setNotice(`Attendance saved for ${formatDate(meetingDate)}.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Could not save attendance.",
      );
    } finally {
      setSaving(false);
    }
  }

  function setMemberStatus(memberId: number, present: boolean) {
    setStatuses((current) => ({ ...current, [memberId]: present }));
    setNotice("");
  }

  function sessionPresentCount(meeting: Meeting) {
    const savedStatuses = attendanceLookup.get(meeting.id);
    return members.filter(
      (member) =>
        member.eligibleFrom <= meeting.meetingDate &&
        savedStatuses?.get(member.id) === true,
    ).length;
  }

  return (
    <main className="min-h-screen bg-[#f3f6f8] text-slate-950">
      <section className="overflow-hidden bg-[#08182b] text-white">
        <div className="mx-auto max-w-7xl px-4 pb-8 pt-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-8">
            <header className="flex items-start justify-between gap-5">
              <div className="flex items-center gap-3">
                <div className="grid size-11 place-items-center rounded-2xl bg-[#ef7540] shadow-[0_8px_24px_rgb(239_117_64/28%)]">
                  <ListChecks className="size-6" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-slate-300">
                    Eastlake Speech &amp; Debate
                  </p>
                  <p className="mt-1 text-sm text-slate-400">Shared attendance board</p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-slate-300">
                <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgb(52_211_153/12%)]" />
                <span className="hidden sm:inline">Anyone with the link can update</span>
                <span className="sm:hidden">Shared board</span>
              </div>
            </header>

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
              <div>
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-[#ffb48f]">
                  <span className="h-px w-8 bg-[#ef7540]" />
                  Keep the team on track
                </p>
                <h1 className="max-w-3xl text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                  Attendance, without the guesswork.
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                  Mark each practice once, then see who is meeting the 75% participation target.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                      The rule
                    </p>
                    <p className="mt-2 text-2xl font-semibold">75% or higher</p>
                  </div>
                  <ShieldCheck className="size-6 text-[#ff9c6d]" aria-hidden="true" />
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  A member passes when they are present for at least three out of every four recorded sessions since joining.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 pb-14 sm:px-6 lg:px-8">
        <section className="-mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Attendance summary">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgb(15_23_42/5%)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">Sessions logged</span>
              <CalendarDays className="size-4 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight">{meetings.length}</p>
            <p className="mt-1 text-xs text-slate-500">Every saved date counts</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-[0_12px_30px_rgb(15_23_42/4%)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-emerald-800">Passing 75%</span>
              <Check className="size-4 text-emerald-600" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-emerald-950">{passingCount}</p>
            <p className="mt-1 text-xs text-emerald-700">Ready for the requirement</p>
          </div>
          <div className="rounded-2xl border border-orange-200 bg-orange-50/80 p-4 shadow-[0_12px_30px_rgb(15_23_42/4%)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-orange-800">Need attention</span>
              <CircleHelp className="size-4 text-orange-600" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-orange-950">{attentionCount}</p>
            <p className="mt-1 text-xs text-orange-700">Below the target right now</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgb(15_23_42/5%)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-500">On today&apos;s sheet</span>
              <Users className="size-4 text-slate-400" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight">
              {presentToday}<span className="text-lg font-normal text-slate-400"> / {eligibleMembers.length}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{meetingDate ? formatDate(meetingDate) : "Choose a date"}</p>
          </div>
        </section>

        <div className="mt-8 flex flex-col gap-3">
          {notice ? (
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status" aria-live="polite">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {notice}
            </div>
          ) : null}
          {error ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800" role="alert">
              <CircleHelp className="mt-1 size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.17fr)_minmax(360px,0.83fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-[0_18px_42px_rgb(15_23_42/6%)]" aria-labelledby="attendance-heading">
            <div className="flex flex-col gap-5 border-b border-slate-100 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#d75b2c]">
                  <CalendarCheck2 className="size-4" aria-hidden="true" />
                  Check in
                </div>
                <h2 id="attendance-heading" className="mt-2 text-2xl font-semibold tracking-tight">Take attendance</h2>
                <p className="mt-1 text-sm text-slate-500">Choose a date, mark each person, then save.</p>
              </div>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                <span>Meeting date</span>
                <Input
                  aria-label="Meeting date"
                  className="h-11 w-full sm:w-[174px]"
                  type="date"
                  value={meetingDate}
                  onChange={(event) => setMeetingDate(event.target.value)}
                />
              </label>
            </div>

            <div className="p-5 sm:p-6">
              {loading ? (
                <div className="grid gap-3" aria-label="Loading attendance" role="status">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-[75px] animate-pulse rounded-2xl bg-slate-100" />
                  ))}
                </div>
              ) : eligibleMembers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
                  <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm">
                    <Users className="size-6" aria-hidden="true" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">Start with your roster</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    Add teammates in the roster panel. They will appear here and start counting from today.
                  </p>
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {eligibleMembers.map((member) => {
                    const present = statuses[member.id] === true;
                    return (
                      <div key={member.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-sm font-semibold", present ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500")}>
                            {member.name.slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">{member.name}</p>
                            <p className="text-xs text-slate-500">{present ? "Marked here" : "Not marked here"}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:w-[166px]">
                          <Button
                            type="button"
                            size="sm"
                            aria-pressed={present}
                            className={present ? "bg-emerald-600 text-white hover:bg-emerald-700" : "border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"}
                            variant={present ? "default" : "outline"}
                            onClick={() => setMemberStatus(member.id, true)}
                          >
                            <Check aria-hidden="true" />
                            Here
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            aria-pressed={!present}
                            className={!present ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100" : "border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"}
                            variant="outline"
                            onClick={() => setMemberStatus(member.id, false)}
                          >
                            <X aria-hidden="true" />
                            Away
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  {selectedMeeting ? "Editing the saved sheet for this date." : "This date will be added when you save."}
                </p>
                <Button
                  type="button"
                  size="lg"
                  className="bg-[#e8652b] text-white shadow-[0_8px_18px_rgb(232_101_43/20%)] hover:bg-[#d95822]"
                  disabled={saving || loading || eligibleMembers.length === 0}
                  onClick={saveMeeting}
                >
                  {saving ? <RefreshCw className="animate-spin" aria-hidden="true" /> : <CalendarCheck2 aria-hidden="true" />}
                  {saving ? "Saving…" : "Save attendance"}
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white shadow-[0_18px_42px_rgb(15_23_42/6%)]" aria-labelledby="roster-heading">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#d75b2c]">
                  <Users className="size-4" aria-hidden="true" />
                  Roster
                </div>
                <h2 id="roster-heading" className="mt-2 text-2xl font-semibold tracking-tight">Who is on track?</h2>
                <p className="mt-1 text-sm text-slate-500">Percentages update after each saved session.</p>
              </div>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">{members.length} {members.length === 1 ? "person" : "people"}</Badge>
            </div>

            <div className="p-5 sm:p-6">
              <form className="flex flex-col gap-2.5 sm:flex-row" onSubmit={addMember}>
                <label className="sr-only" htmlFor="member-name">Add a teammate</label>
                <Input
                  id="member-name"
                  placeholder="Add a teammate"
                  value={memberName}
                  onChange={(event) => setMemberName(event.target.value)}
                  disabled={adding}
                />
                <Button type="submit" className="bg-[#08182b] text-white hover:bg-[#102844]" disabled={adding}>
                  <Plus aria-hidden="true" />
                  {adding ? "Adding…" : "Add person"}
                </Button>
              </form>

              <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
                {members.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">Your first teammate will appear here.</div>
                ) : (
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="pl-4">Member</TableHead>
                        <TableHead>Record</TableHead>
                        <TableHead className="pr-4 text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {memberStats.map((stat) => (
                        <TableRow key={stat.member.id}>
                          <TableCell className="max-w-[140px] pl-4">
                            <p className="truncate font-medium text-slate-900">{stat.member.name}</p>
                            <p className="mt-0.5 text-xs text-slate-500">Since {formatShortDate(stat.member.eligibleFrom)}</p>
                          </TableCell>
                          <TableCell className="min-w-[110px]">
                            <div className="flex items-center gap-2">
                              <Progress value={stat.percent ?? 0} className={cn("h-1.5 bg-slate-100", stat.percent !== null && stat.percent >= TARGET_PERCENT ? "[&_[data-slot=progress-indicator]]:bg-emerald-500" : "[&_[data-slot=progress-indicator]]:bg-[#e8652b]")} />
                              <span className="w-10 text-right text-xs font-semibold text-slate-700">{stat.percent === null ? "—" : `${stat.percent}%`}</span>
                            </div>
                            <p className="mt-1 text-xs text-slate-500">{stat.present} / {stat.eligibleMeetings} present</p>
                          </TableCell>
                          <TableCell className="pr-4 text-right">
                            <Badge variant="outline" className={cn("text-xs", statusClass(stat.percent))}>{statusLabel(stat.percent)}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="rounded-3xl border border-slate-200 bg-white shadow-[0_18px_42px_rgb(15_23_42/5%)]" aria-labelledby="history-heading">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-5 sm:p-6">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#d75b2c]">
                  <CalendarDays className="size-4" aria-hidden="true" />
                  Recent sheets
                </div>
                <h2 id="history-heading" className="mt-2 text-2xl font-semibold tracking-tight">Saved sessions</h2>
              </div>
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Refresh attendance" onClick={() => void loadData()}>
                <RefreshCw aria-hidden="true" />
              </Button>
            </div>
            {meetings.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500 sm:px-6">Saved sessions will show up here after your first check-in.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5 sm:pl-6">Date</TableHead>
                    <TableHead>Here</TableHead>
                    <TableHead className="pr-5 text-right sm:pr-6">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {meetings.slice(0, 8).map((meeting) => {
                    const total = members.filter((member) => member.eligibleFrom <= meeting.meetingDate).length;
                    return (
                      <TableRow key={meeting.id}>
                        <TableCell className="pl-5 font-medium sm:pl-6">{formatDate(meeting.meetingDate)}</TableCell>
                        <TableCell className="text-slate-600">{sessionPresentCount(meeting)} / {total}</TableCell>
                        <TableCell className="pr-5 text-right sm:pr-6">
                          <Button type="button" size="sm" variant="ghost" className="text-slate-500 hover:text-slate-900" onClick={() => setMeetingDate(meeting.meetingDate)}>
                            Edit
                            <ChevronRight aria-hidden="true" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </section>

          <aside className="rounded-3xl border border-[#f3c3af] bg-[#fff7f3] p-5 shadow-[0_18px_42px_rgb(232_101_43/6%)] sm:p-6">
            <div className="grid size-10 place-items-center rounded-xl bg-[#ef7540] text-white">
              <CircleHelp className="size-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight">How the percentage works</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The app counts saved sessions from the date a member is added. Missing a saved session counts as away, so the roster always reflects the same shared record.
            </p>
            <div className="mt-5 rounded-2xl border border-[#f3c3af] bg-white/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#c35327]">Example</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                6 present out of 8 sessions = <span className="font-semibold text-slate-950">75%</span>, so that member is passing.
              </p>
            </div>
          </aside>
        </div>

        <footer className="mt-6 flex flex-col gap-2 border-t border-slate-200 px-1 pt-5 text-xs leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Eastlake Speech &amp; Debate · shared team record</span>
          <span>Anyone with this link can add people and update attendance.</span>
        </footer>
      </div>
    </main>
  );
}
