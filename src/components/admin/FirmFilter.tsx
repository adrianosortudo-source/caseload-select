"use client";

/**
 * Firm filter dropdown for /admin/triage and /admin/webhook-outbox.
 *
 * Renders a native <select> that submits a GET to /admin/* with the new
 * firm_id query param on change. Falls back to a submit button when JS is
 * disabled. Preserves any sibling filters (band, status) via hidden inputs
 * passed in `extraParams`.
 */

interface FirmOption {
  id: string;
  name: string;
}

interface ExtraParam {
  name: string;
  value: string;
}

export default function FirmFilter({
  action,
  firms,
  active,
  extraParams = [],
}: {
  action: string;
  firms: FirmOption[];
  active: string | null;
  extraParams?: ExtraParam[];
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {extraParams.map((p) => (
        <input key={p.name} type="hidden" name={p.name} value={p.value} />
      ))}
      <label className="text-xs uppercase tracking-wider font-semibold text-black/50">
        Firm
      </label>
      <select
        name="firm_id"
        defaultValue={active ?? ""}
        className="text-xs px-2 py-1.5 border border-black/15 bg-white text-black/80 focus:outline-none focus:border-navy"
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (form) form.submit();
        }}
      >
        <option value="">All firms</option>
        {firms.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="text-xs px-2 py-1 border border-black/15">
          Apply
        </button>
      </noscript>
    </form>
  );
}
