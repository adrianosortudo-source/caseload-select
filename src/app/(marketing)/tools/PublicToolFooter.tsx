const LINKS = [
  { href: "https://caseloadselect.ca/", label: "Home" },
  { href: "https://caseloadselect.ca/screen.html", label: "Screen" },
  { href: "https://caseloadselect.ca/work/drg-law.html", label: "DRG Law case study" },
  { href: "https://caseloadselect.ca/tools.html", label: "All tools" },
  { href: "https://caseloadselect.ca/tools/seo-check.html", label: "SEO Check" },
  { href: "https://caseloadselect.ca/privacy", label: "Privacy" },
  { href: "https://caseloadselect.ca/terms", label: "Terms" },
];

export default function PublicToolFooter() {
  return (
    <>
      <footer className="public-tool-footer">
        <a href="https://caseloadselect.ca/" className="public-tool-footer-brand">CaseLoad Select</a>
        <nav aria-label="CaseLoad Select site links">
          {LINKS.map(({ href, label }) => <a key={href} href={href}>{label}</a>)}
        </nav>
        <p>Toronto, Ontario · <a href="mailto:adriano@caseloadselect.ca">adriano@caseloadselect.ca</a></p>
      </footer>
      <style>{`
        .cls-marketing > .cls-footer { display: none; }
        .public-tool-footer { background: var(--navy-deep); color: rgba(255,255,255,.72); padding: var(--sp-7) var(--section-pad-h); text-align: center; }
        .public-tool-footer-brand { display: inline-block; margin-bottom: var(--sp-4); color: var(--white); font: 700 var(--fs-h3) var(--font-display); text-decoration: none; }
        .public-tool-footer nav { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--sp-3) var(--sp-5); }
        .public-tool-footer nav a, .public-tool-footer p, .public-tool-footer p a { color: inherit; font: var(--fs-body-sm) var(--font-body); }
        .public-tool-footer nav a { text-decoration: none; }
        .public-tool-footer nav a:hover, .public-tool-footer p a:hover { color: var(--white); }
        .public-tool-footer p { margin: var(--sp-4) 0 0; }
        @media(max-width:640px) { .public-tool-footer { padding: var(--sp-6) var(--sp-4); } }
        @media print { .public-tool-footer { display: none !important; } }
      `}</style>
    </>
  );
}
