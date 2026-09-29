"""Browser regression checks for the GitHub Pages attendance app.

Run after ``npm run build:github`` with:
    uv run --with playwright python tests/attendance_browser.py

The script serves the local ``docs`` build and mocks the shared API in memory.
It never sends writes to the live attendance database.
"""

from copy import deepcopy
from datetime import datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo
import json
import os

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
BASE_PATH = "/eastlake-speech-debate-attendance"
API_URL = "https://eastlake-speech-debate-attendance.dtalur.chatgpt.site/api/attendance"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def monday_dates():
    today = datetime.now(ZoneInfo("America/Los_Angeles")).date()
    current_monday = today - timedelta(days=today.weekday())
    return current_monday, lambda weeks: (current_monday - timedelta(weeks=weeks)).isoformat()


def make_fixture():
    current_monday, ago = monday_dates()
    alice_dates = [ago(3), ago(2), ago(1)]
    dates = sorted(alice_dates)

    members = [
        {"id": 1, "name": "Alice", "eventType": "speech", "eligibleFrom": ago(4), "createdAt": "2026-09-01"},
        {"id": 2, "name": "Bob", "eventType": "policy", "eligibleFrom": ago(4), "createdAt": "2026-09-01"},
    ]
    meetings = []
    attendance = []
    next_attendance_id = 1
    for meeting_id, meeting_date in enumerate(dates, start=1):
        counts = meeting_date != ago(1)
        meetings.append({
            "id": meeting_id,
            "meetingDate": meeting_date,
            "countsTowardAttendance": counts,
            "createdAt": meeting_date,
            "updatedAt": meeting_date,
        })
        for member in members:
            if meeting_date < member["eligibleFrom"]:
                continue
            if member["id"] == 2 and meeting_date == ago(2):
                continue
            if member["id"] == 1:
                present = meeting_date in (ago(2), ago(1))
            elif meeting_date == ago(1):
                present = True
            else:
                present = False
            attendance.append({
                "id": next_attendance_id,
                "meetingId": meeting_id,
                "memberId": member["id"],
                "present": present,
                "updatedAt": meeting_date,
            })
            next_attendance_id += 1

    return {
        "current_monday": current_monday.isoformat(),
        "saved_monday": ago(2),
        "members": members,
        "meetings": meetings,
        "attendance": attendance,
        "writes": [],
    }


def make_percentage_fixture(name, event_type, weeks, present_count):
    current_monday, ago = monday_dates()
    dates = [ago(week) for week in weeks]
    member = {
        "id": 1,
        "name": name,
        "eventType": event_type,
        "eligibleFrom": dates[0],
        "createdAt": dates[0],
    }
    meetings = [
        {
            "id": index,
            "meetingDate": meeting_date,
            "countsTowardAttendance": True,
            "createdAt": meeting_date,
            "updatedAt": meeting_date,
        }
        for index, meeting_date in enumerate(dates, start=1)
    ]
    attendance = [
        {
            "id": index,
            "meetingId": index,
            "memberId": 1,
            "present": index <= present_count,
            "updatedAt": meeting["meetingDate"],
        }
        for index, meeting in enumerate(meetings, start=1)
    ]
    return {
        "current_monday": current_monday.isoformat(),
        "members": [member],
        "meetings": meetings,
        "attendance": attendance,
        "writes": [],
    }


class PagesHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DOCS), **kwargs)

    def translate_path(self, path):
        request_path = unquote(urlsplit(path).path)
        if request_path == BASE_PATH:
            request_path = "/"
        elif request_path.startswith(f"{BASE_PATH}/"):
            request_path = request_path[len(BASE_PATH):]
        return super().translate_path(request_path)

    def log_message(self, _format, *_args):
        pass


def main():
    if not (DOCS / "index.html").exists():
        raise SystemExit("Run npm run build:github before this browser test.")

    fixture = make_fixture()
    server = ThreadingHTTPServer(("127.0.0.1", 0), PagesHandler)
    server_thread = Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    origin = f"http://127.0.0.1:{server.server_port}"
    cors = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }

    def ensure_fixture_meeting(meeting_date, counts_toward_attendance=True):
        meeting = next(
            (item for item in fixture["meetings"] if item["meetingDate"] == meeting_date),
            None,
        )
        if meeting is None:
            meeting = {
                "id": max((item["id"] for item in fixture["meetings"]), default=0) + 1,
                "meetingDate": meeting_date,
                "countsTowardAttendance": counts_toward_attendance,
                "createdAt": datetime.now().isoformat(),
                "updatedAt": datetime.now().isoformat(),
            }
            fixture["meetings"].append(meeting)
        for member in fixture["members"]:
            if member["eligibleFrom"] > meeting_date:
                continue
            existing = next(
                (
                    row
                    for row in fixture["attendance"]
                    if row["meetingId"] == meeting["id"] and row["memberId"] == member["id"]
                ),
                None,
            )
            if existing is None:
                fixture["attendance"].append({
                    "id": max((row["id"] for row in fixture["attendance"]), default=0) + 1,
                    "meetingId": meeting["id"],
                    "memberId": member["id"],
                    "present": True,
                    "updatedAt": datetime.now().isoformat(),
                })
        return meeting

    def handle_api(route):
        request = route.request
        if request.method == "OPTIONS":
            route.fulfill(status=204, headers=cors)
            return
        if request.method == "GET":
            route.fulfill(status=200, json={
                "members": deepcopy(fixture["members"]),
                "meetings": deepcopy(fixture["meetings"]),
                "attendance": deepcopy(fixture["attendance"]),
            }, headers=cors)
            return

        payload = request.post_data_json
        fixture["writes"].append(payload)
        action = payload["action"]
        status_code = 200
        response = {}
        if action == "ensure_meeting":
            meeting = ensure_fixture_meeting(
                payload["meetingDate"],
                payload.get("countsTowardAttendance", True),
            )
            response["meetingId"] = meeting["id"]
        elif action == "save_member_attendance":
            meeting = ensure_fixture_meeting(payload["meetingDate"])
            record = next(
                row for row in fixture["attendance"]
                if row["meetingId"] == meeting["id"] and row["memberId"] == payload["memberId"]
            )
            record["present"] = payload["present"]
            record["updatedAt"] = datetime.now().isoformat()
            response["meetingId"] = meeting["id"]
        elif action == "set_meeting_counted":
            meeting = ensure_fixture_meeting(
                payload["meetingDate"],
                payload["countsTowardAttendance"],
            )
            meeting["countsTowardAttendance"] = payload["countsTowardAttendance"]
            meeting["updatedAt"] = datetime.now().isoformat()
            response["meetingId"] = meeting["id"]
        elif action == "save_meeting":
            meeting_date = payload["meetingDate"]
            meeting = next((item for item in fixture["meetings"] if item["meetingDate"] == meeting_date), None)
            if meeting is None:
                meeting = {"id": max((item["id"] for item in fixture["meetings"]), default=0) + 1, "meetingDate": meeting_date}
                fixture["meetings"].append(meeting)
            meeting["countsTowardAttendance"] = payload.get("countsTowardAttendance", True)
            meeting["updatedAt"] = datetime.now().isoformat()
            response["meetingId"] = meeting["id"]
            for member in fixture["members"]:
                if member["eligibleFrom"] <= meeting_date:
                    existing = next((row for row in fixture["attendance"] if row["meetingId"] == meeting["id"] and row["memberId"] == member["id"]), None)
                    record = {
                        "id": existing["id"] if existing else max((row["id"] for row in fixture["attendance"]), default=0) + 1,
                        "meetingId": meeting["id"],
                        "memberId": member["id"],
                        "present": payload["statuses"].get(str(member["id"])) is True,
                        "updatedAt": datetime.now().isoformat(),
                    }
                    if existing:
                        existing.update(record)
                    else:
                        fixture["attendance"].append(record)
        elif action == "add_member":
            member = {
                "id": max((item["id"] for item in fixture["members"]), default=0) + 1,
                "name": payload["name"],
                "eventType": payload["eventType"],
                "eligibleFrom": payload["eligibleFrom"],
                "createdAt": datetime.now().isoformat(),
            }
            fixture["members"].append(member)
            response["member"] = member
            status_code = 201
        elif action == "delete_member":
            deleted_id = payload["memberId"]
            fixture["members"] = [item for item in fixture["members"] if item["id"] != deleted_id]
            fixture["attendance"] = [row for row in fixture["attendance"] if row["memberId"] != deleted_id]
            response["deleted"] = True
        elif action == "update_member":
            member = next(item for item in fixture["members"] if item["id"] == payload["memberId"])
            member["eventType"] = payload["eventType"]
            response["member"] = member
        else:
            route.fulfill(status=400, json={"error": "Unexpected test action"}, headers=cors)
            return
        route.fulfill(status=status_code, json=response, headers=cors)

    try:
        with sync_playwright() as playwright:
            launch = {"headless": True}
            if os.path.exists(CHROME):
                launch["executable_path"] = CHROME
            browser = playwright.chromium.launch(**launch)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            page.route(API_URL, handle_api)

            page.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            expect(page.get_by_role("heading", name="Who's here?")).to_be_visible()
            screenshot_dir = os.environ.get("ATTENDANCE_SCREENSHOT_DIR")
            if screenshot_dir:
                screenshot_path = Path(screenshot_dir)
                screenshot_path.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(screenshot_path / "desktop.png"), full_page=True)
                page.set_viewport_size({"width": 390, "height": 844})
                page.screenshot(path=str(screenshot_path / "mobile.png"), full_page=True)
                page.set_viewport_size({"width": 1280, "height": 900})
            expect(page.get_by_role("tablist", name="Attendance sections").get_by_role("tab")).to_have_count(4)
            debate_tabs = page.get_by_role("tablist", name="Debate type")
            expect(debate_tabs.get_by_role("tab")).to_have_count(4)
            for event_name in ("Speech", "Policy", "Public Forum", "Lincoln–Douglas"):
                expect(debate_tabs.get_by_role("tab", name=event_name)).to_be_visible()
            available_dates = page.get_by_label("Monday meeting").locator("option").evaluate_all(
                "options => options.map(option => option.value)"
            )
            one_year_out = (
                datetime.fromisoformat(fixture["current_monday"]) + timedelta(weeks=52)
            ).date().isoformat()
            assert one_year_out in available_dates, "The Monday picker should include the next year"
            page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Policy").click()
            expect(page.locator('[aria-label="Attendance for Bob"]')).to_be_visible()
            expect(page.locator('[aria-label="Attendance for Alice"]')).to_have_count(0)
            assert "event=policy" in page.url
            page.reload(wait_until="networkidle")
            expect(page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Policy")).to_have_attribute("aria-selected", "true")
            expect(page.locator('[aria-label="Attendance for Bob"]')).to_be_visible()
            page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Speech").click()
            page.get_by_role("tab", name="Attendance").focus()
            page.keyboard.press("ArrowRight")
            expect(page.get_by_role("tab", name="Roster")).to_have_attribute("aria-selected", "true")
            page.keyboard.press("ArrowLeft")
            expect(page.get_by_role("tab", name="Attendance")).to_have_attribute("aria-selected", "true")
            expect(page.get_by_role("button", name="Here").first).to_have_attribute("aria-pressed", "true")
            page.get_by_role("tab", name="Roster").click()
            expect(page.locator('section[aria-labelledby="roster-heading"]').get_by_text("100%", exact=True)).to_be_visible()
            expect(page.get_by_text("No counted meeting marked Here yet", exact=True)).to_be_visible()
            page.get_by_role("tab", name="Attendance").click()

            second_editor = context.new_page()
            second_editor.route(API_URL, handle_api)
            second_editor.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            page.locator('[aria-label="Attendance for Alice"]').get_by_role("button", name="Away").click()
            expect(page.get_by_text("Attendance saved", exact=False)).to_be_visible()
            second_editor.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Policy").click()
            second_editor.locator('[aria-label="Attendance for Bob"]').get_by_role("button", name="Away").click()
            expect(second_editor.get_by_text("Attendance saved", exact=False)).to_be_visible()
            page.reload(wait_until="networkidle")
            expect(page.locator('[aria-label="Attendance for Alice"] button').filter(has_text="Away")).to_have_attribute("aria-pressed", "true")
            page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Policy").click()
            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Away")).to_have_attribute("aria-pressed", "true")
            second_editor.close()

            fixture = make_fixture()
            page.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            expect(page.get_by_role("heading", name="Who's here?")).to_be_visible()

            page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Policy").click()
            page.get_by_label("Monday meeting").select_option(fixture["saved_monday"])
            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Away")).to_have_attribute("aria-pressed", "true")
            page.get_by_label("Monday meeting").select_option(fixture["current_monday"])
            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Here")).to_have_attribute("aria-pressed", "true")
            writes_before_marking_here = len(fixture["writes"])
            page.locator('[aria-label="Attendance for Bob"]').get_by_role("button", name="Away").click()
            expect(page.get_by_text("Attendance saved", exact=False)).to_be_visible()
            page.locator('[aria-label="Attendance for Bob"]').get_by_role("button", name="Here").click()
            expect(page.get_by_text("Attendance saved", exact=False)).to_be_visible()
            assert len(fixture["writes"]) == writes_before_marking_here + 2, "Marking Here should save immediately"
            current_meeting = next(item for item in fixture["meetings"] if item["meetingDate"] == fixture["current_monday"])
            bob_saved_row = next((row for row in fixture["attendance"] if row["meetingId"] == current_meeting["id"] and row["memberId"] == 2), None)
            assert bob_saved_row and bob_saved_row["present"] is True, f"Unexpected saved row: {bob_saved_row}; request: {fixture['writes'][-1]}"
            page.reload(wait_until="networkidle")
            assert page.get_by_label("Monday meeting").input_value() == fixture["current_monday"]
            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Here")).to_have_attribute("aria-pressed", "true")

            page.get_by_label("Monday meeting").select_option(fixture["saved_monday"])
            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Away")).to_have_attribute("aria-pressed", "true")
            page.locator('[aria-label="Attendance for Bob"]').get_by_role("button", name="Here").click()
            expect(page.get_by_text("Attendance saved", exact=False)).to_be_visible()
            page.reload(wait_until="networkidle")
            assert page.get_by_label("Monday meeting").input_value() == fixture["saved_monday"]
            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Here")).to_have_attribute("aria-pressed", "true")
            page.locator('[aria-label="Attendance for Bob"]').get_by_role("button", name="Away").click()
            expect(page.get_by_text("Attendance saved", exact=False)).to_be_visible()
            page.get_by_label("Monday meeting").select_option(fixture["current_monday"])

            expect(page.locator('[aria-label="Attendance for Bob"] button').filter(has_text="Here")).to_have_attribute("aria-pressed", "true")
            page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Speech").click()
            expect(page.locator('[aria-label="Attendance for Alice"] button').filter(has_text="Here")).to_have_attribute("aria-pressed", "true")
            page.locator('[aria-label="Attendance for Alice"]').get_by_role("button", name="Away").click()
            page.get_by_role("tablist", name="Debate type").get_by_role("tab", name="Policy").click()
            page.locator('[aria-label="Attendance for Bob"]').get_by_role("button", name="Away").click()
            page.get_by_label("Count this meeting toward attendance").uncheck()
            expect(page.get_by_text("Attendance settings saved", exact=False)).to_be_visible()
            assert fixture["meetings"][-1]["countsTowardAttendance"] is False
            page.get_by_role("tab", name="Roster").click()
            expect(page.locator('section[aria-labelledby="roster-heading"]').get_by_text("100%", exact=True)).to_be_visible()

            page.get_by_role("tab", name="Attendance").click()
            page.get_by_label("Count this meeting toward attendance").check()
            expect(page.get_by_text("Attendance settings saved", exact=False)).to_be_visible()
            page.get_by_role("tab", name="Roster").click()
            expect(page.locator('section[aria-labelledby="roster-heading"]').get_by_text("50%", exact=True)).to_be_visible()
            expect(page.get_by_text("No counted meeting marked Here yet", exact=True)).to_be_visible()

            page.get_by_role("tab", name="Spreadsheet").click()
            with page.expect_download() as download_event:
                page.get_by_role("button", name="Export CSV").click()
            download = download_event.value
            csv_path = download.path()
            csv_text = Path(csv_path).read_text(encoding="utf-8-sig")
            assert "not counted" in csv_text
            assert "Alice" in csv_text and "50%" in csv_text

            page.get_by_role("tab", name="Roster").click()
            page.locator("#member-name").fill("Cara")
            page.locator("#member-event-type").select_option("public_forum")
            page.get_by_role("button", name="Add person").click()
            roster = page.locator('section[aria-labelledby="roster-heading"]')
            expect(roster.get_by_text("Cara", exact=True)).to_be_visible()
            expect(page.get_by_role("heading", name="Public Forum")).to_be_visible()
            page.once("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Delete Cara").click()
            expect(roster.get_by_text("Cara", exact=True)).to_have_count(0)
            assert all(row["memberId"] != 5 for row in fixture["attendance"])

            page.get_by_role("tab", name="History").click()
            expect(page.get_by_role("heading", name="Saved Mondays")).to_be_visible()
            page.get_by_role("button", name="Edit").first.click()
            expect(page.get_by_role("tab", name="Attendance")).to_have_attribute("aria-selected", "true")

            writes_before_student_view = len(fixture["writes"])
            page.goto(f"{origin}{BASE_PATH}/?view=student", wait_until="networkidle")
            page.get_by_role("button", name="Alice", exact=True).click()
            expect(page.get_by_role("heading", name="Alice", exact=True)).to_be_visible()
            expect(page.get_by_text("50%", exact=True)).to_be_visible()
            expect(page.get_by_text("If something looks wrong", exact=False)).to_be_visible()
            expect(page.get_by_role("button", name="Save attendance")).to_have_count(0)
            expect(page.get_by_role("button", name="Delete Alice")).to_have_count(0)
            expect(page.get_by_role("button", name="Here")).to_have_count(0)
            assert len(fixture["writes"]) == writes_before_student_view

            fixture = make_fixture()
            incomplete_date = fixture["current_monday"]
            eligibility_date = (
                datetime.fromisoformat(incomplete_date) - timedelta(weeks=4)
            ).date().isoformat()
            fixture["members"] = [
                {
                    "id": member_id,
                    "name": f"Member {member_id}",
                    "eventType": ("speech", "policy", "public_forum", "lincoln_douglas")[(member_id - 1) % 4],
                    "eligibleFrom": eligibility_date,
                    "createdAt": eligibility_date,
                }
                for member_id in range(1, 44)
            ]
            fixture["meetings"] = [{
                "id": 4,
                "meetingDate": incomplete_date,
                "countsTowardAttendance": True,
                "createdAt": incomplete_date,
                "updatedAt": incomplete_date,
            }]
            fixture["attendance"] = [{
                "id": 1,
                "meetingId": 4,
                "memberId": 1,
                "present": False,
                "updatedAt": incomplete_date,
            }]
            page.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            fill_missing_button = page.get_by_role(
                "button", name="Fill missing attendance as Here"
            )
            expect(fill_missing_button).to_be_visible()
            fill_missing_button.click()
            expect(page.get_by_text("Attendance recorded", exact=False)).to_be_visible()
            assert len(fixture["attendance"]) == 43
            assert fixture["attendance"][0]["present"] is False, "Existing Away marks must be preserved"
            assert all(row["present"] for row in fixture["attendance"][1:])
            expect(page.get_by_role("button", name="Fill missing attendance as Here")).to_have_count(0)

            fixture = make_fixture()
            page.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            future_monday = (
                datetime.fromisoformat(fixture["current_monday"]) + timedelta(weeks=8)
            ).date().isoformat()
            page.get_by_label("Monday meeting").select_option(future_monday)
            page.get_by_role("button", name="Record everyone Here").click()
            expect(page.get_by_text("Attendance recorded", exact=False)).to_be_visible()
            current_meeting = next(
                item for item in fixture["meetings"]
                if item["meetingDate"] == future_monday
            )
            assert all(
                row["present"] is True
                for row in fixture["attendance"]
                if row["meetingId"] == current_meeting["id"]
            )
            page.reload(wait_until="networkidle")
            assert page.get_by_label("Monday meeting").input_value() == future_monday
            expect(page.locator('[aria-label="Attendance for Alice"] button').filter(has_text="Here")).to_have_attribute("aria-pressed", "true")

            fixture = make_percentage_fixture("Near Threshold", "public_forum", range(60, 9, -1), 38)
            page.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            page.get_by_role("tab", name="Roster").click()
            expect(page.locator('section[aria-labelledby="roster-heading"]').get_by_text("74.5%", exact=True)).to_be_visible()
            expect(page.get_by_text("Below 75%", exact=True)).to_be_visible()

            fixture = make_percentage_fixture("Exactly 75", "lincoln_douglas", (9, 8, 7, 6), 3)
            page.goto(f"{origin}{BASE_PATH}/", wait_until="networkidle")
            page.get_by_role("tab", name="Roster").click()
            expect(page.locator('section[aria-labelledby="roster-heading"]').get_by_text("75%", exact=True)).to_be_visible()
            expect(page.get_by_text("Passing", exact=True)).to_be_visible()

            print("PASS: debate tabs, future Mondays, batch-recovery UI, autosave, attendance rules, spreadsheet export, roster edits, and read-only student UI")
            browser.close()
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=2)


if __name__ == "__main__":
    main()
