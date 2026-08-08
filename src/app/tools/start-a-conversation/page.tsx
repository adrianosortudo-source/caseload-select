import type { Metadata } from "next";
import StartConversationFlow from "@/components/start-conversation/StartConversationFlow";
import ToolHeader from "@/components/start-conversation/ToolHeader";
import { resolveBookingConfig } from "@/lib/booking-adapter-pure";

export const metadata: Metadata = {
  title: "Start a Conversation | CaseLoad Select",
  description:
    "Five short questions, so the first call starts from what matters to your firm. Clear fits can book a time on the next screen; everyone gets a personal reply within one business day.",
  robots: { index: false, follow: false },
};

/**
 * /tools/start-a-conversation
 *
 * BUILD_PLAN_start_conversation_flow_v1.md: replaces the bare `mailto:`
 * behind every "Start a conversation" CTA with a short qualifying intake in
 * the site's own tool grammar. Outside the frozen (marketing)/ route group
 * by the same necessity as /tools/firm-voice-builder (check-website-boundary
 * Rule A); a fresh top-level route, sibling to /widget, /book, and
 * /tools/firm-voice-builder, already covered by the AdminShell `/tools`
 * bypass (src/components/AdminShell.tsx).
 *
 * `?embed=1` drops the ToolHeader, same convention as the other two
 * tools-embed routes: conversation.html on the static site frames this
 * route inline, and without the flag the embed would show a second
 * CaseLoad wordmark and a stranded "Back to home" link.
 *
 * The Cal.com booking URL is resolved SERVER-SIDE from CASELOAD_CALCOM_URL
 * (not a secret -- the URL is public by nature -- but there is no reason to
 * expose it as a NEXT_PUBLIC_ env var when a server component can just read
 * it once and hand the resolved string to the client component as a prop).
 * Reuses the same resolveBookingConfig shape /book/[firmId] already uses,
 * with a `{ provider: 'cal_com', url }` object built from the env var
 * rather than a firm's booking_config row -- CaseLoad Select is not a row
 * in intake_firms. Falls back to null (the reply-promise screen renders
 * unconditionally either way) when the env var is unset, so the flow ships
 * before the calendar is configured (plan section 6, acceptance criterion 7).
 */
interface PageProps {
  searchParams: Promise<{ embed?: string }>;
}

export default async function StartConversationPage({ searchParams }: PageProps) {
  const { embed } = await searchParams;
  const isEmbedded = embed === "1";

  const resolved = resolveBookingConfig({
    provider: "cal_com",
    url: process.env.CASELOAD_CALCOM_URL,
  });
  const bookingUrl = resolved.configured ? resolved.url : null;

  return (
    <>
      {!isEmbedded && <ToolHeader />}
      <main className="min-h-screen bg-parchment px-4 py-10">
        <StartConversationFlow bookingUrl={bookingUrl} />
      </main>
    </>
  );
}
