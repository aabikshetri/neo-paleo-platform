import { lazy, Suspense, useState } from "react";
import type { AnalogueResult } from "../../api/taxa";

const Plot = lazy(() => import("../visualization/PlotlyChart"));
type CoreSample = {
  key: string; sampleId: string; depth: string;
  ages: Record<string, { oldest: string; median: string; youngest: string }>;
  counts: Record<string, number>; percentages: Record<string, number>; total: number;
};
type CoreResult = { sample: CoreSample; result: AnalogueResult };
const categories = ["excellent", "very_good", "good", "possible", "poor"];

function downloadCsv(name: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(value => {
    let cell = value == null ? "" : String(value);
    // Keep spreadsheet applications from interpreting uploaded text as formulas.
    if (typeof value === "string" && /^[=+@\-\t\r]/.test(cell) && !/^-?\d+(\.\d+)?$/.test(cell)) cell = `'${cell}`;
    return `"${cell.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function FossilDepthResults({ results, samples, taxa, ageModel, fileName }: {
  results: CoreResult[]; samples: CoreSample[]; taxa: string[]; ageModel: string; fileName: string;
}) {
  const [variable, setVariable] = useState<"water_table_depth" | "pH">("water_table_depth");
  const [matchLimit, setMatchLimit] = useState(1);
  const [unit, setUnit] = useState("cm");
  const [selectedCategories, setSelectedCategories] = useState(categories);
  const shownQuality = results.filter(({ sample, result }) => !result.error && result.category_counts
    && sample.depth.trim() !== "" && Number.isFinite(Number(sample.depth)))
    .sort((a, b) => Number(a.sample.depth) - Number(b.sample.depth));
  const baseName = fileName.replace(/\.csv$/i, "");
  const ranked = taxa.map(taxon => ({ taxon, count: samples.reduce((sum, sample) => sum + (sample.counts[taxon] ?? 0), 0) }))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count || a.taxon.localeCompare(b.taxon)).slice(0, 10);
  const total = samples.reduce((sum, sample) => sum + sample.total, 0);
  const points = results.flatMap(({ sample, result }) => result.error ? [] : result.matches.slice(0, matchLimit)
    .map((match, index) => ({ sample, match, rank: index + 1 })));
  const units = Array.from(new Set(points.filter(point => point.match.water_table_depth != null)
    .map(point => point.match.water_table_depth_units?.trim() || "Unspecified"))).sort();
  const selectedUnit = units.includes(unit) ? unit : units[0] ?? "Unspecified";
  const plotted = points.filter(({ sample, match }) => sample.depth.trim() !== "" && Number.isFinite(Number(sample.depth))
    && match[variable] != null && Number.isFinite(match[variable])
    && (variable === "pH" || (match.water_table_depth_units?.trim() || "Unspecified") === selectedUnit));
  const yLabel = variable === "pH" ? "Modern analogue measured pH" : `Modern analogue measured WTD (${selectedUnit})`;

  function exportMeasurements() {
    downloadCsv(`${baseName}-modern-analogue-measurements.csv`, [
      ["fossil_sample_id", "depth_cm", "age_model", "median_age", "modern_rank", "modern_sample_id", "modern_site", "bray_curtis", "class", "measured_modern_pH", "measured_modern_WTD", "WTD_units", "plotted"],
      ...points.map(point => [point.sample.sampleId, point.sample.depth, ageModel, point.sample.ages[ageModel]?.median,
        point.rank, point.match.sampleid, point.match.sitename, point.match.bray_curtis, point.match.analogue_class,
        point.match.pH, point.match.water_table_depth, point.match.water_table_depth_units, plotted.includes(point)]),
    ]);
  }
  return <div style={{ marginTop: 24 }}>
    <h3>Analogue category counts by depth</h3>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, margin: "12px 0" }}>
      {categories.map(category => <label key={category}><input type="checkbox" checked={selectedCategories.includes(category)}
        onChange={event => setSelectedCategories(current => event.target.checked ? [...current, category] : current.filter(value => value !== category))} /> {category.replace("_", " ")}</label>)}
    </div>
    <p>Counts are modern matches in each quality category, not taxon abundances. This plot includes all {shownQuality.length} core depths with category counts and numeric depths, independently of the top-10 table.</p>
    <button type="button" onClick={() => downloadCsv(`${baseName}-selected-category-counts.csv`, [
      ["depth_cm", "fossil_sample_id", "age_model", "median_age", ...selectedCategories],
      ...shownQuality.map(({ sample, result }) => [sample.depth, sample.sampleId, ageModel, sample.ages[ageModel]?.median, ...selectedCategories.map(category => result.category_counts?.[category])]),
    ])}>Download selected category counts CSV</button>
    {selectedCategories.length > 0 && shownQuality.length > 0 ? <Suspense fallback={<p>Loading category plot…</p>}><Plot
      data={selectedCategories.map(category => ({ type: "scatter" as const, mode: "markers" as const, name: category.replace("_", " "),
        x: shownQuality.map(({ sample }) => Number(sample.depth)), y: shownQuality.map(({ result }) => result.category_counts?.[category]),
        text: shownQuality.map(({ sample }) => `Fossil sample ${sample.sampleId}`),
        hovertemplate: "%{text}<br>Depth %{x} cm<br>Modern matches %{y}<extra>%{fullData.name}</extra>", marker: { size: 7 },
      }))}
      layout={{ autosize: true, height: 420, paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { color: "#94a3b8" },
        xaxis: { title: { text: "Fossil core depth (cm)" } }, yaxis: { title: { text: "Number of modern matches" }, rangemode: "tozero" },
        margin: { l: 80, r: 25, t: 25, b: 65 }, legend: { orientation: "h" } }}
      config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: "100%" }}
    /></Suspense> : <p>Select a category to plot. Results require category counts and numeric depths.</p>}

    <h3>Ten most abundant fossil taxa</h3>
    <p>Ranked by summed raw counts across all {samples.length} core samples. Percentages use the total core count.</p>
    <button type="button" onClick={() => downloadCsv(`${baseName}-top-10-taxa.csv`, [
      ["rank", "fossil_taxon", "total_count", "percent_of_core_count"],
      ...ranked.map((item, index) => [index + 1, item.taxon, item.count, total ? item.count * 100 / total : 0]),
    ])}>Download top 10 taxa CSV</button>
    <table className="analysis-table"><thead><tr><th>Rank</th><th>Fossil taxon</th><th>Total count</th><th>Percent</th></tr></thead>
      <tbody>{ranked.map((item, index) => <tr key={item.taxon}><td>{index + 1}</td><td>{item.taxon}</td><td>{item.count.toLocaleString()}</td><td>{(total ? item.count * 100 / total : 0).toFixed(2)}%</td></tr>)}</tbody>
    </table>
    {results.length > 0 && <>
      <h3>Modern analogue environments by fossil depth</h3>
      <p>Each point is a measured modern sample linked to a fossil depth. These values are not fossil WTD or pH predictions. All compared core depths are included, independently of the top 10 taxa list. Analogue ranks use lowest Bray–Curtis dissimilarity, including Poor matches.</p>
      <div className="fossil-controls">
        <label>Y axis<select value={variable} onChange={event => setVariable(event.target.value as typeof variable)}><option value="water_table_depth">Measured modern WTD</option><option value="pH">Measured modern pH</option></select></label>
        <label>Modern matches per depth<select value={matchLimit} onChange={event => setMatchLimit(Number(event.target.value))}><option value={1}>Closest match</option><option value={5}>Closest 5 matches</option><option value={10}>Closest 10 matches</option></select></label>
        {variable === "water_table_depth" && <label>WTD units<select value={selectedUnit} onChange={event => setUnit(event.target.value)}>{units.map(value => <option key={value}>{value}</option>)}</select></label>}
      </div>
      <p>{plotted.length.toLocaleString()} measurements plotted across {new Set(plotted.map(point => point.sample.key)).size} of {results.length} depths. Missing measurements or depths are omitted; WTD units are plotted separately.</p>
      <button type="button" onClick={exportMeasurements}>Download analogue measurements CSV</button>
      <button type="button" style={{ marginLeft: 8 }} onClick={() => downloadCsv(`${baseName}-analogue-quality-by-depth.csv`, [
        ["depth_cm", "fossil_sample_id", "age_model", "median_age", ...categories, "error"],
        ...results.map(({ sample, result }) => [sample.depth, sample.sampleId, ageModel, sample.ages[ageModel]?.median, ...categories.map(category => result.category_counts?.[category]), result.error]),
      ])}>Download depth results CSV</button>
      {plotted.length ? <Suspense fallback={<p>Loading depth plot…</p>}><Plot
        data={categories.flatMap(category => {
          const group = plotted.filter(point => point.match.analogue_class === category);
          if (!group.length) return [];
          return [{ type: "scatter" as const, mode: "markers" as const, name: category.replace("_", " "),
            x: group.map(point => Number(point.sample.depth)), y: group.map(point => point.match[variable]),
            text: group.map(point => `Fossil ${point.sample.sampleId} · Modern ${point.match.sampleid} · Rank ${point.rank} · Bray–Curtis ${point.match.bray_curtis.toFixed(3)}`),
            hovertemplate: "%{text}<br>Depth %{x} cm<br>Measured value %{y}<extra>%{fullData.name}</extra>", marker: { size: 8, opacity: .7 },
          }];
        })}
        layout={{ autosize: true, height: 440, paper_bgcolor: "transparent", plot_bgcolor: "transparent", font: { color: "#94a3b8" },
          xaxis: { title: { text: "Fossil core depth (cm)" } }, yaxis: { title: { text: yLabel } }, margin: { l: 85, r: 25, t: 25, b: 65 }, legend: { orientation: "h" } }}
        config={{ responsive: true, displaylogo: false }} useResizeHandler style={{ width: "100%" }}
      /></Suspense> : <p>No measurements available for the selected variable and units.</p>}
    </>}
  </div>;
}
