/**
 * New-arrival chime (owner, 10 Nov 2026): "add chime to registrations and cashier if there is new registrations and
 * new payments". Compares two refreshes of the portal data; the first load never chimes.
 *  - Registration: new enrollments and new trainees waiting for a course (website and walk-in registrations).
 *  - Cashier: new payment proofs sent by trainees and new hand-overs from Registration. Payments the Cashier records
 *    herself are not "new" to her, so they do not chime.
 */
export type AlertSnapshot = {
  enrollments?: { id: string }[];
  awaitingCourseIds?: string[];
  traineeProofs?: { id: string }[];
  handedToCashier?: Record<string, string>;
  certificates?: { id: string }[];
};

const fresh = (before: string[], after: string[]) => { const seen = new Set(before); return after.filter((x) => !seen.has(x)).length; };
const ids = (list?: { id: string }[]) => (list ?? []).map((x) => x.id);
const plural = (n: number, one: string) => (n === 1 ? `New ${one}` : `${n} New ${one}s`);

export function newArrivals(prev: AlertSnapshot | null, next: AlertSnapshot, role: string): { count: number; label: string } {
  if (!prev) return { count: 0, label: "" };
  if (role === "registration") {
    const n = fresh(ids(prev.enrollments), ids(next.enrollments)) + fresh(prev.awaitingCourseIds ?? [], next.awaitingCourseIds ?? []);
    return { count: n, label: n ? plural(n, "Registration") : "" };
  }
  if (role === "cashier") {
    const proofs = fresh(ids(prev.traineeProofs), ids(next.traineeProofs));
    const handed = fresh(Object.keys(prev.handedToCashier ?? {}), Object.keys(next.handedToCashier ?? {}));
    const parts = [proofs && plural(proofs, "Payment"), handed && plural(handed, "Hand-Over")].filter(Boolean);
    return { count: proofs + handed, label: parts.join(" · ") };
  }
  // Releasing Officer: certificates newly ready; MISMO Compliance Officer: new enrollments (owner, 10 Nov 2026).
  if (role === "releasing_officer") { const n = fresh(ids(prev.certificates), ids(next.certificates)); return { count: n, label: n ? plural(n, "Certificate") : "" }; }
  if (role === "mismo_officer") { const n = fresh(ids(prev.enrollments), ids(next.enrollments)); return { count: n, label: n ? plural(n, "Enrollment") : "" }; }
  return { count: 0, label: "" };
}
/** Roles that hear the chime (each can be turned off in Admin › Portal Sounds). */
export const SOUND_ROLES = ["registration", "cashier", "releasing_officer", "mismo_officer"] as const;

let audio: AudioContext | null = null;
/** Lets the chime play later: browsers allow sound only after the person has clicked on the page once. */
export function unlockChime() {
  try { audio ??= new AudioContext(); if (audio.state === "suspended") void audio.resume(); } catch { audio = null; }
}
/** A short two-note chime, made in the browser (no sound file). */
export function playChime() {
  try {
    audio ??= new AudioContext();
    const now = audio.currentTime;
    [[880, 0], [1318.5, 0.16]].forEach(([freq, at]) => {
      const osc = audio!.createOscillator(), gain = audio!.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + at);
      gain.gain.exponentialRampToValueAtTime(0.25, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45);
      osc.connect(gain).connect(audio!.destination);
      osc.start(now + at); osc.stop(now + at + 0.5);
    });
  } catch { /* no sound available */ }
}
