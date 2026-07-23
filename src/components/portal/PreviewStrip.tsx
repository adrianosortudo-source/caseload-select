import {
  buildSupportPreviewBannerText,
  type SupportPreviewAudience,
} from "@/lib/support-preview-copy";

/**
 * Support-preview banner (DR-084). The one deliberate visual difference
 * between a preview and the real target view: names the firm and audience,
 * states the read-only boundary, offers the exit. Everything below it is
 * the target's interface unchanged. Never renders credentials, session
 * values, tokens, or raw firm IDs as text.
 */
export default function PreviewStrip({
  firmId,
  firmName,
  audience,
}: {
  firmId: string;
  firmName: string;
  audience: SupportPreviewAudience;
}) {
  return (
    <div className="bg-navy text-white px-4 sm:px-6 py-2 text-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3">
      <span>{buildSupportPreviewBannerText(firmName, audience)}</span>
      <a
        href={`/api/portal/${firmId}/preview/exit`}
        className="uppercase tracking-wider font-semibold underline underline-offset-2 whitespace-nowrap hover:text-gold"
      >
        Exit preview
      </a>
    </div>
  );
}
