// Product checklist priorities for the Website checks summary. These weights
// are not a measurement of rankings, enquiries, legal content quality, or AI
// citations. AI observations are kept visible but excluded from the score.
export const CATEGORY_WEIGHTS: Record<string, number> = {
  "On-Page SEO": 20,
  "Indexability": 8,
  "Schema & Structured Data": 16,
  "AI Visibility": 0,
  "Legal Marketing": 16,
  "Local SEO": 12,
  "Technical & Security": 4,
  "Rendering & Crawlability": 2,
  "Performance": 6,
  "Links & Content": 6,
  "Intent Alignment": 8,
};
