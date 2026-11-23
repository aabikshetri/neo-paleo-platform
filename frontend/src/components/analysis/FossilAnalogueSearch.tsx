import FossilDepthResults from "./FossilDepthResults";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  compareFossilToModern,
  getTaxaBySamples,
  type AnalogueResult,
} from "../../api/taxa";

const categories = ["excellent", "very_good", "good", "possible", "poor"] as const;
const categoryLabels = ["Excellent", "Very good", "Good", "Possible", "Poor"];

type SampleRow = { sampleid?: number | null };
type AgeValue = { oldest: string; median: string; youngest: string };
type FossilSample = {
  key: string;
  sampleId: string;
  depth: string;
  ages: Record<string, AgeValue>;
  counts: Record<string, number>;
  percentages: Record<string, number>;
  total: number;
};
type FossilFile = { name: string; taxa: string[]; ageModels: string[]; samples: FossilSample[] };

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (field || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function parseAge(value: string): AgeValue {
  const [oldest = "—", median = "—", youngest = "—"] = value.split("/").map((item) => item.trim() || "—");
  return { oldest, median, youngest };
}

function parseFossilFile(name: string, text: string): FossilFile {
  const rows = parseCsv(text);
  const depthRow = rows.find((row) => row[0]?.trim().toLowerCase() === "depth");
  const sampleIdRow = rows.find((row) => row[0]?.trim().toLowerCase() === "sample id");
  const teamRows = rows.filter((row) => row[1]?.trim().toUpperCase() === "TEAM" && row[0]?.trim());
  if (!depthRow || !teamRows.length) {
    throw new Error("This file does not contain a Depth row and TEAM taxon rows in the expected Neotoma format.");
  }
  const header = rows[0] ?? [];
  const sampleStart = header.findIndex((value, index) => index >= 4 && /^S?\d+$/i.test(value.trim()));
  if (sampleStart < 0) throw new Error("No Neotoma sample columns were found.");
  const firstTeamIndex = rows.indexOf(teamRows[0]);
  const ageRows = rows.slice(rows.indexOf(depthRow) + 1, firstTeamIndex).filter(
    (row) => row[0]?.trim() && row.slice(sampleStart).some((value) => value.includes("/")),
  );
  const ageModels = ageRows.map((row) => row[0].trim());
  const taxa = teamRows.map((row) => row[0].trim());
  const samples: FossilSample[] = [];
  for (let column = sampleStart; column < Math.max(...rows.map((row) => row.length)); column += 1) {
    const depth = depthRow[column]?.trim() ?? "";
    const sampleId = sampleIdRow?.[column]?.trim() || header[column]?.replace(/^S/i, "") || String(column - sampleStart + 1);
    if (!depth && !sampleIdRow?.[column] && !teamRows.some((row) => row[column]?.trim())) continue;
    const counts: Record<string, number> = {};
    for (const taxonRow of teamRows) {
      const value = Number(taxonRow[column]);
      counts[taxonRow[0].trim()] = Number.isFinite(value) && value > 0 ? value : 0;
    }
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const percentages = Object.fromEntries(
      Object.entries(counts).map(([taxon, count]) => [taxon, total > 0 ? count * 100 / total : 0]),
    );
    samples.push({
      key: `${sampleId}-${column}`,
      sampleId,
      depth,
      counts,
      percentages,
      total,
      ages: Object.fromEntries(ageRows.map((row) => [row[0].trim(), parseAge(row[column] ?? "")])),
    });
  }
  return { name, taxa, ageModels, samples };
}

function normalizedTaxon(value: string) {
  return value.toLowerCase().replace(/[-–—]/g, " ").replace(/\btype\b/g, "").replace(/\s+/g, " ").trim();
}

function suggestedMapping(fossilTaxon: string, modernTaxa: string[]) {
  const exact = modernTaxa.find((taxon) => normalizedTaxon(taxon) === normalizedTaxon(fossilTaxon));
  if (exact) return exact;
  return "";
}

function ModernTaxaPicker({ taxon, taxa, selected, mappings, onChange }: {
  taxon: string; taxa: string[]; selected: string[]; mappings: Record<string, string[]>;
  onChange: (selected: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const visible = taxa.filter(name => name.toLowerCase().includes(query.toLowerCase()));
  return <details className="modern-taxa-picker">
    <summary>{selected.length ? selected.join(" + ") : "Not mapped"}</summary>
    <div className="modern-taxa-options">
      <input aria-label={`Search modern taxa for ${taxon}`} placeholder="Search modern taxa…" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="button" onClick={() => onChange([])}>Clear selection</button>
      <div className="modern-taxa-checkboxes">
        {visible.map(name => {
          const owner = Object.entries(mappings).find(([other, names]) => other !== taxon && names.includes(name))?.[0];
          return <label key={name}>
            <input type="checkbox" checked={selected.includes(name)} disabled={Boolean(owner)}
              onChange={event => onChange(event.target.checked ? [...selected, name] : selected.filter(item => item !== name))} />
            <span>{name}{owner && <small> — linked to {owner}</small>}</span>
          </label>;
        })}
        {!visible.length && <p>No matching modern taxa.</p>}
      </div>
    </div>
  </details>;
}

export default function FossilAnalogueSearch({ rows, selectionToken }: {
  rows: SampleRow[];
  selectionToken?: string | null;
}) {
  const ids = useMemo(() => rows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]), [rows]);
  const [fossil, setFossil] = useState<FossilFile | null>(null);
  const [selectedSample, setSelectedSample] = useState("");
  const [ageModel, setAgeModel] = useState("");
  const [showAbsentTaxa, setShowAbsentTaxa] = useState(false);
  const [modernTaxa, setModernTaxa] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [loadingTaxa, setLoadingTaxa] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [storedResult, setResult] = useState<AnalogueResult | null>(null);

  const [storedCoreResults, setCoreResults] = useState<Array<{ sample: FossilSample; result: AnalogueResult }>>([]);
  const context = JSON.stringify([ids, selectionToken, mappings, fossil?.name]);
  const [resultContext, setResultContext] = useState("");
  const comparisonController = useRef<AbortController | null>(null);
  useEffect(() => () => comparisonController.current?.abort(), [context]);
  const result = resultContext === context ? storedResult : null;
  const coreResults = resultContext === context ? storedCoreResults : [];

  const sample = fossil?.samples.find((item) => item.key === selectedSample) ?? fossil?.samples[0] ?? null;
  const mappedComposition = useMemo(() => {
    if (!sample || !fossil) return [];
    return fossil.taxa.filter(taxon => mappings[taxon]?.length).map(taxon => ({
      taxon, percentage: sample.percentages[taxon], modern_taxa: mappings[taxon],
    }));
  }, [fossil, mappings, sample]);
  const mappedTotal = mappedComposition.reduce((sum, item) => sum + item.percentage, 0);

  async function loadFile(file: File) {
    setError("");
    setResult(null);
    setCoreResults([]);
    try {
      const parsed = parseFossilFile(file.name, await file.text());
      setLoadingTaxa(true);
      const taxaRows = await getTaxaBySamples(ids, "taxon", 1000, selectionToken);
      const available: string[] = Array.from(new Set(
        (taxaRows as Array<{ lumped_taxon: string }>).map((row) => String(row.lumped_taxon))
          .filter((taxon: string) => taxon !== "Other"),
      )).sort();
      setModernTaxa(available);
      const used = new Set<string>();
      setMappings(Object.fromEntries(parsed.taxa.map(taxon => {
        const suggestion = suggestedMapping(taxon, available);
        const names = suggestion && !used.has(suggestion) ? [suggestion] : [];
        names.forEach(name => used.add(name));
        return [taxon, names];
      })));
      setFossil(parsed);
      setSelectedSample(parsed.samples[0]?.key ?? "");
      setAgeModel(parsed.ageModels[0] ?? "");
    } catch (uploadError) {
      setFossil(null);
      setError(uploadError instanceof Error ? uploadError.message : "The fossil file could not be read.");
    } finally {
      setLoadingTaxa(false);
    }
  }

  async function compare(wholeCore = false) {
    if (!sample || !fossil) return;
    const controller = new AbortController();
    comparisonController.current = controller;
    setResultContext(context);
    setComparing(true);
    setError("");
    setResult(null);
    setCoreResults([]);
    const completed: Array<{ sample: FossilSample; result: AnalogueResult }> = [];
    try {
      const samples = wholeCore ? [...fossil.samples].sort((a, b) => {
        const aDepth = a.depth.trim() ? Number(a.depth) : NaN;
        const bDepth = b.depth.trim() ? Number(b.depth) : NaN;
        return (Number.isFinite(aDepth) ? aDepth : Infinity) - (Number.isFinite(bDepth) ? bDepth : Infinity);
      }) : [sample];
      for (const coreSample of samples) {
        const composition = fossil.taxa.filter(taxon => mappings[taxon]?.length).map(taxon => ({
          taxon, percentage: coreSample.percentages[taxon], modern_taxa: mappings[taxon],
        }));
        const comparison = composition.some(item => item.percentage > 0)
          ? await compareFossilToModern(composition, ids, 10, selectionToken, controller.signal)
          : { error: "No mapped positive abundance", matches: [] };
        completed.push({ sample: coreSample, result: comparison });
      }
      if (wholeCore) setCoreResults(completed);
      else setResult(completed[0].result);
    } catch {
      if (!controller.signal.aborted) setError("The comparison could not be completed. Please run it again.");
    } finally {
      setComparing(false);
    }
  }

  const age = sample?.ages[ageModel];
  return (
    <section>
      <fieldset disabled={comparing} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <h2>Fossil-to-modern analogue comparison</h2>
      <p>Upload a Neotoma Explorer CSV, harmonize its TEAM taxa, and compare individual fossil samples or the entire core with the currently filtered modern dataset.</p>
      <label style={{ display: "block", marginTop: "16px" }}>
        <span style={{ display: "block", marginBottom: "5px", fontWeight: 600 }}>Neotoma fossil CSV</span>
        <input type="file" accept=".csv,text/csv" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void loadFile(file);
        }} />
      </label>
      {loadingTaxa && <p style={{ marginTop: "12px" }}>Reading fossil samples and loading modern taxa…</p>}
      {error && <p style={{ marginTop: "12px", color: "#dc2626" }}>{error}</p>}

      {fossil && sample && (
        <>
          <div className="fossil-summary">
            <span><strong>{fossil.samples.length}</strong> core samples</span>
            <span><strong>{fossil.taxa.length}</strong> TEAM taxa</span>
            <span><strong>{modernTaxa.length}</strong> modern taxa available</span>
          </div>
          <div className="fossil-controls">
            <label>Core sample
              <select value={sample.key} onChange={(event) => { setSelectedSample(event.target.value); setResult(null); }}>
                {fossil.samples.map((item) => <option key={item.key} value={item.key}>Depth {item.depth || "—"} cm · Sample {item.sampleId}</option>)}
              </select>
            </label>
            <label>Age-depth model
              <select value={ageModel} onChange={(event) => setAgeModel(event.target.value)}>
                {fossil.ageModels.map((model) => <option key={model}>{model}</option>)}
              </select>
            </label>
            <span className="fossil-age"><strong>Age:</strong> {age ? `${age.oldest} / ${age.median} / ${age.youngest}` : "—"}<small>oldest / median / youngest</small></span>
            <span><strong>TEAM count:</strong> {sample.total.toLocaleString()}</span>
          </div>

          <h3>Taxonomic harmonizer</h3>
          <p>Select one or more equivalent modern names for each fossil TEAM taxon. Selected modern abundances are summed into one group before comparison. Name matches are suggested initially; review and add variants such as species and species-type where appropriate. Each modern name can belong to only one fossil group.</p>
          <label style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
            <input type="checkbox" checked={showAbsentTaxa} onChange={event => setShowAbsentTaxa(event.target.checked)} />
            Show taxa with zero count in this sample
          </label>
          <p>{fossil.taxa.filter(taxon => sample.counts[taxon] > 0).length} of {fossil.taxa.length} core taxa present in this sample. Mappings are retained for every depth.</p>
          <div className="fossil-harmonizer">
            <table className="analysis-table">
              <thead><tr><th>Fossil TEAM taxon</th><th>Count</th><th>Percent</th><th>Linked modern taxa</th></tr></thead>
              <tbody>{fossil.taxa.filter(taxon => showAbsentTaxa || sample.counts[taxon] > 0).map((taxon) => (
                <tr key={taxon}>
                  <td>{taxon}</td>
                  <td>{sample.counts[taxon] || 0}</td>
                  <td>{sample.percentages[taxon].toFixed(2)}%</td>
                  <td><ModernTaxaPicker taxon={taxon} taxa={modernTaxa} selected={mappings[taxon] ?? []} mappings={mappings}
                    onChange={names => {
                      setMappings(current => ({ ...current, [taxon]: names }));
                      setResult(null);
                    }} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="fossil-compare-actions">
            <span>{Object.values(mappings).filter(names => names.length > 0).length} of {fossil.taxa.length} taxa mapped · {mappedTotal.toFixed(1)}% of this sample represented</span>
            <button type="button" disabled={comparing || mappedTotal === 0} onClick={() => void compare()}>
              {comparing ? "Comparing…" : "Compare with filtered modern samples"}
            </button>
          </div>

          <button type="button" disabled={comparing || !Object.values(mappings).some(names => names.length > 0)} onClick={() => void compare(true)}>
            {comparing ? "Comparing samples…" : "Compare entire core by depth"}
          </button>
          <p>Booth et al. (2025): Excellent &lt;0.30; Very good 0.30–&lt;0.38; Good 0.38–0.45; Possible &gt;0.45–0.54; Poor &gt;0.54. Counts include all eligible modern samples, not just the ten closest matches.</p>
          {coreResults.length > 0 && <div style={{ overflowX: "auto", marginTop: 18 }}>
            <h3>Modern analogue quality down-core — top 10</h3>
            <p>Ranked by the number of Excellent + Very good + Good modern matches, highest first. Ties use shallower depth first. Plots and CSV downloads include all core depths.</p>
            <table className="analysis-table"><thead><tr><th>Depth (cm)</th><th>Sample</th><th>Median age</th>{categoryLabels.map(label => <th key={label}>{label}</th>)}</tr></thead>
              <tbody>{[...coreResults].filter(row => !row.result.error && row.result.category_counts).sort((a, b) => {
                const count = (row: typeof a) => ["excellent", "very_good", "good"].reduce((sum, category) => sum + (row.result.category_counts?.[category] ?? 0), 0);
                return count(b) - count(a) || Number(a.sample.depth) - Number(b.sample.depth);
              }).slice(0, 10).map(({ sample: item, result: comparison }) => <tr key={item.key}>
                <td>{item.depth || "—"}</td><td>{item.sampleId}</td><td>{item.ages[ageModel]?.median ?? "—"}</td>
                {comparison.error ? <td colSpan={5}>{comparison.error}</td> : <>
                  {categories.map(category => <td key={category}>{comparison.category_counts?.[category] ?? "—"}</td>)}
                </>}
              </tr>)}</tbody>
            </table>
          </div>}
          {coreResults.length > 0 && <FossilDepthResults results={coreResults} samples={fossil.samples} taxa={fossil.taxa} ageModel={ageModel} fileName={fossil.name} />}
          {result?.error && <p style={{ marginTop: "14px" }}>{result.error}</p>}
          {result && !result.error && (
            <div style={{ marginTop: "18px" }}>
              <h3>Closest modern analogues</h3>
              {result.category_counts ? <p>{categories.flatMap((category, index) => {
                const count = result.category_counts?.[category] ?? 0;
                return count > 0 ? [`${categoryLabels[index]}: ${count.toLocaleString()}`] : [];
              }).join(" · ")}</p>
                : <p>Category counts are unavailable from the running backend. Restart the backend with the updated code and run the comparison again.</p>}
              <p>{result.method}. Compared with {result.candidate_count?.toLocaleString()} eligible modern samples.</p>
              <div style={{ overflowX: "auto", marginTop: "10px" }}><table className="analysis-table">
                <thead><tr><th>Rank</th><th>Modern site and sample</th><th>Dissimilarity</th><th>Class</th><th>Environment</th><th>Shared taxa</th></tr></thead>
                <tbody>{result.matches.map((match, index) => <tr key={match.sampleid}>
                  <td>{index + 1}</td>
                  <td>{match.sitename || "Unknown site"}<br /><small>Sample {match.sampleid}</small></td>
                  <td>{match.bray_curtis.toFixed(3)}</td><td>{match.analogue_class.replace("_", " ")}</td>
                  <td>pH {match.pH == null ? "—" : match.pH.toFixed(2)}<br />WTD {match.water_table_depth == null ? "—" : match.water_table_depth.toFixed(1)} {match.water_table_depth_units || ""}</td>
                  <td>{match.shared_taxa.join(", ") || "—"}</td>
                </tr>)}</tbody>
              </table></div>
              <p style={{ marginTop: "10px", opacity: 0.75 }}>Taxonomic mappings and analogue interpretations require expert review.</p>
            </div>
          )}
        </>
      )}
      </fieldset>
    </section>
  );
}
