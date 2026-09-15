"use client";

import {
  Check,
  CircleHelp,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function statusLabel(percent: number | null) {
  if (percent === null) return "New";
  return percent >= TARGET_PERCENT ? "Passing" : "Below 75%";
}

function statusTone(percent: number | null) {
  if (percent === null) return "text-slate-500";
  return percent >= TARGET_PERCENT ? "text-emerald-700" : "text-orange-700";
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
          description:
            "Add a named person to the shared Eastlake Speech & Debate attendance roster.",
          inputSchema: {
            type: "object",
            properties: { name: { type: "string", minLength: 1 } },
            required: ["name"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: async (input) => {
            const name =
              input &&
              typeof input === "object" &&
              "name" in input &&
              typeof input.name === "string"
                ? input.name.trim()
                : "";
            if (!name) throw new Error("name is required");

            const response = await fetch(attendanceApiUrl(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "add_member",
                name,
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
              !statusesValue ||
              Object.keys(statusesValue).length === 0
            ) {
              throw new Error(
                "meetingDate and at least one member status are required",
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
                statuses: statusesValue,
              }),
            });
            const payload = (await response.json()) as { error?: string };
            if (!response.ok) {
              throw new Error(payload.error ?? "Could not save attendance.");
            }
            setMeetingDate(date);
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
  }, [loadData]);

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

  const presentCount = eligibleMembers.filter(
    (member) => statuses[member.id] === true,
  ).length;

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
          eligibleFrom: localDateString(),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not add that person.");
      }

      setMemberName("");
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

  async function saveMeeting() {
    if (eligibleMembers.length === 0) {
      setError("Add at least one person before saving attendance.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(attendanceApiUrl(), {
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
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not save attendance.");
      }

      await loadData();
      setNotice(`Attendance saved for ${formatDate(meetingDate)}.`);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save attendance.",
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
          <span className="text-xs font-medium text-slate-500">Shared roster</span>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <section aria-labelledby="attendance-heading">
          <div className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="attendance-heading" className="text-2xl font-semibold tracking-tight">
                Who&apos;s here?
              </h2>
              <p className="mt-2 text-sm text-slate-500">
                Mark each person, then save. {TARGET_PERCENT}%+ is passing.
              </p>
            </div>
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              <span>Meeting date</span>
              <Input
                aria-label="Meeting date"
                className="h-10 w-full sm:w-[170px]"
                type="date"
                value={meetingDate}
                onChange={(event) => setMeetingDate(event.target.value)}
              />
            </label>
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
            <p className="text-sm font-medium text-slate-600">
              {presentCount} of {eligibleMembers.length} here
            </p>
            <p className="text-sm text-slate-500">
              {selectedMeeting ? "Editing saved date" : "New date"}
            </p>
          </div>

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
              {eligibleMembers.map((member) => {
                const present = statuses[member.id] === true;
                return (
                  <div key={member.id} className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{member.name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {present ? "Here" : "Away"}
                      </p>
                    </div>
                    <div
                      className="flex shrink-0 rounded-md border border-slate-200 bg-white p-0.5"
                      aria-label={`Attendance for ${member.name}`}
                    >
                      <Button
                        type="button"
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
          )}

          <Button
            type="button"
            size="lg"
            className="mt-6 h-11 w-full bg-[#e8652b] text-white hover:bg-[#d95822]"
            disabled={saving || loading || eligibleMembers.length === 0}
            onClick={saveMeeting}
          >
            {saving ? <RefreshCw className="animate-spin" aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Save attendance"}
          </Button>
        </section>

        <section aria-labelledby="roster-heading" className="mt-12 border-t border-slate-200 pt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h3 id="roster-heading" className="text-lg font-semibold tracking-tight">
                Roster
              </h3>
              <p className="mt-1 text-sm text-slate-500">Add anyone who should be counted.</p>
            </div>
            <span className="text-sm text-slate-500">{members.length} people</span>
          </div>

          <form className="mt-5 flex gap-2" onSubmit={addMember}>
            <label className="sr-only" htmlFor="member-name">
              Add a person
            </label>
            <Input
              id="member-name"
              placeholder="Name"
              value={memberName}
              onChange={(event) => setMemberName(event.target.value)}
              disabled={adding}
            />
            <Button
              type="submit"
              size="icon"
              className="bg-[#08182b] text-white hover:bg-[#102844]"
              aria-label="Add person"
              disabled={adding}
            >
              <Plus aria-hidden="true" />
            </Button>
          </form>
          <p className="mt-2 text-xs text-slate-500">
            New people start counting on the day they are added.
          </p>

          <ul className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
            {members.length === 0 ? (
              <li className="py-4 text-sm text-slate-500">No one added yet.</li>
            ) : (
              memberStats.map((stat) => (
                <li key={stat.member.id} className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">{stat.member.name}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {stat.present} of {stat.eligibleMeetings}, since {formatShortDate(stat.member.eligibleFrom)}
                    </p>
                  </div>
                  <span className={cn("shrink-0 text-right text-sm font-semibold", statusTone(stat.percent))}>
                    <span className="block">{stat.percent === null ? "New" : `${stat.percent}%`}</span>
                    {stat.percent === null ? null : (
                      <span className="block text-xs font-medium">{statusLabel(stat.percent)}</span>
                    )}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>

        <section aria-labelledby="history-heading" className="mt-12 border-t border-slate-200 pt-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 id="history-heading" className="text-lg font-semibold tracking-tight">
                Saved dates
              </h3>
              <p className="mt-1 text-sm text-slate-500">Open an earlier meeting to edit it.</p>
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

          {meetings.length === 0 ? (
            <p className="mt-5 text-sm text-slate-500">No saved dates yet.</p>
          ) : (
            <ul className="mt-5 divide-y divide-slate-200 border-y border-slate-200">
              {meetings.slice(0, 6).map((meeting) => {
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
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-slate-500"
                        onClick={() => setMeetingDate(meeting.meetingDate)}
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
      </div>
    </main>
  );
}
