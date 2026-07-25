import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Jost } from "next/font/google";
import "./globals.css";
import "./catalog.css";
import "./portal-legacy.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display face for headings and branding — a thin, geometric, wide-tracked
// uppercase look matching the New Wave typographic reference.
const jost = Jost({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
});

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
      <body className={`${geistSans.variable} ${geistMono.variable} ${jost.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
