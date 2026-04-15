"use client";

/**
 * Sparkline — SVG polyline for portal KPI tiles.
 * 6 data points, one per week. No external dependencies.
 */

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export default function Sparkline({
  data,
  color = "#1E2F58",
  width = 80,
  height = 28,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + ((max - v) / range) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      <polyline
        points={points.join(" ")}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.7"
      />
      {/* Last point dot */}
      {(() => {
        const last = points[points.length - 1].split(",");
        return (
          <circle
            cx={last[0]}
            cy={last[1]}
            r="2"
            fill={color}
            opacity="0.9"
          />
        );
      })()}
    </svg>
  );
}
