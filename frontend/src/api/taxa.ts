import axios from "axios";

const API =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000";

export type TaxaSampleProfile = {
  sampleid: number;
  dominant_taxon: string;
  composition: Array<{
    lumped_taxon: string;
    percentage: number;
    abundance?: number;
  }>;
};

export type CalibrationQuality = {
  sample_count: number;
  site_count: number;
  dataset_count?: number;
  samples_with_doi?: number;
  unique_doi_count?: number;
  publication_count?: number;
  taxa_sample_count: number;
  missing_taxa: number;
  missing_ph: number;
  missing_water_table: number;
  missing_doi: number;
  low_richness_samples: number;
  median_taxon_richness: number | null;
  ph_range: { min: number | null; max: number | null };
  water_table_range: { min: number | null; max: number | null };
  water_table_units: string[];
};

export type AnalogueMatch = {
  sampleid: number;
  bray_curtis: number;
  analogue_class: "close" | "possible" | "poor";
  sitename?: string | null;
  datasetid?: number | null;
  doi?: string | null;
  pH?: number | null;
  water_table_depth?: number | null;
  water_table_depth_units?: string | null;
  delta_pH?: number | null;
  delta_water_table_depth?: number | null;
  shared_taxa: string[];
  composition: Array<{ lumped_taxon: string; percentage: number }>;
};

export type AnalogueResult = {
  target_sampleid?: number;
  candidate_count?: number;
  excluded_candidate_count?: number;
  exclude_same_site?: boolean;
  exclude_same_doi?: boolean;
  method?: string;
  target_environment?: {
    pH?: number | null;
    water_table_depth?: number | null;
    water_table_depth_units?: string | null;
  };
  target_composition?: Array<{ lumped_taxon: string; percentage: number }>;
  error?: string;
  matches: AnalogueMatch[];
};

export type NmdsPoint = {
  sampleid: number;
  nmds1: number;
  nmds2: number;
  nmds3?: number | null;
  sitename?: string | null;
  pH?: number | null;
  water_table_depth?: number | null;
  dominant_taxon: string;
  highlight?: "target" | "analogue" | null;
};

export type NmdsResult = {
  error?: string;
  method?: string;
  dimensions?: number;
  stress?: number;
  stress_kind?: string;
  iterations?: number;
  converged?: boolean;
  sample_count?: number;
  taxon_count?: number;
  removed_taxon_count?: number;
  sampled?: boolean;
  available_sample_count?: number;
  prevalence?: number;
  random_seed?: number;
  n_init?: number;
  sampling_method?: string;
  stress_by_dimension?: Record<string, number>;
  target_sampleid?: number | null;
  shepard?: {
    bray_curtis: number[];
    ordination_distance: number[];
    monotonic_disparity: number[];
  };
  renormalized_after_filtering?: boolean;
  sensitivity?: {
    initializations: Array<{
      random_seed: number;
      stress: number;
      procrustes_disparity: number;
    }>;
    prevalence: Array<{
      prevalence: number;
      taxon_count: number;
      sample_count: number;
      distance_spearman: number | null;
    }>;
  };
  points: NmdsPoint[];
};

const profileRequests = new Map<string, Promise<TaxaSampleProfile[]>>();
const taxonValueRequests = new Map<string, Promise<TaxonSampleValue[]>>();
const aggregateRequests = new Map<string, Promise<any[]>>();
const qualityRequests = new Map<string, Promise<CalibrationQuality>>();

function selectionPayload(sampleids: number[], selectionToken?: string | null) {
  return selectionToken
    ? { selection_token: selectionToken }
    : { sampleids: Array.from(new Set(sampleids)).sort((a, b) => a - b) };
}

export async function getTaxaBySamples(
  sampleids: number[],
  level = "taxon",
  limit = 500,
  selectionToken?: string | null,
) {
  const ids = Array.from(new Set(sampleids)).sort((a, b) => a - b);
  const key = `${level}:${limit}:${selectionToken ?? ids.join(",")}`;
  const existing = aggregateRequests.get(key);
  if (existing) return existing;

  if (aggregateRequests.size >= 20) aggregateRequests.clear();
  const request = axios.post(`${API}/taxa/aggregate`, {
    ...selectionPayload(ids, selectionToken),
    level,
    limit,
  }).then((response) => response.data).catch((error) => {
    aggregateRequests.delete(key);
    throw error;
  });
  aggregateRequests.set(key, request);
  return request;
}

export async function getTaxaCompositionBySample(
  sampleids: Array<number | string>,
  level = "taxon",
  limit = 8
) {
  const response = await axios.get(
    `${API}/taxa/composition-by-samples`,
    {
      params: {
        sampleids: sampleids.join(","),
        level,
        limit,
      },
    }
  );

  return response.data;
}

export async function getTaxaSampleProfiles(
  sampleids: number[],
  limit = 8,
  selectionToken?: string | null,
): Promise<TaxaSampleProfile[]> {
  const ids = Array.from(new Set(sampleids)).sort((a, b) => a - b);
  const key = `${limit}:${selectionToken ?? ids.join(",")}`;
  const existing = profileRequests.get(key);
  if (existing) return existing;

  if (profileRequests.size >= 20) profileRequests.clear();
  const request = axios.post(`${API}/taxa/sample-profiles`, {
    ...selectionPayload(ids, selectionToken),
    level: "taxon",
    limit,
  }).then((response) => response.data).catch((error) => {
    profileRequests.delete(key);
    throw error;
  });
  profileRequests.set(key, request);
  return request;
}

export type TaxonSampleValue = {
  sampleid: number;
  combined_percentage: number;
  composition: Array<{ lumped_taxon: string; percentage: number }>;
};

export async function getTaxonSampleValues(
  sampleids: number[],
  taxa: string[],
  selectionToken?: string | null,
): Promise<TaxonSampleValue[]> {
  const ids = Array.from(new Set(sampleids)).sort((a, b) => a - b);
  const selectedTaxa = Array.from(new Set(taxa));
  const key = `${selectionToken ?? ids.join(",")}|${selectedTaxa.join("|")}`;
  const existing = taxonValueRequests.get(key);
  if (existing) return existing;

  if (taxonValueRequests.size >= 20) taxonValueRequests.clear();
  const request = axios.post(`${API}/taxa/sample-values`, {
    ...selectionPayload(ids, selectionToken),
    taxa: selectedTaxa,
  }).then((response) => response.data).catch((error) => {
    taxonValueRequests.delete(key);
    throw error;
  });
  taxonValueRequests.set(key, request);
  return request;
}

export async function downloadFilteredTaxaCsv(sampleids: number[], selectionToken?: string | null) {
  const response = await axios.post(
    `${API}/export/taxa-csv`,
    selectionPayload(sampleids, selectionToken),
    { responseType: "blob" }
  );
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = "neotoma_testate_amoebae_filtered_taxa.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export async function getCalibrationQuality(
  sampleids: number[],
  selectionToken?: string | null,
): Promise<CalibrationQuality> {
  const ids = Array.from(new Set(sampleids)).sort((a, b) => a - b);
  const key = selectionToken ?? ids.join(",");
  const existing = qualityRequests.get(key);
  if (existing) return existing;

  if (qualityRequests.size >= 20) qualityRequests.clear();
  const request = axios.post(`${API}/calibration/quality`, selectionPayload(ids, selectionToken))
    .then((response) => response.data)
    .catch((error) => {
      qualityRequests.delete(key);
      throw error;
    });
  qualityRequests.set(key, request);
  return request;
}

export async function findModernAnalogues(
  targetSampleid: number,
  calibrationSampleids: number[],
  limit = 10,
  excludeSameSite = true,
  excludeSameDoi = true,
  selectionToken?: string | null,
): Promise<AnalogueResult> {
  const response = await axios.post(`${API}/jobs/modern-analogues`, {
    target_sampleid: targetSampleid,
    ...(selectionToken
      ? { selection_token: selectionToken }
      : { calibration_sampleids: calibrationSampleids }),
    limit,
    exclude_same_site: excludeSameSite,
    exclude_same_doi: excludeSameDoi,
  });
  return awaitAnalysisJob<AnalogueResult>(response.data);
}

async function awaitAnalysisJob<T>(submission: any): Promise<T> {
  if (submission.status === "complete") return submission.result;
  const jobId = submission.job_id;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const status = await axios.get(`${API}/jobs/${jobId}`);
    if (status.data.status === "complete") return status.data.result;
    if (status.data.status === "failed") throw new Error(status.data.detail || "Analysis job failed");
    if (status.data.status === "not_found") throw new Error("Analysis job expired or was not found");
  }
  throw new Error("Analysis job did not finish within two minutes");
}

export async function runNmds(
  sampleids: number[],
  settings: {
    maxSamples: number;
    prevalence: number;
    randomSeed: number;
    nInit: number;
    dimensions: number;
    targetSampleid?: number | null;
    runSensitivity: boolean;
  },
  selectionToken?: string | null,
): Promise<NmdsResult> {
  const response = await axios.post(`${API}/jobs/nmds`, {
    ...selectionPayload(sampleids, selectionToken),
    max_samples: settings.maxSamples,
    prevalence: settings.prevalence,
    random_seed: settings.randomSeed,
    n_init: settings.nInit,
    dimensions: settings.dimensions,
    target_sampleid: settings.targetSampleid,
    run_sensitivity: settings.runSensitivity,
  });
  return awaitAnalysisJob<NmdsResult>(response.data);
}
