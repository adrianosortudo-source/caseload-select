import Image from "next/image";

export default function ToolNav() {
  return (
    <header className="seo-nav">
      <a href="https://caseloadselect.ca/" className="seo-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <nav className="seo-nav-links" aria-label="Main navigation">
        <a href="https://caseloadselect.ca/">Home</a>
        <a href="https://caseloadselect.ca/tools.html">Back to tools</a>
      </nav>

      <style>{`
        .seo-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 32px;
          border-bottom: 1px solid var(--border);
          background: var(--white);
          position: sticky;
          top: 0;
          z-index: 50;
        }
        .seo-nav-logo { line-height: 0; }
        .seo-nav-logo { flex-shrink: 0; }
        .seo-nav-logo :global(img) { height: 38px; width: auto; }
        .seo-nav-links { display: flex; align-items: center; gap: 24px; }
        .seo-nav-links a {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.2s;
        }
        .seo-nav-links a:hover { color: var(--navy); }
        @media (max-width: 640px) {
          .seo-nav { padding: 14px 18px; }
          .seo-nav-logo :global(img) { height: 30px; }
          .seo-nav-links { gap: 14px; }
          .seo-nav-links a { font-size: 12px; }
        }
      `}</style>
    </header>
  );
}
