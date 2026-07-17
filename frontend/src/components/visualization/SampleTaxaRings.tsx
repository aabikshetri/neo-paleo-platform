import { useEffect, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import { getTaxaCompositionBySample } from "../../api/taxa";

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#64748b",
];

const PAGE_SIZE = 12;

type SampleRow = {
  sampleid?: number | string | null;
  siteid?: number | string | null;
  sitename?: string | null;
  pH?: number | null;
  water_table_depth?: number | null;
};

type CompositionRow = {
  lumped_taxon: string;
  percentage: number;
};

type SampleComposition = {
  sampleid: number | string;
  composition: CompositionRow[];
};

export default function SampleTaxaRings({ rows }: { rows: SampleRow[] }) {
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data: SampleComposition[];
  }>({ key: "", data: [] });

  const samples = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (row.sampleid == null) return false;
      const key = String(row.sampleid);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(samples.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleSamples = useMemo(
    () => samples.slice(
      safePage * PAGE_SIZE,
      (safePage + 1) * PAGE_SIZE
    ),
    [safePage, samples]
  );
  const sampleKey = visibleSamples.map((row) => row.sampleid).join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = visibleSamples.flatMap((row) =>
      row.sampleid == null ? [] : [row.sampleid]
    );

    if (ids.length === 0) {
      return;
    }

    getTaxaCompositionBySample(ids)
      .then((data) => {
        if (!cancelled) setResult({ key: sampleKey, data });
      })
      .catch((error) => {
        console.error(error);
        if (!cancelled) setResult({ key: sampleKey, data: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [sampleKey, visibleSamples]);

  const loading = sampleKey !== "" && result.key !== sampleKey;

  const bySample = new Map(
    result.data.map((item) => [String(item.sampleid), item.composition])
  );

  return (
    <section style={{ marginTop: "28px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "end",
          gap: "16px",
          marginBottom: "18px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ textAlign: "left" }}>
          <h3 style={{ marginBottom: "4px" }}>Composition by sample</h3>
          <p style={{ opacity: 0.75 }}>
            Genus composition for each sample shown in the pH–water table dataset.
          </p>
        </div>

        {samples.length > PAGE_SIZE && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </button>
            <span>
              {safePage + 1} / {pageCount}
            </span>
            <button
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <p>Loading sample rings…</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "16px",
          }}
        >
          {visibleSamples.map((sample) => {
            const data = bySample.get(String(sample.sampleid)) ?? [];

            return (
              <article
                key={String(sample.sampleid)}
                style={{
                  border: "1px solid var(--border, #ddd)",
                  borderRadius: "12px",
                  padding: "14px",
                  minWidth: 0,
                }}
              >
                <div style={{ textAlign: "left" }}>
                  <strong>{sample.sitename || `Site ${sample.siteid ?? "—"}`}</strong>
                  <div style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                    Sample {sample.sampleid} · pH {sample.pH ?? "—"} · WTD{" "}
                    {sample.water_table_depth ?? "—"}
                  </div>
                </div>

                {data.length === 0 ? (
                  <div style={{ padding: "64px 0", opacity: 0.65 }}>No taxa data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={190}>
                    <PieChart>
                      <Pie
                        data={data}
                        dataKey="percentage"
                        nameKey="lumped_taxon"
                        innerRadius={45}
                        outerRadius={76}
                        paddingAngle={1}
                        stroke="none"
                      >
                        {data.map((item, index) => (
                          <Cell
                            key={item.lumped_taxon}
                            fill={COLORS[index % COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, name) => [
                          `${Number(value).toFixed(2)}%`,
                          name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
