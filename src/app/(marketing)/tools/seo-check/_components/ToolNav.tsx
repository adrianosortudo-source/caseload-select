import Image from "next/image";

export default function ToolNav() {
  return (
    <header className="seo-nav">
      <a href="/home" className="seo-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-light-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <a href="/home" className="seo-nav-exit">← Back to home</a>

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
        .seo-nav-logo :global(img) { height: 32px; width: auto; }
        .seo-nav-exit {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.2s;
        }
        .seo-nav-exit:hover { color: var(--navy); }
        @media (max-width: 640px) {
          .seo-nav { padding: 14px 18px; }
          .seo-nav-logo :global(img) { height: 26px; }
        }
      `}</style>
    </header>
  );
}
