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
        justifyContent: "flex-start",
        alignItems: "center",
        gap: "24px",
        padding: "20px 28px",
        borderBottom: "1px solid var(--border)",
        textAlign: "left",
        flexWrap: "wrap",
      }}
    >
      <Link to="/" aria-label="AmoebaScope home" style={{ flex: "0 0 auto" }}>
          <img
            src="/assets/amoebascope.jpeg"
            alt="AmoebaScope logo: a testate amoeba viewed through a microscope"
            width="132"
            height="132"
            style={{
              display: "block",
              width: "clamp(104px, 12vw, 132px)",
              height: "clamp(104px, 12vw, 132px)",
              objectFit: "cover",
              borderRadius: "12px",
              flexShrink: 0,
            }}
          />
      </Link>
      <Link
        to="/"
        style={{ color: "inherit", textDecoration: "none", flex: "1 1 520px", alignSelf: "center" }}
        aria-label="AmoebaScope home"
      >
        <strong style={{ display: "block", color: "var(--text-h)", fontSize: "clamp(1.35rem, 2.4vw, 1.8rem)", lineHeight: 1.2 }}>
          AmoebaScope
        </strong>
        <span style={{ display: "block", maxWidth: "820px", marginTop: "7px", fontSize: "1rem", lineHeight: 1.45 }}>
          Exploration and visualization of testate amoeba ecology and paleoecology using the Neotoma Paleoecology Database
        </span>
        <span style={{ display: "block", marginTop: "4px", opacity: 0.72, fontSize: "0.9rem" }}>
          Database accessed: {accessed}
        </span>
      </Link>
    </header>
  );
}
