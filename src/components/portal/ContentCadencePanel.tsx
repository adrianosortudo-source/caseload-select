import "./ContentCadencePanel.css";
import type {
  ContentCadence,
  PieceIcon,
  Channel,
  CadenceReferenceLink,
} from "@/lib/content-cadence";

/**
 * "How your content works" panel. Structured, brand-styled explainer of the
 * content production model for the firm's lawyer. Presentational and static, so
 * it can render on the server.
 *
 * variant="summary": intro + production metrics + a link to the full
 *   page. Rendered on the deliverables portal in place of AboutPanel.
 * variant="full": the whole thing (pieces, weekly schedule, lead magnet). Lives
 *   at /portal/[firmId]/how-your-content-works.
 */
export default function ContentCadencePanel({
  cadence,
  variant,
  detailHref,
  referenceLinks,
}: {
  cadence: ContentCadence;
  variant: "summary" | "full";
  /** Where the summary "See how your week works" button points. */
  detailHref?: string;
  /** Overrides cadence.referenceLinks when provided (e.g. the firm_about links). */
  referenceLinks?: CadenceReferenceLink[];
}) {
  const links = referenceLinks ?? cadence.referenceLinks;

  return (
    <section className="ccp" aria-label="How your content works">
      {/* Intro + approval summary */}
      <div className="ccp-pad">
        <div className="ccp-intro">
          <div>
            <p className="ccp-eyebrow">{cadence.eyebrow}</p>
            <h2 className="ccp-head">
              {cadence.headline}
              <span className="ccp-sq" aria-hidden />
            </h2>
            <p className="ccp-lede">{cadence.lede}</p>
          </div>

          <aside className="ccp-approve">
            <p className="ccp-approve-at">
              <CheckIcon />
              {cadence.approve.heading}
            </p>
            <div className="ccp-metrics">
              {cadence.approve.metrics.map((metric) => (
                <div className="ccp-metric" key={metric.label}>
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>
            <p className="ccp-approve-note">{cadence.approve.note}</p>
          </aside>
        </div>
      </div>

      {/* Promise band */}
      <div className="ccp-promise">
        {cadence.promise.metrics.map((metric, index) => (
          <div className="ccp-promise-stage" key={metric.label}>
            {index > 0 ? (
              <span className="ccp-arrow" aria-hidden>
                &rarr;
              </span>
            ) : null}
            <div className="ccp-big">
              <span className={metric.underline ? "ccp-u" : undefined}>{metric.value}</span>{" "}
              {metric.label}
            </div>
          </div>
        ))}
        <p className="ccp-promise-lbl">{cadence.promise.label}</p>
      </div>

      {variant === "summary" ? (
        detailHref ? (
          <div className="ccp-summary-cta">
            <a className="ccp-btn" href={detailHref}>
              {cadence.summaryCta}
              <ArrowRightIcon />
            </a>
          </div>
        ) : null
      ) : (
        <div className="ccp-pad ccp-stack">
          {/* 1. Owned content families */}
          <div>
            <div className="ccp-sec-label">
              <span className="ccp-sec-num">1</span>
              <span className="ccp-sec-title">{cadence.sectionLabels.pieces}</span>
            </div>
            <div className="ccp-pieces">
              {cadence.pieces.map((p, i) => (
                <div key={p.kind} className={`ccp-piece ccp-p${i + 1}`}>
                  <PieceIconGlyph icon={p.icon} />
                  <p className="ccp-piece-kind">{p.kind}</p>
                  <p className="ccp-piece-nm">{p.name}</p>
                  <p className="ccp-piece-ds">{p.desc}</p>
                  <span className="ccp-piece-tag">{p.tag}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ccp-divider" />

          {/* 2. Publishing map */}
          <div>
            <div className="ccp-sec-label">
              <span className="ccp-sec-num">2</span>
              <span className="ccp-sec-title">{cadence.sectionLabels.schedule}</span>
            </div>
            <div className="ccp-legend">
              <span>
                <i className="ccp-dot ccp-d-site" /> Your website
              </span>
              <span>
                <i className="ccp-dot ccp-d-li" /> LinkedIn (Damaris&rsquo;s feed)
              </span>
              <span>
                <i className="ccp-dot ccp-d-gbp" /> Google Business Profile
              </span>
            </div>

            <div className="ccp-week">
              <div className="ccp-week-head">
                <div>Channel</div>
                {cadence.days.map((d) => (
                  <div key={d.label} className={d.quiet ? "ccp-quiet" : undefined}>
                    {d.label}
                  </div>
                ))}
              </div>
              {cadence.rows.map((row) => (
                <div className="ccp-row" key={row.channel}>
                  <div className="ccp-chan">
                    <ChannelIcon channel={row.channel} /> {row.label}
                  </div>
                  {row.cells.map((cell, ci) => {
                    const quiet = cadence.days[ci]?.quiet;
                    return (
                      <div className={`ccp-cell${quiet ? " ccp-q" : ""}`} key={ci}>
                        {cell && cell.length > 0 ? (
                          cell.map((c, k) => (
                            <div className={`ccp-card ccp-c-${row.channel === "website" ? "site" : row.channel === "linkedin" ? "li" : "gbp"}`} key={k}>
                              <span className="ccp-t">{c.slot}</span>
                              <b>{c.piece}</b>
                              {c.detail} · {c.count} {c.count === 1 ? "deliverable" : "deliverables"}
                            </div>
                          ))
                        ) : (
                          <span className="ccp-empty">&mdash;</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="ccp-count-strip">
              {cadence.counts.map((c) => (
                <div className="ccp-count" key={c.l}>
                  <div className="ccp-count-n">{c.n}</div>
                  <div className="ccp-count-l">{c.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="ccp-divider" />

          {/* 3. Lead magnet and required marketing consent */}
          <div>
            <div className="ccp-sec-label">
              <span className="ccp-sec-num">3</span>
              <span className="ccp-sec-title">{cadence.sectionLabels.magnet}</span>
            </div>
            <div className="ccp-magnet">
              <div className="ccp-magnet-vis" aria-hidden>
                <div className="ccp-sheet">
                  <span className="ccp-sheet-pl">PDF</span>
                  <div className="ccp-sheet-rows">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <div className="ccp-gate">
                  <b>Unlock</b>
                  <div className="ccp-fld" />
                  <div className="ccp-fld" />
                  <div className="ccp-btn2" />
                </div>
              </div>
              <div className="ccp-magnet-copy">
                <h3>{cadence.magnet.heading}</h3>
                <p>{cadence.magnet.body}</p>
                <div className="ccp-steps">
                  {cadence.magnet.steps.map((s, i) => (
                    <div className="ccp-step" key={s.title}>
                      <div className="ccp-step-sn">{i + 1}</div>
                      <b>{s.title}</b>
                      <span>{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="ccp-adhoc">
            <b>{cadence.transition.heading}</b>{" "}
            {cadence.transition.body}
          </div>

          {links.length > 0 ? (
            <div className="ccp-ref">
              <p className="ccp-ref-rl">Reference</p>
              <ul style={{ display: "flex", flexWrap: "wrap", gap: "20px", listStyle: "none", margin: 0, padding: 0 }}>
                {links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {l.label} <span aria-hidden>&nearr;</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PieceIconGlyph({ icon }: { icon: PieceIcon }) {
  const common = {
    className: "ccp-piece-ic",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (icon === "note") {
    return (
      <svg {...common}>
        <path d="M4 4h11l5 5v11H4z" />
        <path d="M14 4v6h6" />
        <path d="M8 13h8M8 17h5" />
      </svg>
    );
  }
  if (icon === "clause") {
    return (
      <svg {...common}>
        <path d="M6 3h12v18l-6-4-6 4z" />
        <path d="M9.5 9.5h5M9.5 13h3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 8l1.2 1.2L12.5 7M9 13l1.2 1.2L12.5 12M15 8.2h1.5M15 13.2h1.5" />
    </svg>
  );
}

function ChannelIcon({ channel }: { channel: Channel }) {
  if (channel === "website") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <rect x="3" y="4" width="18" height="14" rx="1.5" />
        <path d="M3 9h18M8 21h8" />
      </svg>
    );
  }
  if (channel === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 10v7M7 7v.01M11 17v-4a2 2 0 0 1 4 0v4M11 17v-7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
      <path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
