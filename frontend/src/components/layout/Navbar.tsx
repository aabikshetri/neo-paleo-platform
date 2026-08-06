import { Link } from "react-router-dom";

export default function Navbar() {
  const accessed = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());

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
        aria-label="AmoebaScope home"
      >
        <strong style={{ display: "block", color: "var(--text-h)", fontSize: "1.15rem" }}>
          AmoebaScope: exploration and visualization of testate amoeba ecology and paleoecology using the Neotoma database.
        </strong>
        <span style={{ opacity: 0.72, fontSize: "0.9rem" }}>
          Database accessed: {accessed}
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
