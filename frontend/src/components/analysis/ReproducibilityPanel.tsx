type ReproducibilityPanelProps = {
  filters: Record<string, string>;
  rows: Array<Record<string, unknown>>;
  analogueSnapshot: Record<string, unknown> | null;
  nmdsSnapshot: Record<string, unknown> | null;
};

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function ReproducibilityPanel({
  filters,
  rows,
  analogueSnapshot,
  nmdsSnapshot,
}: ReproducibilityPanelProps) {
  const sampleids = Array.from(new Set(rows.flatMap((row) => {
    const value = row.sampleid;
    return typeof value === "number" ? [value] : [];
  }))).sort((a, b) => a - b);
  const dois = Array.from(new Set(rows.flatMap((row) => {
    const value = row.doi ?? row.dataset_doi ?? row.publication_doi;
    return typeof value === "string"
      ? value.split(";").map((doi) => doi.trim()).filter(Boolean)
      : [];
  }))).sort();

  const manifest = {
    schema_version: "1.0",
    exported_at_utc: new Date().toISOString(),
    platform: "Paleoecology Analytics Platform",
    data_source: "Neotoma Paleoecology Database",
    selection: {
      filters,
      sample_count: sampleids.length,
      sampleids,
      dataset_dois: dois,
    },
    preprocessing: {
      taxonomic_level: "genus",
      composition: "normalized to 100% within each sample",
      dissimilarity: "Bray-Curtis",
      nmds_post_filter_normalization: "retained genera renormalized to 100%",
    },
    modern_analogue: analogueSnapshot,
    nmds: nmdsSnapshot,
  };

  function downloadManifest() {
    downloadText(
      "paleoecology-analysis-manifest.json",
      JSON.stringify(manifest, null, 2),
      "application/json"
    );
  }

  function downloadPythonScript() {
    const script = `"""Re-run the recorded platform analyses through its FastAPI backend."""
import json
import os
from pathlib import Path

import requests

API_URL = os.getenv("PALEO_API_URL", "http://127.0.0.1:8000").rstrip("/")
MANIFEST = Path(__file__).with_name("paleoecology-analysis-manifest.json")
manifest = json.loads(MANIFEST.read_text())
sampleids = manifest["selection"]["sampleids"]
output = {}

analogue = manifest.get("modern_analogue")
if analogue and analogue.get("settings", {}).get("target_sampleid") is not None:
    settings = analogue["settings"]
    response = requests.post(f"{API_URL}/calibration/modern-analogues", json={
        "target_sampleid": settings["target_sampleid"],
        "calibration_sampleids": sampleids,
        "limit": settings["limit"],
        "exclude_same_site": settings["exclude_same_site"],
        "exclude_same_doi": settings["exclude_same_doi"],
    })
    response.raise_for_status()
    output["modern_analogue"] = response.json()

nmds = manifest.get("nmds")
if nmds:
    settings = nmds["settings"]
    response = requests.post(f"{API_URL}/calibration/nmds", json={
        "sampleids": sampleids,
        "max_samples": settings["max_samples"],
        "prevalence": settings["prevalence"],
        "random_seed": settings["random_seed"],
        "n_init": settings["n_init"],
        "dimensions": settings["dimensions"],
        "target_sampleid": settings["target_sampleid"],
        "run_sensitivity": settings["run_sensitivity"],
    })
    response.raise_for_status()
    output["nmds"] = response.json()

Path("reproduced-analysis-results.json").write_text(json.dumps(output, indent=2))
print("Wrote reproduced-analysis-results.json")
`;
    downloadText("reproduce-analysis.py", script, "text/x-python");
  }

  return (
    <section style={{ textAlign: "left" }}>
      <h2>Reproducible analysis export</h2>
      <p>
        Save the current calibration selection, method settings, diagnostics, and result summaries.
      </p>
      <p style={{ marginTop: "12px" }}>
        {sampleids.length.toLocaleString()} sample IDs · {dois.length.toLocaleString()} DOI values · {analogueSnapshot ? "analogue recorded" : "run analogue search to record it"} · {nmdsSnapshot ? "NMDS recorded" : "run NMDS to record it"}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "16px" }}>
        <button type="button" onClick={downloadManifest}>Download analysis manifest</button>
        <button type="button" onClick={downloadPythonScript}>Download Python re-run script</button>
      </div>
      <p style={{ marginTop: "12px", opacity: 0.75 }}>
        Keep both files together. The script uses the recorded sample IDs and settings and requires the same backend version and source data to reproduce results.
      </p>
    </section>
  );
}
