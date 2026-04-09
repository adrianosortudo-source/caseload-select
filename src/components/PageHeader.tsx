export default function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <div className="px-8 py-6 border-b border-black/5 bg-white flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-black/60 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
