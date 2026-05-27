/**
 * Ticker — auto-scrolling navy strip between hero and Problem section
 *
 * CaseLoad-specific keywords. Hover pauses the scroll. The track contains
 * two copies of the keyword list so the loop is seamless when translateX
 * hits -50%.
 *
 * Server-renderable (no client state). Pure CSS animation.
 */

const KEYWORDS = [
  "Sign Better Cases",
  "Ontario-First",
  "LSO-Compliant",
  "Operator-Led",
  "Priority-Ranked",
  "Voice AI 24/7",
  "Brief in Hand",
  "Authority",
  "Capture",
  "Target",
  "Screen",
];

export default function Ticker() {
  const doubled = [...KEYWORDS, ...KEYWORDS];

  return (
    <div className="cls-ticker" aria-hidden="true">
      <div className="cls-ticker-track">
        {doubled.map((word, i) => (
          <span key={`${word}-${i}`} className="cls-ticker-item">
            {word}
          </span>
        ))}
      </div>

      <style>{`
        .cls-ticker {
          overflow: hidden;
          background: var(--navy);
          border-top: 1px solid rgba(196, 180, 154, 0.12);
          border-bottom: 1px solid rgba(196, 180, 154, 0.12);
          padding: 16px 0;
          white-space: nowrap;
          position: relative;
        }
        .cls-ticker::before,
        .cls-ticker::after {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          width: 80px;
          z-index: 2;
          pointer-events: none;
        }
        .cls-ticker::before {
          left: 0;
          background: linear-gradient(90deg, var(--navy), transparent);
        }
        .cls-ticker::after {
          right: 0;
          background: linear-gradient(270deg, var(--navy), transparent);
        }
        .cls-ticker-track {
          display: inline-flex;
          align-items: center;
          animation: cls-ticker-scroll 32s linear infinite;
        }
        .cls-ticker:hover .cls-ticker-track {
          animation-play-state: paused;
        }
        .cls-ticker-item {
          font-family: 'Oxanium', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: rgba(196, 180, 154, 0.55);
          padding: 0 32px;
          display: inline-flex;
          align-items: center;
        }
        .cls-ticker-item::after {
          content: '·';
          color: rgba(196, 180, 154, 0.25);
          font-size: 18px;
          line-height: 1;
          margin-left: 32px;
        }
        @keyframes cls-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}
