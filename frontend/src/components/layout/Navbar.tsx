import { Link } from "react-router-dom";

export default function Navbar() {
  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "24px",
        padding: "20px 28px",
        borderBottom: "1px solid var(--border)",
        textAlign: "left",
        flexWrap: "wrap",
      }}
    >
      <Link
        to="/"
        style={{ color: "inherit", textDecoration: "none" }}
        aria-label="Neotoma Testate Amoeba Database Explorer home"
      >
        <strong style={{ display: "block", color: "var(--text-h)", fontSize: "1.15rem" }}>
          Neotoma Testate Amoeba Database Explorer: Surface-samples and Paleoecology
        </strong>
        <span style={{ opacity: 0.72, fontSize: "0.9rem" }}>
          Finest recorded taxonomic resolution
        </span>
      </Link>

      <span
        style={{
          border: "1px solid var(--border)",
          borderRadius: "999px",
          padding: "5px 11px",
          fontSize: "0.82rem",
          opacity: 0.78,
        }}
      >
        Surface-sample explorer
      </span>
    </header>
  );
}
