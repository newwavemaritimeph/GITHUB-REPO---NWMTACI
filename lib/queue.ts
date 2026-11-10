/**
 * New Wave Queue (owner, 10 Nov 2026; NWMTACI_Queue_System_Plan.md, Phase 1): pure rules shared by the pages, the
 * server routes and the tests. The queue runs on queue.newwavemaritimemtaci.com from this same deployment.
 */
export const QUEUE_HOST_PREFIX = "queue.";
/** The fixed public paths on the queue host (printed posters point at /join), and where they live in the app. */
export function queueRewrite(host: string, pathname: string): string | null {
  if (!host.toLowerCase().startsWith(QUEUE_HOST_PREFIX)) return null;
  if (pathname === "/" ) return "/queue/join";
  if (pathname === "/join" || pathname === "/display" || pathname === "/staff") return `/queue${pathname}`;
  if (/^\/t\/[0-9A-Za-z]{16}$/.test(pathname)) return `/queue${pathname}`;
  return null;
}

export const QUEUE_MOBILE = /^09\d{9}$/;
export const QUEUE_TOKEN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
export const normalizeQueueMobile = (v: string) => v.replace(/[\s-]/g, "").replace(/^\+63/, "0").replace(/^63(?=9\d{9}$)/, "0");

export type QueueJoinInput = { name: string; mobile: string; service: string; consent: boolean };
/** What is wrong with a join, in plain words, or null. */
export function joinProblem(input: QueueJoinInput, services: string[]): string | null {
  if (input.name.trim().length < 3) return "Enter your full name.";
  if (!QUEUE_MOBILE.test(normalizeQueueMobile(input.mobile))) return "Enter your mobile number as 09XXXXXXXXX.";
  if (!services.includes(input.service)) return "Choose what you came for.";
  if (!input.consent) return "Tick the consent box to get a number.";
  return null;
}

/** Office hours in Manila time ("08:00" to "17:00"). */
export function queueOpen(open: string, close: string, now = new Date()) {
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return hm >= open.slice(0, 5) && hm < close.slice(0, 5);
}

/** "Now serving, E, 4. Please proceed to window 1." The number without leading zeros. */
export function announcement(ticketNo: string, windowNo: number) {
  const [code, n] = ticketNo.split("-");
  return `Now serving, ${code}, ${Number(n)}. Please proceed to window ${windowNo}.`;
}

/** The windows a staff member may call at (owner's plan, §7): their own window; the Admin any. */
export const ROLE_WINDOWS: Record<string, number[]> = { registration: [1], cashier: [2], releasing_officer: [3] };
export function allowedWindows(roleCodes: string[], all: number[]) {
  if (roleCodes.includes("admin")) return all;
  return [...new Set(roleCodes.flatMap((r) => ROLE_WINDOWS[r] ?? []))].filter((w) => all.includes(w)).sort((a, b) => a - b);
}

/** The public broadcast carries numbers, windows and statuses only. Never a name or mobile. */
export type QueueBroadcast = { type: "join" | "call" | "recall" | "done" | "no_show"; ticket_no: string; service_code: string; window_no: number | null };
export const QUEUE_CHANNEL = "queue:public";
