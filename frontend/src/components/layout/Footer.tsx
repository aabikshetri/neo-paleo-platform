const repositoryUrl = "https://github.com/aabikshetri/neo-paleo-platform";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <section className="site-footer__section" aria-labelledby="footer-project">
          <span className="site-footer__eyebrow" id="footer-project">AmoebaScope</span>
          <p className="site-footer__primary">
            <a href={repositoryUrl} target="_blank" rel="noreferrer">
              Beta Version (GitHub)
            </a>
            <span aria-hidden="true"> · </span>2026
          </p>
          <p>Aabiskar Thapa Kshetri and Robert K. Booth</p>
        </section>

        <section className="site-footer__section" aria-labelledby="footer-data">
          <span className="site-footer__eyebrow" id="footer-data">Research data</span>
          <p className="site-footer__primary">
            <a href="https://www.neotomadb.org/" target="_blank" rel="noreferrer">
              Neotoma Paleoecology Database
            </a>
          </p>
          <p>Logo by London Diiorio</p>
        </section>

        <section className="site-footer__section" aria-labelledby="footer-contact">
          <span className="site-footer__eyebrow" id="footer-contact">Contact</span>
          <p><a href="mailto:aabiskar0232@gmail.com">aabiskar0232@gmail.com</a></p>
          <p><a href="mailto:rkb205@lehigh.edu">rkb205@lehigh.edu</a></p>
        </section>
      </div>

      <details className="site-footer__citation">
        <summary>
          <span aria-hidden="true" className="site-footer__cite-icon">“</span>
          <span>
            <strong>Cite AmoebaScope</strong>
            <small>Get the recommended software citation</small>
          </span>
        </summary>
        <div className="site-footer__citation-content">
          <p>
            Thapa Kshetri, A., &amp; Booth, R. K. (2026).{" "}
            <em>
              AmoebaScope: Exploration and visualization of testate amoeba ecology and
              paleoecology using the Neotoma Paleoecology Database
            </em>{" "}
            (Version 1.5.0-beta) [Computer software].
          </p>
          <a
            className="site-footer__citation-link"
            href={`${repositoryUrl}/blob/main/CITATION.cff`}
            target="_blank"
            rel="noreferrer"
          >
            View CITATION.cff <span aria-hidden="true">↗</span>
          </a>
        </div>
      </details>
    </footer>
  );
}
