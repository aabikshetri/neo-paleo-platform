import { useEffect, useState } from "react";

import { searchDatasets } from "../api/search";

import ScatterPlot from "../components/visualization/ScatterPlot";
import ResultsTable from "../components/ResultsTable";

export default function Dashboard() {

  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const data = await searchDatasets();

    console.log(data);

    setRows(data);
  }

  return (
    <div style={{ padding: "20px" }}>

      <h1>Neotoma Analytics</h1>

      <p>
        Rows Loaded: {rows.length}
      </p>

      <ScatterPlot rows={rows} />

      <ResultsTable rows={rows} />

    </div>
  );
}