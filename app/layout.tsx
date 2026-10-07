import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Geist_Mono, Source_Serif_4, Plus_Jakarta_Sans, Space_Grotesk, Outfit } from "next/font/google";
import "./globals.css";
import "./catalog.css";
import "./portal-legacy.css";

// Interface face. Inter is drawn for screen UI: it stays legible at the small
// sizes the portal uses for table meta and field labels.
const interSans = Inter({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for headings and figures (the "Editorial" direction). A serif
// gives headings and numbers a considered, reported quality — fitting for
// records that end in an accredited certificate.
// Source Serif 4 is a VARIABLE font with an optical-size axis. Pinning static
// weights here makes next/font emit no @font-face at all and the page silently
// falls back to sans-serif. Omit `weight` so the whole variable range loads.
const sourceSerif = Source_Serif_4({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

// Staff portal faces ("Bridge Compass" direction, Oct 2026): Plus Jakarta Sans
// for the interface and headings, Space Grotesk for figures. Scoped to
// .portal-shell in portal-legacy.css; the public site keeps Editorial.
// Both are variable fonts, so no weight list (see the Source Serif note).
const portalSans = Plus_Jakarta_Sans({ variable: "--font-portal", subsets: ["latin"], display: "swap" });
const portalNumerals = Space_Grotesk({ variable: "--font-num", subsets: ["latin"], display: "swap" });
// Registration form headings ("Quiet Checklist" direction). Variable font.
const formDisplay = Outfit({ variable: "--font-form", subsets: ["latin"], display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    title: { default: "New Wave Maritime", template: "%s · New Wave Maritime" },
    description: "Registration, training, payments, attendance, and learner support from New Wave Maritime Training and Assessment Center, Inc.",
    icons: { icon: "/new-wave-logo.png", shortcut: "/new-wave-logo.png" },
    openGraph: {
      title: "New Wave Maritime",
      description: "Ride the New Wave of Maritime Excellence.",
      images: [{ url: `${origin}/new-wave-social.png`, width: 1200, height: 630, alt: "Ride the New Wave of Maritime Excellence" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "New Wave Maritime",
      description: "Ride the New Wave of Maritime Excellence.",
      images: [`${origin}/new-wave-social.png`],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${interSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${portalSans.variable} ${portalNumerals.variable} ${formDisplay.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
