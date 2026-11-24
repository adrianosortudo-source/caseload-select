/**
 * /widget-public/[firmId] - public website intake.
 *
 * Uses the same CaseLoad Screen engine as /widget/[firmId], but removes the
 * OTP gate and uses lead-facing completion language for law-firm websites.
 *
 * Per-firm theme (2026-06-05):
 *   The firm's `intake_firms.branding.theme` is read here and applied as
 *   CSS variables on the widget root. Components read those vars via
 *   `var(--cls-*, <CaseLoad default>)`. Source Serif 4 is bundled from a
 *   lockfile-pinned local package and used only when the resolved theme asks
 *   for its CSS variable.
 */

import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";
import { screenParityPreviewEnabled } from "@/lib/screen-parity-preview-enabled";
import ScreenParityPreview from "@/components/intake-v2/ScreenParityPreview";
import type { PreviewPracticeArea } from "@/lib/screen-preview-boundary";
import "@/app/portal/[firmId]/triage/[leadId]/brief.css";
import { ScreenEnginePublicWidget } from "@/components/intake-v2/ScreenEnginePublicWidget";
import {
  resolveWidgetTheme,
  themeToCssVars,
  type FirmBranding,
} from "@/lib/widget-theme";

interface PageProps {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ lang?: string; practice_area?: string }>;
}

interface FirmRow {
  name: string | null;
  branding: FirmBranding | null;
  consent_gate_enabled: boolean | null;
}

// Languages the kickoff screen can render before the engine detects the
// real language from typed text. Only "pt" has an authored kickoff
// bundle today; anything else (or absent) falls back to English. The
// engine still detects and serves every OTHER language fully once the
// visitor types, regardless of this hint.
const KICKOFF_LANGS = new Set(["en", "pt"]);

export default async function PublicWidgetPage({ params, searchParams }: PageProps) {
  const { firmId } = await params;
  const { lang, practice_area: area } = await searchParams;
  const previewFirm = firmId === "fictional-screen-preview" || firmId === "fictional-screen-default-preview";
  if (previewFirm && (!screenParityPreviewEnabled() || !area || !["corporate", "employment", "real_estate", "estates", "family"].includes(area))) notFound();
  const operationalPracticeAreas = previewFirm && firmId === "fictional-screen-preview" && area === "family" ? ["family" as const] : undefined;

  // Locale hint from the embedding page (e.g. DRG's /pt/contact passes
  // ?lang=pt). Validated against the kickoff allow-list; unknown values
  // fall back to English so a malformed query never breaks the screen.
  const initialLang = lang && KICKOFF_LANGS.has(lang) ? (lang as "en" | "pt") : "en";

  const firm: FirmRow | null = previewFirm
    ? { name: "Example Law Firm", branding: null, consent_gate_enabled: false }
    : (await supabase
    .from("intake_firms")
    .select("name, branding, consent_gate_enabled")
    .eq("id", firmId)
    .single<FirmRow>()).data;

  if (!firm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F3EF]">
        <p className="text-[14px] text-[#1E2F58]/60" style={{ fontFamily: "DM Sans, sans-serif" }}>
          Firm not found.
        </p>
      </div>
    );
  }

  const displayName = (firm.name as string).replace(/\s+Test$/i, "");
  const theme = resolveWidgetTheme(firm.branding);
  const themeStyle = themeToCssVars(theme);

  const widget = (
    <div style={themeStyle}>
      <ScreenEnginePublicWidget
        firmId={firmId}
        firmName={displayName}
        initialLang={initialLang}
        consentCaptureEnabled={!!firm.consent_gate_enabled}
        operationalPracticeAreas={operationalPracticeAreas}
        selectedPracticeArea={firmId === "fictional-screen-preview" ? area as PreviewPracticeArea : undefined}
        canRequestQuestionPolicy={firmId === "fictional-screen-preview"}
      />
    </div>
  );
  return previewFirm ? <ScreenParityPreview practiceArea={area as PreviewPracticeArea} channel="website"
    comparison externalReport={false}>{widget}</ScreenParityPreview> : widget;
}
