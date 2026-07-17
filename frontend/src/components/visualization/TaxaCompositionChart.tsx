import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { getTaxaSampleProfiles } from "../../api/taxa";
import { taxonColor } from "./taxaColors";

type TaxaComposition = {
  lumped_taxon: string;
  percentage?: number;
  abundance?: number;
};

type SampleRow = {
  sampleid?: number | null;
  sitename?: string | null;
  pH?: number | null;
  water_table_depth?: number | null;
  water_table_depth_units?: string | null;
};

type SampleProfile = {
  sampleid: number;
  composition: Array<{
    lumped_taxon: string;
    percentage: number;
  }>;
};

const MAX_REFERENCE_SAMPLES = 350;
const MAX_SELECTED_SAMPLES = 300;
const Plot = lazy(() => import("./PlotlyChart"));

export default function TaxaCompositionChart({
  data,
  referenceData = [],
  rows = [],
  referenceRows = [],
}: {
  data: TaxaComposition[];
  referenceData?: TaxaComposition[];
  rows?: SampleRow[];
  referenceRows?: SampleRow[];
}) {
  const [selectedGenera, setSelectedGenera] = useState<string[]>([]);
  const [showReference, setShowReference] = useState(true);
  const [plotRevision, setPlotRevision] = useState(0);
  const [profileResult, setProfileResult] = useState<{
    key: string;
    reference: SampleProfile[];
    selected: SampleProfile[];
  }>({ key: "", reference: [], selected: [] });
  const chartData = data.map((row) => ({
    ...row,
    percentage: Number(row.percentage ?? row.abundance ?? 0),
  }));

  const reference = referenceData.map((row) => ({
    ...row,
    percentage: Number(row.percentage ?? row.abundance ?? 0),
  }));
  const selectedByTaxon = new Map(
    chartData.map((row) => [row.lumped_taxon, row.percentage])
  );
  const taxa = Array.from(new Set([
    ...reference.map((row) => row.lumped_taxon),
    ...chartData.map((row) => row.lumped_taxon),
  ])).filter((taxon) => taxon !== "Other").sort((a, b) =>
    (selectedByTaxon.get(b) ?? 0) - (selectedByTaxon.get(a) ?? 0)
  );
  const activeGenera = selectedGenera.filter((taxon) => taxa.includes(taxon));
  if (activeGenera.length === 0 && taxa[0]) activeGenera.push(taxa[0]);
  const lumpLabel = activeGenera.length > 1
    ? `Custom lump (${activeGenera.join(" + ")})`
    : activeGenera[0] ?? "Lumped composition";
  const combinedMean = activeGenera.reduce(
    (sum, taxon) => sum + (selectedByTaxon.get(taxon) ?? 0),
    0
  );

  const validReferenceRows = useMemo(
    () => {
      const valid = referenceRows.filter((row) =>
        row.sampleid != null && row.pH != null && row.water_table_depth != null
      );
      if (valid.length <= MAX_REFERENCE_SAMPLES) return valid;
      const step = valid.length / MAX_REFERENCE_SAMPLES;
      return Array.from(
        { length: MAX_REFERENCE_SAMPLES },
        (_, index) => valid[Math.floor(index * step)]
      );
    },
    [referenceRows]
  );
  const validSelectedRows = useMemo(
    () => rows.filter((row) =>
      row.sampleid != null && row.pH != null && row.water_table_depth != null
    ).slice(0, MAX_SELECTED_SAMPLES),
    [rows]
  );
  const referenceIds = useMemo(
    () => validReferenceRows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]),
    [validReferenceRows]
  );
  const selectedIds = useMemo(
    () => validSelectedRows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]),
    [validSelectedRows]
  );
  const profileKey = `${referenceIds.join(",")}|${selectedIds.join(",")}`;

  useEffect(() => {
    let cancelled = false;
    if (referenceIds.length === 0 && selectedIds.length === 0) return;

    Promise.all([
      referenceIds.length ? getTaxaSampleProfiles(referenceIds, 100) : [],
      selectedIds.length ? getTaxaSampleProfiles(selectedIds, 100) : [],
    ])
      .then(([referenceProfiles, selectedProfiles]) => {
        if (!cancelled) {
          setProfileResult({
            key: profileKey,
            reference: referenceProfiles,
            selected: selectedProfiles,
          });
        }
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
    };
  }, [profileKey, referenceIds, selectedIds]);

  const profiles = profileResult.key === profileKey
    ? profileResult
    : { reference: [], selected: [] };
  const profilesLoading = profileResult.key !== profileKey &&
    (referenceIds.length > 0 || selectedIds.length > 0);
  const referenceProfileMap = new Map(
    profiles.reference.map((profile) => [String(profile.sampleid), profile])
  );
  const selectedProfileMap = new Map(
    profiles.selected.map((profile) => [String(profile.sampleid), profile])
  );
  const percentageFor = (
    profile: SampleProfile | undefined,
    selectedTaxa: string[]
  ) => selectedTaxa.reduce((sum, taxon) =>
    sum + (profile?.composition.find(
      (item) => item.lumped_taxon === taxon
    )?.percentage ?? 0), 0);
  const ringSize = (percentage: number) =>
    Math.max(4, Math.min(26, 4 + Math.sqrt(Math.max(percentage, 0)) * 3));
  const referencePercentages = validReferenceRows.map((row) =>
    percentageFor(referenceProfileMap.get(String(row.sampleid)), activeGenera)
  );
  const referencePoints = validReferenceRows
    .map((row, index) => ({ row, percentage: referencePercentages[index] }))
    .filter((point) => point.percentage > 0);
  const selectedTraces = activeGenera.map((taxon, taxonIndex) => {
    const taxonPercentages = validSelectedRows.map((row) =>
      percentageFor(selectedProfileMap.get(String(row.sampleid)), [taxon])
    );
    const cumulativePercentages = validSelectedRows.map((row) =>
      percentageFor(
        selectedProfileMap.get(String(row.sampleid)),
        activeGenera.slice(0, taxonIndex + 1)
      )
    );
    const visibleIndexes = taxonPercentages
      .map((percentage, index) => percentage > 0 ? index : -1)
      .filter((index) => index >= 0);

    return {
      x: visibleIndexes.map((index) => validSelectedRows[index].pH),
      y: visibleIndexes.map((index) => validSelectedRows[index].water_table_depth),
      z: visibleIndexes.map((index) => cumulativePercentages[index]),
      text: visibleIndexes.map(
        (index) => `${validSelectedRows[index].sitename || "Unknown site"}<br>Sample ${validSelectedRows[index].sampleid}`
      ),
      customdata: visibleIndexes.map((index) => [
        taxonPercentages[index],
        cumulativePercentages[index],
      ]),
      hovertemplate:
        `%{text}<br>pH %{x:.2f}<br>WTD %{y:.2f}<br>${taxon}: %{customdata[0]:.2f}%<br>Combined: %{customdata[1]:.2f}%<extra>${taxon}</extra>`,
      mode: "markers" as const,
      type: "scatter3d" as const,
      name: taxon,
      marker: {
        symbol: "circle-open",
        size: visibleIndexes.map((index) => ringSize(taxonPercentages[index])),
        color: taxonColor(taxon),
        opacity: 0.9,
        line: { width: 4 },
      },
    };
  });

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
          marginBottom: "8px",
        }}
      >
        <span>Lumped genera:</span>
        {activeGenera.map((taxon) => (
          <button
            key={taxon}
            type="button"
            onClick={() => {
              if (activeGenera.length > 1) {
                setSelectedGenera(activeGenera.filter((item) => item !== taxon));
              }
            }}
            title={activeGenera.length > 1 ? `Remove ${taxon}` : "At least one genus is required"}
          >
            {taxon}{activeGenera.length > 1 ? " ×" : ""}
          </button>
        ))}
        <label>
          <span style={{ position: "absolute", width: "1px", height: "1px", overflow: "hidden" }}>
            Add genus to lump
          </span>
          <select
            value=""
            onChange={(event) => {
              const taxon = event.target.value;
              if (taxon && !activeGenera.includes(taxon)) {
                setSelectedGenera([...activeGenera, taxon]);
              }
            }}
          >
            <option value="">+ Add genus</option>
            {taxa
              .filter((taxon) => !activeGenera.includes(taxon))
              .map((taxon) => <option key={taxon}>{taxon}</option>)}
          </select>
        </label>
        <strong>{combinedMean.toFixed(2)}% combined mean</strong>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
          <input
            type="checkbox"
            checked={showReference}
            onChange={(event) => setShowReference(event.target.checked)}
          />
          Show reference
        </label>
        <button type="button" onClick={() => setPlotRevision((value) => value + 1)}>
          Reset view
        </button>
      </div>
      {profilesLoading ? (
        <div style={{ minHeight: "560px", display: "grid", placeItems: "center" }}>
          Loading 3D sample profiles…
        </div>
      ) : (
      <Suspense fallback={(
        <div style={{ minHeight: "560px", display: "grid", placeItems: "center" }}>
          Loading interactive chart…
        </div>
      )}>
      <Plot
        data={[
          ...(showReference ? [{
            x: referencePoints.map((point) => point.row.pH),
            y: referencePoints.map((point) => point.row.water_table_depth),
            z: referencePoints.map((point) => point.percentage),
            text: referencePoints.map(
              (point) => `${point.row.sitename || "Unknown site"}<br>Sample ${point.row.sampleid}`
            ),
            customdata: referencePoints.map((point) => point.percentage),
            hovertemplate:
              "%{text}<br>pH %{x:.2f}<br>WTD %{y:.2f}<br>Composition %{customdata:.2f}%<extra>Reference sample</extra>",
            mode: "markers" as const,
            type: "scatter3d" as const,
            name: "Reference sample",
            marker: {
              symbol: "circle-open",
              size: referencePoints.map((point) => Math.min(18, ringSize(point.percentage))),
              color: "#94a3b8",
              opacity: 0.14,
              line: { color: "#64748b", width: 1 },
            },
          }] : []),
          ...selectedTraces,
        ]}
        layout={{
          autosize: true,
          height: 560,
          margin: { l: 0, r: 0, t: 28, b: 0 },
          legend: { orientation: "h" },
          paper_bgcolor: "transparent",
          scene: {
            xaxis: { title: { text: "pH" } },
            yaxis: { title: { text: "Water-table depth" } },
            zaxis: { title: { text: `${lumpLabel} composition (%)` }, rangemode: "tozero" },
            camera: { eye: { x: 1.55, y: 1.45, z: 1.15 } },
          },
        }}
        config={{ responsive: true, displaylogo: false }}
        style={{ width: "100%" }}
        revision={plotRevision}
      />
      </Suspense>
      )}

      <p style={{ opacity: 0.72, marginBottom: "14px" }}>
        Each ring is one sample. Every selected genus keeps its own color and
        ring size represents that genus percentage. Multiple genera stack on
        the Z axis, with the top ring showing the combined lump percentage.{" "}
        {validSelectedRows.length.toLocaleString()} filtered samples and{" "}
        {referencePoints.length.toLocaleString()} non-zero reference samples are plotted.
      </p>

    </div>
  );
}
