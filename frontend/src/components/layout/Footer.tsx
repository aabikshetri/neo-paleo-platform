export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "24px 28px",
        marginTop: "auto",
        display: "flex",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
        textAlign: "left",
        fontSize: "0.82rem",
        opacity: 0.72,
      }}
    >
      <span>Data source: Neotoma Paleoecology Database</span>
      <span>Composition normalized within each sample at the finest taxonomic resolution recorded by Neotoma.</span>
      <span>Aabiskar Thapa Kshetri and Robert K. Booth, 2026. Contact: aat226@lehigh.edu · rkb205@lehigh.edu</span>
    </footer>
  );
}
