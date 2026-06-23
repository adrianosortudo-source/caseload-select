/**
 * Renders the lawyer-facing brief HTML for a tool-originated lead.
 *
 * The output is inserted into screened_leads.brief_html and rendered by the
 * triage portal's BriefFrame component. It includes the ACTION_RAIL_SLOT
 * marker so the portal can mount the Take/Pass/Refer action bar inline.
 *
 * Inline styles throughout (the brief renders inside dangerouslySetInnerHTML
 * with no external stylesheet guarantee beyond brief.css base resets).
 */

import type { ToolResult, ToolResultGroup, ToolResultList } from './tool-intake-derive';

interface ToolBriefArgs {
  contactName: string | null;
  contactEmail: string;
  toolName: string;
  toolSlug: string;
  practiceName: string;
  practiceArea: string;
  matterType: string;
  band: 'B' | 'C';
  toolResult: ToolResult;
  answers: Record<string, string>;
  submittedAt: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderGroups(groups: ToolResultGroup[]): string {
  return groups
    .map((group) => {
      const title = group.title
        ? `<div style="margin:14px 0 6px;font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#8a7a68;">${esc(group.title)}</div>`
        : '';
      const rows = group.rows
        .map((row) => {
          const color =
            row.weight === 'primary' ? '#1a2744' :
            row.weight === 'warning' ? '#92400e' :
            row.weight === 'muted' ? '#6b7280' : '#1a2744';
          const fw = row.weight === 'primary' ? '700' : '400';
          const hint = row.hint
            ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${esc(row.hint)}</div>`
            : '';
          return `<tr>
            <td style="padding:6px 12px 6px 0;font-size:13px;color:#4b5563;vertical-align:top;border-bottom:1px solid #e5e7eb;">${esc(row.label)}</td>
            <td style="padding:6px 0;font-size:13px;color:${color};font-weight:${fw};text-align:right;vertical-align:top;border-bottom:1px solid #e5e7eb;">${esc(row.value)}${hint}</td>
          </tr>`;
        })
        .join('');
      return `${title}<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>`;
    })
    .join('');
}

function renderLists(lists?: ToolResultList[]): string {
  if (!lists || lists.length === 0) return '';
  return lists
    .map((list) => {
      const accent =
        list.intent === 'missing' ? '#dc2626' :
        list.intent === 'risk' ? '#92400e' :
        list.intent === 'in-place' ? '#16a34a' : '#4b5563';
      const items = list.items
        .map((item) => `<li style="margin:4px 0;font-size:13px;color:#1f2937;">${esc(item)}</li>`)
        .join('');
      return `<div style="margin:12px 0;border-left:3px solid ${accent};padding:4px 0 4px 12px;">
        <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:${accent};margin-bottom:4px;">${esc(list.title)}</div>
        <ul style="margin:0;padding-left:16px;">${items}</ul>
      </div>`;
    })
    .join('');
}

function renderSources(sources?: string[]): string {
  if (!sources || sources.length === 0) return '';
  const items = sources
    .map((s) => `<li style="margin:2px 0;font-size:11px;color:#6b7280;">${esc(s)}</li>`)
    .join('');
  return `<div style="margin:16px 0 0;">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#8a7a68;margin-bottom:4px;">Sources</div>
    <ul style="margin:0;padding-left:16px;">${items}</ul>
  </div>`;
}

function renderAnswersTable(answers: Record<string, string>): string {
  const entries = Object.entries(answers);
  if (entries.length === 0) return '';
  const rows = entries
    .map(
      ([k, v]) =>
        `<tr>
          <td style="padding:5px 10px 5px 0;font-size:12px;color:#6b7280;vertical-align:top;border-bottom:1px solid #f3f4f6;">${esc(k)}</td>
          <td style="padding:5px 0;font-size:12px;color:#1f2937;vertical-align:top;border-bottom:1px solid #f3f4f6;">${esc(String(v))}</td>
        </tr>`,
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${rows}</table>`;
}

export function renderToolBriefHtml(args: ToolBriefArgs): string {
  const {
    contactName,
    contactEmail,
    toolName,
    practiceName,
    band,
    toolResult,
    answers,
    submittedAt,
  } = args;

  const displayName = contactName ? esc(contactName) : '<span style="color:#9ca3af;">Name not provided</span>';
  const bandColor = band === 'B' ? '#2563eb' : '#8a7a68';

  const formattedDate = new Date(submittedAt).toLocaleString('en-CA', {
    timeZone: 'America/Toronto',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937;line-height:1.5;">

  <!-- NAP block -->
  <div style="padding:20px 24px;border-bottom:2px solid #1a2744;">
    <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:8px;">
      <span style="font-size:20px;font-weight:700;color:#1a2744;">${displayName}</span>
      <span style="display:inline-block;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#fff;background:${bandColor};">BAND ${esc(band)}</span>
      <span style="display:inline-block;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#92400e;background:#fef3c7;border:1px solid #fde68a;">TOOL LEAD</span>
    </div>
    <div style="font-size:13px;color:#4b5563;">
      <span>${esc(contactEmail)}</span>
    </div>
    <div style="margin-top:6px;font-size:11px;color:#9ca3af;">${formattedDate} ET</div>
  </div>

<!-- ACTION_RAIL_SLOT -->

  <!-- Lead source -->
  <div style="padding:16px 24px;background:#fffbeb;border-bottom:1px solid #fde68a;">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#92400e;margin-bottom:6px;">Lead source</div>
    <div style="font-size:15px;font-weight:600;color:#1a2744;">${esc(toolName)}</div>
    <div style="font-size:13px;color:#4b5563;margin-top:2px;">${esc(practiceName)}</div>
    <div style="margin-top:8px;font-size:12px;color:#92400e;padding:6px 10px;background:#fff;border:1px solid #fde68a;border-radius:3px;display:inline-block;">
      This lead used a calculator tool on the website. Lower intent than a direct intake submission.
    </div>
  </div>

  <!-- Tool result headline -->
  <div style="padding:16px 24px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#8a7a68;margin-bottom:6px;">Tool result</div>
    <div style="font-size:17px;font-weight:700;color:#1a2744;">${esc(toolResult.headline)}</div>
    ${toolResult.subline ? `<div style="font-size:13px;color:#6b7280;margin-top:4px;">${esc(toolResult.subline)}</div>` : ''}
  </div>

  <!-- Breakdown -->
  <div style="padding:16px 24px;border-bottom:1px solid #e5e7eb;">
    ${renderGroups(toolResult.groups)}
    ${renderLists(toolResult.lists)}
  </div>

  <!-- Recommendation -->
  <div style="padding:16px 24px;border-bottom:1px solid #e5e7eb;">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#8a7a68;margin-bottom:6px;">Tool recommendation shown to visitor</div>
    <div style="padding:10px 14px;background:#f0f9ff;border-left:3px solid #2563eb;font-size:13px;color:#1e40af;">${esc(toolResult.recommendation)}</div>
  </div>

  ${renderSources(toolResult.sources)}

  <!-- Raw answers -->
  <div style="padding:16px 24px;">
    <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#8a7a68;margin-bottom:8px;">Answers provided</div>
    ${renderAnswersTable(answers)}
  </div>

</div>`;
}
