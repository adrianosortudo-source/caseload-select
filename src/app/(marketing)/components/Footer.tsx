/**
 * Footer
 *
 * Global marketing-site footer. Mounted once in the `(marketing)` route
 * group layout so every marketing page gets it (home, screen-demo, the
 * case study, scope page, tools). Three columns per the brand's
 * document-footer grammar: identity, site links, compliance + legal.
 *
 * Brand discipline: navy background, no em dashes, no italics, terminal
 * square on the identity mark only (matches nav treatment elsewhere).
 */
export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="cls-footer">
      <div className="cls-footer-inner">
        <div className="cls-footer-col">
          <p className="cls-footer-brand">CaseLoad Select</p>
          <p className="cls-footer-line">Toronto, Ontario</p>
          <p className="cls-footer-line">
            <a href="mailto:adriano@caseloadselect.ca">adriano@caseloadselect.ca</a>
          </p>
        </div>

        <div className="cls-footer-col">
          <p className="cls-footer-heading">Site</p>
          <ul className="cls-footer-links">
            <li><a href="/home">Home</a></li>
            <li><a href="/screen-demo">Try the Screen</a></li>
            <li><a href="/case-studies/drg-law">DRG Law case study</a></li>
            <li><a href="/tools/seo-check">Free SEO check</a></li>
          </ul>
        </div>

        <div className="cls-footer-col">
          <p className="cls-footer-heading">Legal</p>
          <p className="cls-footer-note">
            Marketing produced under LSO Rule 4.2-1 discipline.
          </p>
          <ul className="cls-footer-links">
            <li><a href="/privacy">Privacy policy</a></li>
            <li><a href="/terms">Terms of service</a></li>
          </ul>
          <p className="cls-footer-copyright">&copy; {year} CaseLoad Select. All rights reserved.</p>
        </div>
      </div>

      <style>{`
        .cls-footer {
          background: var(--navy-deep);
          color: rgba(255, 255, 255, 0.7);
          padding: var(--sp-8) var(--section-pad-h) var(--sp-6);
        }

        .cls-footer-inner {
          max-width: 1200px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: var(--sp-7);
        }

        .cls-footer-col {
          display: flex;
          flex-direction: column;
          gap: var(--sp-3);
        }

        .cls-footer-brand {
          font-family: var(--font-display);
          font-size: var(--fs-h3);
          font-weight: 700;
          color: var(--white);
          letter-spacing: var(--ls-headline);
          margin: 0;
        }

        .cls-footer-line {
          font-family: var(--font-body);
          font-size: var(--fs-body-sm);
          margin: 0;
          color: rgba(255, 255, 255, 0.6);
        }

        .cls-footer-line a {
          color: rgba(255, 255, 255, 0.8);
          text-decoration: none;
        }
        .cls-footer-line a:hover {
          color: var(--stone);
        }

        .cls-footer-heading {
          font-family: var(--font-body);
          font-size: var(--fs-micro);
          font-weight: 700;
          letter-spacing: var(--ls-label);
          text-transform: uppercase;
          color: var(--stone);
          margin: 0 0 var(--sp-2);
        }

        .cls-footer-links {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--sp-2);
        }

        .cls-footer-links a {
          font-family: var(--font-body);
          font-size: var(--fs-body-sm);
          color: rgba(255, 255, 255, 0.7);
          text-decoration: none;
          transition: color var(--t-fast);
        }
        .cls-footer-links a:hover {
          color: var(--white);
        }

        .cls-footer-note {
          font-family: var(--font-body);
          font-size: var(--fs-small);
          line-height: 1.5;
          color: rgba(255, 255, 255, 0.55);
          margin: 0;
        }

        .cls-footer-copyright {
          font-family: var(--font-body);
          font-size: var(--fs-micro);
          color: rgba(255, 255, 255, 0.4);
          margin: var(--sp-3) 0 0;
        }

        @media (max-width: 880px) {
          .cls-footer-inner {
            grid-template-columns: 1fr;
            gap: var(--sp-6);
          }
        }
      `}</style>
    </footer>
  );
}
