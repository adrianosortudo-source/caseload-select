/**
 * /data-deletion
 *
 * User-data-deletion instructions page. Required by Meta for any app that
 * touches user data (Messenger, Instagram Graph API, WhatsApp Cloud API).
 * This page tells a person who interacted with CaseLoad Select on behalf
 * of a client firm how to request deletion of their record.
 *
 * The substance overlaps with /privacy (PIPEDA s. 4.9 right of access /
 * correction / deletion), but Meta requires a distinct URL so we host
 * the procedure on its own page. Keep both pages in sync when retention
 * rules or contact addresses change.
 */

import Link from "next/link";

export const metadata = {
  title: "Data Deletion · CaseLoad Select",
  description: "How to request deletion of personal information CaseLoad Select holds on behalf of a Canadian law firm.",
};

export default function DataDeletionPage() {
  return (
    <div className="bg-parchment min-h-screen">
      <Header />
      <main className="max-w-3xl mx-auto px-3 py-10 space-y-8 text-black/80 sm:px-6">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] font-semibold text-gold">CaseLoad Select</p>
          <h1 className="text-3xl font-bold text-navy mt-2">Data Deletion<span className="text-gold">▪</span></h1>
          <p className="mt-2 text-sm text-black/50">Last updated: 2026-09-04</p>
        </div>

        <Section title="What this page covers">
          <p>
            CaseLoad Select operates intake-screening tools on behalf of Canadian law firms. When you submit an inquiry through a firm&rsquo;s intake form, web widget, Facebook Messenger, Instagram DM, WhatsApp, SMS, or voice channel, we store the information you provided so the firm can review it.
          </p>
          <p>
            This page explains how to request removal of identifying information from the operational systems CaseLoad Select controls. Our <Link href="/privacy" className="text-navy underline underline-offset-2">Privacy Policy</Link> describes how we handle personal information more broadly.
          </p>
        </Section>

        <Section title="How to request deletion">
          <p>
            Send a written request to <a href="mailto:privacy@caseloadselect.ca" className="text-navy underline underline-offset-2">privacy@caseloadselect.ca</a> with the subject line <code className="whitespace-nowrap">Data Deletion Request</code>. Include:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Your full name.</li>
            <li>The name of the law firm you contacted (this helps us locate your record across the firms we operate for).</li>
            <li>The email address, phone number, or channel identifier you used when you submitted the inquiry.</li>
            <li>The approximate date of the inquiry, if you remember.</li>
          </ul>
          <p>
            We will confirm receipt within 5 business days. We aim to complete a verified request within 30 days or explain why more time is needed.
          </p>
        </Section>

        <Section title="What happens after a verified request">
          <p>
            For screened leads, CaseLoad Select uses a restricted database operation to irreversibly remove message content and direct identifiers from the operational copies it controls. This includes names, contact details, channel identifiers, message identifiers, transcripts, and free-text descriptions. The matched fields are cleared or replaced with redacted markers and cannot be reconstructed through the application.
          </p>
          <p>
            Older intake records follow a separate recovery-aware process that clears the matched lead, its linked intake session, queued payloads, and its intake-attachment folder. We keep a request open if any required cleanup or verification step fails.
          </p>
          <p>
            We do not promise that every database row will be physically deleted. We may preserve a limited audit record for system security, delivery-integrity checks, proof that deletion was completed, and aggregate reporting. It excludes names, contact details, message content, platform sender IDs, and platform message IDs. Retained channel audit events have a three-year retention period measured from the original event. Separate deletion-request and anti-recontact suppression records are retained for their deletion-proof and re-collection-prevention purposes only.
          </p>
          <p>
            If a legal obligation prevents us from removing a specific item, we will explain the item, the reason, and the expected retention period when we respond.
          </p>
        </Section>

        <Section title="Records controlled by the law firm">
          <p>
            The law firm controls its own legal files. If the firm took on your matter or copied information into its case-management, accounting, email, or document systems, its retention duties and policies apply to those copies. Direct a request about those records to the firm.
          </p>
          <p>
            Removing the CaseLoad Select operational copy does not authorize us to erase a firm&rsquo;s legal file. We will identify the relevant firm when we can so you can contact it directly.
          </p>
        </Section>

        <Section title="Processors, external platforms, and backups">
          <p>
            When a service provider may hold an active copy on our behalf, a privileged operator records the provider-specific disposition after checking the applicable deletion or escalation step. A completed or not-applicable status is the operator&rsquo;s attestation, not provider-issued evidence. A provider-managed status is only a routing marker and cannot, by itself, close external cleanup.
          </p>
          <p>
            Application-level recovery controls keep encrypted deletion instructions outside the operational database and block normal use until those instructions are replayed and verified after a restore. We tested that control with fictional data in a transactional logical-restore simulation. This was not a managed Supabase backup or point-in-time recovery rehearsal. Provider-managed backup copies may remain until the provider&rsquo;s retention or backup cycle expires.
          </p>
          <p>
            Facebook Messenger, Instagram Direct, WhatsApp, Google, and other communication platforms control copies created in their own products before the information reaches CaseLoad Select. Deleting the CaseLoad Select copy does not delete those platform-controlled copies. Use the platform&rsquo;s deletion controls or contact the platform directly.
          </p>
        </Section>

        <Section title="Contact">
          <address className="not-italic">
            <span className="block">CaseLoad Select</span>
            <span className="block">Adriano Domingues, Operator</span>
            <span className="block">Toronto, Ontario, Canada</span>
            <a href="mailto:privacy@caseloadselect.ca" className="text-navy underline underline-offset-2">privacy@caseloadselect.ca</a>
          </address>
          <p className="text-sm text-black/60">
            If you cannot resolve a deletion request with us directly, you may file a complaint with the Office of the Privacy Commissioner of Canada at <a href="https://www.priv.gc.ca" rel="noopener" target="_blank" className="underline underline-offset-2">priv.gc.ca</a>.
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
      <div className="max-w-3xl mx-auto flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="font-mono text-[11px] uppercase tracking-[0.18em] font-semibold text-gold hover:text-white transition-colors">
          CaseLoad Select
        </Link>
        <nav className="flex items-center gap-5 text-xs uppercase tracking-wider text-white/60">
          <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
          <Link href="/data-deletion" className="text-white">Data Deletion</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="pt-8 mt-8 border-t border-black/10 text-xs text-black/50 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
      <span>caseloadselect.ca</span>
      <Link href="/privacy" className="hover:text-navy transition-colors">Privacy Policy</Link>
    </footer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3" data-ui-component-content={`data-deletion-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}>
      <h2 className="w-full text-lg font-bold text-navy text-balance" data-ui-copy="heading">{title}</h2>
      <div className="w-full text-sm leading-relaxed space-y-3 [&>p]:text-pretty [&>ul>li]:text-pretty" data-ui-copy="body">{children}</div>
    </section>
  );
}
