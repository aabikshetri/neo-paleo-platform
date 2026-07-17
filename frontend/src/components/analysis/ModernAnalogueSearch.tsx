import { useEffect, useMemo, useState } from "react";

import { findModernAnalogues, type AnalogueResult } from "../../api/taxa";
import { taxonColor } from "../visualization/taxaColors";

type SampleRow = {
  sampleid?: number | null;
  sitename?: string | null;
  pH?: number | null;
  water_table_depth?: number | null;
};

function formatNumber(value?: number | null, digits = 2) {
  return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
}

export default function ModernAnalogueSearch({
  rows,
  onSnapshotChange,
}: {
  rows: SampleRow[];
  onSnapshotChange?: (snapshot: Record<string, unknown> | null) => void;
}) {
  const samples = useMemo(
    () => rows.filter((row) => row.sampleid != null),
    [rows]
  );
  const ids = useMemo(
    () => Array.from(new Set(samples.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]))),
    [samples]
  );
  const [chosenTarget, setChosenTarget] = useState<number | null>(null);
  const [excludeSameSite, setExcludeSameSite] = useState(true);
  const [excludeSameDoi, setExcludeSameDoi] = useState(true);
  const target = chosenTarget != null && ids.includes(chosenTarget) ? chosenTarget : ids[0] ?? null;
  const currentKey = `${target}|${excludeSameSite}|${excludeSameDoi}|${ids.join(",")}`;
  const [result, setResult] = useState<{ key: string; data: AnalogueResult | null }>({ key: "", data: null });
  const [loading, setLoading] = useState(false);

  async function runSearch() {
    if (target == null) return;
    setLoading(true);
    try {
      const data = await findModernAnalogues(target, ids, 10, excludeSameSite, excludeSameDoi);
      setResult({ key: currentKey, data });
    } catch (error) {
      console.error(error);
      setResult({ key: currentKey, data: { error: "The analogue search could not be completed.", matches: [] } });
    } finally {
      setLoading(false);
    }
  }

  const activeResult = result.key === currentKey ? result.data : null;

  useEffect(() => {
    if (!activeResult || activeResult.error) {
      onSnapshotChange?.(null);
      return;
    }
    onSnapshotChange?.({
      settings: {
        target_sampleid: target,
        limit: 10,
        exclude_same_site: excludeSameSite,
        exclude_same_doi: excludeSameDoi,
      },
      result: {
        method: activeResult.method,
        candidate_count: activeResult.candidate_count,
        excluded_candidate_count: activeResult.excluded_candidate_count,
        matches: activeResult.matches.map((match) => ({
          sampleid: match.sampleid,
          datasetid: match.datasetid,
          doi: match.doi,
          bray_curtis: match.bray_curtis,
          analogue_class: match.analogue_class,
        })),
      },
    });
  }, [activeResult, excludeSameDoi, excludeSameSite, onSnapshotChange, target]);
  const bestMatch = activeResult?.matches[0];
  const targetComposition = activeResult?.target_composition ?? [];
  const comparisonGenera = Array.from(new Set([
    ...targetComposition.map((item) => item.lumped_taxon),
    ...(bestMatch?.composition ?? []).map((item) => item.lumped_taxon),
  ])).sort((a, b) => {
    const maximum = (taxon: string) => Math.max(
      targetComposition.find((item) => item.lumped_taxon === taxon)?.percentage ?? 0,
      bestMatch?.composition.find((item) => item.lumped_taxon === taxon)?.percentage ?? 0,
    );
    return maximum(b) - maximum(a);
  }).slice(0, 8);
  const compositionValue = (
    composition: Array<{ lumped_taxon: string; percentage: number }>,
    taxon: string
  ) => composition.find((item) => item.lumped_taxon === taxon)?.percentage ?? 0;

  return (
    <section>
      <div style={{ textAlign: "left" }}>
        <h2>Modern analogue search</h2>
        <p>Find modern samples with assemblages most similar to a target sample within the current filters.</p>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "end", marginTop: "16px" }}>
        <label style={{ flex: "1 1 360px", textAlign: "left" }}>
          <span style={{ display: "block", marginBottom: "4px" }}>Target sample</span>
          <select
            value={target ?? ""}
            onChange={(event) => setChosenTarget(Number(event.target.value))}
            style={{ width: "100%" }}
          >
            {samples.map((sample) => (
              <option key={sample.sampleid} value={sample.sampleid ?? ""}>
                {sample.sitename || "Unknown site"} — sample {sample.sampleid} · pH {formatNumber(sample.pH)} · WTD {formatNumber(sample.water_table_depth, 1)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={excludeSameSite} onChange={(event) => setExcludeSameSite(event.target.checked)} />
          Exclude same site
        </label>
        <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
          <input type="checkbox" checked={excludeSameDoi} onChange={(event) => setExcludeSameDoi(event.target.checked)} />
          Exclude same DOI
        </label>
        <button type="button" onClick={runSearch} disabled={loading || target == null}>
          {loading ? "Comparing…" : "Find analogues"}
        </button>
      </div>

      {activeResult?.error && <p style={{ marginTop: "16px" }}>{activeResult.error}</p>}
      {activeResult && !activeResult.error && (
        <>
          <p style={{ textAlign: "left", marginTop: "16px" }}>
            Compared against {activeResult.candidate_count?.toLocaleString()} eligible samples using Bray–Curtis dissimilarity; {activeResult.excluded_candidate_count?.toLocaleString()} candidates were excluded by the selected independence rules.
          </p>
          {bestMatch && (
            <div style={{ textAlign: "left", marginTop: "16px" }}>
              <h3 style={{ marginBottom: "4px" }}>Best analogue: {bestMatch.sitename || "Unknown site"}, sample {bestMatch.sampleid}</h3>
              <p>
                Dissimilarity {bestMatch.bray_curtis.toFixed(3)} ({bestMatch.analogue_class}). {bestMatch.analogue_class === "close"
                  ? "A close analogue is present in the filtered calibration set."
                  : bestMatch.analogue_class === "possible"
                    ? "A possible analogue is present, but no close analogue was found."
                    : "No close or possible modern analogue was found in the filtered calibration set."}
              </p>
              <div style={{ display: "grid", gap: "8px", marginTop: "14px" }}>
                {comparisonGenera.map((taxon) => {
                  const targetValue = compositionValue(targetComposition, taxon);
                  const analogueValue = compositionValue(bestMatch.composition, taxon);
                  return (
                    <div key={taxon} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 3fr", gap: "10px", alignItems: "center" }}>
                      <span>{taxon}</span>
                      <div>
                        <div title={`Target: ${targetValue.toFixed(2)}%`} style={{ height: "8px", width: `${targetValue}%`, minWidth: targetValue > 0 ? "2px" : 0, background: taxonColor(taxon), marginBottom: "3px" }} />
                        <div title={`Best analogue: ${analogueValue.toFixed(2)}%`} style={{ height: "8px", width: `${analogueValue}%`, minWidth: analogueValue > 0 ? "2px" : 0, background: taxonColor(taxon), opacity: 0.45 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p style={{ marginTop: "8px", opacity: 0.75 }}>Solid bars: target · muted bars: best analogue</p>
            </div>
          )}
          <div style={{ overflowX: "auto", marginTop: "12px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr>
                  <th>Rank</th><th>Site and sample</th><th>Dissimilarity</th><th>Class</th><th>Environment</th><th>Shared genera</th>
                </tr>
              </thead>
              <tbody>
                {activeResult.matches.map((match, index) => (
                  <tr key={match.sampleid}>
                    <td>{index + 1}</td>
                    <td>{match.sitename || "Unknown site"}<br /><span>Sample {match.sampleid}</span></td>
                    <td>{match.bray_curtis.toFixed(3)}</td>
                    <td>{match.analogue_class}</td>
                    <td>pH {formatNumber(match.pH)}<br />WTD {formatNumber(match.water_table_depth, 1)} {match.water_table_depth_units || ""}</td>
                    <td>{match.shared_genera.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ textAlign: "left", marginTop: "12px", opacity: 0.75 }}>
            Diagnostic classes: close ≤ 0.20, possible 0.21–0.40, poor &gt; 0.40. These thresholds are screening aids and should be validated for the calibration dataset.
          </p>
        </>
      )}
    </section>
  );
}
