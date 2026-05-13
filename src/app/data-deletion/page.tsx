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
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8 text-black/80">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] font-semibold text-gold">CaseLoad Select</p>
          <h1 className="text-3xl font-bold text-navy mt-2">Data Deletion<span className="text-gold">▪</span></h1>
          <p className="mt-2 text-sm text-black/50">Last updated: 2026-05-13</p>
        </div>

        <Section title="What this page is">
          <p>
            CaseLoad Select operates intake-screening tools on behalf of Canadian law firms. When you submit an inquiry through a firm&rsquo;s intake form, web widget, Facebook Messenger, Instagram DM, WhatsApp, SMS, or voice channel, we store the information you provided so the firm can review it.
          </p>
          <p>
            This page explains how to request deletion of that information from CaseLoad Select&rsquo;s systems. Your rights under the federal Personal Information Protection and Electronic Documents Act (PIPEDA) and applicable provincial law are described in full in our <Link href="/privacy" className="text-navy underline underline-offset-2">Privacy Policy</Link>.
          </p>
        </Section>

        <Section title="How to request deletion">
          <p>
            Send a written request to <a href="mailto:privacy@caseloadselect.ca" className="text-navy underline underline-offset-2">privacy@caseloadselect.ca</a> with the subject line <code>Data Deletion Request</code>. Include:
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Your full name.</li>
            <li>The name of the law firm you contacted (this helps us locate your record across the firms we operate for).</li>
            <li>The email address, phone number, or channel identifier you used when you submitted the inquiry.</li>
            <li>The approximate date of the inquiry, if you remember.</li>
          </ul>
          <p>
            We will confirm receipt within 5 business days and complete the deletion within 30 days, in line with PIPEDA response timelines.
          </p>
        </Section>

        <Section title="What happens after we receive your request">
          <p>
            We anonymize the lead record on our side. This replaces your name, contact details, and free-text description with redacted placeholders, while preserving non-identifying counts (timing, scoring band, stage history) so the firm&rsquo;s aggregate reporting remains accurate. After anonymization, the record no longer identifies you.
          </p>
          <p>
            If you prefer full deletion of the row, ask for it in your message. We will honor the request unless we are required to retain the record by law (for example, a regulatory or court order).
          </p>
        </Section>

        <Section title="What we cannot delete">
          <p>
            If the firm took on your matter and opened a file with you as a client, the firm&rsquo;s own copy of that file is governed by the firm&rsquo;s record-retention policy, not ours. CaseLoad Select deletes its operational copy; the firm&rsquo;s case management system, accounting records, and any documents you signed remain with the firm. Direct deletion requests for those records to the firm.
          </p>
          <p>
            We may keep audit logs (timestamps and action types, with no personal content) for security and dispute-resolution purposes. These logs do not contain the substance of your inquiry.
          </p>
        </Section>

        <Section title="Messages received through Meta channels">
          <p>
            If you contacted the firm through Facebook Messenger, Instagram Direct, or WhatsApp, the messages also exist on Meta&rsquo;s servers under Meta&rsquo;s own retention rules. Deleting your record on our side does not delete it from Meta. To remove the conversation from Meta, use the in-app delete option on the relevant Meta product, or contact Meta directly through their help center.
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
      <div className="max-w-3xl mx-auto flex items-center justify-between">
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
