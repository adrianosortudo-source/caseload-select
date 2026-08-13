const SECTIONS = [
  "The basics",
  "Real words",
  "How you sound",
  "Calibration",
  "Practice-specific",
  "Proof & taste",
  "Build it",
];

export default function ProgressRail({ currentSection, complete }: { currentSection: number | null; complete: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Interview progress">
      {SECTIONS.map((label, i) => {
        const n = i + 1;
        const done = complete || (currentSection !== null && n < currentSection);
        const active = !complete && currentSection === n;
        return (
          <div
            key={label}
            className={[
              "px-2.5 py-1 text-[10px] font-display font-semibold uppercase tracking-wider border",
              done ? "bg-navy text-white border-navy" : active ? "bg-gold border-gold text-deep-black" : "border-border-brand text-muted",
            ].join(" ")}
          >
            {n}. {label}
          </div>
        );
      })}
    </div>
  );
}
