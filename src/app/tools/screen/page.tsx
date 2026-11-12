import type { Metadata } from "next";
import { PublicScreenSandboxFrame } from "@/components/intake-v2/PublicScreenSandboxFrame";

export const metadata: Metadata = {
  title: "SCREEN Intake Demo · CaseLoad Select",
  description: "Try a fictional inquiry across the available practice areas and channels, then inspect the lawyer report. No firm is contacted.",
  robots: { index: false, follow: false },
};

type ScreenQuery = { embed?: string; practice_area?: string; channel?: string; profile?: string };

export default async function ScreenToolPage({ searchParams }: { searchParams: Promise<ScreenQuery> }) {
  const params = await searchParams;
  const query = new URLSearchParams();
  if (params.embed === "1") query.set("embed", "1");
  if (params.practice_area && ["auto", "corporate", "real_estate", "employment", "estates", "family"].includes(params.practice_area)) {
    query.set("practice_area", params.practice_area);
  }
  if (params.channel && ["widget", "whatsapp", "sms", "instagram", "facebook", "voice"].includes(params.channel)) {
    query.set("channel", params.channel);
  }
  if (params.profile && ["drg", "gene"].includes(params.profile)) query.set("profile", params.profile);
  return <PublicScreenSandboxFrame query={query.toString()} />;
}
