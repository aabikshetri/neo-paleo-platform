import { useEffect, useMemo, useState } from "react";
import Plot from "react-plotly.js";
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
  dominant_genus: string;
  composition: CompositionRow[];
};

const MAX_PROFILES = 1000;

function categoryColor(name: string) {
  if (name === "Other genera") return "#94a3b8";
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
  const [colorBy, setColorBy] = useState("dominant_genus");
  const [responseVariable, setResponseVariable] = useState("water_table_depth");
  const [responseGenus, setResponseGenus] = useState("");

  const validRows = useMemo(
    () => rows.filter(
      (row) => row.sampleid != null && row.pH != null && row.water_table_depth != null
    ).slice(0, MAX_PROFILES),
    [rows]
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
      profile.dominant_genus,
      (dominantCounts.get(profile.dominant_genus) ?? 0) + 1
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
    const dominant = profile?.dominant_genus || "No taxa data";
    const group = colorBy === "site"
      ? row.sitename || "Unknown site"
      : topDominantGenera.has(dominant) ? dominant : "Other genera";
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
        <label>
          Color points by{" "}
          <select value={colorBy} onChange={(event) => setColorBy(event.target.value)}>
            <option value="dominant_genus">Dominant genus</option>
            <option value="site">Site</option>
          </select>
        </label>
      </div>

      {rows.length > MAX_PROFILES && (
        <p style={{ opacity: 0.72, textAlign: "left" }}>
          Showing the first {MAX_PROFILES.toLocaleString()} complete samples for interactive analysis.
        </p>
      )}

      <Plot
        data={Array.from(scatterGroups.entries()).map(([group, groupRows]) => ({
          x: groupRows.map((row) => row.water_table_depth),
          y: groupRows.map((row) => row.pH),
          customdata: groupRows,
          text: groupRows.map(
            (row) => {
              const dominant = profileBySample.get(String(row.sampleid))?.dominant_genus;
              return `${row.sitename || "Unknown site"}<br>Sample ${row.sampleid}${dominant ? `<br>Dominant: ${dominant}` : ""}`;
            }
          ),
          hovertemplate: "%{text}<br>WTD %{x:.2f}<br>pH %{y:.2f}<extra></extra>",
          mode: "markers",
          type: "scatter" as const,
          name: group,
          marker: { color: categoryColor(group), size: 8, opacity: 0.76 },
        }))}
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
                {selected.investigators && <><br />Investigators: {selected.investigators}</>}
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
            <h3 style={{ marginBottom: "4px" }}>Genus response</h3>
            <p style={{ opacity: 0.72 }}>Explore abundance along the measured environmental gradient.</p>
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
        <Plot
          data={[{
            x: responseRows.map((row) => row.environmental),
            y: responseRows.map((row) => row.abundance),
            text: responseRows.map((row) => `${row.site}<br>Sample ${row.sampleid}`),
            hovertemplate: "%{text}<br>x %{x:.2f}<br>abundance %{y:.2f}%<extra></extra>",
            mode: "markers",
            type: "scatter",
            marker: { color: taxonColor(activeGenus), opacity: 0.62, size: 7 },
          }]}
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
      </section>
    </div>
  );
}
