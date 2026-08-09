import { lazy, Suspense, useEffect, useRef, useState } from "react";

import SearchFilters, { type SearchFilterState } from "../components/search/SearchFilters";
import SummaryCards from "../components/search/SummaryCards";
import DownloadCSV from "../components/search/DownloadCSV";

import ViewportMount from "../components/visualization/ViewportMount";
import CalibrationQualityPanel from "../components/analysis/CalibrationQualityPanel";

import { getSelectionRows, isRequestCanceled, searchDatasetPage, type SearchPage, type SearchSummary } from "../api/search";
import { getTaxaBySamples } from "../api/taxa";

// Keep mapping, plotting, and analysis libraries out of the initial page bundle.
// Each feature is downloaded only when the user opens or selects it.
const SiteMap = lazy(() => import("../components/visualization/SiteMap"));
const TaxaCompositionChart = lazy(() => import("../components/visualization/TaxaCompositionChart"));
const LinkedEnvironmentalExplorer = lazy(() => import("../components/visualization/LinkedEnvironmentalExplorer"));
const ModernAnalogueSearch = lazy(() => import("../components/analysis/ModernAnalogueSearch"));
const CommunityNmds = lazy(() => import("../components/analysis/CommunityNmds"));
const ReproducibilityPanel = lazy(() => import("../components/analysis/ReproducibilityPanel"));

function FeatureFallback() {
  return <p className="feature-loading">Loading visualization…</p>;
}

type AnalysisGroupProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};

function AnalysisGroup({
  title,
  description,
  children,
  defaultOpen = false,
  onOpenChange,
}: AnalysisGroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [hasOpened, setHasOpened] = useState(defaultOpen);

  return (
    <details
      className="analysis-group"
      open={isOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        setIsOpen(open);
        if (open) setHasOpened(true);
        onOpenChange?.(open);
      }}
    >
      <summary>
        <span>
          <strong>{title}</strong>
          <small>{description}</small>
        </span>
      </summary>
      {hasOpened && <div className="analysis-group__content">{children}</div>}
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
  const [taxaLoading, setTaxaLoading] = useState(false);
  const [explorationOpen, setExplorationOpen] = useState(false);
  const [analogueSnapshot, setAnalogueSnapshot] = useState<Record<string, unknown> | null>(null);
  const [nmdsSnapshot, setNmdsSnapshot] = useState<Record<string, unknown> | null>(null);
  const [selectionToken, setSelectionToken] = useState("");
  const [baselineSelectionToken, setBaselineSelectionToken] = useState("");
  const [resultTotal, setResultTotal] = useState(0);
  const [searchSummary, setSearchSummary] = useState<SearchSummary | null>(null);
  const activeSelectionRef = useRef("");

  const [filters, setFilters] = useState<SearchFilterState>({
    site_contains: "",
    ph_min: "",
    ph_max: "",
    water_min: "",
    water_max: "",
    publication_contains: "",
    lat_min: "",
    lat_max: "",
    lon_min: "",
    lon_max: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadTaxaForSelectedRows(rowsForTaxa: any[], token?: string | null) {
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
        "taxon",
        500,
        token,
      );

      setTaxaRows(data);
    } catch (err) {
      console.error(err);
      setTaxaRows([]);
    } finally {
      setTaxaLoading(false);
    }
  }

  function applySearchPage(data: SearchPage, isBaseline = false) {
    setRows(data.rows);
    setSelectedRows(data.rows);
    setSelectionToken(data.selection_token);
    activeSelectionRef.current = data.selection_token;
    setResultTotal(data.total);
    setSearchSummary(data.summary);
    if (isBaseline) setBaselineSelectionToken(data.selection_token);
  }

  async function loadData() {
    try {
      applySearchPage(await searchDatasetPage(), true);
    } catch (error) {
      if (!isRequestCanceled(error)) console.error(error);
    }
  }

  async function loadCompleteSelection(token = selectionToken) {
    if (!token) return [];
    const completeRows = await getSelectionRows(token);
    if (token === activeSelectionRef.current) {
      setRows(completeRows);
      setSelectedRows(completeRows);
    }
    return completeRows;
  }

  async function prepareExploration(token = selectionToken) {
    const completeRows = await loadCompleteSelection(token);
    const referenceRows = allRows.length
      ? allRows
      : await getSelectionRows(baselineSelectionToken || selectionToken);
    if (!allRows.length) setAllRows(referenceRows);
    await loadTaxaForSelectedRows(completeRows, token);
  }

  async function handleSearch() {
    let data: SearchPage;
    try {
      data = await searchDatasetPage(filters);
    } catch (error) {
      if (!isRequestCanceled(error)) console.error(error);
      return;
    }
    applySearchPage(data);
    setSelectedSite(null);
    setBbox(null);

    if (explorationOpen) await prepareExploration(data.selection_token);
  }

  async function clearFilters() {
    const emptyFilters = {
      site_contains: "",
      ph_min: "",
      ph_max: "",
      water_min: "",
      water_max: "",
      publication_contains: "",
      lat_min: "",
      lat_max: "",
      lon_min: "",
      lon_max: "",
    };
    setFilters(emptyFilters);
    let data: SearchPage;
    try {
      data = await searchDatasetPage(emptyFilters);
    } catch (error) {
      if (!isRequestCanceled(error)) console.error(error);
      return;
    }
    applySearchPage(data);
    setSelectedSite(null);
    setBbox(null);
    if (explorationOpen) await prepareExploration(data.selection_token);
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
    if (explorationOpen) loadTaxaForSelectedRows(filtered);
  }

  function clearRegion() {
    setSelectedRows(rows);
    setBbox(null);
    if (explorationOpen) loadTaxaForSelectedRows(rows);
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
        resultCount={bbox ? selectedRows.length : resultTotal}
        downloadControl={<DownloadCSV rows={selectedRows} selectionToken={bbox ? null : selectionToken} />}
      />

      <AnalysisGroup
        title="Summary statistics of filtered dataset"
        description=""
        defaultOpen
      >
        <div className="analysis-panel">
          <CalibrationQualityPanel rows={selectedRows} selectionToken={bbox ? null : selectionToken} />
        </div>
      </AnalysisGroup>

      <SummaryCards rows={selectedRows} summary={bbox ? null : searchSummary} />

      <AnalysisGroup
        title="Exploratory visualization"
        description="Inspect community composition, environmental gradients, and geography."
        onOpenChange={(open) => {
          setExplorationOpen(open);
          if (open && taxaRows.length === 0 && !taxaLoading) {
            prepareExploration();
          }
        }}
      >
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

      <div className="analysis-panel">
        <h2>Geographic distribution and environmental gradients</h2>

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
        <p style={{ opacity: 0.72 }}>
          Use the scatter plot to click a sample, or switch to Map Explorer and click a map marker to display its information.
        </p>

        {showMap ? (
          <Suspense fallback={<FeatureFallback />}>
            <SiteMap
              rows={rows}
              onSiteSelect={setSelectedSite}
              onBoundsSelect={selectRegion}
            />
          </Suspense>
        ) : (
          <ViewportMount>
            <Suspense fallback={<FeatureFallback />}>
              <LinkedEnvironmentalExplorer
                rows={selectedRows}
                onSampleSelect={setSelectedSite}
                selectionToken={bbox ? null : selectionToken}
              />
            </Suspense>
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

      <div className="analysis-panel">
        <h2>Multi-taxon visualization</h2>

        <p>Taxa abundance along environmental gradients.</p>

        {taxaLoading ? (
          <p>Loading taxa composition...</p>
        ) : taxaRows.length === 0 ? (
          <p>No taxa data loaded for current selection.</p>
        ) : (
          <Suspense fallback={<FeatureFallback />}>
            <TaxaCompositionChart
              data={taxaRows}
              rows={selectedRows}
              referenceRows={allRows}
              selectionToken={bbox ? null : selectionToken}
            />
          </Suspense>
        )}
      </div>
      </AnalysisGroup>

      <AnalysisGroup
        title="Analyses (in development)"
        description="Compare assemblages and examine community structure."
        onOpenChange={(open) => { if (open) loadCompleteSelection(); }}
      >
        <div className="analysis-panel">
          <Suspense fallback={<FeatureFallback />}>
            <ModernAnalogueSearch rows={selectedRows} selectionToken={bbox ? null : selectionToken} onSnapshotChange={setAnalogueSnapshot} />
          </Suspense>
        </div>
        <div className="analysis-panel">
          <Suspense fallback={<FeatureFallback />}>
            <CommunityNmds rows={selectedRows} selectionToken={bbox ? null : selectionToken} onSnapshotChange={setNmdsSnapshot} />
          </Suspense>
        </div>
      </AnalysisGroup>

      <AnalysisGroup
        title="Reproducibility"
        description="Record the active dataset selection, methods, diagnostics, and results."
        onOpenChange={(open) => { if (open) loadCompleteSelection(); }}
      >
        <div className="analysis-panel">
          <Suspense fallback={<FeatureFallback />}>
            <ReproducibilityPanel
              filters={filters}
              rows={selectedRows}
              analogueSnapshot={analogueSnapshot}
              nmdsSnapshot={nmdsSnapshot}
            />
          </Suspense>
        </div>
      </AnalysisGroup>
    </div>
  );
}
