import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { attendance, meetings, members } from "../../../db/schema";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function now() {
  return new Date().toISOString();
}

function routeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  const detail =
    error instanceof Error && error.cause instanceof Error
      ? error.cause.message
      : "";
  const combined = `${message}\n${detail}`;

  if (
    combined.includes("no such table") ||
    combined.includes("members") ||
    combined.includes("meetings")
  ) {
    return "Attendance storage is not ready yet. Publish the latest app version, then reload this page.";
  }

  return message;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export async function GET() {
  try {
    const db = getDb();
    const [memberRows, meetingRows, attendanceRows] = await Promise.all([
      db.select().from(members).orderBy(asc(members.name), asc(members.id)),
      db
        .select()
        .from(meetings)
        .orderBy(desc(meetings.meetingDate), desc(meetings.id))
        .limit(500),
      db.select().from(attendance).orderBy(desc(attendance.updatedAt)).limit(50000),
    ]);

    return Response.json({
      members: memberRows,
      meetings: meetingRows,
      attendance: attendanceRows,
    });
  } catch (error) {
    return Response.json({ error: routeErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      action?: string;
      name?: string;
      eligibleFrom?: string;
      meetingDate?: string;
      statuses?: Record<string, boolean>;
    };

    const db = getDb();

    if (payload.action === "add_member") {
      const name = cleanName(payload.name);
      const eligibleFrom = isDate(payload.eligibleFrom)
        ? payload.eligibleFrom
        : today();

      if (!name) {
        return Response.json({ error: "Enter a name first." }, { status: 400 });
      }

      if (name.length > 80) {
        return Response.json(
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
        return Response.json(
          { error: "That person is already on the roster." },
          { status: 409 },
        );
      }

      const [member] = await db
        .insert(members)
        .values({ name, eligibleFrom })
        .returning();

      return Response.json({ member }, { status: 201 });
    }

    if (payload.action === "save_meeting") {
      if (!isDate(payload.meetingDate)) {
        return Response.json(
          { error: "Choose a valid meeting date." },
          { status: 400 },
        );
      }

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

      let meetingId = existingMeeting?.id;
      if (meetingId) {
        await db
          .update(meetings)
          .set({ updatedAt: now() })
          .where(eq(meetings.id, meetingId));
      } else {
        const [meeting] = await db
          .insert(meetings)
          .values({ meetingDate: payload.meetingDate, updatedAt: now() })
          .returning();
        meetingId = meeting.id;
      }

      if (eligibleMembers.length > 0) {
        await db
          .insert(attendance)
          .values(
            eligibleMembers.map((member) => ({
              meetingId: meetingId!,
              memberId: member.id,
              present: statuses[String(member.id)] === true,
              updatedAt: now(),
            })),
          )
          .onConflictDoUpdate({
            target: [attendance.meetingId, attendance.memberId],
            set: {
              present: sql`excluded.present`,
              updatedAt: now(),
            },
          });
      }

      return Response.json({ meetingId });
    }

    return Response.json({ error: "Unknown attendance action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: routeErrorMessage(error) }, { status: 500 });
  }
}
