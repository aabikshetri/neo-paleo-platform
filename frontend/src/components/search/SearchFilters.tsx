import { useEffect, useMemo, useState } from "react";

import { getPublicationOptions } from "../../api/search";

type PublicationOption = {
  publicationid?: number;
  citation: string;
  filter_value: string;
  sample_count?: number;
  primary_sample_count?: number;
  year?: string | null;
  doi?: string | null;
};

export type SearchFilterState = Record<string, string>;

type Props = {
    filters: SearchFilterState;
    setFilters: React.Dispatch<React.SetStateAction<SearchFilterState>>;
    onSearch: () => void;
    onClear: () => void;
    resultCount: number;
    downloadControl?: React.ReactNode;
  };
  
  export default function SearchFilters({
    filters,
    setFilters,
    onSearch,
    onClear,
    resultCount,
    downloadControl,
  }: Props) {
    const [publications, setPublications] = useState<PublicationOption[]>([]);
    const [publicationQuery, setPublicationQuery] = useState("");
    const [publicationOpen, setPublicationOpen] = useState(false);
    const visiblePublications = useMemo(() => {
      const query = publicationQuery.trim().toLocaleLowerCase();
      const matching = query
        ? publications.filter((publication) => publication.citation.toLocaleLowerCase().includes(query))
        : publications;
      return matching.slice(0, 40);
    }, [publicationQuery, publications]);

    useEffect(() => {
      let cancelled = false;
      getPublicationOptions()
        .then((data) => {
          if (!cancelled) setPublications(data);
        })
        .catch((error) => console.error(error));

      return () => {
        cancelled = true;
      };
    }, []);
  
    return (
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: "12px",
          padding: "18px",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Filter samples</h3>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ opacity: 0.75 }}>{resultCount.toLocaleString()} results</span>
            {downloadControl}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", marginTop: "16px", textAlign: "left" }}>
          <label>
            <span style={{ display: "block", marginBottom: "4px" }}>Site name</span>
            <input style={{ width: "100%", boxSizing: "border-box" }} value={filters.site_contains || ""} onChange={(e) => setFilters({ ...filters, site_contains: e.target.value })} />
          </label>

          <label style={{ gridColumn: "1 / -1" }}>
            <span style={{ display: "block", marginBottom: "4px" }}>Publication</span>
            <div style={{ position: "relative" }}>
              <input
                role="combobox"
                aria-expanded={publicationOpen}
                aria-controls="publication-options"
                placeholder="Search publications…"
                style={{ width: "100%", boxSizing: "border-box" }}
                value={publicationQuery}
                onFocus={() => setPublicationOpen(true)}
                onBlur={() => window.setTimeout(() => setPublicationOpen(false), 120)}
                onChange={(event) => {
                  setPublicationQuery(event.target.value);
                  setPublicationOpen(true);
                  if (!event.target.value) setFilters({ ...filters, publication_contains: "" });
                }}
              />
              {publicationOpen && (
                <div id="publication-options" role="listbox" className="publication-options">
                  <button type="button" role="option" onMouseDown={() => {
                    setPublicationQuery("");
                    setFilters({ ...filters, publication_contains: "" });
                  }}>All publications</button>
                  {visiblePublications.map((publication) => (
                    <button
                      type="button"
                      role="option"
                      key={publication.filter_value}
                      onMouseDown={() => {
                        setPublicationQuery(publication.citation);
                        setFilters({ ...filters, publication_contains: publication.filter_value });
                      }}
                    >
                      {publication.citation}{publication.sample_count ? ` (${publication.sample_count.toLocaleString()} samples)` : ""}
                    </button>
                  ))}
                  {visiblePublications.length === 40 && <small>Type more to narrow the results.</small>}
                </div>
              )}
            </div>
          </label>

          {[
            ["ph_min", "Minimum pH"],
            ["ph_max", "Maximum pH"],
            ["water_min", "Minimum WTD (cm)"],
            ["water_max", "Maximum WTD (cm)"],
            ["lat_min", "Minimum latitude"],
            ["lat_max", "Maximum latitude"],
            ["lon_min", "Minimum longitude"],
            ["lon_max", "Maximum longitude"],
          ].map(([field, label]) => (
            <label key={field}>
              <span style={{ display: "block", marginBottom: "4px" }}>{label}</span>
              <input type="number" step="any" style={{ width: "100%", boxSizing: "border-box" }} value={filters[field] || ""} onChange={(e) => setFilters({ ...filters, [field]: e.target.value })} />
            </label>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "16px" }}>
          <button type="button" onClick={() => {
            setPublicationQuery("");
            setPublicationOpen(false);
            onClear();
          }}>Clear</button>
          <button type="button" onClick={onSearch}>Search</button>
        </div>
      </section>
    );
  }
