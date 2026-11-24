import { notFound, redirect } from "next/navigation";
import { screenParityPreviewEnabled } from "@/lib/screen-parity-preview-enabled";
import type { Metadata } from "next";
import ScreenParityPreview from "@/components/intake-v2/ScreenParityPreview";
import type { PreviewPracticeArea } from "@/lib/screen-preview-boundary";
import "@/app/portal/[firmId]/triage/[leadId]/brief.css";

export const metadata: Metadata = { title: "SCREEN private preview", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const areas = new Set(["family", "corporate", "employment", "estates", "real_estate"]);
const channels = new Set(["website", "sms", "whatsapp", "instagram", "facebook"]);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!screenParityPreviewEnabled()) notFound();
  const query = await searchParams;
  const area = query.practice_area;
  const channel = query.channel ?? "website";
  if (typeof area !== "string" || !areas.has(area) || typeof channel !== "string" || !channels.has(channel)) notFound();
  if (query.compare === "production" && (channel === "website" || channel === "sms")) {
    redirect("/widget-public/fictional-screen-preview?practice_area=" + area);
  }
  return <ScreenParityPreview practiceArea={area as PreviewPracticeArea}
    channel={channel as "website" | "sms" | "whatsapp" | "instagram" | "facebook"}
    canRequestQuestionPolicy
    operationalPracticeAreas={area === "family" ? ["family"] : undefined}
    comparison={query.compare === "production"} externalReport={query.external_report === "1"} />;
}
