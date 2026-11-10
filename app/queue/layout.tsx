import type { Metadata } from "next";
import "./queue.css";

/** New Wave Queue pages: never indexed (queue plan §13). */
export const metadata: Metadata = { title: "New Wave Queue", robots: { index: false, follow: false } };

export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return <div className="q-page">{children}</div>;
}
