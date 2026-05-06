/**
 * /terms
 *
 * Terms of Service for CaseLoad Select. Public-facing, linked from the
 * portal footer and the intake widget. Calibrated for Ontario / LSO Rule
 * 4.2-1: no outcome promises, no "specialist" framing, lawyer-client
 * relationship is between the prospective client and the engaged firm,
 * not between the prospective client and CaseLoad Select.
 */

import Link from "next/link";

export const metadata = {
  title: "Terms of Service · CaseLoad Select",
  description: "Terms governing use of CaseLoad Select intake forms and lawyer-triage workflow on behalf of Canadian law firms.",
};

export default function TermsPage() {
  return (
    <div className="bg-parchment min-h-screen">
      <Header />
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-black/80">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] font-semibold text-gold">CaseLoad Select</p>
          <h1 className="text-3xl font-bold text-navy mt-2">Terms of Service</h1>
          <p className="mt-2 text-sm text-black/50">Last updated: 2026-05-06</p>
        </div>

        <Section title="What CaseLoad Select is">
          <p>
            CaseLoad Select is a case-acquisition and selection service operated by Adriano Domingues. The service provides law firms with intake forms, automated screening, priority scoring, and a lawyer-triage workflow. The firms that engage CaseLoad Select use these tools to evaluate inquiries and decide which matters to take on.
          </p>
          <p>
            CaseLoad Select is not a law firm. It does not provide legal advice. Submitting an intake form does not create a lawyer-client relationship between you and CaseLoad Select. A lawyer-client relationship can only form between you and a law firm after that firm accepts your matter and a written retainer is in place.
          </p>
        </Section>

        <Section title="No outcome promises">
          <p>
            Nothing in CaseLoad Select communications, including automated replies, scoring labels, and priority bands, is a guarantee of any legal outcome, settlement amount, or representation decision. Priority bands describe how the firm prioritises a matter for triage; they do not predict the merits of the matter or the result of any future proceedings.
          </p>
          <p>
            Submission of an intake form does not entitle you to representation by the firm. The firm retains full discretion to accept or decline the matter for any lawful reason.
          </p>
        </Section>

        <Section title="Your obligations">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Provide accurate information when you fill out the intake form. False or misleading information may cause the firm to decline your matter.</li>
            <li>Do not enter sensitive identifiers such as bank-account numbers, credit-card details, government-issued identification numbers, or biometric data into the form.</li>
            <li>Use the service only for lawful purposes. Do not attempt to reverse-engineer the screening logic, scrape the service, or submit large volumes of automated traffic.</li>
            <li>Treat communications you receive from the firm as confidential where the firm marks them so or where context makes clear they are confidential.</li>
          </ul>
        </Section>

        <Section title="Lawyer and operator portal">
          <p>
            The portal at <code>app.caseloadselect.ca</code> is reserved for lawyers and operators who have been authorised by their firm or by CaseLoad Select. Access requires a magic link sent to a registered email address. Sharing the link, the resulting session, or your credentials with anyone else violates these terms.
          </p>
          <p>
            Lawyers may take, pass, or annotate the leads visible to them. Operators may view triage queues and webhook delivery logs across firms for support and quality control. All actions are logged.
          </p>
        </Section>

        <Section title="Service availability">
          <p>
            CaseLoad Select runs on third-party infrastructure (Supabase, Vercel, Resend, OpenAI, GoHighLevel) and inherits their availability. We do not promise specific uptime numbers and do not warrant that the service will be free of interruption or error. Maintenance windows and provider incidents may briefly affect intake form availability.
          </p>
        </Section>

        <Section title="Intellectual property">
          <p>
            The CaseLoad Select name, the brand identity (including the navy and gold colour treatment, the Oxanium and Manrope typography lockups, and the system documentation), the software that runs the intake forms and lawyer triage workflow, and the scoring logic are owned by Adriano Domingues. Firms that engage the service receive a limited, non-exclusive licence to use the configured intake forms on their own website during the term of their engagement.
          </p>
          <p>
            Information you submit through the intake form remains yours. By submitting it, you grant the firm and CaseLoad Select a licence to process it as described in the <Link href="/privacy" className="text-navy underline underline-offset-2">Privacy Policy</Link>.
          </p>
        </Section>

        <Section title="Limitation of liability">
          <p>
            To the fullest extent permitted by Ontario law, neither CaseLoad Select nor Adriano Domingues is liable for indirect, incidental, special, consequential, or punitive damages arising from your use of the service, even if advised of the possibility of those damages. Liability for direct damages is limited to the fees, if any, that you have paid to CaseLoad Select directly in the twelve months preceding the event giving rise to the claim. CaseLoad Select does not collect fees from prospective clients; this clause is included for completeness.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update these terms from time to time. The current version is always available at <Link href="/terms" className="text-navy underline underline-offset-2">app.caseloadselect.ca/terms</Link>. Material changes will be flagged in the portal at the next sign-in.
          </p>
        </Section>

        <Section title="Governing law">
          <p>
            These terms are governed by the laws of the Province of Ontario and the federal laws of Canada applicable in Ontario. Disputes are resolved in the courts of the City of Toronto unless mandatory law requires otherwise.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            CaseLoad Select<br />
            Adriano Domingues, Operator<br />
            Toronto, Ontario, Canada<br />
            <a href="mailto:hello@caseloadselect.ca" className="text-navy underline underline-offset-2">hello@caseloadselect.ca</a>
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
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          <Link href="/terms" className="text-white">Terms</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="pt-8 mt-8 border-t border-black/10 text-xs text-black/50 flex items-center justify-between">
      <span>caseloadselect.ca</span>
      <Link href="/privacy" className="hover:text-navy transition-colors">Privacy Policy</Link>
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
