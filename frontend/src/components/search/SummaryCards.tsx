// src/components/search/SummaryCards.tsx

type Props = {
    rows: any[];
  };
  
  export default function SummaryCards({ rows }: Props) {
    const samples = rows.length;
  
    const sites = new Set(
      rows.map((r) => r.siteid)
    ).size;
  
    const meanOfValid = (field: "pH" | "water_table_depth") => {
      const values = rows
        .flatMap((row) => row[field] == null ? [] : [Number(row[field])])
        .filter((value) => Number.isFinite(value));

      return values.length > 0
        ? (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)
        : "—";
    };

    const meanPH = meanOfValid("pH");
    const meanWT = meanOfValid("water_table_depth");
  
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
