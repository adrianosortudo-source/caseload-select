import Image from "next/image";

export default function ToolNav() {
  return (
    <header className="dc-nav">
      <a href="https://caseloadselect.ca/" className="dc-nav-logo" aria-label="CaseLoad Select home">
        <Image src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png" alt="CaseLoad Select" width={220} height={44} priority />
      </a>
      <nav className="dc-nav-links" aria-label="Main navigation">
        <a href="https://caseloadselect.ca/">Home</a>
        <a href="https://caseloadselect.ca/tools.html">Back to tools</a>
      </nav>

      <style>{`
        .dc-nav { display: flex; justify-content: space-between; align-items: center; padding: 18px 32px; border-bottom: 1px solid var(--border); background: var(--white); position: sticky; top: 0; z-index: 50; }
        .dc-nav-logo { line-height: 0; }
        .dc-nav-logo { flex-shrink: 0; }
        .dc-nav-logo :global(img) { height: 38px; width: auto; }
        .dc-nav-links { display: flex; align-items: center; gap: 24px; }
        .dc-nav-links a { font-family: var(--font-body); font-size: 13px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
        .dc-nav-links a:hover { color: var(--navy); }
        @media (max-width: 640px) {
          .dc-nav { padding: 14px 18px; }
          .dc-nav-logo :global(img) { height: 30px; }
          .dc-nav-links { gap: 14px; }
          .dc-nav-links a { font-size: 12px; }
        }
      `}</style>
    </header>
  );
}
