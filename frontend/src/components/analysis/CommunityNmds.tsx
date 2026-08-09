import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { runNmds, type NmdsPoint, type NmdsResult } from "../../api/taxa";
import { taxonColor } from "../visualization/taxaColors";

const Plot = lazy(() => import("../visualization/PlotlyChart"));

type SampleRow = { sampleid?: number | null; sitename?: string | null };

function stressInterpretation(stress?: number) {
  if (stress == null) return "Stress unavailable";
  if (stress < 0.1) return "strong representation";
  if (stress < 0.2) return "usable with caution";
  if (stress < 0.3) return "weak representation";
  return "unreliable representation";
}

function categoryGroups(points: NmdsPoint[], field: "sitename" | "dominant_taxon") {
  const counts = new Map<string, number>();
  points.forEach((point) => {
    const value = point[field] || "Unknown";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  const retained = new Set(
    Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([value]) => value)
  );
  const groups = new Map<string, NmdsPoint[]>();
  points.forEach((point) => {
    const raw = point[field] || "Unknown";
    const value = retained.has(raw) ? raw : field === "sitename" ? "Other sites" : "Other taxa";
    groups.set(value, [...(groups.get(value) ?? []), point]);
  });
  return groups;
}

export default function CommunityNmds({
  rows,
  onSnapshotChange,
  selectionToken,
}: {
  rows: SampleRow[];
  onSnapshotChange?: (snapshot: Record<string, unknown> | null) => void;
  selectionToken?: string | null;
}) {
  const ids = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]))),
    [rows]
  );
  const [maxSamples, setMaxSamples] = useState(500);
  const [prevalencePercent, setPrevalencePercent] = useState(2);
  const [dimensions, setDimensions] = useState(2);
  const [nInit, setNInit] = useState(10);
  const [targetSampleid, setTargetSampleid] = useState<number | null>(null);
  const [runSensitivity, setRunSensitivity] = useState(true);
  const [colorBy, setColorBy] = useState<"pH" | "water_table_depth" | "dominant_taxon" | "sitename">("pH");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NmdsResult | null>(null);
  const [resultKey, setResultKey] = useState("");
  const [plotRevision, setPlotRevision] = useState(0);
  const currentAnalysisKey = JSON.stringify({
    ids,
    maxSamples,
    prevalencePercent,
    dimensions,
    nInit,
    targetSampleid,
    runSensitivity,
  });

  async function calculate() {
    setLoading(true);
    try {
      const data = await runNmds(ids, {
        maxSamples,
        prevalence: prevalencePercent / 100,
        randomSeed: 42,
        nInit,
        dimensions,
        targetSampleid,
        runSensitivity,
      }, selectionToken);
      setResult(data);
      setResultKey(currentAnalysisKey);
    } catch (error) {
      console.error(error);
      setResult({ error: "NMDS could not be completed. Confirm that the updated backend is running.", points: [] });
    } finally {
      setLoading(false);
    }
  }

  function downloadCoordinates() {
    if (!result?.points.length) return;
    const header = "sampleid,sitename,nmds1,nmds2,nmds3,pH,water_table_depth,dominant_taxon,highlight";
    const rows = result.points.map((point) => [
      point.sampleid,
      JSON.stringify(point.sitename ?? ""),
      point.nmds1,
      point.nmds2,
      point.nmds3 ?? "",
      point.pH ?? "",
      point.water_table_depth ?? "",
      JSON.stringify(point.dominant_taxon),
      point.highlight ?? "",
    ].join(","));
    const url = URL.createObjectURL(new Blob([[header, ...rows].join("\n")], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "nmds-coordinates.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const continuous = colorBy === "pH" || colorBy === "water_table_depth";
  const coordinates = (points: NmdsPoint[]) => ({
    x: points.map((point) => point.nmds1),
    y: points.map((point) => point.nmds2),
    ...(result?.dimensions === 3 ? { z: points.map((point) => point.nmds3) } : {}),
    text: points.map((point) => `${point.sitename || "Unknown site"}<br>Sample ${point.sampleid}<br>pH ${point.pH?.toFixed(2) ?? "—"}<br>WTD ${point.water_table_depth?.toFixed(1) ?? "—"}`),
  });
  const baseTraces = result?.points.length ? continuous ? [{
    ...coordinates(result.points),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers" as const,
    type: result.dimensions === 3 ? "scatter3d" as const : "scatter" as const,
    name: colorBy === "pH" ? "pH" : "Water-table depth",
    marker: {
      size: result.dimensions === 3 ? 6 : 8,
      opacity: 0.72,
      symbol: "circle-open",
      color: result.points.map((point) => point[colorBy] ?? null),
      colorscale: "Viridis",
      showscale: true,
      colorbar: { title: { text: colorBy === "pH" ? "pH" : "WTD" } },
    },
  }] : Array.from(categoryGroups(result.points, colorBy).entries()).map(([group, points]) => ({
    ...coordinates(points),
    hovertemplate: "%{text}<extra></extra>",
    mode: "markers" as const,
    type: result.dimensions === 3 ? "scatter3d" as const : "scatter" as const,
    name: group,
    marker: {
      symbol: "circle-open",
      size: result.dimensions === 3 ? 6 : 9,
      opacity: 0.8,
      color: taxonColor(group),
      line: { color: taxonColor(group), width: 2 },
    },
  })) : [];
  const highlightTraces = result?.points.length ? ([
    ["target", "Target sample", "diamond", "#ef4444"],
    ["analogue", "Nearest assemblages", "circle-open", "#f59e0b"],
  ] as const).flatMap(([role, name, symbol, color]) => {
    const points = result.points.filter((point) => point.highlight === role);
    return points.length ? [{
      ...coordinates(points),
      hovertemplate: `%{text}<extra>${name}</extra>`,
      mode: "markers" as const,
      type: result.dimensions === 3 ? "scatter3d" as const : "scatter" as const,
      name,
      marker: {
        size: result.dimensions === 3
          ? role === "target" ? 10 : 8
          : role === "target" ? 14 : 11,
        symbol,
        color,
        line: { width: 2 },
      },
    }] : [];
  }) : [];
  const traces = [...baseTraces, ...highlightTraces];
  const shepardLine = (result?.shepard?.bray_curtis ?? [])
    .map((value, index) => ({
      x: value,
      y: result?.shepard?.monotonic_disparity[index] ?? 0,
    }))
    .sort((a, b) => a.x - b.x);
  const initializationDisparities = result?.sensitivity?.initializations.map(
    (run) => run.procrustes_disparity
  ) ?? [];
  const maximumInitializationDisparity = initializationDisparities.length
    ? Math.max(...initializationDisparities)
    : null;

  useEffect(() => {
    if (!result || result.error || !result.points.length || resultKey !== currentAnalysisKey) {
      onSnapshotChange?.(null);
      return;
    }
    onSnapshotChange?.({
      settings: {
        max_samples: maxSamples,
        prevalence: prevalencePercent / 100,
        random_seed: 42,
        n_init: nInit,
        dimensions,
        target_sampleid: targetSampleid,
        run_sensitivity: runSensitivity,
      },
      result: {
        method: result.method,
        stress: result.stress,
        stress_kind: result.stress_kind,
        stress_by_dimension: result.stress_by_dimension,
        sample_count: result.sample_count,
        available_sample_count: result.available_sample_count,
        taxon_count: result.taxon_count,
        removed_taxon_count: result.removed_taxon_count,
        converged: result.converged,
        iterations: result.iterations,
        sampling_method: result.sampling_method,
        renormalized_after_filtering: result.renormalized_after_filtering,
        sensitivity: result.sensitivity,
      },
    });
  }, [currentAnalysisKey, dimensions, maxSamples, nInit, onSnapshotChange, prevalencePercent, result, resultKey, runSensitivity, targetSampleid]);

  return (
    <section>
      <div style={{ textAlign: "left" }}>
        <h2>Community NMDS</h2>
        <p>Ordination of filtered samples using Bray–Curtis dissimilarity on normalized finest-level Neotoma taxon composition.</p>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "end", marginTop: "16px" }}>
        <label style={{ textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Maximum samples</span>
          <select value={maxSamples} onChange={(event) => setMaxSamples(Number(event.target.value))}>
            {[250, 500, 750, 1000].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label style={{ textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Minimum prevalence (%)</span>
          <input type="number" min="0" max="100" step="1" value={prevalencePercent} onChange={(event) => setPrevalencePercent(Number(event.target.value))} />
        </label>
        <label style={{ textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Dimensions</span>
          <select value={dimensions} onChange={(event) => setDimensions(Number(event.target.value))}>
            <option value={2}>2D</option>
            <option value={3}>3D</option>
          </select>
        </label>
        <label style={{ textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Initial configurations</span>
          <select value={nInit} onChange={(event) => setNInit(Number(event.target.value))}>
            {[4, 10, 20].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label style={{ textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Color points by</span>
          <select value={colorBy} onChange={(event) => setColorBy(event.target.value as typeof colorBy)}>
            <option value="pH">pH</option>
            <option value="water_table_depth">Water-table depth</option>
            <option value="dominant_taxon">Dominant taxon</option>
            <option value="sitename">Site</option>
          </select>
        </label>
        <label style={{ flex: "1 1 280px", textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Highlight target and nearest assemblages</span>
          <select value={targetSampleid ?? ""} onChange={(event) => setTargetSampleid(event.target.value ? Number(event.target.value) : null)} style={{ width: "100%" }}>
            <option value="">No target</option>
            {rows.filter((row) => row.sampleid != null).map((row) => (
              <option key={row.sampleid} value={row.sampleid ?? ""}>{row.sitename || "Unknown site"} — sample {row.sampleid}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={runSensitivity} onChange={(event) => setRunSensitivity(event.target.checked)} />
          Run sensitivity diagnostics
        </label>
        <button type="button" onClick={calculate} disabled={loading || ids.length < 3}>
          {loading ? "Running NMDS…" : "Run NMDS"}
        </button>
        {result?.dimensions === 3 ? (
          <button type="button" onClick={() => setPlotRevision((value) => value + 1)}>
            Reset 3D view
          </button>
        ) : null}
        {result?.points.length ? <button type="button" onClick={downloadCoordinates}>Download coordinates</button> : null}
      </div>

      {result?.error && <p style={{ marginTop: "18px" }}>{result.error}</p>}
      {result?.points.length ? (
        <>
          <p style={{ textAlign: "left", marginTop: "18px" }}>
            {result.dimensions}D stress {result.stress?.toFixed(3)} ({stressInterpretation(result.stress)}); {result.sample_count?.toLocaleString()} samples and {result.taxon_count?.toLocaleString()} taxa ({result.removed_taxon_count?.toLocaleString()} removed by prevalence filtering and retained compositions renormalized to 100%); {result.converged ? `converged in ${result.iterations} iterations` : `iteration limit reached (${result.iterations})`}. {result.sampled ? `${result.sample_count?.toLocaleString()} of ${result.available_sample_count?.toLocaleString()} eligible samples were selected using ${result.sampling_method}.` : "All eligible samples were included."}
          </p>
          <Suspense fallback={<div style={{ minHeight: "500px", display: "grid", placeItems: "center" }}>Loading ordination plot…</div>}>
            <Plot
              data={traces}
              layout={{
                autosize: true,
                height: result.dimensions === 3 ? 650 : 520,
                margin: result.dimensions === 3
                  ? { l: 0, r: 18, t: 10, b: 38 }
                  : { l: 62, r: 30, t: 24, b: 62 },
                ...(result.dimensions === 3 ? {
                  scene: {
                    domain: { x: [0, 0.9], y: [0.08, 1] },
                    aspectmode: "cube",
                    camera: { eye: { x: 1.35, y: 1.35, z: 1.05 } },
                    xaxis: { title: { text: "NMDS1" }, showgrid: true, showbackground: false },
                    yaxis: { title: { text: "NMDS2" }, showgrid: true, showbackground: false },
                    zaxis: { title: { text: "NMDS3" }, showgrid: true, showbackground: false },
                  },
                } : {
                  xaxis: { title: { text: "NMDS1" }, zeroline: false, gridcolor: "rgba(148,163,184,0.18)" },
                  yaxis: { title: { text: "NMDS2" }, zeroline: false, gridcolor: "rgba(148,163,184,0.18)" },
                }),
                legend: result.dimensions === 3
                  ? { orientation: "h", x: 0, y: 0.01 }
                  : { orientation: "h", y: -0.2 },
                paper_bgcolor: "transparent",
                plot_bgcolor: "transparent",
              }}
              config={{ responsive: true, displaylogo: false, toImageButtonOptions: { format: "svg", filename: "community-nmds" } }}
              style={{ width: "100%" }}
              revision={plotRevision}
            />
          </Suspense>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "20px", marginTop: "18px" }}>
            <div style={{ textAlign: "left" }}>
              <h3>Stress by dimensionality</h3>
              {[2, 3].map((dimension) => {
                const value = result.stress_by_dimension?.[String(dimension)];
                return (
                  <div key={dimension} style={{ marginTop: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}><span>{dimension}D</span><span>{value?.toFixed(3) ?? "—"}</span></div>
                    <div style={{ height: "9px", background: "var(--code-bg)", marginTop: "5px", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${Math.min(100, (value ?? 0) * 300)}%`, background: "var(--accent)" }} />
                    </div>
                  </div>
                );
              })}
              <p style={{ marginTop: "12px", opacity: 0.75 }}>Lower stress is better. Prefer the simpler 2D solution unless 3D produces a meaningful improvement.</p>
            </div>
            <div style={{ textAlign: "left" }}>
              <h3>Shepard diagnostic</h3>
              <Suspense fallback={<p>Loading diagnostic…</p>}>
                <Plot
                  data={[
                    {
                      x: result.shepard?.bray_curtis ?? [],
                      y: result.shepard?.ordination_distance ?? [],
                      mode: "markers",
                      type: "scatter",
                      name: "Ordination distances",
                      marker: { size: 5, opacity: 0.24, color: "#8b5cf6" },
                      hovertemplate: "Bray–Curtis %{x:.3f}<br>Ordination distance %{y:.3f}<extra></extra>",
                    },
                    {
                      x: shepardLine.map((point) => point.x),
                      y: shepardLine.map((point) => point.y),
                      mode: "lines",
                      type: "scatter",
                      name: "Monotonic fit",
                      line: { color: "#f59e0b", width: 3 },
                      hovertemplate: "Bray–Curtis %{x:.3f}<br>Fitted disparity %{y:.3f}<extra></extra>",
                    },
                  ]}
                  layout={{
                    autosize: true,
                    height: 310,
                    margin: { l: 55, r: 15, t: 12, b: 52 },
                    xaxis: { title: { text: "Bray–Curtis dissimilarity" }, gridcolor: "rgba(148,163,184,0.18)" },
                    yaxis: { title: { text: "Ordination distance" }, gridcolor: "rgba(148,163,184,0.18)" },
                    paper_bgcolor: "transparent",
                    plot_bgcolor: "transparent",
                    legend: { orientation: "h", y: -0.28 },
                  }}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: "100%" }}
                />
              </Suspense>
            </div>
          </div>
          {result.sensitivity && (
            <div style={{ marginTop: "22px", textAlign: "left" }}>
              <h3>Sensitivity diagnostics</h3>
              <p>
                Initialization stability: maximum Procrustes disparity {maximumInitializationDisparity?.toFixed(4) ?? "—"} ({maximumInitializationDisparity == null
                  ? "not evaluated"
                  : maximumInitializationDisparity < 0.01 ? "stable"
                    : maximumInitializationDisparity < 0.05 ? "moderately stable"
                      : "sensitive to initialization"}). Lower values indicate more similar solutions after rotation, translation, and scaling.
              </p>
              <div style={{ overflowX: "auto", marginTop: "12px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr><th>Prevalence threshold</th><th>Retained taxa</th><th>Samples compared</th><th>Bray–Curtis rank correlation</th></tr>
                  </thead>
                  <tbody>
                    {result.sensitivity.prevalence.map((test) => (
                      <tr key={test.prevalence}>
                        <td>{(test.prevalence * 100).toFixed(1)}%</td>
                        <td>{test.taxon_count}</td>
                        <td>{test.sample_count}</td>
                        <td>{test.distance_spearman?.toFixed(3) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ marginTop: "10px", opacity: 0.75 }}>
                Rank correlations near 1 indicate that sample relationships are robust to the tested prevalence threshold. Sensitivity runs use the same samples and post-filter renormalization.
              </p>
            </div>
          )}
          <p style={{ textAlign: "left", opacity: 0.75 }}>
            NMDS uses a fixed random seed of 42 and {result.n_init} initial configurations. Highlighted nearest assemblages are based on Bray–Curtis distance within this ordination subset. Stress thresholds are diagnostic; inspect gradients and sensitivity before interpreting distances literally.
          </p>
        </>
      ) : null}
    </section>
  );
}
