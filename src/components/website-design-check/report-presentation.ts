// Explicit copy mappings from the approved report specification.
export const flagMappings = [
  [
    "pre_checked_consent",
    "Consent starts selected",
    "A data-sharing or consent control appears selected by default.",
    "Ask your website editor to make the choice affirmative and explain what the control covers.",
    "Website editor",
    "none"
  ],
  [
    "manufactured_urgency",
    "Urgency signal detected",
    "A countdown or scarcity cue was detected.",
    "Ask your website editor to verify the deadline or quantity and remove unsupported urgency.",
    "Firm owner",
    "none"
  ],
  [
    "exit_intent_popup",
    "Exit pop-up detected",
    "The detector marked an exit-intent pop-up pattern; inspect the evidence before describing behavior.",
    "Ask your website editor whether the prompt is needed and ensure it can be dismissed.",
    "Website editor",
    "none"
  ],
  [
    "bandwagon_claim_without_proof",
    "Number needs a source",
    "A numeric popularity or volume claim lacks visible support in the inspected content.",
    "Ask the firm owner to verify the number and add its source beside the claim if substantiated.",
    "Firm owner",
    "Claim support"
  ],
  [
    "contrast_failure",
    "Text contrast needs review",
    "A sampled text/background pair fell below the checker threshold.",
    "Ask your website editor to adjust the sampled colors and recheck the measured pair.",
    "Website editor",
    "Text contrast"
  ],
  [
    "self_designation_without_proof",
    "Self-description needs support",
    "A distinction or superlative was detected without a visible basis in the inspected content.",
    "Ask the firm owner to verify the wording and supporting evidence before changing it.",
    "Firm owner",
    "Claim support"
  ],
  [
    "generic_full_service",
    "Practice focus is broad",
    "The page presents a broad practice list without a clearly named primary focus.",
    "Ask the firm owner which practice focus should lead, then ask your editor to reflect that choice.",
    "Firm owner",
    "none"
  ],
  [
    "no_author_entity",
    "Author attribution is unclear",
    "The scan did not find a named author entity for the inspected content.",
    "Ask the firm owner to confirm authorship and credentials before adding a byline or profile markup.",
    "Firm owner",
    "none"
  ],
  [
    "unattributed_testimonials",
    "Testimonial attribution is unclear",
    "One or more detected testimonial blocks lack visible attribution.",
    "Ask the firm owner to verify attribution and permission before publishing identifying details.",
    "Firm owner",
    "Testimonial attribution"
  ],
  [
    "lso_specialist_expert_unearned",
    "Credential wording needs review",
    "The detector found specialist or expert wording without a matching designation in the inspected text.",
    "Ask the firm owner to review this wording and its supporting evidence before changing the page.",
    "Firm owner",
    "none"
  ],
  [
    "lso_prohibited_word",
    "Word choice needs review",
    "The detector matched wording on its configured review list.",
    "Ask the firm owner to review this wording and its supporting evidence before changing the page.",
    "Firm owner",
    "none"
  ],
  [
    "lso_aggressive_framing",
    "Promotional wording needs review",
    "The detector matched promotional wording configured for review.",
    "Ask the firm owner to review this wording and its supporting evidence before changing the page.",
    "Firm owner",
    "none"
  ],
  [
    "possible_outcome_guarantee",
    "Outcome wording needs review",
    "The detector matched wording that may read as an outcome assurance.",
    "Ask the firm owner to review this wording and its supporting evidence before changing the page.",
    "Firm owner",
    "none"
  ],
  [
    "color_only_status",
    "Status needs another cue",
    "The scan detected status communicated by color alone.",
    "Ask your website editor to add a visible text or shape cue and recheck the state.",
    "Website editor",
    "none"
  ],
  [
    "bait_reciprocity",
    "Offer appears after a step",
    "The detector marked a gated-offer pattern; inspect the evidence before describing sequence.",
    "Ask your website editor to show the offer and its conditions before requesting visitor information.",
    "Website editor",
    "none"
  ]
];
export const ordinaryMappings = [
  [
    "Exact identity (dimension",
    "label)",
    "Title",
    "Why",
    "Next action",
    "Owner",
    "Group"
  ],
  [
    "Typography and Legibility",
    "Body line length",
    "Text lines are short",
    "The sampled average is below the checker’s 45–75 character range.",
    "Ask your website editor to widen the text column.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "Body line length",
    "Text lines are long",
    "The sampled average is above the checker’s 45–75 character range.",
    "Ask your website editor to narrow the text column so lines are easier to track.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "Body line height",
    "Line spacing is tight",
    "Sampled body line-height averages below the 120–145% range.",
    "Ask your website editor to increase body-copy line height, then recheck the rendered text.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "Body line height",
    "Line spacing is loose",
    "Sampled body line-height averages above the 120–145% range.",
    "Ask your website editor to reduce body-copy line height, then recheck the rendered text.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "All-caps body copy",
    "Body copy uses capitals",
    "Paragraph-length text is set to uppercase in the inspected sample.",
    "Ask your website editor to reserve uppercase for short labels and use normal case for paragraphs.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "Justified text on narrow columns",
    "Narrow text is justified",
    "The scan found fully justified text in a column under 400 pixels wide.",
    "Ask your website editor to use ragged-right alignment in the affected narrow column.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "Single H1",
    "Main heading structure needs review",
    "The scan found zero or multiple H1 elements.",
    "Ask your website editor to keep one H1 as the page’s main heading.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "No skipped heading levels",
    "Heading levels skip",
    "The inspected heading sequence skips a level.",
    "Ask your website editor to add the missing level or restructure the heading sequence.",
    "Website editor",
    "none"
  ],
  [
    "Color and Contrast",
    "Text contrast",
    "Sampled text contrast is low",
    "A sampled text/background pair falls below the checker threshold.",
    "Ask your website editor to adjust the sampled colors and recheck the measured pair.",
    "Website editor",
    "Text contrast"
  ],
  [
    "Forms and Conversion Flow",
    "Form field count",
    "Form asks for many fields",
    "The detected form exceeds the checker’s field-count guidance.",
    "Ask the firm owner which fields are essential for the next action and defer the rest when appropriate.",
    "Firm owner",
    "none"
  ],
  [
    "Forms and Conversion Flow",
    "Field labels",
    "Field labels need review",
    "One or more detected fields rely on placeholder text instead of a persistent label.",
    "Ask your website editor to add a persistent label to each affected field.",
    "Website editor",
    "none"
  ],
  [
    "Forms and Conversion Flow",
    "Required-field markers explained",
    "Required marker is unclear",
    "The scan found a required marker without visible explanation.",
    "Ask your website editor to explain the required marker in visible text.",
    "Website editor",
    "none"
  ],
  [
    "Mobile and Responsive",
    "Viewport meta tag",
    "Mobile viewport needs review",
    "The viewport setting is missing or does not match device width.",
    "Ask your developer to set the viewport to device width and an initial scale of one.",
    "Developer",
    "none"
  ],
  [
    "Mobile and Responsive",
    "Horizontal overflow",
    "Page exceeds viewport width",
    "The scan detected horizontal overflow at the tested mobile width.",
    "Ask your developer to locate the overflowing element and constrain it to the viewport.",
    "Developer",
    "none"
  ],
  [
    "Mobile and Responsive",
    "Tap target size",
    "Tap targets are small",
    "One or more sampled interactive targets fall below the checker’s minimum size.",
    "Ask your website editor to increase padding on the affected links or buttons.",
    "Website editor",
    "none"
  ],
  [
    "Mobile and Responsive",
    "Hamburger menu label",
    "Menu control needs a name",
    "The detected menu toggle lacks a visible or programmatic name.",
    "Ask your developer to add a visible Menu label or an accessible name.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Largest Contentful Paint",
    "Main content loads slowly",
    "The measured load is in the needs-improvement range.",
    "Ask your developer to inspect and optimize the largest above-the-fold element.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Largest Contentful Paint",
    "Main content load needs work",
    "The measured load exceeds the checker’s poor-range threshold.",
    "Ask your developer to compress and preload the largest above-the-fold asset and inspect blocking resources.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Cumulative Layout Shift",
    "Layout shifts during load",
    "The measured score is in the needs-improvement range.",
    "Ask your developer to reserve space for images and late-loading content.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Cumulative Layout Shift",
    "Layout shift needs work",
    "The measured score exceeds the checker’s poor-range threshold.",
    "Ask your developer to set image dimensions and reserve space for late-loading content.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Total Blocking Time",
    "Main thread is blocked",
    "The lab measure is elevated during load.",
    "Ask your developer to split long JavaScript tasks and defer non-critical scripts.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Total Blocking Time",
    "Main thread blocking is high",
    "The lab measure shows heavy blocking during load.",
    "Ask your developer to defer or remove non-critical JavaScript and split remaining long tasks.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Logo format",
    "Logo format can improve",
    "The detected logo is not served as SVG.",
    "Ask your developer whether an SVG source is available and suitable for this logo.",
    "Developer",
    "none"
  ],
  [
    "Performance and Technical Health",
    "Modern image formats",
    "Images can be lighter",
    "Some sampled images use formats outside WebP or AVIF.",
    "Ask your developer to serve suitable images as WebP or AVIF where supported.",
    "Developer",
    "none"
  ],
  [
    "Spacing, Grid, and Alignment (partial: scale adherence only)",
    "Spacing scale adherence",
    "Spacing scale is inconsistent",
    "Sampled spacing values do not consistently follow the measured scale.",
    "Ask your website editor to review the sampled values against one deliberate spacing scale.",
    "Website editor",
    "none"
  ],
  [
    "Authority and Positioning",
    "Meta title and description present",
    "Page description is missing",
    "The inspected page lacks a meta description.",
    "Ask your website editor to draft a page description that accurately names its focus and location.",
    "Website editor",
    "none"
  ],
  [
    "Authority and Positioning",
    "Meta title and description present",
    "Page title is generic",
    "The inspected title does not clearly name the practice focus and location.",
    "Ask your website editor to review the title for an accurate practice focus and location.",
    "Website editor",
    "none"
  ],
  [
    "Authority and Positioning",
    "Named focus vs. generic full-service list",
    "Practice focus is broad",
    "Detected practice areas appear equally weighted without a named primary focus.",
    "Ask the firm owner which focus should lead, then ask your editor to reflect that choice.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Named author entity present",
    "Author attribution is missing",
    "No named author entity was detected for the inspected content.",
    "Ask the firm owner to confirm authorship and credentials before adding attribution.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Named author entity present",
    "Author profile is not linked",
    "The detected byline has no linked profile.",
    "Ask the firm owner to confirm a suitable profile, then ask your editor to link it.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Person schema present",
    "Author markup is missing",
    "The scan did not detect Person structured data for the named author.",
    "Ask your developer to confirm the author details and add accurate Person markup if appropriate.",
    "Developer",
    "none"
  ],
  [
    "Authority and Positioning",
    "Review or rating structured data",
    "Review markup is missing",
    "No review or rating structured data was detected.",
    "Ask your developer to review whether accurate structured data is appropriate for this page.",
    "Developer",
    "none"
  ],
  [
    "Authority and Positioning",
    "Review or rating structured data",
    "Review count is missing",
    "Rating markup was detected without a review count.",
    "Ask your firm owner to verify the source and count before updating structured data.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Testimonial attribution",
    "Testimonials need attribution review",
    "Detected testimonial blocks do not all carry visible attribution.",
    "Ask the firm owner to verify attribution and permission before publishing identifying details.",
    "Firm owner",
    "Testimonial attribution"
  ],
  [
    "Authority and Positioning",
    "Named credentials or association membership",
    "Credentials need review",
    "The inspected copy does not name a verifiable credential or membership.",
    "Ask the firm owner to confirm credentials and evidence before deciding whether to display them.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Message consistency across home, about, and service pages",
    "Page messages differ",
    "The inspected page messages are not consistent on the compared themes.",
    "Ask the firm owner to confirm the intended positioning, then review the affected pages.",
    "Firm owner",
    "none"
  ],
  [
    "First Impression and Clarity",
    "Value and audience clear above the fold, one action wins the eye",
    "First view needs clarity",
    "The vision judgment identified an unclear value, audience, or leading action.",
    "Ask your website editor to review the first-screen message and make the intended action clear.",
    "Website editor",
    "none"
  ],
  [
    "Visual Hierarchy and Composition",
    "Visual hierarchy",
    "Visual hierarchy needs review",
    "The vision judgment identified competing or unclear visual emphasis.",
    "Ask your website editor to review which page element should lead and adjust emphasis accordingly.",
    "Website editor",
    "none"
  ],
  [
    "Visual Hierarchy and Composition",
    "Grid and alignment",
    "Alignment needs review",
    "The vision judgment identified inconsistent alignment or grid use.",
    "Ask your website editor to review the affected alignment against the page’s content structure.",
    "Website editor",
    "none"
  ],
  [
    "Visual Hierarchy and Composition",
    "Composition and whitespace",
    "Composition needs review",
    "The vision judgment identified an imbalance in composition or whitespace.",
    "Ask your website editor to review the affected section’s spacing and grouping.",
    "Website editor",
    "none"
  ],
  [
    "Typography and Legibility",
    "Headline-to-subline contrast",
    "Heading levels look similar",
    "The measured H1-to-H2 size ratio is below the checker threshold.",
    "Ask your website editor to review the size or weight difference between the first two heading levels.",
    "Website editor",
    "none"
  ],
  [
    "Authority and Positioning",
    "About or team page linked",
    "About or team link is missing",
    "No matching About or team page link was found in navigation or footer.",
    "Ask the firm owner whether an About or team page exists, then ask your editor to link it.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Organization schema present",
    "Organization markup is missing",
    "The scan found no Organization-family structured data.",
    "Ask your developer to confirm the firm details and add accurate markup if appropriate.",
    "Developer",
    "none"
  ],
  [
    "Authority and Positioning",
    "Name, address, and phone visible on this page",
    "Contact details need review",
    "The scan found both, either, or neither of a phone number and street address in page text.",
    "Ask your firm owner to confirm the public contact details and ask your editor to show accurate details.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "Legal-information disclaimer present",
    "Legal wording needs review",
    "The detector did not find the searched disclaimer wording in visible page text.",
    "Ask the firm owner to review this wording and its supporting evidence before making a change.",
    "Firm owner",
    "none"
  ],
  [
    "Authority and Positioning",
    "HTTPS",
    "Connection security needs review",
    "The scanned page was not served over HTTPS.",
    "Ask your developer to serve the site over HTTPS with a valid certificate.",
    "Developer",
    "none"
  ],
  [
    "Authority and Positioning",
    "Naked self-designation claims",
    "Claim wording needs review",
    "The detector found strong-quality wording without adjacent detected proof.",
    "Ask the firm owner to review this wording and its supporting evidence before making a change.",
    "Firm owner",
    "Claim support"
  ],
  [
    "Authority and Positioning",
    "LSO Rule 4.2-1: \"specialist\"/\"expert\" without the Certified Specialist designation",
    "Credential wording needs review",
    "The detector matched specialist or expert wording without finding the named designation in context.",
    "Ask the firm owner to review this wording and its supporting evidence before making a change.",
    "Firm owner",
    "none"
  ]
];

import type { DesignCheckResult, RankedFinding, RedFlag } from './WebsiteDesignCheckReport';

type Copy = { title: string; why: string; action: string; owner: string; group: string };
export type PresentationFinding = { source: RankedFinding; flag?: RedFlag; copy: Copy; evidence: string; status: string };
export type FindingGroup = { copy: Copy; findings: PresentationFinding[]; status: string };
const fallback: Copy = { title: 'Review this automated finding.', why: 'This signal needs review before choosing a change.', action: 'Ask your website editor to review the full finding before changing the page.', owner: 'Website editor', group: 'none' };
const legalKeys = new Set(['lso_specialist_expert_unearned','lso_prohibited_word','lso_aggressive_framing','possible_outcome_guarantee']);
const legalLabels = new Set(['Legal-information disclaimer present','LSO Rule 4.2-1: "specialist"/"expert" without the Certified Specialist designation']);
const legalAction = 'Ask the firm owner to review this wording and its supporting evidence before making a change.';
const legalCaveat = 'Automated detector statement, not a verified legal conclusion.';
function mapped(row: string[] | undefined, offset: number): Copy {
 if (!row) return fallback;
 return {title: row[offset], why: row[offset+1], action: row[offset+2], owner: row[offset+3], group: row[offset+4]};
}
export function matchFlag(f: RankedFinding, flags: RedFlag[]): RedFlag | undefined {
 if (f.flagKey) return flags.find(x => x.key === f.flagKey);
 const matches = flags.filter(x => x.label === f.label);
 return matches.length === 1 ? matches[0] : undefined;
}
function ordinaryRow(f: RankedFinding): string[] | undefined {
 const rows = ordinaryMappings.filter(r => r[0] === f.dimension && r[1] === f.label);
 if (rows.length < 2) return rows[0];
 const e = f.evidence.toLowerCase();
 let index = 0;
 if (f.label === 'Body line length') index = e.includes('wider than') ? 1 : 0;
 else if (f.label === 'Body line height') index = e.includes('looser than') ? 1 : 0;
 else if (['Largest Contentful Paint','Cumulative Layout Shift','Total Blocking Time'].includes(f.label)) index = e.includes('poor') || e.includes('heavy main-thread') ? 1 : 0;
 else if (f.label === 'Meta title and description present') {
  if (e === 'no meta title found.') return [f.dimension, f.label, 'Page title is missing', 'The inspected page lacks a meta title.', 'Ask your website editor to draft an accurate title naming the page’s practice focus and location.', 'Website editor', 'none'];
  if (e === 'no meta title or description found.') return [f.dimension, f.label, 'Page title and description are missing', 'The inspected page lacks a meta title and description.', 'Ask your website editor to draft an accurate title and description naming the page’s practice focus and location.', 'Website editor', 'none'];
  index = e.includes('description') ? 0 : 1;
 }
 else if (f.label === 'Named author entity present') index = e.includes('byline is present') ? 1 : 0;
 else if (f.label === 'Review or rating structured data') index = e.includes('found but') ? 1 : 0;
 return rows[index];
}
export function displayEvidence(f: RankedFinding): string {
 return f.dimension === 'Performance and Technical Health' && f.label === 'Largest Contentful Paint'
  ? f.evidence.replace('Conversions fall roughly 7% for every second past 3s.', '').trim() : f.evidence;
}
export function presentFinding(f: RankedFinding, flags: RedFlag[]): PresentationFinding {
 const flag = f.severity === 'flag' ? matchFlag(f,flags) : undefined;
 const key = f.flagKey || flag?.key;
 let copy = f.severity === 'flag' ? mapped(flagMappings.find(r => r[0] === key),1) : mapped(ordinaryRow(f),2);
 const legal = !!key && legalKeys.has(key) || legalLabels.has(f.label);
 if (legal) copy = {...copy, action: legalAction, owner: 'Firm owner'};
 const evidence = `${legal ? legalCaveat + ' ' : ''}${displayEvidence(f)}`;
 const status = flag?.confidence === 'best_effort' ? 'Needs confirmation' : flag?.confidence === 'proven' ? 'Confirmed' : 'Confidence not supplied';
 return {source:f, flag, copy, evidence, status};
}
export function groups(result: DesignCheckResult): FindingGroup[] {
 const out: FindingGroup[] = [];
 for (const source of result.rankedFindings) {
  const item = presentFinding(source,result.redFlagPanel.activeFlags);
  const existing = item.copy.group !== 'none' ? out.find(g => g.copy.group === item.copy.group) : undefined;
  if (existing) { existing.findings.push(item); if (item.status === 'Needs confirmation') existing.status = item.status; else if (item.status === 'Confidence not supplied' && existing.status !== 'Needs confirmation') existing.status = item.status; }
  else out.push({copy:item.copy, findings:[item], status:item.status});
 }
 return out;
}
export function coverageText(result: DesignCheckResult): string {
 const c = result.judgmentCoverage;
 return !c ? 'Visual capture coverage was not supplied.' : c.wholePage ? 'The desktop screenshot was not clipped.' : `Visual-review capture was limited to the top ${c.judgedTopPx} pixels of a ${c.actualPageHeightPx}-pixel homepage.`;
}
export function assessment(result: DesignCheckResult, priorities: FindingGroup[]): string {
 const measured = result.dimensionBar.filter(d => d.score !== null).sort((a,b) => (b.score ?? 0) - (a.score ?? 0));
 const first = measured.length && (measured[0].score ?? 0) >= 85 ? `${measured[0].name} scored ${measured[0].score}/100 against this tool’s rubric.` : 'This automated check reviewed the homepage on mobile and desktop.';
 return `${first} ${priorities.length ? 'Start with the selected priorities below.' : 'No actionable findings were selected, which does not establish that the entire website is issue-free.'}`;
}
export function groupAction(group: FindingGroup): string {
 if (group.findings.length < 2) return group.copy.action;
 switch (group.copy.group) {
  case 'Claim support': return 'Ask the firm owner to review the highlighted claims and add supporting evidence where the claims are accurate.';
  case 'Testimonial attribution': return 'Ask the firm owner to verify attribution and permission before publishing identifying details.';
  case 'Text contrast': return 'Ask your website editor to adjust the sampled colors and recheck the measured pair.';
  default: return group.copy.action;
 }
}
export function copyPlan(result: DesignCheckResult, priorities: FindingGroup[]): string {
 const lines = [result.domain, `Checked ${new Date(result.checkedAt).toLocaleDateString()}`, 'Automated homepage check · Mobile and desktop.', assessment(result,priorities), ''];
 priorities.forEach((g,i) => { lines.push(`${i+1}. ${g.copy.title}`, `Found: ${g.findings.map(x => x.evidence).join(" ")}`, `Why: ${g.copy.why}`, `Change: ${groupAction(g)}`, `Suggested owner: ${g.copy.owner}`, `Status: ${g.status}${g.findings.length > 1 ? "; combines related findings" : ""}`, ''); });
 const flags = result.redFlagPanel.activeFlags.filter(f=>f.classification === 'disqualifying');
 if (flags.length) { lines.push('Grade-limiting notices:'); flags.forEach(f=>lines.push(`${f.label}: ${f.confidence === 'best_effort' ? 'Needs confirmation' : f.confidence === 'proven' ? 'Confirmed' : 'Confidence not supplied'}`)); }
 lines.push('After making changes, run this homepage check again.'); return lines.join('\n');
}
