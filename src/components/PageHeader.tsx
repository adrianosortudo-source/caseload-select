/**
 * Canonical operator-console page header.
 *
 * One treatment for every admin surface: a gold Oxanium eyebrow, a navy
 * Manrope title, an optional muted subtitle, and an optional right-aligned
 * slot for meta or actions. This replaced the prior boxed-card version (a
 * white bordered bar with no eyebrow) that only Content Studio used, which
 * is why the console had four different header treatments. The eyebrow
 * defaults to "Operator console" so every page reads the same; pass a
 * different eyebrow only when a page genuinely needs one.
 */
export default function PageHeader({
  eyebrow = "Operator console",
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wider font-semibold text-gold">{eyebrow}</p>
        <h1 className="text-2xl font-bold text-navy mt-1">{title}</h1>
        {subtitle && <p className="text-sm text-black/60 mt-1">{subtitle}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
