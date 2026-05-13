/**
 * CaseLoad Screen — Chat Widget Embed Script v3
 *
 * Drop this single script tag on any law firm website:
 *
 *   <script
 *     src="https://app.caseloadselect.ca/widget-v3-embed.js"
 *     data-firm-id="YOUR_FIRM_ID"
 *     data-color="#1E2F58"
 *     data-label="Submit for review"
 *     data-position="bottom-right"
 *   ></script>
 *
 * Attributes:
 *   data-firm-id   (required) Your CaseLoad Screen firm ID
 *   data-color     Brand color for the bubble (default: #1E2F58)
 *   data-label     Bubble label text
 *   data-position  bottom-right (default) | bottom-left
 */

(function () {
  var script = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var firmId   = script.getAttribute("data-firm-id");
  var color    = script.getAttribute("data-color")    || "#1E2F58";
  var label    = script.getAttribute("data-label")    || "Submit for review";
  var position = script.getAttribute("data-position") || "bottom-right";

  if (!firmId) {
    console.warn("[CaseLoad] Missing data-firm-id on embed script.");
    return;
  }

  var BASE_URL = "https://app.caseloadselect.ca";
  var isOpen   = false;

  // ── Styles ──────────────────────────────────────────────────────────────────

  var css = `
    #cl-bubble {
      position: fixed;
      ${position === "bottom-left" ? "left: 24px;" : "right: 24px;"}
      bottom: 24px;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 10px;
      background: ${color};
      color: #fff;
      border: none;
      border-radius: 50px;
      padding: 0 20px 0 14px;
      height: 52px;
      font-family: 'DM Sans', system-ui, sans-serif;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.18);
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      white-space: nowrap;
    }
    #cl-bubble:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 28px rgba(0,0,0,0.22);
    }
    #cl-bubble:active { transform: scale(0.97); }
    #cl-bubble svg { flex-shrink: 0; }

    #cl-frame-wrap {
      position: fixed;
      ${position === "bottom-left" ? "left: 16px;" : "right: 16px;"}
      bottom: 88px;
      width: 390px;
      height: 620px;
      max-height: calc(100vh - 100px);
      z-index: 2147483645;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.18);
      display: none;
      opacity: 0;
      transform: translateY(16px) scale(0.97);
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #cl-frame-wrap.cl-open {
      display: block;
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    #cl-frame {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }

    @media (max-width: 480px) {
      #cl-frame-wrap {
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100% !important;
        height: 100% !important;
        max-height: 100% !important;
        border-radius: 0 !important;
      }
    }
  `;

  var styleEl = document.createElement("style");
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Bubble button ────────────────────────────────────────────────────────────

  var bubble = document.createElement("button");
  bubble.id = "cl-bubble";
  bubble.setAttribute("aria-label", label);
  bubble.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
    <span>${label}</span>
  `;

  // ── Frame wrapper ─────────────────────────────────────────────────────────────

  var frameWrap = document.createElement("div");
  frameWrap.id = "cl-frame-wrap";

  var frame = document.createElement("iframe");
  frame.id = "cl-frame";
  frame.title = "Intake";
  frame.allow = "microphone";
  // Lazy-load: src set on first open
  frameWrap.appendChild(frame);

  // ── Toggle ────────────────────────────────────────────────────────────────────

  bubble.addEventListener("click", function () {
    isOpen = !isOpen;
    if (isOpen) {
      // Set iframe src on first open
      if (!frame.src || frame.src === "about:blank") {
        frame.src = BASE_URL + "/widget-v3/" + firmId;
      }
      // Animate open: force reflow then add class
      frameWrap.style.display = "block";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          frameWrap.classList.add("cl-open");
        });
      });
      bubble.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
        <span>Close</span>
      `;
    } else {
      frameWrap.classList.remove("cl-open");
      setTimeout(function () {
        if (!isOpen) frameWrap.style.display = "none";
      }, 220);
      bubble.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <span>${label}</span>
      `;
    }
  });

  // ── Mount ─────────────────────────────────────────────────────────────────────

  function mount() {
    document.body.appendChild(frameWrap);
    document.body.appendChild(bubble);
  }

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount);
  }
})();
