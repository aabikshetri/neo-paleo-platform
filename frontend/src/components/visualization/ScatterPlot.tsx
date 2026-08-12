import Plot from "react-plotly.js";

export default function ScatterPlot(
  { rows, xField, yField }: any
) {

  const valid = rows.filter(
    (r: any) =>
      r[xField] != null &&
      r[yField] != null
  );

  return (
    <Plot
      data={[
        {
          x: valid.map(
            (r: any) => r[xField]
          ),
          y: valid.map(
            (r: any) => r[yField]
          ),
          mode: "markers",
          type: "scatter",
        },
      ]}
      layout={{
        title:
          `${yField} vs ${xField}`,
        xaxis: { zeroline: false },
        yaxis: { zeroline: false },
      }}
    />
  );
}
