import { notFound } from "next/navigation";
import { PublicSite, type PublicPage } from "@/components/public-site";

const pages = new Set<PublicPage>(["about", "courses", "schedules", "register", "registration-search", "contact", "staff-login"]);

export default async function PublicPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!pages.has(slug as PublicPage)) notFound();
  return <PublicSite page={slug as PublicPage} />;
}
