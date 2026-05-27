import Image from "next/image";

/**
 * DemoNav — minimal brand-only nav for the /screen-demo flow
 *
 * No menu links, no CTA. The demo is a single-purpose flow; the lawyer's
 * job is to complete the five questions and see the report. Anything in
 * the nav that pulls them off this path is friction.
 *
 * Just the wordmark, linking back to /home if they want to exit. The
 * back-to-home link is small and quiet, not a CTA.
 */
export default function DemoNav() {
  return (
    <header className="cls-demo-nav">
      <a href="/home" className="cls-demo-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-light-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          priority
        />
      </a>
      <a href="/home" className="cls-demo-exit">← Back to home</a>

      <style>{`
        .cls-demo-nav {
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
        .cls-demo-logo {
          line-height: 0;
        }
        .cls-demo-logo :global(img) {
          height: 32px;
          width: auto;
        }
        .cls-demo-exit {
          font-family: var(--font-body);
          font-size: 12px;
          color: var(--text-muted);
          text-decoration: none;
          transition: color 0.2s;
        }
        .cls-demo-exit:hover { color: var(--navy); }

        @media (max-width: 640px) {
          .cls-demo-nav { padding: 14px 18px; }
          .cls-demo-logo :global(img) { height: 26px; }
        }
      `}</style>
    </header>
  );
}
