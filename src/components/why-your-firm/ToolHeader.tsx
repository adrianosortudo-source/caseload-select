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
      <a href="/home" className="wyf-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-light-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <a href="/home" className="wyf-nav-exit">← Back to home</a>

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
        .wyf-nav-logo { line-height: 0; }
        .wyf-nav-logo img { height: 32px; width: auto; }
        .wyf-nav-exit {
          font-family: 'Manrope', system-ui, sans-serif;
          font-size: 12px;
          color: #6B7A8D;
          text-decoration: none;
          transition: color 0.2s;
        }
        .wyf-nav-exit:hover { color: #1E2F58; }
        @media (max-width: 640px) {
          .wyf-nav { padding: 14px 18px; }
          .wyf-nav-logo img { height: 26px; }
        }
      `}</style>
    </header>
  );
}
