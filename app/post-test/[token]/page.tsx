import { PostTestForm } from "@/components/post-test-form";

export const runtime = "nodejs";
export const metadata = { title: "Course Post-Test · New Wave Maritime", robots: { index: false, follow: false } };

export default async function PostTestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PostTestForm token={token} />;
}
