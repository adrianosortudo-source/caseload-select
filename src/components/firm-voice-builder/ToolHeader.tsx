import Image from "next/image";

/**
 * Minimal tool chrome for /tools/firm-voice-builder, replicating the look of
 * the seo-check ToolNav. Copied rather than imported so this route keeps zero
 * dependencies on the frozen (marketing) route group; values are the literal
 * equivalents of that group's tokens (border #E8E4DA, muted #6B7A8D).
 */
export default function ToolHeader() {
  return (
    <header className="fvb-nav">
      <a href="/home" className="fvb-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-light-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <a href="/home" className="fvb-nav-exit">← Back to home</a>

      <style>{`
        .fvb-nav {
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
        .fvb-nav-logo { line-height: 0; }
        .fvb-nav-logo img { height: 32px; width: auto; }
        .fvb-nav-exit {
          font-family: 'Manrope', system-ui, sans-serif;
          font-size: 12px;
          color: #6B7A8D;
          text-decoration: none;
          transition: color 0.2s;
        }
        .fvb-nav-exit:hover { color: #1E2F58; }
        @media (max-width: 640px) {
          .fvb-nav { padding: 14px 18px; }
          .fvb-nav-logo img { height: 26px; }
        }
      `}</style>
    </header>
  );
}
