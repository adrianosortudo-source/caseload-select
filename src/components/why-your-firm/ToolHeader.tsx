import Image from "next/image";

/**
 * Minimal tool chrome for /tools/why-your-firm, copied from the Firm Voice
 * Builder's ToolHeader rather than imported, per the route-class doctrine:
 * this route keeps zero dependencies on any other tool or on the frozen
 * (marketing) route group, so a chrome change on one tool never ripples to
 * another. Byte-identical in structure to the Voice Builder's version; only
 * this file's own class names are namespaced (wyf- instead of fvb-) so the
 * two tools' embedded styles never collide if both ever render in the same
 * frame stack.
 */
export default function ToolHeader() {
  return (
    <header className="wyf-nav">
      <a href="https://caseloadselect.ca/" className="wyf-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-tagline-dark-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <nav className="wyf-nav-links" aria-label="Main navigation">
        <a href="https://caseloadselect.ca/">Home</a>
        <a href="https://caseloadselect.ca/tools.html">Back to tools</a>
      </nav>

      <style>{`
        .wyf-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 32px;
          border-bottom: 1px solid #E8E4DA;
          background: #FFFFFF;
          position: sticky;
          top: 0;
          z-index: 50;
        }
        .wyf-nav-logo { line-height: 0; flex-shrink: 0; }
        .wyf-nav-logo img { height: 38px; width: auto; }
        .wyf-nav-links { display: flex; align-items: center; gap: 24px; }
        .wyf-nav-links a {
          font-family: 'Manrope', system-ui, sans-serif;
          font-size: 12px;
          color: #6B7A8D;
          text-decoration: none;
          transition: color 0.2s;
        }
        .wyf-nav-links a:hover { color: #1E2F58; }
        @media (max-width: 640px) {
          .wyf-nav { padding: 14px 18px; }
          .wyf-nav-logo img { height: 30px; }
          .wyf-nav-links { gap: 14px; }
          .wyf-nav-links a { font-size: 12px; }
        }
      `}</style>
    </header>
  );
}
