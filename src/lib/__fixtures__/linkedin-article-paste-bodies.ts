/**
 * Fixture bodies for linkedin-article-paste-pure.test.ts. Each string mimics
 * a stored content_deliverable_versions.body_html value for a LinkedIn
 * Article piece: leading per-line whitespace (the stored-source convention
 * toLinkedInArticleHtml strips), a plain-text headline on the first
 * non-blank line, then HTML paragraphs. Original test content -- not real
 * DRG Law copy -- but structured to match every pattern the CSB doctrine
 * defines: labelled links, a "See"/"Source:" citation, a bare URL, the
 * Five-Line Brief, an FAQ block, a Decision Box, and the DR-082 disclaimer.
 */

/**
 * The comprehensive fixture. Exercises every transform in one pass:
 *  - a labelled link ("label (url)")
 *  - a "See <authority>: <url>" citation
 *  - a "Source: <cite>: <url>" citation
 *  - a bare URL with no surrounding link shape
 *  - an <h2> with no preceding <hr> (-> Subheading, <h3>)
 *  - all five Five-Line Brief labels
 *  - an FAQ block with two question/answer pairs (-> <h2> kept, two <em>
 *    answers)
 *  - a Decision Box whose heading is DELIBERATELY NOT "Six actions before
 *    committing to the sale" -- the original script's one hardcoded week --
 *    to prove the structural (heading text-independent) detection actually
 *    generalizes
 *  - the DR-082 disclaimer, opened with <strong> in storage
 *  - the closing "Related reading" paragraph with two labelled links joined
 *    by "and the"
 */
export const FULL_ARTICLE_BODY = `
      Renewal Clause Basics: What Commercial Tenants Need to Know
      <p>When a commercial tenant reaches the end of a lease term, the renewal clause determines what happens next.</p>
      <p>Read the full analysis on the DRG Law website (https://drglaw.ca/counsel-notes/renewal-clause-basics).</p>
      <p>See the Landlord and Tenant Board: https://tribunalsontario.ca/ltb/</p>
      <p>Source: Commercial Tenancies Act, RSO 1990: https://www.ontario.ca/laws/statute/90c07</p>
      <p>A working checklist is available directly at https://drglaw.ca/resources/renewal-checklist for firms that want one.</p>
      <h2>What the courts have said</h2>
      <p>Ontario courts have repeatedly emphasized strict compliance with notice periods before enforcing a renewal option.</p>
      <p>Risk: A missed notice deadline can forfeit the right to renew entirely.</p>
      <p>Price: Renegotiated rent at renewal is rarely below market once a landlord senses leverage.</p>
      <p>Timeline: Most leases require 90 to 180 days written notice before the term ends.</p>
      <p>Decision: Calendar the notice deadline the day the lease is signed, not the year before it matters.</p>
      <p>Next step: Confirm the exact notice mechanism the lease requires, in writing.</p>
      <h2>Frequently asked questions</h2>
      <p>Does a renewal clause renew automatically?</p>
      <p>No. Almost every commercial lease requires the tenant to give written notice inside a defined window, or the right lapses.</p>
      <p>Can a landlord refuse a valid renewal notice?</p>
      <p>Only on the narrow grounds the lease itself sets out. A validly exercised option is generally binding on both sides.</p>
      <h2>Three questions before signing the lease renewal</h2>
      <p>1. Confirm the renewal window in writing.</p>
      <p>2. Calendar the deadline with a buffer.</p>
      <p>3. Review the rent-reset mechanism before it locks in.</p>
      <p><strong>Legal information, not legal advice.</strong> This article is provided for general information about Ontario law and does not constitute legal advice. Contact DRG Law for advice about your specific situation.</p>
      <p>Related reading on the DRG Law website: the Renewal Clause Basics Counsel Note (https://drglaw.ca/counsel-notes/renewal-clause-basics) and the Clause in the Margin (https://drglaw.ca/clause/renewal-language).</p>
`;

/**
 * A Decision Box using the ORIGINAL script's one hardcoded heading, proving
 * the generalized structural detection still handles that exact week's copy
 * -- the fix is a superset of the old behaviour, not a replacement for it.
 */
export const ORIGINAL_WEEK_DECISION_BOX_BODY = `
      Selling the Business When You Lease the Premises
      <h2>Six actions before committing to the sale</h2>
      <p>1. Confirm whether the lease is assignable.</p>
      <p>2. Ask the landlord for written consent early.</p>
`;

/**
 * A single numbered paragraph -- one, not two or more. Must NOT promote to
 * <ol> (the pattern requires a run of 2+), and because nothing promotes it,
 * the heading above it has no numbered-list neighbour to trigger a divider
 * either, so it downgrades to <h3> like any ordinary Subheading.
 */
export const SINGLE_NUMBERED_PARAGRAPH_BODY = `
      Not Actually a Decision Box
      <h2>Only one step here</h2>
      <p>1. Just one thing to do.</p>
`;

/**
 * A numbered-paragraph run with a plain <p> above it instead of an <h2>.
 * Never seen in real CSB content, but the original script's unconditional
 * ol-promotion regex tolerated it, so the port's fallback pass must too:
 * promotes to <ol>, with no <hr> anywhere (there is no heading to divide).
 */
export const HEADINGLESS_NUMBERED_LIST_BODY = `
      Steps With No Heading Above Them
      <p>Some intro text with no heading right above the list below.</p>
      <p>1. First step.</p>
      <p>2. Second step.</p>
`;

/** Body opening directly with a tag: no plain-text first line, so headline extraction must yield "". */
export const TAG_OPENING_BODY = `<h1>Already a Heading Tag</h1>
      <p>The body starts with a tag, not plain text, so there is no headline to pull out.</p>
`;

/**
 * The production import shape that exposed the W5 defect: section headings
 * are plain paragraphs, the entire Five-Line Brief is one paragraph, and all
 * numbered Decision Box actions are one paragraph.
 */
export const WEEK_FIVE_IMPORTED_BODY = `<p>Before signing, organize the actual transaction record.</p>
<p>Risk: Missing records can hide an obligation. Price: Map every stated and continuing cost. Timeline: Preserve delivery, signing, and payment dates. Decision: Decide whether the file supports qualified review. Next step: Build one indexed working file.</p>
<p>What is the buyer actually deciding?</p>
<p>The buyer is deciding whether the record is ready for review.</p>
<p>Decision Box</p>
<p>1. Preserve every disclosure version. 2. Build Risk, Price, and Timeline summaries. 3. List unresolved questions.</p>
<p>Frequently asked questions</p>
<p>What should I review?</p>
<p>Start with the disclosure package and proposed agreements.</p>
<p>When should I seek review?</p>
<p>Before commitment, with the actual records organized.</p>
<p>A qualified next step</p>
<p>Organize first, then ask for qualified review.</p>`;
