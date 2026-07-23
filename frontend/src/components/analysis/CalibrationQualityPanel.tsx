import { useEffect, useMemo, useState } from "react";

import { getCalibrationQuality, type CalibrationQuality } from "../../api/taxa";

type SampleRow = { sampleid?: number | null };

function percentage(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

export default function CalibrationQualityPanel({ rows }: { rows: SampleRow[] }) {
  const ids = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]))),
    [rows]
  );
  const requestKey = ids.join(",");
  const [result, setResult] = useState<{ key: string; data: CalibrationQuality | null }>({
    key: "",
    data: null,
  });
  const [errorKey, setErrorKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) return;
    getCalibrationQuality(ids)
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setErrorKey(requestKey);
      });
    return () => { cancelled = true; };
  }, [ids, requestKey]);

  const quality = result.key === requestKey ? result.data : null;
  if (!quality) return (
    <section style={{ textAlign: "left" }}>
      <h2>Data coverage</h2>
      <p>{errorKey === requestKey
        ? "Quality checks are unavailable. Confirm that the updated backend is running."
        : ids.length > 0 ? "Checking calibration coverage…" : "No samples are available for quality checks."}</p>
    </section>
  );

  const checks = [
    ["Taxa composition", quality.taxa_sample_count, quality.missing_taxa],
    ["pH", quality.sample_count - quality.missing_ph, quality.missing_ph],
    ["Water-table depth", quality.sample_count - quality.missing_water_table, quality.missing_water_table],
    ["Dataset DOI", quality.samples_with_doi ?? quality.sample_count - quality.missing_doi, quality.missing_doi],
  ] as const;
  const warnings = [
    quality.missing_taxa > 0 && `${quality.missing_taxa.toLocaleString()} samples have no usable taxa composition.`,
    quality.low_richness_samples > 0 && `${quality.low_richness_samples.toLocaleString()} samples contain fewer than five recorded taxa.`,
    quality.water_table_units.length > 1 && `Multiple water-table units are present: ${quality.water_table_units.join(", ")}.`,
  ].filter(Boolean) as string[];

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={{ textAlign: "left" }}>
          <h2>Data coverage</h2>
          <p>Coverage and comparability checks for the current filtered dataset.</p>
        </div>
        <span>{quality.sample_count.toLocaleString()} samples · {quality.site_count.toLocaleString()} sites · {(quality.dataset_count ?? 0).toLocaleString()} datasets · {(quality.unique_doi_count ?? quality.publication_count ?? 0).toLocaleString()} unique dataset DOIs</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "14px", marginTop: "18px" }}>
        {checks.map(([label, complete, missing]) => (
          <div key={label} style={{ textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
              <strong>{label}</strong>
              <span>{percentage(complete, quality.sample_count).toFixed(1)}%</span>
            </div>
            <div style={{ height: "8px", background: "var(--code-bg)", borderRadius: "4px", overflow: "hidden", margin: "7px 0" }}>
              <span style={{ display: "block", width: `${percentage(complete, quality.sample_count)}%`, height: "100%", background: "var(--accent)" }} />
            </div>
            <span>{missing.toLocaleString()} missing</span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: "18px", textAlign: "left" }}>
        Environmental coverage: pH {quality.ph_range.min?.toFixed(2) ?? "—"}–{quality.ph_range.max?.toFixed(2) ?? "—"}; water-table depth {quality.water_table_range.min?.toFixed(1) ?? "—"}–{quality.water_table_range.max?.toFixed(1) ?? "—"}. Median richness is {quality.median_taxon_richness?.toFixed(1) ?? "—"} recorded taxa per sample.
      </p>

      {warnings.length > 0 && (
        <ul style={{ textAlign: "left", marginBottom: 0 }}>
          {warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}
