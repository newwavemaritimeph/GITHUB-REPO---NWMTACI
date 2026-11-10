import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isLateAddable, lateDayLabel } from "@/lib/scheduling";

// Register Trainee in the portal and late add to started batches (owner, 10 Nov 2026).
const today = "2026-11-10", now = "2026-11-10T03:00:00.000Z";
const b = (over: Partial<Parameters<typeof isLateAddable>[0]> = {}) => ({ partner_offer_id: null, status: "Open", starts_on: "2026-11-09", ends_on: "2026-11-13", enrollment_deadline: "2026-11-08T23:00:00.000Z", confirmed_count: 10, capacity: 24, ...over });

describe("Late add rule", () => {
  it("keeps a started batch open to Registration up to its last day, seats permitting", () => {
    expect(isLateAddable(b(), today, now)).toBe(true);
    expect(isLateAddable(b({ ends_on: today }), today, now)).toBe(true); // last day
    expect(isLateAddable(b({ ends_on: "2026-11-09" }), today, now)).toBe(false); // ended
    expect(isLateAddable(b({ confirmed_count: 24 }), today, now)).toBe(false); // 24 seats taken
    expect(isLateAddable(b({ partner_offer_id: "x" }), today, now)).toBe(false); // a partner's batch
    expect(isLateAddable(b({ status: "Cancelled" }), today, now)).toBe(false);
    // Day one after the 07:00 deadline counts as started.
    expect(isLateAddable(b({ starts_on: today, enrollment_deadline: "2026-11-09T23:00:00.000Z" }), today, now)).toBe(true);
    // Not started and before the deadline: booked the normal way, not a late add.
    expect(isLateAddable(b({ starts_on: "2026-11-17", ends_on: "2026-11-21", enrollment_deadline: "2026-11-16T23:00:00.000Z" }), today, now)).toBe(false);
  });
  it("labels the training day", () => {
    expect(lateDayLabel("2026-11-09", "2026-11-13", today)).toBe("Day 2 of 5");
    expect(lateDayLabel("2026-11-06", "2026-11-10", today)).toBe("Day 5 of 5 · last day");
  });
});

describe("Late add in the database and the server", () => {
  const sql = readFileSync("supabase/migrations/202610290092_late_add.sql", "utf8");
  const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
  const reg = readFileSync("app/api/public/registrations/route.ts", "utf8");
  const catalog = readFileSync("app/api/public/catalog/route.ts", "utf8");
  it("checks the last day and the seats, needs a reason and keeps it in the audit log", () => {
    expect(sql).toContain("batch_row.ends_on<current_date or batch_row.confirmed_count>=batch_row.capacity");
    expect(sql).toContain("Enter the reason for the late add.");
    expect(sql).toContain("'enrollment.late_added'");
    expect(sql).toContain("grant execute on function public.late_add_to_batch(uuid,uuid,uuid,text) to service_role");
    // The website's own rules stay as they are.
    expect(sql).not.toContain("function public.submit_public_registration");
  });
  it("lets only Registration or the Admin late add or register from the portal", () => {
    const action = route.slice(route.indexOf('if (input.action === "application-late-add") {'), route.indexOf('if (input.action === "registration-change-batch") {'));
    expect(action).toContain("if (!canRegister(staff.roleCodes))");
    expect(action).toContain('admin.rpc("late_add_to_batch"');
    expect(route).toContain('reason: z.string().trim().min(3, "Enter the reason for the late add.")');
    expect(reg).toContain('await requireStaff(["admin", "registration"])');
    expect(reg).toContain('const lateIds = staff ? batchesSchema.parse(');
    expect(reg).toContain('if (lateIds.length && lateReason.length < 3) throw new Error("Enter the reason for the late add.");');
  });
  it("lists started batches only on Registration's form, never to the public", () => {
    expect(catalog).toContain('searchParams.get("ongoing") === "1" && !!(await requireStaff(["admin", "registration"]))');
    expect(catalog).toContain('const late = ongoing && !bookable && isLateAddable(');
    expect(catalog).toContain('(ongoing ? q : q.gt("enrollment_deadline", now.toISOString()))');
  });
});

describe("Referral Voucher release records the expense", () => {
  const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
  const fn = route.slice(route.indexOf("async function bookVoucherExpense("), route.indexOf("async function tryAutoEnroll("));
  it("books a Paid Referral Rebates expense, except for Offset at Payment", () => {
    expect(fn).toContain('if (!snap?.mode || snap.mode === "Offset at Payment"');
    expect(fn).toContain('category: "Referral Rebates"');
    expect(fn).toContain('admin.rpc("approve_expense"');
    expect(fn).toContain('.update({ status: "Paid", paid_at: now');
  });
});
