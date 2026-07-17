// src/components/search/DownloadCSV.tsx

type Props = {
    rows: any[];
  };
  
  export default function DownloadCSV({
    rows,
  }: Props) {
  
    function download() {
      const csv =
        [
          Object.keys(rows[0]).join(","),
          ...rows.map((row) =>
            Object.values(row).join(",")
          ),
        ].join("\n");
  
      const blob = new Blob(
        [csv],
        { type: "text/csv" }
      );
  
      const url =
        window.URL.createObjectURL(blob);
  
      const a =
        document.createElement("a");
  
      a.href = url;
  
      a.download =
        "neotoma_results.csv";
  
      a.click();
    }
  
    if (!rows.length) return null;
  
    return (
      <button onClick={download}>
        Download CSV
      </button>
    );
  }