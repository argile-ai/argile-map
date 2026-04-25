/**
 * Address search input with autocomplete, styled after argile-site's
 * design system (Lexend font, 12px border-radius, soft borders).
 *
 * Uses the French government geocoding API (api-adresse.data.gouv.fr)
 * which is free, fast, and covers all of France. No API key needed.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Suggestion = {
  label: string;
  lat: number;
  lng: number;
};

const GEOCODE_URL = "https://api-adresse.data.gouv.fr/search";
const DEBOUNCE_MS = 250;

async function geocode(query: string, signal?: AbortSignal): Promise<Suggestion[]> {
  if (query.length < 3) return [];
  const url = `${GEOCODE_URL}?q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.features ?? []).map(
    (f: { properties: { label: string }; geometry: { coordinates: [number, number] } }) => ({
      label: f.properties.label,
      lng: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }),
  );
}

type Props = {
  onSelect: (lat: number, lng: number) => void;
};

export function AddressSearch({ onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      geocode(query, controller.signal)
        .then((results) => {
          setSuggestions(results);
          setOpen(results.length > 0);
          setActiveIdx(-1);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pick = useCallback(
    (s: Suggestion) => {
      setQuery(s.label);
      setOpen(false);
      setSuggestions([]);
      onSelect(s.lat, s.lng);
    },
    [onSelect],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        // Default to the top suggestion when no row has been arrow-keyed.
        e.preventDefault();
        pick(suggestions[Math.max(activeIdx, 0)]);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [open, suggestions, activeIdx, pick],
  );

  return (
    <div style={styles.wrapper}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Rechercher une adresse…"
        style={styles.input}
      />
      <svg style={styles.icon} viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
          clipRule="evenodd"
        />
      </svg>
      {open && suggestions.length > 0 && (
        <ul style={styles.dropdown}>
          {suggestions.map((s, i) => (
            <li
              key={s.label}
              style={{
                ...styles.item,
                background: i === activeIdx ? "#f7fafc" : "transparent",
              }}
              onMouseDown={() => pick(s)}
              onMouseEnter={() => setActiveIdx(i)}
            >
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 340,
    zIndex: 10,
    fontFamily: "'Lexend', system-ui, sans-serif",
  },
  input: {
    width: "100%",
    height: 48,
    padding: "0 40px 0 12px",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    background: "white",
    fontSize: 14,
    letterSpacing: "-0.01em",
    color: "#0a0a10",
    boxShadow: "0 1px 2px 0 rgba(0,0,0,0.05)",
    outline: "none",
  },
  icon: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 20,
    height: 20,
    color: "#a0aec0",
    pointerEvents: "none" as const,
  },
  dropdown: {
    listStyle: "none",
    margin: "4px 0 0",
    padding: "4px 0",
    background: "white",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)",
    overflow: "hidden",
  },
  item: {
    padding: "10px 12px",
    fontSize: 14,
    color: "#0a0a10",
    cursor: "pointer",
    letterSpacing: "-0.01em",
  },
};
