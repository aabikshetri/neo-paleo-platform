import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { getTaxaSampleProfiles } from "../../api/taxa";
import { taxonColor } from "./taxaColors";

type SampleRow = {
  sampleid?: number | null;
  siteid?: number | null;
  datasetid?: number | null;
  sitename?: string | null;
  pH?: number | null;
  water_table_depth?: number | null;
  water_table_depth_units?: string | null;
  altitude?: number | null;
  doi?: string | null;
  investigators?: string | null;
};

type CompositionRow = {
  lumped_taxon: string;
  percentage: number;
};

type SampleProfile = {
  sampleid: number;
  dominant_taxon: string;
  composition: CompositionRow[];
};

const Plot = lazy(() => import("./PlotlyChart"));

function selectRowsForPlot(
  rows: SampleRow[],
  limit: number,
  method: "site_stratified" | "even_interval"
) {
  if (rows.length <= limit) return rows;
  if (method === "even_interval") {
    const step = rows.length / limit;
    return Array.from({ length: limit }, (_, index) => rows[Math.floor(index * step)]);
  }

  const groups = new Map<string, SampleRow[]>();
  rows.forEach((row) => {
    const key = String(row.siteid ?? row.sitename ?? "Unknown site");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  });
  const siteRows = Array.from(groups.values());
  const selected: SampleRow[] = [];
  for (let depth = 0; selected.length < limit; depth += 1) {
    let added = false;
    siteRows.forEach((group) => {
      if (selected.length < limit && group[depth]) {
        selected.push(group[depth]);
        added = true;
      }
    });
    if (!added) break;
  }
  return selected;
}

function categoryColor(name: string) {
  if (name === "Other taxa") return "#94a3b8";
  return taxonColor(name);
}

function formatNumber(value?: number | null, digits = 2) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toFixed(digits);
}

export default function LinkedEnvironmentalExplorer({ rows }: { rows: SampleRow[] }) {
  const [result, setResult] = useState<{ key: string; data: SampleProfile[] }>({
    key: "",
    data: [],
  });
  const [selected, setSelected] = useState<SampleRow | null>(null);
  const [pinned, setPinned] = useState<SampleRow[]>([]);
  const [displayMode, setDisplayMode] = useState("selected_genus");
  const [responseVariable, setResponseVariable] = useState("water_table_depth");
  const [responseGenus, setResponseGenus] = useState("");
  const [maxProfiles, setMaxProfiles] = useState(5000);
  const [samplingMethod, setSamplingMethod] = useState<"site_stratified" | "even_interval">("site_stratified");
  const [minimumAbundance, setMinimumAbundance] = useState(0);
  const [showAbsences, setShowAbsences] = useState(true);
  const [ringScale, setRingScale] = useState(1);

  const eligibleRows = useMemo(
    () => rows.filter(
      (row) => row.sampleid != null && row.pH != null && row.water_table_depth != null
    ),
    [rows]
  );
  const validRows = useMemo(
    () => selectRowsForPlot(eligibleRows, maxProfiles, samplingMethod),
    [eligibleRows, maxProfiles, samplingMethod]
  );
  const ids = useMemo(
    () => validRows.flatMap((row) => row.sampleid == null ? [] : [row.sampleid]),
    [validRows]
  );
  const requestKey = ids.join(",");

  useEffect(() => {
    let cancelled = false;
    if (ids.length === 0) return;

    getTaxaSampleProfiles(ids, 100)
      .then((data) => {
        if (!cancelled) setResult({ key: requestKey, data });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setResult({ key: requestKey, data: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [ids, requestKey]);

  const profiles = result.key === requestKey ? result.data : [];
  const profilesLoading = result.key !== requestKey && ids.length > 0;
  const profileBySample = new Map(
    profiles.map((profile) => [String(profile.sampleid), profile])
  );
  const genera = Array.from(new Set(
    profiles.flatMap((profile) =>
      profile.composition
        .filter((item) => item.lumped_taxon !== "Other")
        .map((item) => item.lumped_taxon)
    )
  )).sort();
  const activeGenus = genera.includes(responseGenus) ? responseGenus : genera[0] ?? "";
  const dominantCounts = new Map<string, number>();
  profiles.forEach((profile) => {
    dominantCounts.set(
      profile.dominant_taxon,
      (dominantCounts.get(profile.dominant_taxon) ?? 0) + 1
    );
  });
  const topDominantGenera = new Set(
    Array.from(dominantCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 9)
      .map(([genus]) => genus)
  );

  const scatterGroups = new Map<string, SampleRow[]>();
  validRows.forEach((row) => {
    const profile = profileBySample.get(String(row.sampleid));
    const dominant = profile?.dominant_taxon || "No taxa data";
    const group = displayMode === "site"
      ? row.sitename || "Unknown site"
      : topDominantGenera.has(dominant) ? dominant : "Other taxa";
    scatterGroups.set(group, [...(scatterGroups.get(group) ?? []), row]);
  });

  const selectedProfile = selected
    ? profileBySample.get(String(selected.sampleid))
    : undefined;

  const togglePin = (sample: SampleRow) => {
    const key = String(sample.sampleid);
    if (pinned.some((item) => String(item.sampleid) === key)) {
      setPinned(pinned.filter((item) => String(item.sampleid) !== key));
      return;
    }
    if (pinned.length < 6) setPinned([...pinned, sample]);
  };

  const responseRows = validRows
    .map((row) => {
      const profile = profileBySample.get(String(row.sampleid));
      const abundance = profile?.composition.find(
        (item) => item.lumped_taxon === activeGenus
      )?.percentage ?? 0;
      return {
        environmental: Number(row[responseVariable as "pH" | "water_table_depth"]),
        abundance,
        site: row.sitename || "Unknown site",
        sampleid: row.sampleid,
      };
    })
    .filter((row) => Number.isFinite(row.environmental));

  const genusAbundance = (row: SampleRow) => profileBySample
    .get(String(row.sampleid))
    ?.composition.find((item) => item.lumped_taxon === activeGenus)
    ?.percentage ?? 0;
  const ringRows = validRows.filter((row) => {
    const abundance = genusAbundance(row);
    return abundance > 0 && abundance >= minimumAbundance;
  });
  const backgroundRows = validRows.filter((row) => {
    const abundance = genusAbundance(row);
    return abundance <= 0 || abundance < minimumAbundance;
  });
  const ringSize = (percentage: number) =>
    Math.max(7, Math.min(42, Math.sqrt(Math.max(percentage, 0)) * 4 * ringScale));
  const environmentalTraces = displayMode === "selected_genus"
    ? [
        ...(showAbsences ? [{
          x: backgroundRows.map((row) => row.water_table_depth),
          y: backgroundRows.map((row) => row.pH),
          customdata: backgroundRows,
          text: backgroundRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}<br>${activeGenus}: ${genusAbundance(row).toFixed(2)}%`),
          hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra>Absent or below threshold</extra>",
          mode: "markers" as const,
          type: "scatter" as const,
          name: minimumAbundance > 0 ? `Below ${minimumAbundance}%` : `${activeGenus} absent`,
          marker: { symbol: "circle", color: "#94a3b8", size: 9, opacity: 0.42 },
        }] : []),
        {
          x: ringRows.map((row) => row.water_table_depth),
          y: ringRows.map((row) => row.pH),
          customdata: ringRows,
          text: ringRows.map((row) => `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}<br>${activeGenus}: ${genusAbundance(row).toFixed(2)}%`),
          hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra></extra>",
          mode: "markers" as const,
          type: "scatter" as const,
          name: activeGenus,
          marker: {
            symbol: "circle-open",
            color: taxonColor(activeGenus),
            size: ringRows.map((row) => ringSize(genusAbundance(row))),
            opacity: 0.86,
            line: { color: taxonColor(activeGenus), width: 2 },
          },
        },
      ]
    : Array.from(scatterGroups.entries()).map(([group, groupRows]) => ({
        x: groupRows.map((row) => row.water_table_depth),
        y: groupRows.map((row) => row.pH),
        customdata: groupRows,
        text: groupRows.map((row) => {
          const dominant = profileBySample.get(String(row.sampleid))?.dominant_taxon;
          return `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}${dominant ? `<br>Dominant: ${dominant}` : ""}`;
        }),
        hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra></extra>",
        mode: "markers" as const,
        type: "scatter" as const,
        name: group,
        marker: {
          symbol: "circle-open",
          color: categoryColor(group),
          size: 9,
          opacity: 0.82,
          line: { color: categoryColor(group), width: 2 },
        },
      }));

  const positiveResponseRows = responseRows.filter((row) => row.abundance > 0);
  const zeroResponseRows = responseRows.filter((row) => row.abundance <= 0);
  const sortedNonZeroAbundances = positiveResponseRows
    .map((row) => row.abundance)
    .sort((a, b) => a - b);
  const medianNonZero = sortedNonZeroAbundances.length
    ? sortedNonZeroAbundances.length % 2
      ? sortedNonZeroAbundances[Math.floor(sortedNonZeroAbundances.length / 2)]
      : (sortedNonZeroAbundances[sortedNonZeroAbundances.length / 2 - 1] + sortedNonZeroAbundances[sortedNonZeroAbundances.length / 2]) / 2
    : 0;
  const responsePrevalence = responseRows.length
    ? positiveResponseRows.length / responseRows.length * 100
    : 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
          marginBottom: "10px",
        }}
      >
        <div style={{ textAlign: "left" }}>
          <h3 style={{ marginBottom: "4px" }}>pH vs water-table depth</h3>
          <p style={{ opacity: 0.72 }}>Select a point to inspect or pin its assemblage.</p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Display samples as{" "}
          <select value={displayMode} onChange={(event) => setDisplayMode(event.target.value)}>
            <option value="selected_genus">Taxon-abundance rings</option>
            <option value="dominant_genus">Dominant taxon</option>
            <option value="site">Site</option>
          </select>
        </label>
        {displayMode === "selected_genus" && (
          <label>
            Taxon{" "}
            <select value={activeGenus} onChange={(event) => setResponseGenus(event.target.value)}>
              {genera.map((genus) => <option key={genus}>{genus}</option>)}
            </select>
          </label>
        )}
        </div>
      </div>

      {eligibleRows.length > maxProfiles && (
        <p style={{ opacity: 0.72, textAlign: "left" }}>
          Showing {validRows.length.toLocaleString()} of {eligibleRows.length.toLocaleString()} complete samples using {samplingMethod === "site_stratified" ? "site-stratified round-robin" : "even-interval"} selection.
        </p>
      )}

      <details style={{ margin: "12px 0", textAlign: "left" }}>
        <summary style={{ cursor: "pointer" }}>Plot controls</summary>
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "end", marginTop: "10px" }}>
          <label>
            <span style={{ display: "block" }}>Maximum samples</span>
            <select value={maxProfiles} onChange={(event) => setMaxProfiles(Number(event.target.value))}>
              {[300, 500, 1000].map((value) => <option key={value}>{value}</option>)}
              <option value={5000}>All filtered samples</option>
            </select>
          </label>
          <label>
            <span style={{ display: "block" }}>Sample selection</span>
            <select value={samplingMethod} onChange={(event) => setSamplingMethod(event.target.value as typeof samplingMethod)}>
              <option value="site_stratified">Balance across sites</option>
              <option value="even_interval">Even interval</option>
            </select>
          </label>
          {displayMode === "selected_genus" && (
            <>
              <label>
                <span style={{ display: "block" }}>Minimum composition (%)</span>
                <input type="number" min="0" max="100" step="0.5" value={minimumAbundance} onChange={(event) => setMinimumAbundance(Math.max(0, Number(event.target.value)))} />
              </label>
              <label>
                <span style={{ display: "block" }}>Ring scale</span>
                <select value={ringScale} onChange={(event) => setRingScale(Number(event.target.value))}>
                  <option value={0.75}>Small</option>
                  <option value={1}>Standard</option>
                  <option value={1.35}>Large</option>
                </select>
              </label>
              <label style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                <input type="checkbox" checked={showAbsences} onChange={(event) => setShowAbsences(event.target.checked)} />
                Show absent/below-threshold samples
              </label>
            </>
          )}
        </div>
      </details>

      {profilesLoading ? (
        <div style={{ minHeight: "500px", display: "grid", placeItems: "center" }}>
          Loading environmental profiles…
        </div>
      ) : (
      <Suspense fallback={(
        <div style={{ minHeight: "500px", display: "grid", placeItems: "center" }}>
          Loading interactive chart…
        </div>
      )}>
      <Plot
        data={environmentalTraces}
        layout={{
          autosize: true,
          height: 500,
          margin: { l: 62, r: 20, t: 20, b: 62 },
          xaxis: { title: { text: "Water-table depth" } },
          yaxis: { title: { text: "pH" } },
          legend: { orientation: "h", y: -0.22 },
          paper_bgcolor: "transparent",
          plot_bgcolor: "transparent",
        }}
        config={{ responsive: true, displaylogo: false }}
        style={{ width: "100%" }}
        onClick={(event) => {
          const row = event.points[0]?.customdata as SampleRow | undefined;
          if (row) setSelected(row);
        }}
      />
      </Suspense>
      )}

      {displayMode === "selected_genus" && !profilesLoading && (
        <div style={{ marginTop: "8px", opacity: 0.72 }}>
          <p>
            Ring diameter uses square-root abundance scaling, so area tracks {activeGenus} composition except at the stated visibility limits; coordinates are unaltered. {showAbsences ? "Small muted points are absent or below the selected threshold." : "Absent and below-threshold samples are hidden."}
          </p>
          <div style={{ display: "flex", gap: "16px", alignItems: "end", marginTop: "8px" }} aria-label="Ring-size legend">
            {[1, 10, 50].map((percentage) => (
              <span key={percentage} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <span style={{ display: "inline-block", width: `${ringSize(percentage)}px`, height: `${ringSize(percentage)}px`, border: `2px solid ${taxonColor(activeGenus)}`, borderRadius: "50%", boxSizing: "border-box" }} />
                {percentage}%
              </span>
            ))}
          </div>
        </div>
      )}

      {!selected && pinned.length === 0 ? (
        <p style={{ marginTop: "12px", opacity: 0.72 }}>
          Click a point to open its composition and pin samples for comparison.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
            gap: "18px",
            marginTop: "22px",
          }}
        >
        <section style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "18px" }}>
          <h3>Selected sample</h3>
          {!selected ? (
            <p style={{ opacity: 0.7 }}>Click a scatter point to inspect its composition.</p>
          ) : (
            <>
              <div style={{ textAlign: "left", lineHeight: 1.7 }}>
                <strong>{selected.sitename || "Unknown site"}</strong><br />
                Sample {selected.sampleid} · Dataset {selected.datasetid}<br />
                pH {formatNumber(selected.pH)} · WTD {formatNumber(selected.water_table_depth)}{" "}
                {selected.water_table_depth_units || "(unit not recorded)"}<br />
                Altitude {formatNumber(selected.altitude, 0)}
                {selected.doi && (
                  <><br /><a href={`https://doi.org/${selected.doi.split(";")[0]}`} target="_blank" rel="noreferrer">Dataset DOI</a></>
                )}
                {selected.investigators && (
                  <details style={{ marginTop: "6px" }}>
                    <summary style={{ cursor: "pointer" }}>
                      Investigators ({selected.investigators.split(";").filter((name) => name.trim()).length})
                    </summary>
                    <span>{selected.investigators}</span>
                  </details>
                )}
              </div>
              <button onClick={() => togglePin(selected)} style={{ marginTop: "10px" }}>
                {pinned.some((item) => item.sampleid === selected.sampleid)
                  ? "Remove pin"
                  : pinned.length >= 6 ? "Pin limit reached" : "Pin for comparison"}
              </button>
              {selectedProfile && (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={selectedProfile.composition}
                      dataKey="percentage"
                      nameKey="lumped_taxon"
                      innerRadius={55}
                      outerRadius={88}
                      stroke="none"
                    >
                      {selectedProfile.composition.map((item) => (
                        <Cell key={item.lumped_taxon} fill={taxonColor(item.lumped_taxon)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </>
          )}
        </section>

        <section style={{ border: "1px solid var(--border)", borderRadius: "12px", padding: "18px" }}>
          <h3>Pinned comparison ({pinned.length}/6)</h3>
          {pinned.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Pin samples to compare their assemblages.</p>
          ) : pinned.map((sample) => {
            const profile = profileBySample.get(String(sample.sampleid));
            return (
              <div key={sample.sampleid} style={{ marginBottom: "16px", textAlign: "left" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <strong>{sample.sitename} · {sample.sampleid}</strong>
                  <button onClick={() => togglePin(sample)}>Remove</button>
                </div>
                <div style={{ display: "flex", height: "18px", marginTop: "8px", borderRadius: "9px", overflow: "hidden" }}>
                  {profile?.composition.map((item) => (
                    <span
                      key={item.lumped_taxon}
                      title={`${item.lumped_taxon}: ${item.percentage.toFixed(2)}%`}
                      style={{ width: `${item.percentage}%`, background: taxonColor(item.lumped_taxon) }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </section>
        </div>
      )}

      <section style={{ marginTop: "22px", borderTop: "1px solid var(--border)", paddingTop: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ textAlign: "left" }}>
            <h3 style={{ marginBottom: "4px" }}>Taxon response</h3>
            <p style={{ opacity: 0.72 }}>Explore abundance along the measured environmental gradient.</p>
            <p style={{ opacity: 0.72, marginTop: "4px" }}>
              {positiveResponseRows.length.toLocaleString()} of {responseRows.length.toLocaleString()} plotted samples are non-zero ({responsePrevalence.toFixed(1)}% prevalence); median non-zero composition {medianNonZero.toFixed(2)}%.
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <select value={activeGenus} onChange={(event) => setResponseGenus(event.target.value)}>
              {genera.map((genus) => <option key={genus}>{genus}</option>)}
            </select>
            <select value={responseVariable} onChange={(event) => setResponseVariable(event.target.value)}>
              <option value="water_table_depth">Water-table depth</option>
              <option value="pH">pH</option>
            </select>
          </div>
        </div>
        <Suspense fallback={<p>Loading response chart…</p>}>
        <Plot
          data={[
            {
              x: zeroResponseRows.map((row) => row.environmental),
              y: zeroResponseRows.map((row) => row.abundance),
              text: zeroResponseRows.map((row) => `${row.site}<br>Sample ${row.sampleid}`),
              hovertemplate: "%{text}<br>x %{x:.2f}<br>abundance 0.00%<extra>Not recorded</extra>",
              mode: "markers",
              type: "scatter",
              name: `${activeGenus} absent`,
              marker: { color: "#94a3b8", opacity: 0.22, size: 5 },
            },
            {
              x: positiveResponseRows.map((row) => row.environmental),
              y: positiveResponseRows.map((row) => row.abundance),
              text: positiveResponseRows.map((row) => `${row.site}<br>Sample ${row.sampleid}`),
              hovertemplate: "%{text}<br>x %{x:.2f}<br>abundance %{y:.2f}%<extra></extra>",
              mode: "markers",
              type: "scatter",
              name: activeGenus,
              marker: {
                symbol: "circle-open",
                color: taxonColor(activeGenus),
                opacity: 0.84,
                size: positiveResponseRows.map((row) => ringSize(row.abundance)),
                line: { color: taxonColor(activeGenus), width: 2 },
              },
            },
          ]}
          layout={{
            autosize: true,
            height: 360,
            margin: { l: 62, r: 20, t: 20, b: 58 },
            xaxis: { title: { text: responseVariable === "pH" ? "pH" : "Water-table depth" } },
            yaxis: { title: { text: `${activeGenus} composition (%)` }, rangemode: "tozero" },
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
          }}
          config={{ responsive: true, displaylogo: false }}
          style={{ width: "100%" }}
        />
        </Suspense>
      </section>
    </div>
  );
}
