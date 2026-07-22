import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { getTaxonSampleValues, type TaxonSampleValue } from "../../api/taxa";
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
};

type Props = {
  data: TaxaComposition[];
  referenceData?: TaxaComposition[];
  rows?: SampleRow[];
  referenceRows?: SampleRow[];
};

const Plot = lazy(() => import("./PlotlyChart"));

export default function TaxaCompositionChart(props: Props) {
  const { data, rows = [] } = props;
  const [selectedTaxa, setSelectedTaxa] = useState<string[]>([]);
  const [dimensions, setDimensions] = useState<2 | 3>(2);
  const [aggregation, setAggregation] = useState<"combined" | "individual">("combined");
  const [showBackground, setShowBackground] = useState(true);
  const [plotRevision, setPlotRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; values: TaxonSampleValue[] }>({ key: "", values: [] });

  const chartData = useMemo(() => data
    .map((row) => ({
      taxon: row.lumped_taxon,
      percentage: Number(row.percentage ?? row.abundance ?? 0),
    }))
    .filter((row) => row.taxon !== "Other")
    .sort((a, b) => b.percentage - a.percentage), [data]);
  const taxa = useMemo(() => chartData.map((row) => row.taxon), [chartData]);
  const displayedTaxa = useMemo(() => {
    const activeTaxa = selectedTaxa.filter((taxon) => taxa.includes(taxon));
    return activeTaxa.length ? activeTaxa : taxa.slice(0, 1);
  }, [selectedTaxa, taxa]);
  const validRows = useMemo(
    () => rows.filter((row) => row.sampleid != null && row.pH != null && row.water_table_depth != null),
    [rows]
  );
  const ids = useMemo(
    () => validRows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]),
    [validRows]
  );
  const requestKey = `${ids.join(",")}|${displayedTaxa.join("|")}`;

  useEffect(() => {
    let cancelled = false;
    if (!ids.length || !displayedTaxa.length) return;
    getTaxonSampleValues(ids, displayedTaxa)
      .then((values) => {
        if (!cancelled) setResult({ key: requestKey, values });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setResult({ key: requestKey, values: [] });
      });
    return () => { cancelled = true; };
  }, [ids, displayedTaxa, requestKey]);

  const values = result.key === requestKey ? result.values : [];
  const loading = result.key !== requestKey && ids.length > 0;
  const valueBySample = new Map(values.map((value) => [String(value.sampleid), value]));
  const percentageFor = (row: SampleRow, taxon: string) =>
    valueBySample.get(String(row.sampleid))?.composition.find(
      (item) => item.lumped_taxon === taxon
    )?.percentage ?? 0;
  const combinedFor = (row: SampleRow) => valueBySample.get(String(row.sampleid))?.combined_percentage ?? 0;
  const ringSize = (percentage: number) =>
    Math.max(7, Math.min(38, Math.sqrt(Math.max(percentage, 0)) * 4));
  const combinedMean = displayedTaxa.reduce((sum, taxon) =>
    sum + (chartData.find((row) => row.taxon === taxon)?.percentage ?? 0), 0);
  const selectedLabel = displayedTaxa.join(" + ");

  const backgroundTrace = dimensions === 3 ? {
    x: validRows.map((row) => row.pH),
    y: validRows.map((row) => row.water_table_depth),
    z: validRows.map(() => 0),
    text: validRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}`),
    hovertemplate: "%{text}<br>pH %{x:.2f}<br>WTD %{y:.2f}<extra>Filtered sample</extra>",
    mode: "markers" as const,
    type: "scatter3d" as const,
    name: "All filtered samples",
    marker: { symbol: "circle", size: 7, color: "#94a3b8", opacity: 0.42 },
  } : {
    x: validRows.map((row) => row.water_table_depth),
    y: validRows.map((row) => row.pH),
    text: validRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}`),
    hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra>Filtered sample</extra>",
    mode: "markers" as const,
    type: "scatter" as const,
    name: "All filtered samples",
    marker: { symbol: "circle", size: 9, color: "#94a3b8", opacity: 0.42 },
  };

  const combinedRows = validRows.filter((row) => combinedFor(row) > 0);
  const combinedTrace = dimensions === 3 ? {
    x: combinedRows.map((row) => row.pH),
    y: combinedRows.map((row) => row.water_table_depth),
    z: combinedRows.map(combinedFor),
    text: combinedRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}<br>${selectedLabel}: ${combinedFor(row).toFixed(2)}%`),
    hovertemplate: "%{text}<br>pH %{x:.2f}<br>WTD %{y:.2f}<extra>Combined selection</extra>",
    mode: "markers" as const,
    type: "scatter3d" as const,
    name: `Combined (${displayedTaxa.length})`,
    marker: { symbol: "circle-open", size: combinedRows.map((row) => ringSize(combinedFor(row))), color: taxonColor(displayedTaxa[0]), opacity: 0.9, line: { width: 3 } },
  } : {
    x: combinedRows.map((row) => row.water_table_depth),
    y: combinedRows.map((row) => row.pH),
    text: combinedRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}<br>${selectedLabel}: ${combinedFor(row).toFixed(2)}%`),
    hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra>Combined selection</extra>",
    mode: "markers" as const,
    type: "scatter" as const,
    name: `Combined (${displayedTaxa.length})`,
    marker: { symbol: "circle-open", size: combinedRows.map((row) => ringSize(combinedFor(row))), color: taxonColor(displayedTaxa[0]), opacity: 0.9, line: { width: 2 } },
  };

  const individualTraces = displayedTaxa.map((taxon, taxonIndex) => {
    const taxonRows = validRows.filter((row) => percentageFor(row, taxon) > 0);
    const cumulative = (row: SampleRow) => displayedTaxa.slice(0, taxonIndex + 1)
      .reduce((sum, selectedTaxon) => sum + percentageFor(row, selectedTaxon), 0);
    return dimensions === 3 ? {
      x: taxonRows.map((row) => row.pH),
      y: taxonRows.map((row) => row.water_table_depth),
      z: taxonRows.map(cumulative),
      text: taxonRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}<br>${taxon}: ${percentageFor(row, taxon).toFixed(2)}%`),
      hovertemplate: "%{text}<br>pH %{x:.2f}<br>WTD %{y:.2f}<extra></extra>",
      mode: "markers" as const,
      type: "scatter3d" as const,
      name: taxon,
      marker: { symbol: "circle-open", size: taxonRows.map((row) => ringSize(percentageFor(row, taxon))), color: taxonColor(taxon), opacity: 0.88, line: { width: 3 } },
    } : {
      x: taxonRows.map((row) => row.water_table_depth),
      y: taxonRows.map((row) => row.pH),
      text: taxonRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}<br>${taxon}: ${percentageFor(row, taxon).toFixed(2)}%`),
      hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra></extra>",
      mode: "markers" as const,
      type: "scatter" as const,
      name: taxon,
      marker: { symbol: "circle-open", size: taxonRows.map((row) => ringSize(percentageFor(row, taxon))), color: taxonColor(taxon), opacity: 0.88, line: { width: 2 } },
    };
  });
  const traces = [
    ...(showBackground ? [backgroundTrace] : []),
    ...(aggregation === "combined" ? [combinedTrace] : individualTraces),
  ];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "end", margin: "14px 0" }}>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <span>Selected taxa:</span>
          {displayedTaxa.map((taxon) => (
            <button key={taxon} type="button" onClick={() => displayedTaxa.length > 1 && setSelectedTaxa(displayedTaxa.filter((item) => item !== taxon))}>
              {taxon}{displayedTaxa.length > 1 ? " ×" : ""}
            </button>
          ))}
          <select value="" onChange={(event) => {
            const taxon = event.target.value;
            if (taxon && !displayedTaxa.includes(taxon)) setSelectedTaxa([...displayedTaxa, taxon]);
          }}>
            <option value="">+ Add taxon</option>
            {taxa.filter((taxon) => !displayedTaxa.includes(taxon)).map((taxon) => <option key={taxon}>{taxon}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <label>View <select value={dimensions} onChange={(event) => setDimensions(Number(event.target.value) as 2 | 3)}><option value={2}>2D pH–WTD</option><option value={3}>3D composition</option></select></label>
          <label>Display <select value={aggregation} onChange={(event) => setAggregation(event.target.value as typeof aggregation)}><option value="combined">Combined selection</option><option value="individual">Individual taxa</option></select></label>
          <label><input type="checkbox" checked={showBackground} onChange={(event) => setShowBackground(event.target.checked)} /> Filled background samples</label>
          <button type="button" onClick={() => setPlotRevision((value) => value + 1)}>Reset view</button>
        </div>
      </div>

      <p style={{ marginBottom: "10px" }}>
        {validRows.length.toLocaleString()} complete filtered samples are included; selected taxa have a combined mean composition of {combinedMean.toFixed(2)}%.
      </p>
      {loading ? (
        <div style={{ minHeight: "520px", display: "grid", placeItems: "center" }}>Loading finest-level taxon values for all filtered samples…</div>
      ) : (
        <Suspense fallback={<div style={{ minHeight: "520px", display: "grid", placeItems: "center" }}>Loading interactive plot…</div>}>
          <Plot
            data={traces}
            layout={{
              autosize: true,
              height: 560,
              margin: dimensions === 3 ? { l: 0, r: 0, t: 24, b: 0 } : { l: 62, r: 20, t: 20, b: 62 },
              legend: { orientation: "h" },
              paper_bgcolor: "transparent",
              plot_bgcolor: "transparent",
              ...(dimensions === 3 ? {
                scene: {
                  xaxis: { title: { text: "pH" } },
                  yaxis: { title: { text: "Water-table depth" } },
                  zaxis: { title: { text: aggregation === "combined" ? "Combined composition (%)" : "Cumulative selected composition (%)" }, rangemode: "tozero" },
                  camera: { eye: { x: 1.55, y: 1.45, z: 1.15 } },
                },
              } : {
                xaxis: { title: { text: "Water-table depth" } },
                yaxis: { title: { text: "pH" } },
              }),
            }}
            config={{ responsive: true, displaylogo: false }}
            style={{ width: "100%" }}
            revision={plotRevision}
          />
        </Suspense>
      )}
      <p style={{ opacity: 0.72 }}>
        Filled gray markers show every complete sample in the current filter. Ring area tracks the recorded composition percentage for each selected taxon; combined mode sums the selected taxa within each sample.
      </p>
    </div>
  );
}
