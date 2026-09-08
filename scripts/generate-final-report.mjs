/**
 * Generates DIU SmartRoutine — Final Project Report (DOCX)
 * Run: node scripts/generate-final-report.mjs
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  PageNumber,
  Footer,
  Header,
  LevelFormat,
} from "docx";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "..", "DIU-SmartRoutine-Final-Project-Report.docx");

const navy = "0B3D5C";
const green = "1B7A4E";
const muted = "444444";

const border = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC" },
};

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 160, before: opts.before ?? 0, line: 276 },
    alignment: opts.align,
    ...opts,
    children: [
      new TextRun({
        text,
        font: "Calibri",
        size: opts.size ?? 22,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color ?? "222222",
      }),
    ],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, font: "Calibri", bold: true, size: 32, color: navy })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [new TextRun({ text, font: "Calibri", bold: true, size: 26, color: green })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, font: "Calibri", bold: true, size: 24, color: navy })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, font: "Calibri", size: 22, color: "222222" })],
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "numbers", level },
    spacing: { after: 80, line: 276 },
    children: [new TextRun({ text, font: "Calibri", size: 22, color: "222222" })],
  });
}

function cell(text, opts = {}) {
  return new TableCell({
    borders: border,
    width: { size: opts.width ?? 2340, type: WidthType.DXA },
    shading: opts.header ? { fill: "E8F0F5" } : undefined,
    children: [
      new Paragraph({
        spacing: { after: 40, before: 40 },
        children: [
          new TextRun({
            text,
            font: "Calibri",
            size: 18,
            bold: !!opts.header || !!opts.bold,
            color: opts.header ? navy : "222222",
          }),
        ],
      }),
    ],
  });
}

function table(headers, rows, colWidths) {
  const widths = colWidths || headers.map(() => Math.floor(9360 / headers.length));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({
        children: headers.map((h, i) => cell(h, { header: true, width: widths[i] })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => cell(String(c), { width: widths[i] })),
          }),
      ),
    ],
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 120 }, children: [] });
}

const children = [
  // Cover
  new Paragraph({ spacing: { before: 1200 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text: "DAFFODIL INTERNATIONAL UNIVERSITY",
        font: "Calibri",
        bold: true,
        size: 28,
        color: navy,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: "Department of English · B.A. (Hons) in English",
        font: "Calibri",
        size: 22,
        color: muted,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
    children: [
      new TextRun({
        text: "Daffodil Smart City · Summer 2026",
        font: "Calibri",
        size: 20,
        color: muted,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [
      new TextRun({
        text: "DIU SmartRoutine",
        font: "Calibri",
        bold: true,
        size: 56,
        color: navy,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 600 },
    children: [
      new TextRun({
        text: "Final Project Report",
        font: "Calibri",
        size: 36,
        color: green,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: "Complete Features, Functionalities & Technical Documentation",
        font: "Calibri",
        italics: true,
        size: 22,
        color: muted,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 800, after: 80 },
    children: [
      new TextRun({
        text: "Document type: Client Delivery / Final System Report",
        font: "Calibri",
        size: 20,
        color: muted,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [
      new TextRun({
        text: "Version: 1.0  ·  Seed: 3.0.0-diu-summer-2026",
        font: "Calibri",
        size: 20,
        color: muted,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({
        text: "Prepared for department demonstration & handover",
        font: "Calibri",
        size: 20,
        color: muted,
      }),
    ],
  }),

  // Page break via empty + heading
  new Paragraph({ children: [], pageBreakBefore: true }),

  h1("1. Executive Summary"),
  p(
    "DIU SmartRoutine is a full-stack campus class-scheduling platform built for the Department of English at Daffodil International University. It replaces static spreadsheet and PDF routines with live web portals for Students, Teachers, and the Chairman (super admin). The system supports conflict-aware timetable editing, constraint-based auto-generation, class cancel/reschedule with notices, free-room lookup, teacher appointments, analytics, PDF import/export, calendar (.ics) export, optional email (SMTP), Web Push notifications, Google Calendar sync, and Progressive Web App (PWA) install.",
  ),
  p(
    "The monorepo ships a React (Vite + TypeScript) frontend and an Express 5 + SQLite API. On first boot the API auto-seeds Summer 2026 English department data (faculty, courses, rooms, batches, demo students, and ~293 class entries). This report documents every major feature and functionality from A to Z for client delivery.",
  ),

  h1("2. Project Objectives"),
  numbered("Provide role-based portals for Student, Teacher, and Chairman with secure JWT login."),
  numbered("Maintain a live, searchable, day-filtered class routine instead of static documents."),
  numbered("Detect and prevent room / teacher / batch clashes when editing or generating schedules."),
  numbered("Allow teachers to cancel, change room, or reschedule with automatic student notices."),
  numbered("Enable students to find free rooms, browse faculty, book appointments, and optimize study preferences."),
  numbered("Give the Chairman full CRUD on catalog data, timetable operations, analytics, and Lab tools."),
  numbered("Support PDF import/export, calendar sync, optional professional email, and PWA install."),

  h1("3. System Overview"),
  h2("3.1 Architecture"),
  bullet("Frontend (frontend): React 19 SPA, Vite, React Router, CSS design system, PWA."),
  bullet("Backend (backend): Node.js 22.5+, Express 5, JWT auth, bcrypt passwords."),
  bullet("Database: SQLite file (backend/data/smartroutine.db) with auto-seed."),
  bullet("Dev: API on port 4000, Vite typically on 5173 (or next free port)."),
  bullet("Production: root npm start serves API + built static web (Render-ready)."),

  h2("3.2 Technology Stack"),
  table(
    ["Layer", "Technology"],
    [
      ["Frontend", "React 19, TypeScript, Vite 8, React Router 7"],
      ["UI / icons", "Custom CSS (DIU campus palette), Lucide icons"],
      ["PDF / calendar", "jsPDF, pdfjs, ics"],
      ["Backend", "Node.js ≥22.5, Express 5"],
      ["Database", "SQLite (node:sqlite)"],
      ["Auth", "JWT (jsonwebtoken), bcryptjs"],
      ["Email (optional)", "Nodemailer / Gmail SMTP, FormSubmit fallback"],
      ["Push (optional)", "web-push + VAPID"],
      ["Calendar (optional)", "Google Calendar OAuth (googleapis)"],
      ["PWA", "vite-plugin-pwa"],
    ],
    [2800, 6560],
  ),
  spacer(),

  h1("4. User Roles & Access Control"),
  table(
    ["Role", "Login", "Portal", "Primary powers"],
    [
      [
        "super_admin (Chairman)",
        "Username (e.g. Chairman)",
        "/admin",
        "Full CRUD, generate, conflicts, analytics, Lab, SMTP, password resets",
      ],
      [
        "teacher / teacher_admin",
        "Initial or email",
        "/teacher",
        "Own schedule, cancel/room/reschedule, appointments, notices, profile",
      ],
      [
        "student",
        "Email or student ID",
        "/student",
        "Batch schedule, rooms, optimize, appointments, attendance, profile",
      ],
    ],
    [2200, 2200, 1600, 3360],
  ),
  spacer(),
  p(
    "Routes are guarded by role: /admin requires super_admin only; /teacher requires teacher or teacher_admin; /student requires student. Unauthenticated users are sent to /login.",
  ),

  h1("5. Shared / Login Features"),
  bullet("Branded DIU Department of English login page with campus visual identity."),
  bullet("Username + password authentication with show/hide password."),
  bullet("Role-based redirect after successful login."),
  bullet("Connection mode indicator (Live API / Supabase / Offline demo)."),
  bullet("Light / dark theme toggle."),
  bullet("Offline banner and toast notifications."),
  bullet("Campus atmosphere UI (DIU navy–blue–green palette, glass surfaces)."),
  bullet("PWA install support from profile pages."),
  bullet("Bootstrap splash while catalog + timetable load."),
  bullet("JWT session (default ~12 hours); expired sessions prompt re-login."),

  h1("6. Student Portal — Features A to Z"),
  p("Bottom navigation: Schedule · Teacher · Room · Free · Optimize · Profile. Extra tools linked from Profile."),

  h2("6.1 Schedule (/student)"),
  bullet("View own batch weekly/day-filtered timetable."),
  bullet("See cancelled classes clearly marked."),
  bullet("Export schedule to .ics / calendar file."),
  bullet("Live data from API bootstrap / timetable."),

  h2("6.2 Teachers directory (/student/teacher)"),
  bullet("Search faculty by name or initial."),
  bullet("View today load and contact (email / phone when available)."),
  bullet("Expand today’s classes for a teacher."),
  bullet("Deep-link to book an appointment."),

  h2("6.3 Room search (/student/room)"),
  bullet("Search rooms by day and time slot."),
  bullet("Filter free vs busy rooms."),
  bullet("See who occupies a room in a given period."),

  h2("6.4 Free rooms (/student/free)"),
  bullet("List today’s free rooms by period slot."),
  bullet("Quick campus utility for finding empty classrooms."),

  h2("6.5 Study optimizer (/student/optimize)"),
  bullet("Set preferences: avoid early classes, prefer gaps, max daily load, prefer online."),
  bullet("Save preferences to API."),
  bullet("Receive scored tips / suggested study blocks."),

  h2("6.6 Attendance (/student/attendance)"),
  bullet("Scan QR / token for class attendance (live API)."),
  bullet("Linked from Profile for easy access."),

  h2("6.7 Notifications (/student/notifications)"),
  bullet("Batch-level and personal notices (e.g. cancel / reschedule)."),
  bullet("Mark notices as read."),

  h2("6.8 Appointments (/student/appointments)"),
  bullet("Request meeting with a teacher (date, time, purpose)."),
  bullet("Track pending / accepted / rejected status."),

  h2("6.9 Profile (/student/profile)"),
  bullet("Upload profile photo."),
  bullet("Theme toggle; Web Push subscribe/unsubscribe."),
  bullet("Shortcuts to notices, appointments, attendance."),
  bullet("One-time password change (then Chairman reset required)."),
  bullet("Google Calendar connect / sync (when configured)."),
  bullet("Install as PWA / app."),

  h1("7. Teacher Portal — Features A to Z"),
  p("Footer navigation: Desk · Meetings · Profile · Logout. Notifications reachable from Profile."),

  h2("7.1 Teacher Desk (/teacher)"),
  bullet("Own week schedule filtered by day."),
  bullet("Cancel a class with reason (notifies students)."),
  bullet("Change room to a free room only (clash-guarded)."),
  bullet("Reschedule to clash-free slots; adjust type/mode when allowed."),
  bullet("Calendar / .ics export."),
  bullet("Campus desk hero visual aligned with DIU branding."),

  h2("7.2 Appointments / Meetings (/teacher/appointments)"),
  bullet("View pending, accepted, and rejected requests."),
  bullet("Accept or reject with optional remarks."),
  bullet("Students receive status updates via notices / optional mail."),

  h2("7.3 Notifications (/teacher/notifications)"),
  bullet("Personal notices for class changes and appointment activity."),
  bullet("Mark as read."),

  h2("7.4 Profile (/teacher/profile)"),
  bullet("Photo upload, theme, push notifications."),
  bullet("One-time password change (Chairman can reset)."),
  bullet("Google Calendar connect / sync."),
  bullet("Install app; view basic teaching stats."),

  h1("8. Chairman / Admin Portal — Features A to Z"),
  p("Fixed left sidebar groups: Overview · People & catalog · Operations · Insights."),

  h2("8.1 Dashboard (/admin)"),
  bullet("Live counts: batches, students, teachers, classes."),
  bullet("Clash / conflict alert summary."),
  bullet("Quick links to Analytics, Timetable, Lab."),

  h2("8.2 Batches (/admin/batches)"),
  bullet("Create, edit, delete batches (name, session)."),
  bullet("Foundation for student assignment and timetable filters."),

  h2("8.3 Students (/admin/students)"),
  bullet("Full CRUD for students."),
  bullet("Assign / change batch."),
  bullet("Reset student password (restores ability to change once)."),

  h2("8.4 Teachers (/admin/teachers)"),
  bullet("Full CRUD for faculty records."),
  bullet("Set starting password on create."),
  bullet("Reset teacher password."),

  h2("8.5 Courses (/admin/courses)"),
  bullet("CRUD course catalog (code, title)."),

  h2("8.6 Rooms (/admin/rooms)"),
  bullet("CRUD classroom / room list used by timetable and free-room tools."),

  h2("8.7 Timetable (/admin/timetable)"),
  bullet("Filter by day, batch, and search text."),
  bullet("Add and delete class entries."),
  bullet("Server-side clash checks on write."),
  bullet("Export timetable PDF."),
  bullet("Import from PDF / JSON / CSV (replace or merge modes)."),

  h2("8.8 Conflicts (/admin/conflicts)"),
  bullet("Standing conflict checker for room, teacher, and batch clashes."),
  bullet("Filter by day; summary counts."),
  bullet("Jump to Timetable to fix issues."),

  h2("8.9 Generate (/admin/generate)"),
  bullet("Constraint-based auto-generator for selected batches."),
  bullet("Requirements, preferred days, load caps."),
  bullet("Options: morning preference, no back-to-back, avoid Friday."),
  bullet("Preview conflicts before apply."),
  bullet("Apply / replace generated schedule."),

  h2("8.10 Lab (/admin/lab)"),
  bullet("Advanced operations console (API-backed)."),
  bullet("What-if simulation."),
  bullet("Live occupancy / presence views."),
  bullet("Negotiations tooling."),
  bullet("Predictive load analytics."),
  bullet("Semester snapshots: save, restore, activate."),
  bullet("Audit log of sensitive operations."),
  bullet("Natural-language ops helpers (where enabled)."),
  bullet("QR attendance open / report tools."),

  h2("8.11 Notices (/admin/notices)"),
  bullet("Inbox of student and teacher notifications."),
  bullet("Audience filter; mark read."),
  bullet("Push-related status banner when configured."),

  h2("8.12 Analytics (/admin/analytics)"),
  bullet("Live KPIs and health percentage."),
  bullet("Class type / mode mix charts."),
  bullet("Heatmaps for scheduling density."),
  bullet("Teacher, room, and batch load breakdowns."),
  bullet("Conflict feed for operational awareness."),
  bullet("Panel titles and “How to read this page” guidance for demos."),

  h2("8.13 Profile (/admin/profile)"),
  bullet("Chairman identity and theme."),
  bullet("Conflict snapshot summary."),
  bullet("Professional email SMTP: save, test, clear."),
  bullet("Unlimited password changes for admin."),

  h1("9. Backend API Capabilities"),
  p("All business routes are under /api. Key capability areas:"),
  table(
    ["Area", "Capabilities"],
    [
      ["Health", "GET /api/health — DB, mail, push, Google Calendar status"],
      ["Auth", "Login, me, profile pic, change-password"],
      ["Bootstrap", "Catalog + timetable payload (role-scoped)"],
      ["Entities", "Batches, courses, rooms, teachers, students CRUD"],
      ["Timetable", "List/filter, free-rooms, conflicts, slots, CRUD, import, generate"],
      ["Notifications", "List + mark read; created on cancel/reschedule/appointments"],
      ["Appointments", "Student create; teacher/admin accept/reject"],
      ["Analytics", "Admin totals + Lab predictive endpoints"],
      ["Mail", "SMTP get/put/delete/test (super_admin)"],
      ["Push", "VAPID public key, subscribe, unsubscribe"],
      ["Google Calendar", "Status, OAuth URL, callback, sync, disconnect"],
      ["Lab / Advanced", "Audit, semesters, what-if, occupancy, attendance, optimize, NL ops"],
    ],
    [2800, 6560],
  ),
  spacer(),

  h1("10. Core Functional Flows"),
  h2("10.1 Login flow"),
  numbered("User opens /login and enters credentials."),
  numbered("API validates against bcrypt hash; returns JWT + role."),
  numbered("Frontend stores session and redirects to role portal."),
  numbered("Subsequent API calls send Bearer token; /auth/me refreshes profile."),

  h2("10.2 Cancel / reschedule flow (Teacher)"),
  numbered("Teacher selects a class on Desk."),
  numbered("Cancel with reason OR change room OR pick clash-free reschedule slot."),
  numbered("API validates clashes; updates timetable."),
  numbered("Notifications (and optional email/push) go to affected students."),

  h2("10.3 Appointment flow"),
  numbered("Student requests meeting with teacher, date/time, purpose."),
  numbered("Teacher accepts or rejects with remarks."),
  numbered("Both sides see updated status; notices updated."),

  h2("10.4 Generate flow (Chairman)"),
  numbered("Select batches and constraints on Generate page."),
  numbered("Preview proposed schedule and conflicts."),
  numbered("Apply/replace into live timetable when satisfied."),

  h2("10.5 Import / export flow"),
  numbered("Chairman exports PDF from Timetable for printing/sharing."),
  numbered("Import PDF/JSON/CSV with replace or merge to update data."),
  numbered("Students/teachers export personal .ics for external calendars."),

  h1("11. Security & Password Policy"),
  bullet("Passwords stored only as bcrypt hashes (≈10 rounds); never returned by API."),
  bullet("JWT Bearer authentication; set JWT_SECRET in production (dev fallback exists)."),
  bullet("Default token TTL ≈ 12 hours."),
  bullet("CORS: localhost allowed in development; production needs explicit CORS_ORIGIN."),
  bullet("New password must be at least 6 characters."),
  bullet("Students and teachers may change password once (has_changed_password); further changes require Chairman reset."),
  bullet("Admins may change password repeatedly."),
  bullet("Teacher timetable PATCH limited to allowed fields; writes blocked on clash."),
  bullet("Profile picture upload size capped (~900KB string)."),
  bullet("Do not commit .env, mail-smtp.json, or credentials.local.txt."),

  h1("12. Seed Data (Summer 2026)"),
  table(
    ["Item", "Value"],
    [
      ["Institution", "Daffodil International University"],
      ["Department / Program", "Department of English · B.A. (Hons) in English"],
      ["Campus / Term", "Daffodil Smart City · Summer 2026"],
      ["Timezone / Off day", "Asia/Dhaka · Friday off"],
      ["Periods", "08:30–10:00 … 16:00–17:30 (6 slots)"],
      ["Seed version", "3.0.0-diu-summer-2026"],
      ["Teachers (approx.)", "47"],
      ["Batches (approx.)", "10 (66th–58th + Retake/Special)"],
      ["Courses (approx.)", "35"],
      ["Rooms (approx.)", "10"],
      ["Demo students (approx.)", "45"],
      ["Timetable entries (approx.)", "293"],
      ["Source artifacts", "Faculty List.docx, COURSE LIST.docx, Summer 2026 (V-0.4).xlsx"],
    ],
    [3200, 6160],
  ),
  spacer(),
  p(
    "Auto-seed runs when the database is empty or seed version changes. npm run reset or FORCE_SEED=1 wipes and reseeds. Full credential list is written to gitignored credentials.local.txt on seed.",
  ),

  h1("13. Demo Login Patterns"),
  table(
    ["Role", "Username / Login", "Password pattern"],
    [
      ["Chairman", "Chairman", "Chairman123"],
      ["Teacher", "Faculty INITIAL (e.g. LS, EHE, ZTF, SLT)", "INITIAL + 123 (e.g. LS123, SLT123)"],
      ["Student", "Email (e.g. student01@diu.demo) or student ID", "12345678"],
    ],
    [2200, 4200, 2960],
  ),
  spacer(),
  p(
    "Exact credentials for a local DB appear in the API terminal on first seed and in credentials.local.txt. After a user changes password once, use Chairman reset pages or repair scripts if demos need seed passwords again.",
  ),

  h1("14. How to Run Locally"),
  numbered("Install Node.js 22.5+ (LTS recommended)."),
  numbered("cd DIU-SmartRoutine"),
  numbered("npm install"),
  numbered("npm run install:all"),
  numbered("npm run dev   (API :4000 + Vite :5173)"),
  numbered("Open http://localhost:5173 (or the port Vite prints if 5173 is busy)."),
  p(
    "Optional: configure Gmail SMTP / Google Calendar via .env or Chairman Profile (see SETUP.md). Deploy: build the web app and use npm start, or follow UPLOAD-AND-RUN.txt / Render scripts.",
  ),

  h1("15. Quality Assurance Snapshot"),
  p(
    "Before client delivery, automated and manual checks were exercised on this codebase. Representative results from the delivery preparation pass:",
  ),
  bullet("Core API smoke tests: passed (25/25)."),
  bullet("Conflict tests: passed (20/20)."),
  bullet("Generate tests: passed (18/18)."),
  bullet("Social / appointments tests: passed (14/14)."),
  bullet("Delivery E2E script: passed (43/43)."),
  bullet("Seed audit (source vs seed): 0 mismatches."),
  bullet("Frontend lint: clean exit; production build succeeded."),
  p(
    "Operators should re-run smoke / delivery scripts after any major data reset or environment change.",
  ),

  h1("16. Feature Index (A–Z Quick Reference)"),
  bullet("Analytics — Chairman KPIs, heatmaps, load, conflicts."),
  bullet("Appointments — Student request; teacher accept/reject."),
  bullet("Attendance — QR/token scan; Lab open/report."),
  bullet("Audit log — Lab sensitive-operation history."),
  bullet("Batches — Admin CRUD; student assignment."),
  bullet("Bootstrap — Single payload for catalog + timetable."),
  bullet("Calendar export — .ics for students/teachers."),
  bullet("Cancel class — Teacher cancel + notices."),
  bullet("Change room — Clash-free room swap."),
  bullet("Conflicts — Standing checker + write guards."),
  bullet("Courses — Catalog CRUD."),
  bullet("Dashboard — Chairman overview counts & alerts."),
  bullet("Dark / light theme — Global preference."),
  bullet("Email / SMTP — Professional mail config + test."),
  bullet("Free rooms — Student today-by-slot finder."),
  bullet("Generate — Constraint-based auto-scheduling."),
  bullet("Google Calendar — OAuth connect & sync."),
  bullet("Health check — API / integrations status."),
  bullet("Import timetable — PDF / JSON / CSV."),
  bullet("JWT auth — Role-scoped sessions."),
  bullet("Lab — What-if, occupancy, snapshots, NL ops."),
  bullet("Login — Branded role-aware authentication."),
  bullet("Notices — Batch & personal notifications."),
  bullet("Optimize — Student study preferences & tips."),
  bullet("Password policy — bcrypt + one-time change for non-admins."),
  bullet("PDF export — Timetable print/share."),
  bullet("Profile photos — Upload for student/teacher."),
  bullet("PWA — Installable web app."),
  bullet("Reschedule — Clash-free day/time moves."),
  bullet("Rooms — Admin CRUD + student search."),
  bullet("Seed data — Summer 2026 English department."),
  bullet("Students / Teachers — Admin people management + resets."),
  bullet("Timetable — Live CRUD, filters, import/export."),
  bullet("Web Push — Optional browser notifications."),

  h1("17. Deliverables Included with This System"),
  bullet("frontend — Frontend application source."),
  bullet("backend — Backend API + SQLite seed."),
  bullet("SETUP.md — Setup and optional integrations guide."),
  bullet("UPLOAD-AND-RUN.txt — Quick upload / run notes."),
  bullet("scripts/ — Smoke, delivery E2E, seed audit, repair helpers."),
  bullet("This Final Project Report (DOCX)."),

  h1("18. Conclusion"),
  p(
    "DIU SmartRoutine delivers an end-to-end departmental routine management system: secure multi-role portals, conflict-aware scheduling, generation and import tools, student utilities (rooms, optimize, appointments), teacher operational controls, and Chairman analytics/Lab oversight. Optional mail, push, and Google Calendar integrations extend communication beyond the browser. With Summer 2026 English seed data and documented demo logins, the system is ready for department demonstration and handover.",
  ),
  p("— End of Report —", { align: AlignmentType.CENTER, italics: true, color: muted, before: 400 }),
];

const doc = new Document({
  creator: "DIU SmartRoutine",
  title: "DIU SmartRoutine — Final Project Report",
  description: "Complete features and functionalities report for DIU SmartRoutine",
  styles: {
    default: {
      document: {
        styles: [],
      },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
      {
        reference: "numbers",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 900, bottom: 900, left: 1000, right: 1000 },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: "DIU SmartRoutine · Final Project Report",
                  font: "Calibri",
                  size: 16,
                  color: "888888",
                  italics: true,
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: "Page ", font: "Calibri", size: 16, color: "666666" }),
                new TextRun({ children: [PageNumber.CURRENT], font: "Calibri", size: 16, color: "666666" }),
                new TextRun({ text: " of ", font: "Calibri", size: 16, color: "666666" }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Calibri", size: 16, color: "666666" }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync(outPath, buffer);
console.log("Wrote:", outPath);
console.log("Bytes:", buffer.length);
