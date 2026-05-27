"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

/**
 * MarketingNav
 *
 * Sticky nav. Transparent over the dark hero, becomes white-with-backdrop-blur
 * after scrolling 80px. The official brand lockup swaps between the dark-
 * background variant (over hero) and the light-background variant (after
 * scroll) automatically via the `scrolled` class.
 *
 * Brand logos served from /public/brand/logos/ per CLAUDE.md doctrine.
 */
export default function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`cls-nav${scrolled ? " scrolled" : ""}`}>
      <a href="/home" className="cls-nav-logo" aria-label="CaseLoad Select home">
        <Image
          src="/brand/logos/lockup-horizontal-dark-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          className="cls-nav-logo-dark"
          priority
        />
        <Image
          src="/brand/logos/lockup-horizontal-light-transparent.png"
          alt="CaseLoad Select"
          width={180}
          height={36}
          className="cls-nav-logo-light"
          priority
        />
      </a>
      <ul className="cls-nav-links">
        <li><a href="#problem">The Problem</a></li>
        <li><a href="#system">ACTS</a></li>
        <li><a href="#cpi">Priority Index</a></li>
        <li><a href="/screen-demo" className="cls-nav-link-emphasis">Try the Screen</a></li>
        <li><a href="#why">Why us</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ul>
      <a href="#cta" className="cls-nav-cta">Book a Call</a>

      <style jsx>{`
        .cls-nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 100;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 14px 60px;
          transition: background 0.4s, backdrop-filter 0.4s, padding 0.3s, border-color 0.4s;
          border-bottom: 1px solid transparent;
        }
        .cls-nav.scrolled {
          background: rgba(255, 255, 255, 0.94);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          padding: 12px 60px;
          border-bottom-color: #E8E4DA;
        }

        .cls-nav-logo {
          display: flex;
          align-items: center;
          text-decoration: none;
          line-height: 0;
        }
        .cls-nav-logo :global(.cls-nav-logo-dark)  { display: block;  height: 36px; width: auto; }
        .cls-nav-logo :global(.cls-nav-logo-light) { display: none;   height: 36px; width: auto; }
        .cls-nav.scrolled .cls-nav-logo :global(.cls-nav-logo-dark)  { display: none; }
        .cls-nav.scrolled .cls-nav-logo :global(.cls-nav-logo-light) { display: block; }

        .cls-nav-links {
          display: flex;
          align-items: center;
          gap: 32px;
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .cls-nav-links li { display: inline-block; }
        .cls-nav-links a {
          font-family: 'Manrope', sans-serif;
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.3px;
          color: rgba(255, 255, 255, 0.7);
          text-decoration: none;
          transition: color 0.2s;
        }
        .cls-nav-links a:hover { color: #FFFFFF; }
        .cls-nav.scrolled .cls-nav-links a { color: #6B7A8D; }
        .cls-nav.scrolled .cls-nav-links a:hover { color: #1E2F58; }

        .cls-nav-links a.cls-nav-link-emphasis {
          color: #C4B49A;
          font-weight: 700;
        }
        .cls-nav-links a.cls-nav-link-emphasis:hover { color: #D8CAAE; }
        .cls-nav.scrolled .cls-nav-links a.cls-nav-link-emphasis {
          color: #9E9070;
        }
        .cls-nav.scrolled .cls-nav-links a.cls-nav-link-emphasis:hover {
          color: #1E2F58;
        }

        .cls-nav-cta {
          font-family: 'Manrope', sans-serif;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #0D1520;
          background: #C4B49A;
          padding: 10px 22px;
          border-radius: 3px;
          text-decoration: none;
          transition: background 0.2s, transform 0.2s;
        }
        .cls-nav-cta:hover {
          background: #D8CAAE;
          transform: translateY(-1px);
        }

        @media (max-width: 880px) {
          .cls-nav { padding: 14px 24px; }
          .cls-nav.scrolled { padding: 12px 24px; }
          .cls-nav-links { display: none; }
        }
      `}</style>
    </nav>
  );
}
