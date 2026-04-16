"use client";

/**
 * Sparkline — SVG polyline for portal KPI tiles.
 * 6 data points (one per week). No external dependencies.
 *
 * yoyData: optional prior-year series rendered as a dashed, muted line
 * on the same scale — visible only when 12+ months of data exist.
 */

interface SparklineProps {
  data: number[];
  yoyData?: number[] | null;
  color?: string;
  width?: number;
  height?: number;
}

export default function Sparkline({
  data,
  yoyData,
  color = "#1E2F58",
  width = 80,
  height = 28,
}: SparklineProps) {
  if (!data || data.length < 2) return null;

  // Unified scale across both series so they're comparable
  const allValues = [...data, ...(yoyData ?? [])];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const pad = 2;

  const toPoints = (arr: number[]) =>
    arr.map((v, i) => {
      const x = pad + (i / (arr.length - 1)) * (width - pad * 2);
      const y = pad + ((max - v) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

  const mainPoints = toPoints(data);
  const yoyPoints =
    yoyData && yoyData.length >= 2 ? toPoints(yoyData) : null;

  const lastMain = mainPoints[mainPoints.length - 1].split(",");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      {/* Prior-year line — dashed, 25% opacity */}
      {yoyPoints && (
        <polyline
          points={yoyPoints.join(" ")}
          stroke={color}
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="2 2"
          fill="none"
          opacity="0.25"
        />
      )}

      {/* Current-year line */}
      <polyline
        points={mainPoints.join(" ")}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.7"
      />

      {/* Dot on latest point */}
      <circle
        cx={lastMain[0]}
        cy={lastMain[1]}
        r="2"
        fill={color}
        opacity="0.9"
      />
    </svg>
  );
}
