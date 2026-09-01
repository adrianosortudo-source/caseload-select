const IMPORT_PATH = [
  {
    label: "In your browser",
    title: "The CSV is checked locally",
    body: "The file is opened, validated and fingerprinted by code running in this browser. The original CSV is not uploaded to CaseLoad Select, HighLevel, email or a cloud file-storage bucket.",
  },
  {
    label: "After you authorize",
    title: "Only normalized rows leave the browser",
    body: "A six-digit code and a firm-authority statement from an authorized firm lawyer or administrator are required. Then groups of up to 25 normalized contact rows travel over HTTPS through the protected CaseLoad Select import endpoint.",
  },
  {
    label: "Your CRM location",
    title: "Rows are forwarded to an isolated account",
    body: "The server pairs a firm-specific credential with the firm's configured HighLevel location ID before forwarding a row. The credential is never exposed to the browser or to the person preparing the spreadsheet.",
  },
  {
    label: "Safe starting state",
    title: "New records begin suppressed",
    body: "Every new contact starts with global do-not-disturb and an import-hold tag. Exact email and phone checks run first; an existing contact is left unchanged and ambiguous matches are held and require reconciliation.",
  },
] as const;

const FIELD_NOTES: ReadonlyArray<{
  fields: readonly string[];
  joiner?: string;
  need: string;
  body: string;
}> = [
  {
    fields: ["first_name", "last_name"],
    joiner: "or",
    need: "Identity",
    body: "Identifies the person. Use both when known; at least one name is required.",
  },
  {
    fields: ["email", "phone"],
    joiner: "or",
    need: "Identity check",
    body: "Used for exact duplicate checks and the contact record. At least one is required.",
  },
  {
    fields: ["relationship_type"],
    need: "Required",
    body: "Classifies the person as current, former, prospective, referral source or unknown.",
  },
  {
    fields: ["practice_area"],
    need: "Optional",
    body: "Supports useful grouping without adding matter facts or privileged details.",
  },
  {
    fields: ["matter_closed_year"],
    need: "Optional",
    body: "A four-digit year that helps assess relationship timing. Leave blank if not applicable.",
  },
  {
    fields: ["marketing_permission"],
    need: "Required",
    body: "Records express, implied, unknown or no_contact. Importing never creates consent; unknown is the safe default.",
  },
] as const;

const SECURITY_LINKS = [
  {
    label: "HighLevel Trust Center",
    href: "https://trust.upguard.com/f69cca6d-517e-4220-ac1b-c61fa7ce0d76",
  },
  {
    label: "Security and Compliance Overview",
    href: "https://help.gohighlevel.com/support/solutions/articles/155000000574-highlevel-security-and-compliance-overview",
  },
  {
    label: "Data Processing Addendum",
    href: "https://www.gohighlevel.com/data-processing-agreement",
  },
  {
    label: "Subprocessor Register",
    href: "https://www.gohighlevel.com/sub-processors",
  },
] as const;

export default function SecureImportTrustGuide() {
  return (
    <div className="readable-prose space-y-6">
      <section className="border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="data-path-heading">
        <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-black/65">How your data moves</p>
        <h2 id="data-path-heading" className="measure-heading mt-1 text-xl font-bold text-navy sm:text-2xl">
          Your spreadsheet is never handed to CaseLoad Select staff
        </h2>
        <p className="mt-3 text-sm leading-6 text-black/65">
          The raw file stays under your control. CaseLoad Select staff do not receive it, download it or prepare it for you.
          After an authorized firm lawyer or administrator approves the import, our service temporarily processes only the
          normalized contact rows needed to complete that instruction. Those rows are forwarded to the firm&apos;s CRM and are
          not saved in the CaseLoad Select database.
        </p>

        <ol className="mt-6 grid list-none gap-px border border-black/10 bg-black/10 p-0 md:grid-cols-2">
          {IMPORT_PATH.map((item) => (
            <li key={item.label} className="bg-parchment p-4 sm:p-5">
              <p className="font-display text-[0.64rem] font-semibold uppercase tracking-[0.12em] text-field-label">
                {item.label}
              </p>
              <h3 className="measure-heading mt-2 text-base font-bold text-navy">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-black/65">{item.body}</p>
            </li>
          ))}
        </ol>

        <div className="mt-5 bg-navy px-5 py-5 text-white sm:px-6">
          <p className="font-display text-[0.65rem] font-semibold uppercase tracking-[0.13em] text-gold">What the audit receipt keeps</p>
          <p className="mt-2 text-sm leading-6 text-white/85">
            CaseLoad Select retains the authorizing user, request IP when available, the browser user-agent string, time, file
            size, row counts, a SHA-256 file fingerprint, one-way row fingerprints and CRM outcome IDs. It does not retain
            the CSV filename, client names, email addresses, phone numbers, practice areas or row contents, and it does not
            write row contents to application logs.
          </p>
        </div>
      </section>

      <section className="border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="standards-heading">
        <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-black/65">Verified infrastructure</p>
        <h2 id="standards-heading" className="measure-heading mt-1 text-xl font-bold text-navy sm:text-2xl">
          Independently assessed controls, with the limits stated plainly
        </h2>
        <p className="mt-3 text-sm leading-6 text-black/65">
          HighLevel provides the CRM infrastructure behind this branded room. LeadConnector is listed as a provider for
          communication and support services. HighLevel states that its product infrastructure is hosted in the United
          States on Google Cloud and Amazon Web Services.
        </p>

        <dl className="mt-6 grid gap-px border border-black/10 bg-black/10 sm:grid-cols-2 lg:grid-cols-4">
          <Credential term="ISO/IEC 27001:2022" detail="Certified information-security management system" />
          <Credential term="SOC 2 Type II" detail="Independent attestation covering security, availability and confidentiality" />
          <Credential term="TLS 1.2 or 1.3" detail="Encryption in transit with 2,048-bit keys or better" />
          <Credential term="AES-256" detail="Encryption for platform data stored at rest" />
        </dl>
        <p className="mt-3 text-xs leading-5 text-black/65">
          These certifications and attestations apply to HighLevel&apos;s stated audit scope. They do not certify CaseLoad
          Select custom application code or the firm&apos;s configuration.
        </p>

        <details className="mt-5 border border-black/10 bg-parchment open:bg-white">
          <summary className="measure-heading cursor-pointer px-4 py-4 text-sm font-bold text-navy outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy sm:px-5">
            Read the technical controls and privacy terms
          </summary>
          <div className="border-t border-black/10 px-4 py-5 sm:px-5">
            <div className="grid gap-5 text-sm leading-6 text-black/65 md:grid-cols-2">
              <div>
                <h3 className="measure-heading font-bold text-navy">Platform and application controls</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5">
                  <li>Logical tenant separation, firm-specific identifiers and authorization rules.</li>
                  <li>Role-based access control, two-factor authentication, audit logs and just-in-time staff access.</li>
                  <li>Web application firewall controls aligned to OWASP guidance, DDoS protections and network rules that deny unauthorized connections by default.</li>
                  <li>Regular vulnerability scanning and static analysis, periodic dynamic security testing, plus annual penetration testing.</li>
                  <li>Encrypted platform backups use access controls, multi-zone redundancy and point-in-time recovery controls.</li>
                  <li>HighLevel states that protected backup copies use write-once-read-many controls.</li>
                </ul>
              </div>
              <div>
                <h3 className="measure-heading font-bold text-navy">Privacy and processing controls</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5">
                  <li>HighLevel&apos;s DPA assigns customer and HighLevel roles as controller, processor or subprocessor according to the processing context. The firm must confirm the roles that apply to its use.</li>
                  <li>HighLevel&apos;s DPA includes confidentiality, access limitation, incident response and deletion obligations.</li>
                  <li>Its DPA includes Standard Contractual Clauses and lists the EU-U.S. Data Privacy Framework, the UK Extension to the EU-U.S. Data Privacy Framework and the Swiss-U.S. Data Privacy Framework.</li>
                  <li>HighLevel publishes its subprocessors and gives customers a process for update notices and objections.</li>
                  <li>Certifications support a security program, but do not replace the firm&apos;s privacy, retention or consent duties.</li>
                </ul>
              </div>
            </div>
            <div className="mt-5 border border-gold/40 bg-gold/10 px-4 py-3 text-sm leading-6 text-navy">
              <p>
                Do not include medical records, financial information, government identifiers, legal advice, documents or
                privileged matter facts. This room is not approved for protected health information. HighLevel is not HIPAA
                compliant by default; its paid HIPAA package requires a Business Associate Agreement and enablement for each
                applicable sub-account. This import room does not rely on that package.
              </p>
            </div>
            <div className="mt-5 text-xs leading-5 text-black/65">
              <p>Source documents, checked August 31, 2026:</p>
              <ul className="mt-2 flex list-none flex-wrap gap-x-4 gap-y-2 p-0">
                {SECURITY_LINKS.map((link) => (
                  <li key={link.href}>
                    <a
                      className="font-semibold text-navy underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-navy"
                      href={link.href}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </section>

      <section className="border border-black/10 bg-white p-5 sm:p-6" aria-labelledby="template-preview-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-display text-[0.68rem] uppercase tracking-[0.14em] text-black/65">Template preview</p>
            <h2 id="template-preview-heading" className="measure-heading mt-1 text-xl font-bold text-navy sm:text-2xl">
              Eight columns, contact and relationship facts only
            </h2>
            <p className="mt-2 text-sm leading-6 text-black/60">
              This preview uses fictional people. Only these eight columns are used. Keep the names exactly as shown and
              remove every other column before importing.
            </p>
          </div>
          <a
            href="/templates/caseload-select-relationship-import.csv"
            download
            className="shrink-0 text-sm font-bold text-navy underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-navy"
          >
            Download CSV template
          </a>
        </div>

        <figure
          className="mt-5 overflow-hidden border border-black/15 bg-parchment"
          aria-labelledby="csv-preview-caption"
          data-readable-measure-exception="eight-column CSV data table"
        >
          <figcaption id="csv-preview-caption" className="flex flex-wrap items-center justify-between gap-2 border-b border-black/10 bg-navy px-4 py-3 text-white">
            <span className="font-display text-[0.66rem] font-semibold uppercase tracking-[0.12em]">relationship-import.csv</span>
            <span className="text-xs text-white/65">Fictional example</span>
          </figcaption>
          <div
            className="overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy"
            tabIndex={0}
            role="region"
            aria-label="Scrollable CSV template preview"
          >
            <table className="min-w-[1120px] border-collapse text-left font-mono text-[0.72rem] text-black/70">
              <thead>
                <tr className="bg-[#e8e6df] text-navy">
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">first_name</th>
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">last_name</th>
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">email</th>
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">phone</th>
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">relationship_type</th>
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">practice_area</th>
                  <th scope="col" className="border-b border-r border-black/10 px-3 py-2 font-semibold">matter_closed_year</th>
                  <th scope="col" className="border-b border-black/10 px-3 py-2 font-semibold">marketing_permission</th>
                </tr>
              </thead>
              <tbody>
                <ExampleRow values={["Amira", "Patel", "amira.patel@example.com", "+14165550106", "former_client", "Family law", "2025", "unknown"]} />
                <ExampleRow values={["Mateo", "Silva", "", "+16475550114", "referral_source", "Business law", "", "no_contact"]} />
              </tbody>
            </table>
          </div>
        </figure>

        <div className="mt-5 grid gap-px border border-black/10 bg-black/10 md:grid-cols-2">
          {FIELD_NOTES.map((item) => (
            <article key={item.fields.join("-")} className="bg-parchment p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="flex flex-wrap items-baseline gap-1 font-mono text-xs font-bold text-navy">
                  {item.fields.map((field, index) => (
                    <span key={field}>
                      {index > 0 ? <span className="mr-1 font-primary font-normal text-black/65">{item.joiner}</span> : null}
                      <code>{field}</code>
                    </span>
                  ))}
                </p>
                <span className="font-display text-[0.61rem] font-semibold uppercase tracking-[0.1em] text-black/65">{item.need}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-black/65">{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Credential({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="bg-parchment p-4">
      <dt className="text-sm font-extrabold text-navy">{term}</dt>
      <dd className="mt-1 text-xs leading-5 text-black/65">{detail}</dd>
    </div>
  );
}

function ExampleRow({ values }: { values: readonly string[] }) {
  return (
    <tr className="bg-white">
      {values.map((value, index) => (
        <td key={`${index}-${value}`} className="border-b border-r border-black/10 px-3 py-2 last:border-r-0">
          {value || <span className="text-field-label">blank</span>}
        </td>
      ))}
    </tr>
  );
}
