import { memo, useMemo } from "react";
import type { SearchSummary } from "../../api/search";

type Props = {
    rows: any[];
    summary?: SearchSummary | null;
  };
  
  function SummaryCards({ rows, summary }: Props) {
    const samples = summary?.samples ?? rows.length;
    const calculated = useMemo(() => {
      const siteIds = new Set<unknown>();
      let phSum = 0;
      let phCount = 0;
      let waterSum = 0;
      let waterCount = 0;

      for (const row of rows) {
        siteIds.add(row.siteid);
        const ph = Number(row.pH);
        if (row.pH != null && Number.isFinite(ph)) {
          phSum += ph;
          phCount += 1;
        }
        const water = Number(row.water_table_depth);
        if (row.water_table_depth != null && Number.isFinite(water)) {
          waterSum += water;
          waterCount += 1;
        }
      }

      return {
        sites: siteIds.size,
        meanPH: phCount ? (phSum / phCount).toFixed(2) : "—",
        meanWT: waterCount ? (waterSum / waterCount).toFixed(2) : "—",
      };
    }, [rows]);
    const sites = summary?.sites ?? calculated.sites;
    const meanPH = summary?.mean_pH == null
      ? (summary ? "—" : calculated.meanPH)
      : summary.mean_pH.toFixed(2);
    const meanWT = summary?.mean_water_table_depth == null
      ? (summary ? "—" : calculated.meanWT)
      : summary.mean_water_table_depth.toFixed(2);
  
    const cardStyle = {
      border: "1px solid #444",
      padding: "20px",
      borderRadius: "10px",
      minWidth: "180px",
      textAlign: "center" as const,
    };
  
    return (
      <div
        style={{
          display: "flex",
          gap: "20px",
          marginBottom: "25px",
          flexWrap: "wrap",
        }}
      >
        <div style={cardStyle}>
          <h3>{samples}</h3>
          <p>Samples</p>
        </div>
  
        <div style={cardStyle}>
          <h3>{sites}</h3>
          <p>Sites</p>
        </div>
  
        <div style={cardStyle}>
          <h3>{meanPH}</h3>
          <p>Mean pH</p>
        </div>
  
        <div style={cardStyle}>
          <h3>{meanWT}</h3>
          <p>Mean Water Table (cm)</p>
        </div>
      </div>
    );
  }

  export default memo(SummaryCards);
