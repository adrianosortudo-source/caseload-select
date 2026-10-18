import Image from "next/image";

export default function ToolNav() {
  return (
    <header className="dc-nav">
      <a href="https://caseloadselect.ca/" className="dc-nav-logo" aria-label="CaseLoad Select home">
        <Image src="/brand/logos/lockup-horizontal-tagline-light-transparent.png" alt="CaseLoad Select" width={220} height={44} priority />
      </a>
      <nav className="dc-nav-links" aria-label="Main navigation">
        <a href="https://caseloadselect.ca/">Home</a>
        <a href="https://caseloadselect.ca/tools.html">Back to tools</a>
      </nav>

      <style>{`
        .dc-nav { display: flex; justify-content: space-between; align-items: center; padding: 18px 32px; border-bottom: 1px solid var(--border); background: var(--white); position: sticky; top: 0; z-index: 50; min-width: 0; }
        .dc-nav-logo { line-height: 0; }
        .dc-nav-logo { flex-shrink: 0; }
        .dc-nav-logo img { height: 38px; width: auto; max-width: 100%; }
        .dc-nav-links { display: flex; align-items: center; gap: 24px; }
        .dc-nav-links a { font-family: var(--font-body); font-size: 13px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
        .dc-nav-links a:hover { color: var(--navy); }
        @media (max-width: 640px) {
          .dc-nav { padding: 12px 16px; flex-wrap: wrap; gap: 10px 16px; }
          .dc-nav-logo { flex: 0 1 164px; min-width: 0; }
          .dc-nav-logo img { height: 30px; width: auto; max-width: 100%; }
          .dc-nav-links { gap: clamp(8px, 3.5vw, 14px); min-width: 0; }
          .dc-nav-links a { font-size: 12px; }
        }
        @media (max-width: 360px) {
          .dc-nav-links { flex: 1 0 100%; justify-content: flex-end; }
        }
      `}</style>
    </header>
  );
}
