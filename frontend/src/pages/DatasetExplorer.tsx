import { useEffect, useState } from "react";

import SearchFilters from "../components/search/SearchFilters";
import SummaryCards from "../components/search/SummaryCards";
import DownloadCSV from "../components/search/DownloadCSV";

import SiteMap from "../components/visualization/SiteMap";
import TaxaCompositionChart from "../components/visualization/TaxaCompositionChart";
import LinkedEnvironmentalExplorer from "../components/visualization/LinkedEnvironmentalExplorer";
import ViewportMount from "../components/visualization/ViewportMount";
import CalibrationQualityPanel from "../components/analysis/CalibrationQualityPanel";
import ModernAnalogueSearch from "../components/analysis/ModernAnalogueSearch";
import CommunityNmds from "../components/analysis/CommunityNmds";
import ReproducibilityPanel from "../components/analysis/ReproducibilityPanel";

import { searchDatasets } from "../api/search";
import { getTaxaBySamples } from "../api/taxa";

type AnalysisGroupProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
};

function AnalysisGroup({
  title,
  description,
  children,
  defaultOpen = false,
}: AnalysisGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="analysis-group"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </summary>
      <div className="analysis-group__content">{children}</div>
    </details>
  );
}

export default function DatasetExplorer() {
  const [rows, setRows] = useState<any[]>([]);
  const [allRows, setAllRows] = useState<any[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const [bbox, setBbox] = useState<any>(null);
  const [selectedSite, setSelectedSite] = useState<any>(null);
  const [taxaRows, setTaxaRows] = useState<any[]>([]);
  const [allTaxaRows, setAllTaxaRows] = useState<any[]>([]);
  const [taxaLoading, setTaxaLoading] = useState(false);
  const [analogueSnapshot, setAnalogueSnapshot] = useState<Record<string, unknown> | null>(null);
  const [nmdsSnapshot, setNmdsSnapshot] = useState<Record<string, unknown> | null>(null);

  const [filters, setFilters] = useState({
    site_contains: "",
    ph_min: "",
    ph_max: "",
    water_min: "",
    water_max: "",
    publication_contains: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadTaxaForSelectedRows(rowsForTaxa: any[], saveAsBaseline = false) {
    const sampleids = rowsForTaxa
      .map((row) => row.sampleid)
      .filter(Boolean);

    if (sampleids.length === 0) {
      setTaxaRows([]);
      return;
    }

    try {
      setTaxaLoading(true);

      const data = await getTaxaBySamples(
        sampleids,
        "genus",
        20
      );

      setTaxaRows(data);
      if (saveAsBaseline) setAllTaxaRows(data);
    } catch (err) {
      console.error(err);
      setTaxaRows([]);
    } finally {
      setTaxaLoading(false);
    }
  }

  async function loadData() {
    const data = await searchDatasets();

    setRows(data);
    setAllRows(data);
    setSelectedRows(data);

    await loadTaxaForSelectedRows(data, true);
  }

  async function handleSearch() {
    const data = await searchDatasets(filters);

    setRows(data);
    setSelectedRows(data);
    setSelectedSite(null);
    setBbox(null);

    await loadTaxaForSelectedRows(data);
  }

  async function clearFilters() {
    const emptyFilters = {
      site_contains: "",
      ph_min: "",
      ph_max: "",
      water_min: "",
      water_max: "",
      publication_contains: "",
    };
    setFilters(emptyFilters);
    setRows(allRows);
    setSelectedRows(allRows);
    setSelectedSite(null);
    setBbox(null);
    await loadTaxaForSelectedRows(allRows);
  }

  function selectRegion(bounds: any) {
    setBbox(bounds);

    const filtered = rows.filter((row) => {
      if (
        row.latitude == null ||
        row.longitude == null
      ) {
        return false;
      }

      return (
        row.latitude >= bounds.lat_min &&
        row.latitude <= bounds.lat_max &&
        row.longitude >= bounds.lon_min &&
        row.longitude <= bounds.lon_max
      );
    });

    setSelectedRows(filtered);
    loadTaxaForSelectedRows(filtered);
  }

  function clearRegion() {
    setSelectedRows(rows);
    setBbox(null);
    loadTaxaForSelectedRows(rows);
  }

  return (
    <div
      style={{
        maxWidth: "1400px",
        margin: "0 auto",
        padding: "20px",
      }}
    >
      <SearchFilters
        filters={filters}
        setFilters={setFilters}
        onSearch={handleSearch}
        onClear={clearFilters}
        resultCount={selectedRows.length}
      />

      <SummaryCards rows={selectedRows} />

      <AnalysisGroup
        title="Data quality"
        description="Check completeness and calibration coverage before interpreting results."
        defaultOpen
      >
        <div className="analysis-panel">
          <CalibrationQualityPanel rows={selectedRows} />
        </div>
      </AnalysisGroup>

      <AnalysisGroup
        title="Core analysis"
        description="Compare assemblages and examine community structure."
        defaultOpen
      >
        <div className="analysis-panel">
          <ModernAnalogueSearch rows={selectedRows} onSnapshotChange={setAnalogueSnapshot} />
        </div>
        <div className="analysis-panel">
          <CommunityNmds rows={selectedRows} onSnapshotChange={setNmdsSnapshot} />
        </div>
      </AnalysisGroup>

      <AnalysisGroup
        title="Reproducibility"
        description="Record the active dataset selection, methods, diagnostics, and results."
      >
        <div className="analysis-panel">
          <ReproducibilityPanel
            filters={filters}
            rows={selectedRows}
            analogueSnapshot={analogueSnapshot}
            nmdsSnapshot={nmdsSnapshot}
          />
        </div>
      </AnalysisGroup>

      <AnalysisGroup
        title="Exploratory visualization"
        description="Inspect taxon composition, environmental gradients, and geography."
      >
        <div className="analysis-panel">
        <h2>Taxa Composition</h2>

        <p>
          Genus-level taxa abundance for the currently
          filtered samples.
        </p>

        {taxaLoading ? (
          <p>Loading taxa composition...</p>
        ) : taxaRows.length === 0 ? (
          <p>No taxa data loaded for current selection.</p>
        ) : (
          <TaxaCompositionChart
            data={taxaRows}
            referenceData={allTaxaRows}
            rows={selectedRows}
            referenceRows={allRows}
          />
        )}
        </div>

      {bbox && (
        <div
          style={{
            border: "1px solid #333",
            borderRadius: "10px",
            padding: "15px",
            marginBottom: "20px",
          }}
        >
          <h3>Selected Region</h3>

          <p>
            Samples: {selectedRows.length}
          </p>

          <button onClick={clearRegion}>
            Clear Selection
          </button>
        </div>
      )}

      <div className="analysis-results-row">
        <h3>
          {selectedRows.length.toLocaleString()} Samples Found
        </h3>

        <DownloadCSV rows={selectedRows} />
      </div>

      <div className="analysis-panel">
        <h2>Environmental Explorer</h2>

        <p>
          Explore environmental relationships and geographic
          distribution of samples.
        </p>

        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "20px",
          }}
        >
          <button onClick={() => setShowMap(false)}>
            Scatter Plot
          </button>

          <button onClick={() => setShowMap(true)}>
            Map Explorer
          </button>
        </div>

        {showMap ? (
          <SiteMap
            rows={rows}
            onSiteSelect={setSelectedSite}
            onBoundsSelect={selectRegion}
          />
        ) : (
          <ViewportMount>
            <LinkedEnvironmentalExplorer rows={selectedRows} />
          </ViewportMount>
        )}
      </div>

      {selectedSite && (
        <div className="analysis-panel">
          <h2>Site Information</h2>

          <p><strong>Site Name:</strong> {selectedSite.sitename}</p>
          <p><strong>Dataset ID:</strong> {selectedSite.datasetid}</p>
          <p><strong>Site ID:</strong> {selectedSite.siteid}</p>
          <p><strong>pH:</strong> {selectedSite.pH}</p>
          <p><strong>Water Table Depth:</strong> {selectedSite.water_table_depth}</p>
          <p><strong>Altitude:</strong> {selectedSite.altitude}</p>
          <p><strong>Latitude:</strong> {selectedSite.latitude}</p>
          <p><strong>Longitude:</strong> {selectedSite.longitude}</p>
        </div>
      )}
      </AnalysisGroup>
    </div>
  );
}
