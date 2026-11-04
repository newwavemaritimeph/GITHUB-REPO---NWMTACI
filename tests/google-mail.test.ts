import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("resend", () => ({ Resend: class {} }));
import { buildMime } from "@/lib/google-mail";
import { emailConfigured } from "@/lib/email-jobs";
import { GMAIL_SCOPE, hasGmailScope } from "@/lib/google-classroom";

const decode = (mime: string, type: string) => {
  const start = mime.indexOf(`Content-Type: ${type}`);
  const from = mime.indexOf("\r\n\r\n", start) + 4;
  return Buffer.from(mime.slice(from, mime.indexOf("\r\n--", from)).replace(/\r\n/g, ""), "base64");
};

describe("portal email through Gmail", () => {
  const message = { from: "New Wave Maritime <newwavemaritime@gmail.com>", to: "trainee@example.com", subject: "Your training instructions · APA", html: "<p>Dear April, ₱600.00</p>", text: "Dear April, ₱600.00", attachments: [{ filename: "training-instructions-ENR-2026-000035.pdf", content: Buffer.from("%PDF-1.7 sample") }] };
  it("builds the headers, both bodies and the PDF", () => {
    const mime = buildMime(message, "x");
    expect(mime).toContain("From: New Wave Maritime <newwavemaritime@gmail.com>\r\n");
    expect(mime).toContain("To: trainee@example.com\r\n");
    expect(decode(mime, "text/plain").toString("utf8")).toBe("Dear April, ₱600.00");
    expect(decode(mime, "text/html").toString("utf8")).toBe("<p>Dear April, ₱600.00</p>");
    expect(mime).toContain('filename="training-instructions-ENR-2026-000035.pdf"');
    expect(decode(mime, "application/pdf").toString("utf8")).toBe("%PDF-1.7 sample");
    expect(mime.trimEnd().endsWith("--nw-mixed-x--")).toBe(true);
  });
  it("encodes a subject with non-English characters", () => {
    const subject = buildMime(message, "x").split("\r\n").find((l) => l.startsWith("Subject: "))!;
    expect(subject).toBe(`Subject: =?UTF-8?B?${Buffer.from(message.subject, "utf8").toString("base64")}?=`);
  });
  it("keeps a line break in a field from adding a header", () => {
    const mime = buildMime({ ...message, to: "a@example.com\r\nBcc: b@example.com", subject: "Hi\r\nBcc: c@example.com" }, "x");
    expect(mime.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
  });
  it("leaves a message with no attachment as text and HTML only", () => {
    expect(buildMime({ ...message, attachments: [] }, "x")).not.toContain("application/pdf");
  });
});

describe("email is ready when Google or Resend is set", () => {
  afterEach(() => vi.unstubAllEnvs());
  const env = (google: string, resend: string, from: string) => { vi.stubEnv("GOOGLE_CLIENT_ID", google); vi.stubEnv("GOOGLE_CLIENT_SECRET", google); vi.stubEnv("RESEND_API_KEY", resend); vi.stubEnv("EMAIL_FROM", from); };
  it("is ready with the Google keys alone", () => { env("x", "", ""); expect(emailConfigured()).toBe(true); });
  it("is ready with the Resend keys alone", () => { env("", "x", "y"); expect(emailConfigured()).toBe(true); });
  it("is not ready with neither", () => { env("", "", ""); expect(emailConfigured()).toBe(false); });
  it("knows whether the connected account allows sending", () => {
    expect(hasGmailScope(`openid ${GMAIL_SCOPE}`)).toBe(true);
    expect(hasGmailScope("openid email")).toBe(false);
  });
});
