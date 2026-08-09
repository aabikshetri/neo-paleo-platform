import { useState } from "react";

import { downloadFilteredTaxaCsv } from "../../api/taxa";

type Props = {
  rows: Array<{ sampleid?: number | null }>;
  selectionToken?: string | null;
};

export default function DownloadCSV({ rows, selectionToken }: Props) {
  const [loading, setLoading] = useState(false);
  const sampleids = Array.from(new Set(rows.flatMap((row) =>
    row.sampleid == null ? [] : [row.sampleid]
  )));

  async function download() {
    if (!sampleids.length && !selectionToken) return;
    setLoading(true);
    try {
      await downloadFilteredTaxaCsv(sampleids, selectionToken);
    } catch (error) {
      console.error(error);
      window.alert("The complete taxa CSV could not be downloaded. Confirm that the updated backend is running.");
    } finally {
      setLoading(false);
    }
  }

  if (!sampleids.length && !selectionToken) return null;

  return (
    <button type="button" onClick={download} disabled={loading}>
      {loading ? "Preparing CSV…" : "Download CSV"}
    </button>
  );
}
