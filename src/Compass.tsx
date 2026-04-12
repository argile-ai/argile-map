/**
 * Compass overlay. Shows the current map bearing via a rotating north
 * indicator. Click to cycle through cardinal directions (N → E → S → W),
 * matching argile-web-ui's InteractiveCompas pattern.
 */

import { useCallback, useRef } from "react";

type Props = {
  /** Current map bearing in degrees (0 = North, CW positive). */
  bearing: number;
  /** Called when the user picks a new bearing. */
  onBearingChange: (bearing: number) => void;
};

const CYCLE = [0, 90, 180, 270] as const;

/** Find the next cardinal bearing after the current one. */
function nextCardinal(current: number): number {
  const normalized = ((current % 360) + 360) % 360;
  for (const b of CYCLE) {
    if (b > normalized + 5) return b;
  }
  return 0; // wrap around to North
}

/** Avoid 360° jumps. */
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

export function Compass({ bearing, onBearingChange }: Props) {
  const prevRef = useRef(bearing);
  const smoothed = smoothBearing(bearing, prevRef.current);
  prevRef.current = smoothed;

  const onClick = useCallback(() => {
    onBearingChange(nextCardinal(bearing));
  }, [bearing, onBearingChange]);

  return (
    <div style={styles.wrapper} title="Click to rotate view">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ cursor: "pointer", display: "block" }}
        onClick={onClick}
      >
        {/* Background */}
        <circle cx={CX} cy={CY} r={CX - 1} fill="rgba(20,20,30,0.85)" />

        {/* Rotating needle group */}
        <g
          transform={`rotate(${-smoothed}, ${CX}, ${CY})`}
          style={{ transition: "transform 0.4s ease-out" }}
        >
          {/* North needle (red) */}
          <polygon
            points={`${CX},${CY - R + 1} ${CX - 4},${CY} ${CX + 4},${CY}`}
            fill="#e53e3e"
          />
          {/* South needle (dark) */}
          <polygon
            points={`${CX},${CY + R - 1} ${CX - 4},${CY} ${CX + 4},${CY}`}
            fill="#444"
          />
          {/* Center dot */}
          <circle cx={CX} cy={CY} r={2.5} fill="#888" />
        </g>

        {/* Fixed cardinal labels */}
        <text {...cardinalStyle(0)} fill="#e53e3e" fontWeight={700}>N</text>
        <text {...cardinalStyle(90)} fill="#999">E</text>
        <text {...cardinalStyle(180)} fill="#999">S</text>
        <text {...cardinalStyle(270)} fill="#999">O</text>
      </svg>
    </div>
  );
}

function cardinalStyle(angle: number) {
  const a = (angle * Math.PI) / 180;
  const lr = R + 4;
  return {
    x: CX + Math.sin(a) * lr,
    y: CY - Math.cos(a) * lr,
    textAnchor: "middle" as const,
    dominantBaseline: "central" as const,
    fontSize: 9,
    fontFamily: "Lexend, system-ui, sans-serif",
    style: { pointerEvents: "none" as const, userSelect: "none" as const },
  };
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
