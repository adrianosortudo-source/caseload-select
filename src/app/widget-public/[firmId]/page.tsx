/**
 * /widget-public/[firmId] - public website intake.
 *
 * Uses the same CaseLoad Screen engine as /widget/[firmId], but removes the
 * OTP gate and uses lead-facing completion language for law-firm websites.
 *
 * Per-firm theme (2026-06-05):
 *   The firm's `intake_firms.branding.theme` is read here and applied as
 *   CSS variables on the widget root. Components read those vars via
 *   `var(--cls-*, <CaseLoad default>)`. Source Serif 4 is loaded via
 *   next/font/google only when the resolved theme asks for it, so firms
 *   on the default CaseLoad chrome do not pay the bundle cost.
 */

import { Source_Serif_4 } from "next/font/google";
import { supabaseAdmin as supabase } from "@/lib/supabase-admin";
import { ScreenEnginePublicWidget } from "@/components/intake-v2/ScreenEnginePublicWidget";
import {
  resolveWidgetTheme,
  themeToCssVars,
  type FirmBranding,
} from "@/lib/widget-theme";

// Source Serif 4 is loaded once at the module level. next/font requires
// font-import calls at module scope (not inside the handler). The font is
// only actually rendered when the resolved theme references the
// `--font-source-serif-4` CSS variable; firms on the default theme inherit
// Manrope / DM Sans from the global CSS and never paint with this face.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-source-serif-4",
  display: "swap",
});

interface PageProps {
  params: Promise<{ firmId: string }>;
  searchParams: Promise<{ lang?: string }>;
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
  const { lang } = await searchParams;

  // Locale hint from the embedding page (e.g. DRG's /pt/contact passes
  // ?lang=pt). Validated against the kickoff allow-list; unknown values
  // fall back to English so a malformed query never breaks the screen.
  const initialLang = lang && KICKOFF_LANGS.has(lang) ? (lang as "en" | "pt") : "en";

  const { data: firm } = await supabase
    .from("intake_firms")
    .select("name, branding, consent_gate_enabled")
    .eq("id", firmId)
    .single<FirmRow>();

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

  // Apply the Source Serif font variable to the root only when the resolved
  // theme actually uses it. Otherwise the variable stays unset and the
  // widget reads the default fonts from its inline DM Sans / Manrope refs.
  const rootClassName = theme.loadSourceSerif ? sourceSerif.variable : "";

  return (
    <div className={rootClassName} style={themeStyle}>
      <ScreenEnginePublicWidget
        firmId={firmId}
        firmName={displayName}
        initialLang={initialLang}
        consentCaptureEnabled={!!firm.consent_gate_enabled}
      />
    </div>
  );
}
