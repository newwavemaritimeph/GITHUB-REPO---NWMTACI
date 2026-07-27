import type { Metadata } from "next";
import { PortalApp } from "@/components/portal-app";

// Public, no-login PROTOTYPE surface. Runs the browser-local demo workspace with
// seeded SAMPLE DATA only — it never touches Supabase, real records, or auth. This
// is a separate route from /portal (the real staff workspace), which keeps its
// authentication guard. Safe to share for demos.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "NWMTACI Portal — Prototype",
  description: "Interactive prototype of the New Wave Maritime staff portal, running on sample data. No login required.",
  robots: { index: false, follow: false },
};

export default function PrototypePage() {
  return <PortalApp previewMode />;
}
