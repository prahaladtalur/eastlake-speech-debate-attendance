import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { attendance, meetings, members } from "../../../db/schema";
import { insertAttendanceInBatches } from "../../../lib/attendance-batches.js";
import { attendanceRouteErrorMessage } from "../../../lib/attendance-errors.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMondayDate(value: string) {
  return new Date(`${value}T12:00:00Z`).getUTCDay() === 1;
}

async function ensureMeetingWithDefaults(
  db: ReturnType<typeof getDb>,
  meetingDate: string,
  countsTowardAttendance: boolean,
) {
  const timestamp = now();
  await db
    .insert(meetings)
    .values({ meetingDate, countsTowardAttendance, updatedAt: timestamp })
    .onConflictDoNothing({ target: meetings.meetingDate });

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.meetingDate, meetingDate))
    .limit(1);

  if (!meeting) throw new Error("Could not create the meeting.");

  const eligibleMembers = (await db.select().from(members)).filter(
    (member) => member.eligibleFrom <= meetingDate,
  );

  if (eligibleMembers.length > 0) {
    const attendanceRows = eligibleMembers.map((member) => ({
      meetingId: meeting.id,
      memberId: member.id,
      present: true,
      updatedAt: timestamp,
    }));

    await insertAttendanceInBatches(
      attendanceRows,
      (batch) =>
        db
          .insert(attendance)
          .values(batch)
          .onConflictDoNothing({
            target: [attendance.meetingId, attendance.memberId],
          }),
      (statements) =>
        db.batch(
          statements as [
            (typeof statements)[number],
            ...(typeof statements)[number][],
          ],
        ),
    );
  }

  return meeting.id;
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

const EVENT_TYPES = [
  "speech",
  "policy",
  "public_forum",
  "lincoln_douglas",
  "unassigned",
] as const;

type EventType = (typeof EVENT_TYPES)[number];

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPES.includes(value as EventType);
}

const GITHUB_PAGES_ORIGIN = "https://prahaladtalur.github.io";
const STUDENT_PAGES_ORIGIN = "https://eastlake-student-attendance.pages.dev";

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const isAllowedOrigin =
    !origin ||
    origin === GITHUB_PAGES_ORIGIN ||
    origin === STUDENT_PAGES_ORIGIN ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

  return {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": isAllowedOrigin
      ? origin || GITHUB_PAGES_ORIGIN
      : GITHUB_PAGES_ORIGIN,
    Vary: "Origin",
  };
}

function jsonResponse(request: Request, body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...corsHeaders(request), ...init?.headers },
  });
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const db = getDb();
    const [memberRows, meetingRows, attendanceRows] = await Promise.all([
      db.select().from(members).orderBy(asc(members.name), asc(members.id)),
      db
        .select()
        .from(meetings)
        .orderBy(desc(meetings.meetingDate), desc(meetings.id)),
      db.select().from(attendance).orderBy(desc(attendance.updatedAt)),
    ]);

    return jsonResponse(request, {
      members: memberRows,
      meetings: meetingRows,
      attendance: attendanceRows,
    });
  } catch (error) {
    return jsonResponse(request, { error: attendanceRouteErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      action?: string;
      name?: string;
      eventType?: string;
      memberId?: number;
      countsTowardAttendance?: boolean;
      eligibleFrom?: string;
      meetingDate?: string;
      present?: boolean;
      statuses?: Record<string, boolean>;
    };

    const db = getDb();

    if (payload.action === "add_member") {
      const name = cleanName(payload.name);
      const eventType: EventType = isEventType(payload.eventType)
        ? payload.eventType
        : "unassigned";
      const eligibleFrom = isDate(payload.eligibleFrom)
        ? payload.eligibleFrom
        : today();

      if (!name) {
        return jsonResponse(request, { error: "Enter a name first." }, { status: 400 });
      }

      if (name.length > 80) {
        return jsonResponse(request,
          { error: "Keep names under 80 characters." },
          { status: 400 },
        );
      }

      const currentMembers = await db.select().from(members);
      if (
        currentMembers.some(
          (member) => member.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      ) {
        return jsonResponse(request,
          { error: "That person is already on the roster." },
          { status: 409 },
        );
      }

      const [member] = await db
        .insert(members)
        .values({ name, eventType, eligibleFrom })
        .returning();

      return jsonResponse(request, { member }, { status: 201 });
    }

    if (payload.action === "update_member") {
      const memberId = Number(payload.memberId);
      if (!Number.isInteger(memberId) || memberId < 1) {
        return jsonResponse(request, { error: "Choose a valid person." }, { status: 400 });
      }

      if (!isEventType(payload.eventType) || payload.eventType === "unassigned") {
        return jsonResponse(request, { error: "Choose an event type." }, { status: 400 });
      }

      const [member] = await db
        .update(members)
        .set({ eventType: payload.eventType })
        .where(eq(members.id, memberId))
        .returning();

      if (!member) {
        return jsonResponse(request, { error: "That person is no longer on the roster." }, { status: 404 });
      }

      return jsonResponse(request, { member });
    }

    if (payload.action === "delete_member") {
      const memberId = Number(payload.memberId);
      if (!Number.isInteger(memberId) || memberId < 1) {
        return jsonResponse(request, { error: "Choose a valid person." }, { status: 400 });
      }

      const [member] = await db
        .delete(members)
        .where(eq(members.id, memberId))
        .returning();

      if (!member) {
        return jsonResponse(request, { error: "That person is no longer on the roster." }, { status: 404 });
      }

      return jsonResponse(request, { deleted: true, member });
    }

    if (payload.action === "ensure_meeting") {
      if (!isDate(payload.meetingDate) || !isMondayDate(payload.meetingDate)) {
        return jsonResponse(request,
          { error: "Choose a valid Monday meeting date." },
          { status: 400 },
        );
      }

      const eligibleMembers = (await db.select().from(members)).filter(
        (member) => member.eligibleFrom <= payload.meetingDate!,
      );
      if (eligibleMembers.length === 0) {
        return jsonResponse(request,
          { error: "Add at least one person before recording attendance." },
          { status: 400 },
        );
      }

      const meetingId = await ensureMeetingWithDefaults(
        db,
        payload.meetingDate,
        payload.countsTowardAttendance !== false,
      );
      return jsonResponse(request, { meetingId });
    }

    if (payload.action === "save_member_attendance") {
      if (!isDate(payload.meetingDate) || !isMondayDate(payload.meetingDate)) {
        return jsonResponse(request,
          { error: "Choose a valid Monday meeting date." },
          { status: 400 },
        );
      }

      const memberId = Number(payload.memberId);
      if (!Number.isInteger(memberId) || memberId < 1 || typeof payload.present !== "boolean") {
        return jsonResponse(request,
          { error: "Choose a person and mark them Here or Away." },
          { status: 400 },
        );
      }

      const [member] = await db
        .select()
        .from(members)
        .where(eq(members.id, memberId))
        .limit(1);
      if (!member || member.eligibleFrom > payload.meetingDate) {
        return jsonResponse(request,
          { error: "That person is not on the roster for this Monday." },
          { status: 404 },
        );
      }

      const [existingMeeting] = await db
        .select()
        .from(meetings)
        .where(eq(meetings.meetingDate, payload.meetingDate))
        .limit(1);
      const meetingId = existingMeeting?.id ?? await ensureMeetingWithDefaults(
        db,
        payload.meetingDate,
        true,
      );

      await db
        .insert(attendance)
        .values({
          meetingId,
          memberId,
          present: payload.present,
          updatedAt: now(),
        })
        .onConflictDoUpdate({
          target: [attendance.meetingId, attendance.memberId],
          set: { present: payload.present, updatedAt: now() },
        });

      return jsonResponse(request, { meetingId });
    }

    if (payload.action === "set_meeting_counted") {
      if (
        !isDate(payload.meetingDate) ||
        !isMondayDate(payload.meetingDate) ||
        typeof payload.countsTowardAttendance !== "boolean"
      ) {
        return jsonResponse(request,
          { error: "Choose a valid Monday and attendance setting." },
          { status: 400 },
        );
      }

      const eligibleMembers = (await db.select().from(members)).filter(
        (member) => member.eligibleFrom <= payload.meetingDate!,
      );
      if (eligibleMembers.length === 0) {
        return jsonResponse(request,
          { error: "Add at least one person before recording attendance." },
          { status: 400 },
        );
      }

      const meetingId = await ensureMeetingWithDefaults(
        db,
        payload.meetingDate,
        payload.countsTowardAttendance,
      );
      await db
        .update(meetings)
        .set({ countsTowardAttendance: payload.countsTowardAttendance, updatedAt: now() })
        .where(eq(meetings.id, meetingId));

      return jsonResponse(request, { meetingId });
    }

    if (payload.action === "save_meeting") {
      if (!isDate(payload.meetingDate)) {
        return jsonResponse(request,
          { error: "Choose a valid meeting date." },
          { status: 400 },
        );
      }

      if (!isMondayDate(payload.meetingDate)) {
        return jsonResponse(request,
          { error: "Meetings are scheduled for Mondays." },
          { status: 400 },
        );
      }

      const countsTowardAttendance =
        typeof payload.countsTowardAttendance === "boolean"
          ? payload.countsTowardAttendance
          : true;

      const statuses = payload.statuses ?? {};
      const currentMembers = await db.select().from(members);
      const eligibleMembers = currentMembers.filter(
        (member) => member.eligibleFrom <= payload.meetingDate!,
      );

      const [existingMeeting] = await db
        .select()
        .from(meetings)
        .where(eq(meetings.meetingDate, payload.meetingDate))
        .limit(1);

      const meetingWrite = existingMeeting
        ? db
            .update(meetings)
            .set({ updatedAt: now(), countsTowardAttendance })
            .where(eq(meetings.id, existingMeeting.id))
        : db
            .insert(meetings)
            .values({
              meetingDate: payload.meetingDate,
              countsTowardAttendance,
              updatedAt: now(),
            })
            .onConflictDoUpdate({
              target: meetings.meetingDate,
              set: { countsTowardAttendance, updatedAt: now() },
            });
      const attendanceRows = eligibleMembers.map((member) => ({
        meetingId:
          existingMeeting?.id ??
          sql<number>`(select ${meetings.id} from ${meetings} where ${meetings.meetingDate} = ${payload.meetingDate})`,
        memberId: member.id,
        present: statuses[String(member.id)] === true,
        updatedAt: now(),
      }));

      await insertAttendanceInBatches(
        attendanceRows,
        (batch) =>
          db
            .insert(attendance)
            .values(batch)
            .onConflictDoUpdate({
              target: [attendance.meetingId, attendance.memberId],
              set: {
                present: sql`excluded.present`,
                updatedAt: now(),
              },
            }),
        (statements) =>
          db.batch(
            statements as [
              (typeof statements)[number],
              ...(typeof statements)[number][],
            ],
          ),
        [meetingWrite],
      );

      const meetingId = existingMeeting?.id ?? (
        await db
          .select({ id: meetings.id })
          .from(meetings)
          .where(eq(meetings.meetingDate, payload.meetingDate))
          .limit(1)
      )[0]?.id;
      if (!meetingId) throw new Error("Could not save the meeting.");

      return jsonResponse(request, { meetingId });
    }

    return jsonResponse(request, { error: "Unknown attendance action." }, { status: 400 });
  } catch (error) {
    return jsonResponse(request, { error: attendanceRouteErrorMessage(error) }, { status: 500 });
  }
}
