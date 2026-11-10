import { QueueTicket } from "@/components/queue/queue-ticket";

export const metadata = { title: "Your Number" };

export default async function QueueTicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <QueueTicket token={token} />;
}
