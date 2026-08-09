export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "24px 28px",
        marginTop: "auto",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "20px 36px",
        flexWrap: "wrap",
        textAlign: "left",
        fontSize: "0.82rem",
        opacity: 0.72,
      }}
    >
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "7px",
          flex: "1 1 380px",
        }}
      >
        <li>
          <strong>Authors:</strong> Aabiskar Thapa Kshetri and Robert K. Booth, 2026
        </li>
        <li>
          <strong>Contact:</strong>{" "}
          <a href="mailto:aabiskar0232@gmail.com">aabiskar0232@gmail.com</a>
          {" · "}
          <a href="mailto:rkb205@lehigh.edu">rkb205@lehigh.edu</a>
        </li>
      </ul>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "7px",
          flex: "0 1 360px",
          textAlign: "right",
        }}
      >
        <li><strong>Data source:</strong> Neotoma Paleoecology Database</li>
        <li> AmoebaScope Logo by London Diiorio</li>
      </ul>
    </footer>
  );
}
