import { FeedbackForm } from "@/components/feedback-form";

export const runtime = "nodejs";
export const metadata = { title: "Training feedback · New Wave Maritime" };

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <FeedbackForm token={token} />;
}
