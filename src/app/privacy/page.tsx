/**
 * /privacy
 *
 * Privacy policy for CaseLoad Select. Public-facing, linked from the portal
 * footer and the intake widget. Covers PIPEDA basics: what we collect, why,
 * how long, who can see it, and how a data subject can exercise their rights.
 *
 * Concrete retention numbers track the data-retention engine in
 * lib/data-retention.ts (band-based: A/B 1095d, C 365d, D 180d, E 30d,
 * unrated 90d). When the engine changes, update the table here too.
 */

import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · CaseLoad Select",
  description: "How CaseLoad Select handles personal information for legal-intake screening on behalf of Canadian law firms.",
};

export default function PrivacyPage() {
  return (
    <div className="bg-parchment min-h-screen">
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-black/80">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] font-semibold text-gold">CaseLoad Select</p>
          <h1 className="text-3xl font-bold text-navy mt-2">Privacy Policy</h1>
          <p className="mt-2 text-sm text-black/50">Last updated: 2026-05-15</p>
        </div>

        <Section title="Who we are">
          <p>
            CaseLoad Select is a case-acquisition and selection service operated by Adriano Domingues, a senior communications strategist based in Toronto, Ontario. The service powers the intake forms and lawyer-triage workflow for the law firms that engage us.
          </p>
          <p>
            When you submit an intake form on a law firm&rsquo;s website, CaseLoad Select acts as a service provider to that firm. The firm is the controller of your information for the purpose of evaluating your matter; we process the information on the firm&rsquo;s behalf under a written agreement.
          </p>
        </Section>

        <Section title="What we collect">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Contact details you provide: name, email address, phone number.</li>
            <li>The matter description you provide during the intake conversation, including answers to follow-up questions and any details you choose to share.</li>
            <li>Technical metadata generated when you use the form: timestamp, the firm whose form you submitted to, and a generated lead identifier.</li>
            <li>Information about how the firm&rsquo;s lawyer or operator handled the lead inside the CaseLoad Select system: scoring, status changes, decision timing.</li>
          </ul>
          <p>
            We do not collect bank-account numbers, credit-card details, government-issued identification numbers, or biometric data through the intake form. Do not enter that information into the form.
          </p>
        </Section>

        <Section title="Channels we receive intake on">
          <p>
            CaseLoad Select receives intake submissions across seven channels. All seven route through the same CaseLoad Screen engine; the channel affects only how the conversation is initiated, not how your data is stored or retained. The web-based screening conversation runs in the CaseLoad Screen SPA at <code>caseload-screen-v2.vercel.app</code> or in the widget embedded on the firm&rsquo;s website.
          </p>
          <div className="overflow-x-auto mt-1">
            <table className="w-full text-sm border border-black/10">
              <thead className="bg-parchment-2 border-b border-black/10">
                <tr className="text-left text-black/50 uppercase tracking-wider text-xs">
                  <th className="px-3 py-2 font-semibold">Channel</th>
                  <th className="px-3 py-2 font-semibold">How intake is initiated</th>
                  <th className="px-3 py-2 font-semibold">Data captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5 text-xs">
                <tr>
                  <td className="px-3 py-2 font-medium">Web widget</td>
                  <td className="px-3 py-2">Form embedded on the firm&rsquo;s website or at <code>app.caseloadselect.ca/widget/[firmId]</code></td>
                  <td className="px-3 py-2">Typed description, follow-up answers, name, email, phone</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">WhatsApp</td>
                  <td className="px-3 py-2">Text conversation via the firm&rsquo;s WhatsApp Business Account on Meta&rsquo;s Cloud API</td>
                  <td className="px-3 py-2">Message text, sender phone number, WhatsApp profile name</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">SMS</td>
                  <td className="px-3 py-2">Text conversation via the firm&rsquo;s GoHighLevel number</td>
                  <td className="px-3 py-2">Message text, mobile phone number</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Voice</td>
                  <td className="px-3 py-2">Inbound phone call handled by GoHighLevel Voice AI; transcript processed server-side</td>
                  <td className="px-3 py-2">Call transcript, caller phone number</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Instagram DM</td>
                  <td className="px-3 py-2">Direct message on the firm&rsquo;s Instagram Business account; received via the Meta Instagram webhook</td>
                  <td className="px-3 py-2">Message text, sender Instagram-Scoped ID</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Facebook Messenger</td>
                  <td className="px-3 py-2">Direct message on the firm&rsquo;s Facebook Page; received via the Meta Messenger webhook</td>
                  <td className="px-3 py-2">Message text, sender Page-Scoped ID</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Google Business Profile chat</td>
                  <td className="px-3 py-2">Message initiated from the firm&rsquo;s Google Business listing, routed through GoHighLevel</td>
                  <td className="px-3 py-2">Message text, Google account name</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            For Instagram DM and Facebook Messenger, Meta Platforms, Inc. processes the conversation before we receive it. Meta&rsquo;s data processing terms govern the conversation layer; our policy applies from the point of receipt into our systems.
          </p>
          <p>
            For Google Business Profile chat, Google LLC processes the conversation before we receive it. Google&rsquo;s privacy terms govern the conversation layer.
          </p>
        </Section>

        <Section title="Why we collect it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>To evaluate whether the matter falls within the firm&rsquo;s scope of practice and to score it for priority.</li>
            <li>To present a structured brief to the firm&rsquo;s lawyer so they can decide quickly whether to take on the matter.</li>
            <li>To send you an automated reply that confirms next steps or, if the matter is outside the firm&rsquo;s scope, suggests an alternative direction.</li>
            <li>To maintain an internal audit trail of how leads were handled by the firm.</li>
          </ul>
        </Section>

        <Section title="Who sees it">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>The lawyer or staff at the firm whose form you submitted to.</li>
            <li>Adriano Domingues, in the role of CaseLoad Select operator, for system administration, support, and quality control.</li>
            <li>The firm&rsquo;s CRM and communication service provider (GoHighLevel) and transactional email provider (Resend), which deliver the firm&rsquo;s automated replies. GoHighLevel handles SMS, voice, and Google Business Profile chat channels on the firm&rsquo;s behalf. WhatsApp, Facebook Messenger, and Instagram DM intakes are received directly by CaseLoad Select from Meta&rsquo;s APIs; the platform does not route those channels through GoHighLevel.</li>
            <li>Supabase Inc. (database hosting, Toronto region) and Vercel Inc. (application hosting), under written service agreements limited to processing on our instructions.</li>
            <li>Google LLC (intake screening via Gemini 2.5 Flash for Screen 2.0 and the voice channel), under Google&rsquo;s data processing terms.</li>
            <li>OpenAI, L.L.C. (intake screening assistance for legacy web widget sessions), under OpenAI&rsquo;s data processing terms.</li>
            <li>Meta Platforms, Inc., for intake that arrives via Facebook Messenger, Instagram Direct, or WhatsApp Cloud API. Meta processes the conversation before it reaches our systems and stores its own copy under Meta&rsquo;s own retention rules. Our policy applies from the point of receipt into the CaseLoad Select webhook. We use Meta&rsquo;s Page Send API and Cloud API messages endpoint to reply within the standard 24-hour customer-service window only.</li>
          </ul>
          <p>
            We do not sell or rent your information. We do not use your information for advertising.
          </p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Retention follows the priority band assigned to the matter at intake. The system anonymizes records past these limits; it does not delete the row, so historical reporting (counts, timing, conversion) remains correct without retaining personal information.
          </p>
          <table className="w-full text-sm border border-black/10 mt-2">
            <thead className="bg-parchment-2 border-b border-black/10">
              <tr className="text-left text-black/50 uppercase tracking-wider text-xs">
                <th className="px-3 py-2 font-semibold">Band</th>
                <th className="px-3 py-2 font-semibold">Retention</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-black/5"><td className="px-3 py-2">A or B</td><td className="px-3 py-2 tabular-nums">1095 days (3 years)</td></tr>
              <tr className="border-b border-black/5"><td className="px-3 py-2">C</td><td className="px-3 py-2 tabular-nums">365 days</td></tr>
              <tr className="border-b border-black/5"><td className="px-3 py-2">D</td><td className="px-3 py-2 tabular-nums">180 days</td></tr>
              <tr className="border-b border-black/5"><td className="px-3 py-2">E</td><td className="px-3 py-2 tabular-nums">30 days</td></tr>
              <tr><td className="px-3 py-2">Unrated</td><td className="px-3 py-2 tabular-nums">90 days</td></tr>
            </tbody>
          </table>
          <p>
            If you become a client of the firm, the firm&rsquo;s own retention rules govern your file from that point on, separate from this policy.
          </p>
        </Section>

        <Section title="Where it lives">
          <p>
            Your data is stored on Supabase infrastructure with Canadian residency, encrypted at rest. Access requires a service-role key held only by the application and by the operator. Backups are retained per Supabase&rsquo;s standard policy. We use TLS for every connection.
          </p>
        </Section>

        <Section title="Your rights">
          <p>
            Under the federal Personal Information Protection and Electronic Documents Act and applicable provincial law, you may:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Ask what information we hold about you.</li>
            <li>Ask us to correct inaccurate information.</li>
            <li>Ask us to delete your record outside the regular retention schedule. Note that if the firm took on your matter, the firm&rsquo;s own record of the matter is governed by the firm&rsquo;s policy, not ours.</li>
            <li>Withdraw consent at any time, subject to legal or contractual restrictions.</li>
          </ul>
          <p>
            Send written requests to <a href="mailto:privacy@caseloadselect.ca" className="text-navy underline underline-offset-2">privacy@caseloadselect.ca</a>. We will respond within 30 days.
          </p>
        </Section>

        <Section title="Follow-up communications">
          <p>
            By submitting an intake form, you provide express consent under Canada&rsquo;s Anti-Spam Legislation (CASL) for the firm and CaseLoad Select to send you electronic messages related to your inquiry. This includes automated replies, status updates, and follow-up messages about your matter.
          </p>
          <p>
            If you receive marketing messages (such as review requests or re-engagement messages from the firm), each message will identify the firm as the sender and include a working unsubscribe mechanism. Unsubscribing from marketing messages does not affect transactional messages directly related to your open matter.
          </p>
        </Section>

        <Section title="Cookies">
          <p>
            The intake form does not use tracking cookies. The lawyer portal uses one functional cookie called <code>portal_session</code> that signs in a lawyer or operator for 30 days. The cookie is HMAC-signed, HTTP-only, and not used for analytics or advertising.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            CaseLoad Select<br />
            Adriano Domingues, Operator<br />
            Toronto, Ontario, Canada<br />
            <a href="mailto:privacy@caseloadselect.ca" className="text-navy underline underline-offset-2">privacy@caseloadselect.ca</a>
          </p>
          <p className="text-sm text-black/60">
            If you cannot resolve a privacy concern with us directly, you may file a complaint with the Office of the Privacy Commissioner of Canada at <a href="https://www.priv.gc.ca" rel="noopener" target="_blank" className="underline underline-offset-2">priv.gc.ca</a>.
          </p>
        </Section>

        <Footer />
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="bg-[#0D1520] border-b-2 border-gold px-6 py-4">
      <div className="max-w-3xl mx-auto flex items-center justify-between">
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.18em] font-semibold text-gold hover:text-white transition-colors">
          CaseLoad Select
        </Link>
        <nav className="flex items-center gap-5 text-xs uppercase tracking-wider text-white/60">
          <Link href="/privacy" className="text-white">Privacy</Link>
          <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="pt-8 mt-8 border-t border-black/10 text-xs text-black/50 flex items-center justify-between">
      <span>caseloadselect.ca</span>
      <Link href="/terms" className="hover:text-navy transition-colors">Terms of Service</Link>
    </footer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-navy">{title}</h2>
      <div className="text-sm leading-relaxed space-y-3">{children}</div>
    </section>
  );
}
