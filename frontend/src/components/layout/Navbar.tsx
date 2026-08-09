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
        alignItems: "stretch",
        gap: "28px",
        padding: "20px 28px",
        borderBottom: "1px solid var(--border)",
        textAlign: "left",
        flexWrap: "wrap",
      }}
    >
      <Link
        to="/"
        style={{ color: "inherit", textDecoration: "none", flex: "1 1 440px", alignSelf: "center" }}
        aria-label="AmoebaScope home"
      >
        <strong style={{ display: "block", color: "var(--text-h)", fontSize: "clamp(1.15rem, 2vw, 1.55rem)", lineHeight: 1.25 }}>
          AmoebaScope
        </strong>
        <span style={{ display: "block", maxWidth: "900px", marginTop: "5px", fontSize: "1rem", lineHeight: 1.45 }}>
          Exploration and visualization of testate amoeba ecology and paleoecology using the Neotoma Paleoecology Database
        </span>
        <span style={{ opacity: 0.72, fontSize: "0.9rem" }}>
          Database accessed: {accessed}
        </span>
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "16px",
          border: "1px solid var(--border)",
          borderRadius: "14px",
          padding: "10px 12px 10px 16px",
          flex: "0 1 460px",
          maxWidth: "460px",
        }}
      >
        <div style={{ minWidth: 0, textAlign: "right", fontSize: "0.78rem", lineHeight: 1.45 }}>
          <strong style={{ display: "block", color: "var(--text-h)", fontSize: "0.9rem" }}>
            Beta Version, 2026
          </strong>
          <span style={{ display: "block" }}>Aabiskar Thapa Kshetri and Robert K. Booth</span>
          <span style={{ display: "block", opacity: 0.78 }}>Surface-sample explorer</span>
          <span style={{ display: "block", marginTop: "2px" }}>
            <a href="mailto:aat226@lehigh.edu">aat226@lehigh.edu</a>
            {" · "}
            <a href="mailto:rkb205@lehigh.edu">rkb205@lehigh.edu</a>
          </span>
        </div>
        <Link to="/" aria-label="AmoebaScope home">
          <img
            src="/assets/amoebascope.jpeg"
            alt="AmoebaScope logo: a testate amoeba viewed through a microscope"
            width="112"
            height="112"
            style={{
              display: "block",
              width: "clamp(86px, 9vw, 112px)",
              height: "clamp(86px, 9vw, 112px)",
              objectFit: "cover",
              borderRadius: "12px",
              flexShrink: 0,
            }}
          />
        </Link>
      </div>
    </header>
  );
}
