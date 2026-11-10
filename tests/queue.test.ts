import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUEUE_TOKEN, allowedWindows, announcement, joinProblem, normalizeQueueMobile, queueOpen, queueRewrite, windowsFor, windowsText } from "@/lib/queue";

// New Wave Queue, Phase 1 (owner, 10 Nov 2026; NWMTACI_Queue_System_Plan.md).
describe("Queue host and rules", () => {
  it("serves the fixed paths on the queue host only", () => {
    expect(queueRewrite("queue.newwavemaritimemtaci.com", "/join")).toBe("/queue/join");
    expect(queueRewrite("queue.newwavemaritimemtaci.com", "/")).toBe("/queue/join");
    expect(queueRewrite("queue.newwavemaritimemtaci.com", "/display")).toBe("/queue/display");
    expect(queueRewrite("queue.newwavemaritimemtaci.com", "/staff")).toBe("/queue/staff");
    expect(queueRewrite("queue.newwavemaritimemtaci.com", "/t/0123456789ABCDEF")).toBe("/queue/t/0123456789ABCDEF");
    expect(queueRewrite("queue.newwavemaritimemtaci.com", "/staff-login")).toBeNull();
    expect(queueRewrite("newwavemaritimemtaci.com", "/join")).toBeNull();
    expect(queueRewrite("newwavemaritimemtaci.com", "/")).toBeNull();
  });
  it("checks the join form in plain words", () => {
    const ok = { name: "Juan Dela Cruz", mobile: "0917 123 4567", service: "E", consent: true };
    expect(joinProblem(ok, ["E", "P"])).toBeNull();
    expect(joinProblem({ ...ok, name: "Jo" }, ["E"])).toBe("Enter your full name.");
    expect(joinProblem({ ...ok, mobile: "12345" }, ["E"])).toBe("Enter your mobile number as 09XXXXXXXXX.");
    expect(joinProblem({ ...ok, service: "X" }, ["E"])).toBe("Choose what you came for.");
    expect(joinProblem({ ...ok, consent: false }, ["E"])).toBe("Tick the consent box to get a number.");
    expect(normalizeQueueMobile("+63 917-123-4567")).toBe("09171234567");
  });
  it("opens in office hours, Manila time", () => {
    expect(queueOpen("08:00", "17:00", new Date("2026-11-10T01:00:00Z"))).toBe(true); // 9:00 AM Manila
    expect(queueOpen("08:00", "17:00", new Date("2026-11-10T09:30:00Z"))).toBe(false); // 5:30 PM Manila
  });
  it("announces the number without leading zeros", () => {
    expect(announcement("E-004", 1)).toBe("Now serving, E, 4. Please proceed to window 1.");
    expect(announcement("P-012", 2)).toBe("Now serving, P, 12. Please proceed to window 2.");
  });
  it("lets each role call only at its own window, the Admin at any", () => {
    // Two walk-in Registration windows and one Cashier (owner, 10 Nov 2026).
    expect(allowedWindows(["cashier"], [1, 2, 3])).toEqual([3]);
    expect(allowedWindows(["registration"], [1, 2, 3])).toEqual([1, 2]);
    expect(allowedWindows(["registration", "cashier"], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(windowsText([1, 2])).toBe("Window 1 or 2");
    expect(windowsText([3])).toBe("Window 3");
    expect(windowsFor("E", [{ no: 1, service_codes: ["E", "I", "C"] }, { no: 2, service_codes: ["E", "I", "C"] }, { no: 3, service_codes: ["P"] }])).toEqual([1, 2]);
    expect(allowedWindows(["admin"], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(allowedWindows(["accounting"], [1, 2, 3])).toEqual([]);
    expect(QUEUE_TOKEN.test("0123456789ABCDEF")).toBe(true);
    expect(QUEUE_TOKEN.test("E-004")).toBe(false);
  });
});

describe("Queue database and server", () => {
  const sql = readFileSync("supabase/migrations/202610290093_queue.sql", "utf8");
  it("keeps anon out, numbers tickets safely and never hands two staff the same ticket", () => {
    expect(sql).toContain("revoke all on public.queue_services, public.queue_windows, public.queue_counters, public.queue_tickets, public.queue_events, public.queue_settings from anon;");
    expect(sql).toContain("on conflict (service_code, day) do update set last_no = public.queue_counters.last_no + 1");
    expect(sql).toContain("for update skip locked limit 1");
    expect(sql).toContain("create unique index if not exists queue_one_active_ticket_per_mobile");
    expect(sql).toContain("queue_events_immutable before update or delete");
    expect(sql).toMatch(/grant execute on function public\.queue_join\(text, text, text, text, uuid\).* to service_role;/);
  });
  it("puts no names or mobiles on the public channel, the display state or the ticket status", () => {
    const server = readFileSync("lib/queue-server.ts", "utf8");
    expect(server).toContain("const payload: QueueBroadcast = { type: event.type, ticket_no: event.ticket_no, service_code: event.service_code, window_no: event.window_no };");
    const status = sql.slice(sql.indexOf("function public.queue_ticket_status"), sql.indexOf("revoke all on function public.queue_join"));
    expect(status).not.toMatch(/full_name|mobile/);
    const state = readFileSync("app/api/queue/state/route.ts", "utf8");
    expect(state).not.toMatch(/mobile:/);
    expect(state).toContain("...(showName && x.full_name ? { first_name: x.full_name.split(/\\s+/)[0] } : {})");
  });
  it("lets Windows 1 and 2 share the Registration line", () => {
    const w = readFileSync("supabase/migrations/202610290094_queue_windows.sql", "utf8");
    expect(w).toContain("(1, 'Registration', '{E,I,C}', true), (2, 'Registration', '{E,I,C}', true), (3, 'Cashier', '{P}', true)");
    expect(w).toContain("service_code = any(w.service_codes) and (window_no is null or window_no = w.no)");
    expect(w).toContain("for update skip locked limit 1");
  });
  it("checks the window on the server before every staff action", () => {
    const staff = readFileSync("app/api/queue/staff/route.ts", "utf8");
    expect(staff).toContain('if (!mine.includes(input.window)) return NextResponse.json({ error: "That window is not yours." }, { status: 403 });');
    expect(staff).toContain('if (!ticket || !mine.includes(ticket.window_no as number))');
    expect(readFileSync("app/api/queue/join/route.ts", "utf8")).toContain('await enforceRateLimit(request, "queue-join", 5, 10);');
  });
});
