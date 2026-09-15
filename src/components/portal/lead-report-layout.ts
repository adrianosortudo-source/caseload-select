const CONVERSATION_SLOT_HTML =
  '<!-- CHANNEL_CONVERSATION_SLOT --><div class="brief-conversation-slot" data-channel-conversation-slot></div>';

/**
 * New briefs carry the slot from the renderer. Existing v2 snapshots receive
 * the same placeholder immediately after Queue posture at read time. Older
 * report HTML has no right rail and keeps the live panel below the report.
 */
export function ensureConversationRailSlot(html: string): { html: string; inserted: boolean } {
  if (html.includes("data-channel-conversation-slot")) {
    return { html, inserted: true };
  }

  const railStart = html.indexOf('class="brief-main-right"');
  const postureStart = html.indexOf('class="sidebar-card sidebar-card-posture"', railStart);
  if (railStart < 0 || postureStart < 0) return { html, inserted: false };

  const postureEnd = html.indexOf("</section>", postureStart);
  if (postureEnd < 0) return { html, inserted: false };

  const insertAt = postureEnd + "</section>".length;
  return {
    html: `${html.slice(0, insertAt)}\n${CONVERSATION_SLOT_HTML}${html.slice(insertAt)}`,
    inserted: true,
  };
}
