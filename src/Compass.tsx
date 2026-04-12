/**
 * Interactive compass overlay. Shows the current map bearing and lets the
 * user click cardinal directions (N/E/S/W) to rotate, or drag the ring to
 * set an arbitrary bearing.
 *
 * Styled after argile-web-ui's Compas.tsx but rendered as inline SVG so we
 * don't need external PNG assets.
 */

import { useCallback, useRef, useState } from "react";

type Props = {
  /** Current map bearing in degrees (0 = North, CW positive). */
  bearing: number;
  /** Called when the user picks a new bearing. */
  onBearingChange: (bearing: number) => void;
};

/** Avoid 360° jumps — always take the shortest rotation path. */
function smoothBearing(target: number, prev: number): number {
  let delta = target - prev;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return prev + delta;
}

const SIZE = 48;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 18;

const CARDINALS = [
  { label: "N", angle: 0 },
  { label: "E", angle: 90 },
  { label: "S", angle: 180 },
  { label: "O", angle: 270 },
] as const;

export function Compass({ bearing, onBearingChange }: Props) {
  const prevRef = useRef(bearing);
  const smoothed = smoothBearing(bearing, prevRef.current);
  prevRef.current = smoothed;

  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const angleFromEvent = useCallback((e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      (e.target as Element).setPointerCapture(e.pointerId);
      onBearingChange(angleFromEvent(e));
    },
    [angleFromEvent, onBearingChange],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      onBearingChange(angleFromEvent(e));
    },
    [dragging, angleFromEvent, onBearingChange],
  );

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div style={styles.wrapper}>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* Background */}
        <circle cx={CX} cy={CY} r={CX - 1} fill="rgba(20,20,30,0.85)" />
        {/* Rotating ring group */}
        <g
          transform={`rotate(${-smoothed}, ${CX}, ${CY})`}
          style={{ transition: dragging ? "none" : "transform 0.15s ease-out" }}
        >
          {/* Outer ring */}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#555" strokeWidth={1} />
          {/* North indicator (red triangle) */}
          <polygon points={`${CX},${CY - R - 3} ${CX - 3},${CY - R + 3} ${CX + 3},${CY - R + 3}`} fill="#e53e3e" />
          {/* Tick marks */}
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * 30 * Math.PI) / 180;
            const inner = i % 3 === 0 ? R - 4 : R - 2;
            return (
              <line
                key={i}
                x1={CX + Math.sin(a) * inner}
                y1={CY - Math.cos(a) * inner}
                x2={CX + Math.sin(a) * R}
                y2={CY - Math.cos(a) * R}
                stroke="#888"
                strokeWidth={i % 3 === 0 ? 1.5 : 0.8}
              />
            );
          })}
        </g>
        {/* Cardinal labels (fixed, don't rotate) */}
        {CARDINALS.map((c) => {
          const a = ((c.angle - smoothed) * Math.PI) / 180;
          const lr = R + 1;
          const x = CX + Math.sin(a) * lr;
          const y = CY - Math.cos(a) * lr;
          return (
            <text
              key={c.label}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              fill={c.label === "N" ? "#e53e3e" : "#bbb"}
              fontSize={8}
              fontWeight={c.label === "N" ? 700 : 400}
              fontFamily="Lexend, system-ui, sans-serif"
              style={{ pointerEvents: "none", userSelect: "none" }}
            >
              {c.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "absolute",
    bottom: 32,
    right: 12,
    zIndex: 10,
    borderRadius: "50%",
    boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
  },
};
