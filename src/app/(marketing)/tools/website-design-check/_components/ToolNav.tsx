import Image from "next/image";

export default function ToolNav() {
  return (
    <header className="dc-nav">
      <a href="/home" className="dc-nav-logo" aria-label="CaseLoad Select home">
        <Image src="/brand/logos/lockup-horizontal-light-transparent.png" alt="CaseLoad Select" width={180} height={36} priority />
      </a>
      <a href="/home" className="dc-nav-exit">← Back to home</a>

      <style>{`
        .dc-nav { display: flex; justify-content: space-between; align-items: center; padding: 18px 32px; border-bottom: 1px solid var(--border); background: var(--white); position: sticky; top: 0; z-index: 50; }
        .dc-nav-logo { line-height: 0; }
        .dc-nav-logo :global(img) { height: 32px; width: auto; }
        .dc-nav-exit { font-family: var(--font-body); font-size: 12px; color: var(--text-muted); text-decoration: none; transition: color 0.2s; }
        .dc-nav-exit:hover { color: var(--navy); }
        @media (max-width: 640px) {
          .dc-nav { padding: 14px 18px; }
          .dc-nav-logo :global(img) { height: 26px; }
        }
      `}</style>
    </header>
  );
}
