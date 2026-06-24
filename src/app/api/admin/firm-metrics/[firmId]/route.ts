import { NextRequest, NextResponse } from "next/server";
import { requireOperator } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchGA4Metrics, type GA4Report } from "@/lib/google-analytics";
import {
  fetchVercelProjectStatus,
  type VercelProjectStatus,
} from "@/lib/vercel-analytics-api";

interface FirmAnalyticsConfig {
  ga4_property_id: string | null;
  vercel_project_id: string | null;
}

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ firmId: string }> },
) {
  const session = await requireOperator();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { firmId } = await params;

  const { data: firm, error } = await supabaseAdmin
    .from("intake_firms")
    .select("ga4_property_id, vercel_project_id")
    .eq("id", firmId)
    .maybeSingle();

  if (error || !firm) {
    return NextResponse.json({ error: "firm_not_found" }, { status: 404 });
  }

  const config = firm as FirmAnalyticsConfig;

  const [ga4, vercel] = await Promise.all([
    config.ga4_property_id
      ? fetchGA4Metrics(config.ga4_property_id)
      : Promise.resolve({ configured: false } as GA4Report),
    config.vercel_project_id
      ? fetchVercelProjectStatus(config.vercel_project_id)
      : Promise.resolve({ configured: false } as VercelProjectStatus),
  ]);

  const ga4PropertyId = config.ga4_property_id;
  const vercelProjectName =
    vercel.configured && "projectName" in vercel ? (vercel as VercelProjectStatus).projectName : null;
  const teamSlug = process.env.VERCEL_TEAM_SLUG ?? "";

  return NextResponse.json({
    ga4,
    vercel,
    deepLinks: {
      ga4: ga4PropertyId
        ? `https://analytics.google.com/analytics/web/#/p${ga4PropertyId}/reports/`
        : null,
      vercelAnalytics:
        vercel.configured && "deepLinks" in vercel
          ? (vercel as VercelProjectStatus).deepLinks.analytics
          : null,
      vercelSpeedInsights:
        vercel.configured && "deepLinks" in vercel
          ? (vercel as VercelProjectStatus).deepLinks.speedInsights
          : null,
      vercelDeployments:
        vercel.configured && "deepLinks" in vercel
          ? (vercel as VercelProjectStatus).deepLinks.deployments
          : teamSlug && vercelProjectName
            ? `https://vercel.com/${teamSlug}/${vercelProjectName}/deployments`
            : null,
    },
  });
}
