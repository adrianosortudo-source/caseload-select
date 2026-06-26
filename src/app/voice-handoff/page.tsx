/**
 * /voice-handoff - top-level first-party voice recorder for the iOS handoff.
 *
 * The embedded intake widget cannot record on iOS (WebKit blocks getUserMedia
 * in a cross-origin iframe). When the widget detects that case it opens this
 * page in a new tab. Because this is a top-level page on our own origin, the
 * mic works. After transcribing, RecordHandoff sends the text back to the
 * widget via the same-origin handoff transport (see voice-handoff.ts).
 *
 * Query: ?firmId=<uuid>&session=<nonce>. The firm row drives per-firm theming;
 * the nonce scopes the result so the widget only accepts the transcript it
 * asked for. This page is intentionally NOT embeddable (it must be top-level);
 * the strict header set in next.config.ts applies, with microphone=(self).
 */

import { Source_Serif_4 } from "next/font/google";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { RecordHandoff } from "@/components/intake-v2/RecordHandoff";
import {
  resolveWidgetTheme,
  themeToCssVars,
  type FirmBranding,
} from "@/lib/widget-theme";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-source-serif-4",
  display: "swap",
});

interface PageProps {
  searchParams: Promise<{ firmId?: string; session?: string }>;
}

interface FirmRow {
  name: string | null;
  branding: FirmBranding | null;
}

function InvalidLink() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-[#F4F3EF]">
      <p
        className="text-[14px] text-[#1E2F58]/65 text-center leading-relaxed max-w-sm"
        style={{ fontFamily: "DM Sans, sans-serif" }}
      >
        This recording link is no longer valid. Return to the firm&rsquo;s form
        and type your answer, or reopen the recorder from there.
      </p>
    </main>
  );
}

export default async function VoiceHandoffPage({ searchParams }: PageProps) {
  const { firmId, session } = await searchParams;

  // Both are required: the nonce scopes the round-trip and the firmId both
  // themes the page and is echoed back so the widget matches the result.
  if (!firmId || !session) return <InvalidLink />;

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name, branding")
    .eq("id", firmId)
    .single<FirmRow>();

  if (!firm) return <InvalidLink />;

  const displayName = (firm.name ?? "the firm").replace(/\s+Test$/i, "");
  const theme = resolveWidgetTheme(firm.branding);
  const themeStyle = themeToCssVars(theme);
  const rootClassName = theme.loadSourceSerif ? sourceSerif.variable : "";

  return (
    <div className={rootClassName} style={themeStyle}>
      <RecordHandoff firmId={firmId} session={session} firmName={displayName} />
    </div>
  );
}
