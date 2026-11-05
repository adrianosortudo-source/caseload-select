import type { ReportDecision, ReportPage } from "./report-model";

/** Saved page fields used for contextual review. Missing fields mean unavailable evidence. */
export interface ReportPageAudit {
  metaDescription?: string | null;
  h1s?: string[] | null;
  h2s?: string[] | null;
  ctaEvidence?: string[] | null;
  phoneEvidence?: string[] | null;
}

export type InsightPage = ReportPage & { pageAudit?: ReportPageAudit | null };

type Topic = "immigration" | "family law" | "real estate" | "corporate law" | "wills and estates" | "civil litigation";
type TopicMatch = { topic: Topic; phrase: string };

const TOPIC_PHRASES: Record<Topic, string[]> = {
  immigration: ["immigration", "imigração", "imigracao"],
  "family law": ["family law", "family", "separação", "separacao", "guarda de filhos", "pensão", "pensao"],
  "real estate": ["real estate", "imóveis", "imoveis", "transações imobiliárias", "transacoes imobiliarias"],
  "corporate law": ["corporate law", "business law", "corporate", "empresas", "corporativo"],
  "wills and estates": ["wills", "estates", "wills and estates", "testamentos", "herança", "heranca"],
  "civil litigation": ["civil litigation", "civil law", "direito civil"],
};
const LOCALE_TOKENS = ["en", "eng", "english", "pt", "por", "português", "portugues", "br", "pt-br"];
const UI_PREFIX_PHRASES = ["schedule your consultation", "book your consultation", "agende sua consulta", "marque sua consulta", "fale conosco", "entre em contato"];
const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&nbsp;": " ", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#8217;": "’", "&#8216;": "‘", "&#8211;": "–", "&#8212;": "—" };

export function decodeEvidenceOnce(value: string): string {
  return value.replace(/&(?:amp|nbsp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const named = HTML_ENTITIES[entity.toLowerCase()];
    if (named !== undefined) return named;
    const numeric = entity.match(/^&#(x[\da-f]+|\d+);$/i)?.[1];
    if (!numeric) return entity;
    const codePoint = numeric[0].toLowerCase() === "x" ? parseInt(numeric.slice(1), 16) : Number(numeric);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity;
    return String.fromCodePoint(codePoint);
  });
}

export function normalizeEvidence(value: string): string {
  return decodeEvidenceOnce(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function successful(page: InsightPage): boolean { return page.httpStatus >= 200 && page.httpStatus < 300; }
function audit(page: InsightPage): ReportPageAudit { return page.pageAudit ?? {}; }
function normUrl(url: string): string { return normalizeEvidence(url); }
function sortPages<T extends { url: string }>(pages: T[]): T[] { return [...pages].sort((a, b) => normUrl(a.url).localeCompare(normUrl(b.url))); }
function exactTopic(value: string): TopicMatch[] {
  const normalized = normalizeEvidence(value);
  const matches: TopicMatch[] = [];
  for (const [topic, phrases] of Object.entries(TOPIC_PHRASES) as Array<[Topic, string[]]>) {
    for (const phrase of phrases) {
      const normalizedPhrase = normalizeEvidence(phrase);
      const escaped = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(normalized)) { matches.push({ topic, phrase }); break; }
    }
  }
  return matches;
}
function primaryTopic(page: InsightPage): Topic | null {
  const title = page.title ?? "";
  const h1s = audit(page).h1s ?? [];
  const titleTopics = unique(exactTopic(title).map(match => match.topic));
  if (titleTopics.length !== 1) return null;
  const titleTopic = titleTopics[0];
  return h1s.some(h1 => exactTopic(h1).some(match => match.topic === titleTopic)) ? titleTopic : null;
}
function isArticle(page: InsightPage): boolean {
  let pathname = "";
  try { pathname = new URL(page.url).pathname; } catch { return true; }
  return /(^|\/)(blog|news|articles?|resources?)(\/|$)/i.test(pathname) || /article|blog|news|post/i.test(page.pageType);
}
function serviceCandidate(page: InsightPage): boolean {
  const label = `${page.title ?? ""} ${(audit(page).h1s ?? []).join(" ")}`;
  return !isArticle(page) && (page.pageType === "practice" || page.pageType === "practice-area" || primaryTopic(page) !== null || /\b(?:lawyer|law firm|attorney|service|practice area)\b/i.test(label));
}
function serviceDescriptor(page: InsightPage): string | null {
  const title = (page.title ?? "").replace(/\s*(?:\||-|–|—)\s*[^|–—-]*\b(?:law|firm)\b.*$/i, "");
  const text = `${title} ${(audit(page).h1s ?? []).join(" ")}`;
  let descriptor = normalizeEvidence(text);
  descriptor = descriptor.replace(/\b(?:toronto|north york|ontario|canada|brazil|brasil)\b/g, " ")
    .replace(/\b(?:lawyer|lawyers|attorney|attorneys|law|service|services|in|for|the|a|an|and|best|your|our)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return descriptor.length >= 3 ? descriptor : null;
}
function isUtilityOrOverview(page: InsightPage): boolean {
  return page.pageType === "homepage" || /all (?:our )?(?:services|practice areas)|practice areas|our services/i.test(`${page.title ?? ""} ${(audit(page).h1s ?? []).join(" ")}`);
}
function language(page: InsightPage): "en" | "pt" | null {
  let pathname = "";
  try { pathname = new URL(page.url).pathname.toLowerCase(); } catch { return null; }
  if (/^\/(?:en)(?:\/|$)/.test(pathname)) return "en";
  if (/^\/(?:pt|pt-br|br)(?:\/|$)/.test(pathname)) return "pt";
  const corpus = normalizeEvidence(`${page.title ?? ""} ${(audit(page).h1s ?? []).join(" ")}`);
  if (/[ãõç]/i.test(decodeEvidenceOnce(`${page.title ?? ""} ${(audit(page).h1s ?? []).join(" ")}`))) return "pt";
  if (/\b(?:the|your|for|with|in|and|lawyer|immigration)\b/.test(corpus)) return "en";
  return null;
}
function exactEvidence(ref: string, value: string): string { return `${ref}: “${value}”`; }
function pageFor(page: InsightPage, evidence: string): ReportDecision["pages"][number] {
  return { title: page.title?.trim() || page.url, url: page.url, evidence };
}
function makeInsight(options: Omit<ReportDecision, "pages"> & { pages: ReportDecision["pages"]; ruleId: string; family: string; sortClass: number; sourceFieldRefs: string[]; evidenceBasis: string }): ReportDecision {
  return options;
}

function descriptionPrefixMatch(page: InsightPage): boolean {
  const description = audit(page).metaDescription;
  if (!successful(page) || !description?.trim()) return false;
  const prefix = decodeEvidenceOnce(description).trim();
  const locale = LOCALE_TOKENS.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const uiPhrase = UI_PREFIX_PHRASES.map(phrase => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")).join("|");
  const pattern = new RegExp(`^\\s*(?:${locale})\\s*(?:\\/|\\||,|\\s|(?=(?:${locale})))\\s*(?:${locale})\\s*([+()\\d][+()\\d .-]{6,18})\\s*(?:${uiPhrase})\\b`, "i");
  const match = prefix.match(pattern);
  if (!match) return false;
  const normalizePhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  };
  const digits = normalizePhone(match[1]);
  if (digits.length < 7) return false;
  const recorded = (audit(page).phoneEvidence ?? []).map(normalizePhone).filter(phone => phone.length >= 7);
  return recorded.includes(digits);
}
function ruleOne(pages: InsightPage[]): ReportDecision[] {
  const matched = sortPages(pages.filter(descriptionPrefixMatch));
  if (!matched.length) return [];
  return [makeInsight({
    id: "description-navigation-prefix", ruleId: "R1", family: "description-contamination", sortClass: 1, state: "Improve first",
    title: "Rewrite affected search descriptions",
    observed: `The saved descriptions on ${matched.length} pages begin with language-switch and consultation text before the service wording. Google may choose different wording for search results.`,
    whyItMatters: "A searcher may see navigation and a contact prompt where a short explanation of the service and audience would help identify the page.",
    nextStep: "Have a content reviewer draft a concise service-and-audience description for each listed page. The firm should approve the wording before the web provider updates the published fields.",
    owner: "The firm's content reviewer approves the descriptions. The web provider updates the page fields.",
    verification: "Inspect the published description field for every listed URL. Search engines may still display different wording.",
    pages: matched.map(page => pageFor(page, exactEvidence("Saved meta description", audit(page).metaDescription ?? ""))),
    sourceFieldRefs: matched.map(page => `${page.url}#pageAudit.metaDescription,pageAudit.phoneEvidence`), evidenceBasis: "A bounded locale-pair, recorded-phone and explicit EN/PT contact-prefix match at the start of saved descriptions.",
  })];
}
function faqTopic(heading: string): string | null {
  const decoded = normalizeEvidence(heading);
  const match = decoded.match(/^(?:frequently asked questions about|faqs? about|perguntas frequentes sobre)\s+(.+?)\s*[.!?]?$/u);
  return match?.[1]?.trim() || null;
}
function faqTopicIsPrimaryService(topic: string, page: InsightPage): boolean {
  const named = normalizeEvidence(`${page.title ?? ""} ${(audit(page).h1s ?? []).join(" ")}`);
  if (named.includes(topic)) return true;
  // The saved page labels use dismissal and termination for the same narrow employment matter.
  return /\b(?:wrongful|employment) dismissal\b/.test(topic) && /\b(?:dismissal|termination)\b/.test(named);
}
function ruleTwo(pages: InsightPage[]): ReportDecision[] {
  const groups = new Map<string, Array<{ page: InsightPage; heading: string; descriptor: string }>>();
  for (const page of pages.filter(page => successful(page) && serviceCandidate(page))) {
    const descriptor = serviceDescriptor(page);
    if (!descriptor) continue;
    for (const heading of audit(page).h2s ?? []) {
      const topic = faqTopic(heading);
      if (!topic || faqTopicIsPrimaryService(topic, page)) continue;
      const key = normalizeEvidence(heading);
      const group = groups.get(key) ?? [];
      group.push({ page, heading, descriptor }); groups.set(key, group);
    }
  }
  const out: ReportDecision[] = [];
  for (const [topicKey, candidates] of groups) {
    const uniqueCandidates = new Map<string, typeof candidates[number]>();
    for (const candidate of [...candidates].sort((a, b) => normUrl(a.page.url).localeCompare(normUrl(b.page.url)))) uniqueCandidates.set(candidate.page.url, candidate);
    const distinct = [...uniqueCandidates.values()].sort((a, b) => normUrl(a.page.url).localeCompare(normUrl(b.page.url)));
    const descriptorCount = new Set(distinct.map(candidate => candidate.descriptor)).size;
    if (distinct.length < 2 || descriptorCount < 2) continue;
    out.push(makeInsight({
      id: `faq-context-${topicKey}`, ruleId: "R2", family: "content-context", sortClass: 3, state: "Check context",
      title: "Review FAQ answers",
      observed: `The same topic-specific FAQ heading appears on ${distinct.length} retrieved service pages with different service descriptors. The scan recorded headings only; it did not inspect the complete answers.`,
      whyItMatters: "The questions may help visitors on more than one service page, but the answers need to fit the page where they appear.",
      nextStep: "Ask a qualified reviewer to read the FAQ sections on these pages and decide whether the answers serve each page's topic. Keep relevant material; change wording only if that review confirms a problem.",
      owner: "A qualified content or legal reviewer checks the answers. The firm approves any changes and the web provider publishes them.",
      verification: "Check the approved headings and section wording on each published URL after any agreed revision.",
      pages: distinct.map(({ page, heading }) => pageFor(page, `${exactEvidence("Title", page.title ?? page.url)}; ${exactEvidence("H2", heading)}`)),
      sourceFieldRefs: distinct.map(({ page }) => `${page.url}#title,pageAudit.h1s,pageAudit.h2s`), evidenceBasis: "An exact normalized topic-specific FAQ H2 repeated on at least two retrieved service candidates with distinct descriptors.",
    }));
  }
  return out;
}
function serviceHeadingTopic(heading: string): Topic | null {
  const value = decodeEvidenceOnce(heading).trim();
  if (!value || value.length > 110 || /\?|\b(?:why choose|contact|book|schedule|read more|article|blog)\b/i.test(value)) return null;
  const found = unique(exactTopic(value).map(match => match.topic));
  return found.length === 1 ? found[0] : null;
}
function ruleThree(pages: InsightPage[]): ReportDecision[] {
  const candidates = pages.filter(page => successful(page) && serviceCandidate(page) && !isUtilityOrOverview(page)).map(page => {
    const primary = primaryTopic(page);
    const h2Topics = unique((audit(page).h2s ?? []).map(heading => ({ heading, topic: serviceHeadingTopic(heading) })).filter((item): item is { heading: string; topic: Topic } => item.topic !== null));
    return { page, primary, h2Topics };
  }).filter(item => item.primary && item.h2Topics.some(heading => heading.topic !== item.primary));
  const candidatesWithOthers = candidates.map(item => ({ ...item, others: item.h2Topics.filter(h => h.topic !== item.primary) }));
  const out: ReportDecision[] = [];
  for (const candidate of candidatesWithOthers) {
    const familySet = [...new Set(candidate.others.map(item => item.topic))].sort();
    if (familySet.length < 2) continue;
    const candidateHeadingSet = JSON.stringify([...new Set(candidate.h2Topics.map(item => item.topic))].sort());
    const shared = candidatesWithOthers.filter(other => other.page.url !== candidate.page.url && other.primary !== candidate.primary && JSON.stringify([...new Set(other.h2Topics.map(item => item.topic))].sort()) === candidateHeadingSet);
    if (shared.length) continue;
    const representative = candidate.others.filter((item, index, list) => list.findIndex(other => other.topic === item.topic) === index).slice(0, 4);
    out.push(makeInsight({
      id: `service-heading-context-${candidate.page.url}`, ruleId: "R3", family: "content-context", sortClass: 3, state: "Check context",
      title: "Check how related services are grouped on this page",
      observed: `One retrieved page is identified as ${candidate.primary} by its page title and main heading. Its section headings also name ${familySet.join(", ")}. These headings could be part of a related-services section; the scan cannot establish their page structure or full context.`,
      whyItMatters: "A reader should be able to tell which service the page explains and how related services connect to it.",
      nextStep: "Review whether these topics are clearly grouped as related services or were unintentionally placed in the main service explanation. Do not change the headings until that context is confirmed.",
      owner: "The firm and a qualified content reviewer confirm the intended page structure. The web provider implements any approved changes.",
      verification: "Review the published page's title, main explanation and related-services grouping after any agreed change.",
      pages: [pageFor(candidate.page, `${exactEvidence("Title", candidate.page.title ?? candidate.page.url)}; H1: ${(audit(candidate.page).h1s ?? []).map(value => `“${value}”`).join("; ")}; H2 evidence: ${representative.map(item => `“${item.heading}”`).join("; ")}`)],
      sourceFieldRefs: [`${candidate.page.url}#title,pageAudit.h1s,pageAudit.h2s`], evidenceBasis: "Title and H1 agree on one vocabulary topic; two or more distinct other service families occur in saved H2 headings.",
    }));
  }
  return out;
}
function ruleFour(pages: InsightPage[]): ReportDecision[] {
  const grouped = new Map<string, { topic: Topic; language: "en" | "pt"; pages: InsightPage[] }>();
  for (const page of pages.filter(page => successful(page) && serviceCandidate(page))) {
    const topic = primaryTopic(page);
    const pageLanguage = language(page);
    if (!topic || !pageLanguage) continue;
    const key = `${topic}::${pageLanguage}`;
    const entry = grouped.get(key) ?? { topic, language: pageLanguage, pages: [] };
    entry.pages.push(page); grouped.set(key, entry);
  }
  const out: ReportDecision[] = [];
  for (const { topic, language: pageLanguage, pages: group } of grouped.values()) {
    if (group.length !== 2) continue;
    const [first, second] = sortPages(group);
    const firstLanguage = language(first), secondLanguage = language(second);
    if (!firstLanguage || firstLanguage !== secondLanguage || firstLanguage !== pageLanguage) continue;
    if (normalizeEvidence(first.title ?? "") === normalizeEvidence(second.title ?? "") || normalizeEvidence((audit(first).h1s ?? []).join(" ")) === normalizeEvidence((audit(second).h1s ?? []).join(" "))) continue;
    const descriptors = [serviceDescriptor(first), serviceDescriptor(second)];
    if (!descriptors[0] || !descriptors[1] || descriptors[0] === descriptors[1]) continue;
    const bothShowDifferentPageWording = first.title !== second.title || (audit(first).h1s ?? []).join(" ") !== (audit(second).h1s ?? []).join(" ");
    if (!bothShowDifferentPageWording) continue;
    out.push(makeInsight({
      id: `page-role-${topic}-${firstLanguage}`, ruleId: "R4", family: "intent-decision", sortClass: 2, state: "Confirm intent",
      title: `Agree the roles of these ${topic} pages`,
      observed: `Two retrieved pages are identified as ${topic} pages by their titles and main headings, but their public wording differs. This scan does not measure search performance or establish that either page should be removed.`,
      whyItMatters: "Clear page roles can help the firm and its visitors understand which page provides a broad overview and which addresses a particular audience or need.",
      nextStep: "Decide what each page is for. A valid decision is to keep both, with introductions and navigation that explain their separate roles.",
      owner: "The firm confirms the audience and role of each page. A content reviewer and web provider update approved wording and navigation.",
      verification: "Record an agreed role for each URL and check its published introduction and navigation after any approved update.",
      pages: [first, second].map(page => pageFor(page, `${exactEvidence("Title", page.title ?? page.url)}; H1: ${(audit(page).h1s ?? []).map(value => `“${value}”`).join("; ")}`)),
      sourceFieldRefs: [first, second].map(page => `${page.url}#title,pageAudit.h1s`), evidenceBasis: "Exactly two retrieved same-language service pages share a title-and-H1-supported topic and have different public titles or H1s.",
    }));
  }
  return out;
}

export function buildReportInsights(pages: InsightPage[]): ReportDecision[] {
  const uniquePages = new Map<string, InsightPage>();
  for (const page of [...pages].sort((a, b) => normUrl(a.url).localeCompare(normUrl(b.url)) || JSON.stringify(a).localeCompare(JSON.stringify(b)))) {
    const key = normUrl(page.url);
    if (!uniquePages.has(key)) uniquePages.set(key, page);
  }
  const orderedPages = [...uniquePages.values()];
  return [...ruleOne(orderedPages), ...ruleTwo(orderedPages), ...ruleFour(orderedPages), ...ruleThree(orderedPages)]
    .sort((a, b) => (a.sortClass ?? 99) - (b.sortClass ?? 99) || normalizeEvidence(a.title).localeCompare(normalizeEvidence(b.title)) || (a.pages[0]?.url ?? "").localeCompare(b.pages[0]?.url ?? ""));
}
