import { config } from "./config";
import type { BuildingAnalysis, DpeClass, DpeInfo } from "./argile-api/types";
import { useBuildingAnalysis } from "./useBuildingAnalysis";

type ClickPoint = { lat: number; lng: number };

export function BuildingPopup({
  click,
  onClose,
}: {
  click: ClickPoint;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useBuildingAnalysis(click);

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        right: 12,
        width: 340,
        background: "#FFFFFF",
        color: "#171923",
        borderRadius: 12,
        padding: "18px 18px 16px",
        fontFamily: "'Lexend', system-ui, sans-serif",
        fontSize: 13,
        fontWeight: 300,
        boxShadow: "0 6px 24px rgba(15,30,60,0.18)",
        zIndex: 10,
      }}
    >
      <CloseButton onClick={onClose} />
      <PopupBody analysis={data ?? null} isLoading={isLoading} error={error} />
    </div>
  );
}

function PopupBody({
  analysis,
  isLoading,
  error,
}: {
  analysis: BuildingAnalysis | null;
  isLoading: boolean;
  error: Error | null;
}) {
  if (isLoading) return <Loading />;
  if (error) {
    return (
      <div style={{ paddingRight: 16, color: "#E53E3E" }}>Erreur : {error.message}</div>
    );
  }
  if (!analysis) {
    return (
      <div style={{ paddingRight: 16, color: "#4A5568" }}>
        Aucun bâtiment trouvé à cet endroit.
      </div>
    );
  }
  return <Content analysis={analysis} />;
}

function Content({ analysis }: { analysis: BuildingAnalysis }) {
  const url = `${config.argileWebUrl}/acquisition/building?a=${encodeURIComponent(
    analysis.answerId,
  )}&t=${encodeURIComponent(analysis.leadToken)}`;
  return (
    <>
      <Title>{analysis.address.label}</Title>
      <DpeHero dpe={analysis.dpe} />
      <CtaButton href={url}>Lancer une analyse complète →</CtaButton>
    </>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "'Bricolage Grotesque', 'Lexend', system-ui, sans-serif",
        fontWeight: 500,
        fontSize: 15,
        color: "#171923",
        marginBottom: 14,
        paddingRight: 24,
        lineHeight: 1.3,
      }}
    >
      {children}
    </div>
  );
}

function DpeHero({ dpe }: { dpe: DpeInfo | null }) {
  if (!dpe) {
    return (
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          background: "#F7FAFC",
          color: "#4A5568",
          fontSize: 12.5,
        }}
      >
        DPE non disponible pour ce bâtiment.
      </div>
    );
  }
  const color = DPE_COLORS[dpe.value];
  const sub = dpe.visitDate
    ? `Diagnostic ${formatVisitDate(dpe.visitDate)}`
    : dpe.consoKwhEpM2 != null
      ? `${Math.round(dpe.consoKwhEpM2)} kWh ep / m² / an`
      : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 8,
        background: "#F7FAFC",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 44,
          height: 44,
          background: color.bg,
          color: color.fg,
          borderRadius: 6,
          fontFamily: "'Bricolage Grotesque', 'Lexend', system-ui, sans-serif",
          fontWeight: 700,
          fontSize: 22,
          lineHeight: 1,
        }}
      >
        {dpe.value}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontSize: 11,
            color: "#8A9AAF",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          DPE
        </span>
        {sub && <span style={{ fontSize: 12.5, color: "#4A5568" }}>{sub}</span>}
      </div>
    </div>
  );
}

function CtaButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "block",
        marginTop: 16,
        padding: "11px 14px",
        background: "#335CFF",
        color: "white",
        textDecoration: "none",
        borderRadius: 8,
        textAlign: "center",
        fontWeight: 500,
        fontFamily: "'Lexend', system-ui, sans-serif",
        fontSize: 13.5,
        boxShadow: "0 2px 8px rgba(51,92,255,0.25)",
      }}
    >
      {children}
    </a>
  );
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Fermer"
      style={{
        position: "absolute",
        top: 10,
        right: 10,
        width: 26,
        height: 26,
        background: "transparent",
        border: "none",
        color: "#4A5568",
        fontSize: 20,
        cursor: "pointer",
        lineHeight: 1,
      }}
    >
      ×
    </button>
  );
}

function Loading() {
  return (
    <div
      style={{
        paddingRight: 16,
        color: "#4A5568",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <Spinner /> Chargement…
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid #E2E8F0",
        borderTopColor: "#335CFF",
        borderRadius: "50%",
        animation: "argile-spin 0.7s linear infinite",
      }}
    />
  );
}

function formatVisitDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

const DPE_COLORS: Record<DpeClass, { bg: string; fg: string }> = {
  A: { bg: "#42996E", fg: "#FFFFFF" },
  B: { bg: "#6AAF5E", fg: "#FFFFFF" },
  C: { bg: "#87BB7D", fg: "#FFFFFF" },
  D: { bg: "#F0E54D", fg: "#000000" },
  E: { bg: "#E9B640", fg: "#FFFFFF" },
  F: { bg: "#DD8545", fg: "#FFFFFF" },
  G: { bg: "#C4362C", fg: "#FFFFFF" },
};
