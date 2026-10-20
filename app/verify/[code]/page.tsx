import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCertificate, type VerifyResult } from "@/lib/certificate-verify-server";
import { formatVerifyCode, normalizeVerifyCode } from "@/lib/certificate-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Trainee records are never listed by search engines (owner's QR plan, 20 Oct 2026).
export const metadata = { title: "Verify a Certificate · New Wave Maritime", robots: { index: false, follow: false } };

const longDate = (d: string | null) => (d ? new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`)) : "—");
const dates = (a: string | null, b: string | null) => (!a || !b || a === b ? longDate(a ?? b) : `${longDate(a)} – ${longDate(b)}`);

const CSS = `
.vf{--blue:#0571D0;--navy:#123F63;--orange:#F25615;--cyan:#35CCFA;--bg:#f1f6f9;--card:#fff;--line:#d8e4ec;--fg:#0f2638;--muted:#58707f;--ok:#0a7a3e;--okbg:#e3f4ea;--bad:#b42318;--badbg:#fbe4dc;--soft:#eef4f8;min-height:100vh;background:var(--bg);color:var(--fg);font:400 16px/1.5 Geist,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px max(16px,env(safe-area-inset-right,0px)) 48px max(16px,env(safe-area-inset-left,0px))}
@media (prefers-color-scheme:dark){.vf{--bg:#0b1824;--card:#112434;--line:#24394b;--fg:#e4eef5;--muted:#9ab0c1;--ok:#5fd493;--okbg:#12301f;--bad:#ff8a7a;--badbg:#3c1d16;--soft:#152d3d}}
.vf main{max-width:480px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.vf .brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--blue);letter-spacing:.04em}.vf .brand i{width:30px;height:30px;border-radius:50%;background:conic-gradient(var(--orange) 0 25%,var(--blue) 0 62%,var(--cyan) 0)}
.vf .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px}
.vf .state{border-radius:12px;padding:14px 16px;font-weight:700;font-size:18px}.vf .ok{background:var(--okbg);color:var(--ok)}.vf .bad{background:var(--badbg);color:var(--bad)}.vf .nf{background:var(--soft);color:var(--muted)}
.vf .who{display:flex;gap:14px;align-items:flex-start}.vf .who img,.vf .who .ph{width:110px;height:110px;border-radius:6px;object-fit:cover;flex:none;background:var(--soft);border:1px solid var(--line)}
.vf h1{margin:0;font-size:20px;text-wrap:balance;overflow-wrap:anywhere}.vf .course{color:var(--muted);font-size:15px;margin-top:4px}
.vf dl{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;margin:0;font-size:15px}.vf dt{color:var(--muted)}.vf dd{margin:0;font-weight:600;overflow-wrap:anywhere}.vf .mono{font-family:"Geist Mono",ui-monospace,Consolas,monospace}
.vf .tip{background:var(--soft);border-radius:10px;padding:10px 12px;font-size:14px}.vf .code{font:500 13px "Geist Mono",ui-monospace,monospace;color:var(--muted);text-align:center}.vf p{margin:0}
`;

function Contact() {
  return <p>Questions? Call <b className="mono">0948 847 6530</b> or email <b>newwavemaritime@gmail.com</b>.</p>;
}

function Body({ r }: { r: VerifyResult }) {
  if (r.state === "limited") return <div className="card"><div className="state nf">Too many checks from this device. Please wait a minute and scan again.</div></div>;
  if (r.state === "not_found") return <div className="card"><div className="state nf">This certificate is not in New Wave&apos;s records.</div><p>If you are checking a New Wave certificate, compare the code under the QR with this page&apos;s address, then contact us.</p><Contact /></div>;
  if (r.state === "revoked") return <div className="card"><div className="state bad">✗ This certificate has been revoked.</div><dl><dt>Certificate No.</dt><dd className="mono">{r.certificateNumber}</dd></dl><Contact /></div>;
  return <div className="card">
    <div className="state ok">✓ Valid Certificate</div>
    <div className="who">{r.photoUrl ? <img src={r.photoUrl} alt={`2x2 photo of ${r.name}`} /> : <div className="ph" aria-hidden="true" />}<div><h1>{r.name}</h1><div className="course">{r.course}</div></div></div>
    <dl>
      <dt>Training</dt><dd>{dates(r.startsOn, r.endsOn)}</dd>
      {r.hours ? <><dt>Hours</dt><dd>{r.hours}</dd></> : null}
      <dt>Issued</dt><dd>{longDate(r.issuedOn)}</dd>
      <dt>Certificate No.</dt><dd className="mono">{r.certificateNumber}</dd>
      {r.stickerNo ? <><dt>Sticker No.</dt><dd className="mono">{r.stickerNo}</dd></> : null}
    </dl>
    <p className="tip">Compare the name, photo and hologram sticker number with the physical certificate.</p>
  </div>;
}

/** Public certificate verification, opened from the QR (owner, 20 Oct 2026). The address format never changes. */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  let result: VerifyResult;
  try { result = await verifyCertificate(createSupabaseAdminClient(), decodeURIComponent(code), { ip, userAgent: h.get("user-agent") }); }
  catch { result = { state: "not_found" }; }
  const shown = normalizeVerifyCode(decodeURIComponent(code));
  return <div className="vf"><style>{CSS}</style><main>
    <div className="brand"><i aria-hidden="true" />NEW WAVE MARITIME</div>
    <Body r={result} />
    <p className="code">{shown ? formatVerifyCode(shown) : "Invalid code"}</p>
  </main></div>;
}
