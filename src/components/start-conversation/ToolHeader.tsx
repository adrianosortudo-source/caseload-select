import Image from "next/image";

/**
 * Minimal tool chrome for /tools/start-a-conversation, same shape as
 * firm-voice-builder's ToolHeader (copied rather than imported so this
 * route keeps zero dependencies on another tool's component tree; values
 * are the literal equivalents of the (marketing) group's tokens: border
 * #E8E4DA, muted #6B7A8D). Only rendered when NOT embedded.
 */
export default function ToolHeader() {
  return (
    <header className="sc-nav">
      <a href="/home" className="sc-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-light-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <a href="/home" className="sc-nav-exit">← Back to home</a>

      <style>{`
        .sc-nav {
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
        .sc-nav-logo { line-height: 0; }
        .sc-nav-logo img { height: 32px; width: auto; }
        .sc-nav-exit {
          font-family: 'Manrope', system-ui, sans-serif;
          font-size: 12px;
          color: #6B7A8D;
          text-decoration: none;
          transition: color 0.2s;
        }
        .sc-nav-exit:hover { color: #1E2F58; }
        @media (max-width: 640px) {
          .sc-nav { padding: 14px 18px; }
          .sc-nav-logo img { height: 26px; }
        }
      `}</style>
    </header>
  );
}
