import type { ContentPeriod } from "@/lib/types";
import {
  canonicalFormat,
  displayStatusLabel,
  languageLabel,
  type CanonicalFormat,
  type PlanDeliverable,
} from "@/lib/deliverables-pure";

export interface ContentArchiveEntry {
  firmId: string;
  deliverable: PlanDeliverable;
  period: ContentPeriod | null;
  format: CanonicalFormat;
  language: string;
  status: string;
  searchText: string;
}

export interface ContentArchiveFilters {
  query?: string;
  format?: CanonicalFormat | "all";
  language?: string | "all";
  status?: string | "all";
  periodId?: string | "all";
}

export function buildContentArchiveIndex(
  firmId: string,
  periods: ContentPeriod[],
  deliverables: PlanDeliverable[],
  standingAuthActive = false,
): ContentArchiveEntry[] {
  const periodById = new Map(periods.map((period) => [period.id, period]));
  return deliverables.map((deliverable) => {
    const period = deliverable.period_id ? periodById.get(deliverable.period_id) ?? null : null;
    const format = canonicalFormat(deliverable);
    const language = languageLabel(deliverable.locale);
    const status = displayStatusLabel(deliverable.status, {
      standingAuthActive,
      requiresIndividualReview: deliverable.requires_individual_review,
      publishedAt: deliverable.published_at,
    });
    const periodText = period ? `${period.week_number ? `Week ${period.week_number}` : "Unnumbered"} ${period.theme ?? ""}` : "Unscheduled";
    return {
      firmId,
      deliverable,
      period,
      format,
      language,
      status,
      searchText: [deliverable.title, deliverable.kicker, deliverable.format, deliverable.deliverable_role, deliverable.publication_destination, language, format, periodText]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase(),
    };
  });
}

export function searchContentArchive(
  entries: ContentArchiveEntry[],
  firmId: string,
  filters: ContentArchiveFilters = {},
): ContentArchiveEntry[] {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return entries.filter((entry) => {
    if (entry.firmId !== firmId) return false;
    if (query && !entry.searchText.includes(query)) return false;
    if (filters.format && filters.format !== "all" && entry.format !== filters.format) return false;
    if (filters.language && filters.language !== "all" && entry.language !== filters.language) return false;
    if (filters.status && filters.status !== "all" && entry.status !== filters.status) return false;
    if (filters.periodId && filters.periodId !== "all" && entry.period?.id !== filters.periodId) return false;
    return true;
  });
}

