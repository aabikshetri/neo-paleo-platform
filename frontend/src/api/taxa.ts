import axios from "axios";

const API =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000";

export type TaxaSampleProfile = {
  sampleid: number;
  dominant_genus: string;
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
  median_genus_richness: number | null;
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
  shared_genera: string[];
  composition: Array<{ lumped_taxon: string; percentage: number }>;
};

export type AnalogueResult = {
  target_sampleid?: number;
  candidate_count?: number;
  excluded_candidate_count?: number;
  exclude_same_site?: boolean;
  exclude_same_doi?: boolean;
  method?: string;
  target_composition?: Array<{ lumped_taxon: string; percentage: number }>;
  error?: string;
  matches: AnalogueMatch[];
};

const profileRequests = new Map<string, Promise<TaxaSampleProfile[]>>();

export async function getTaxaBySamples(
  sampleids: number[],
  level = "genus",
  limit = 25
) {
  const response = await axios.post(`${API}/taxa/aggregate`, {
    sampleids,
    level,
    limit,
  });

  return response.data;
}

export async function getTaxaCompositionBySample(
  sampleids: Array<number | string>,
  level = "genus",
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
  limit = 8
): Promise<TaxaSampleProfile[]> {
  const ids = Array.from(new Set(sampleids)).sort((a, b) => a - b);
  const key = `${limit}:${ids.join(",")}`;
  const existing = profileRequests.get(key);
  if (existing) return existing;

  if (profileRequests.size >= 20) profileRequests.clear();
  const request = axios.post(`${API}/taxa/sample-profiles`, {
    sampleids: ids,
    level: "genus",
    limit,
  }).then((response) => response.data).catch((error) => {
    profileRequests.delete(key);
    throw error;
  });
  profileRequests.set(key, request);
  return request;
}

export async function getCalibrationQuality(
  sampleids: number[]
): Promise<CalibrationQuality> {
  const response = await axios.post(`${API}/calibration/quality`, { sampleids });
  return response.data;
}

export async function findModernAnalogues(
  targetSampleid: number,
  calibrationSampleids: number[],
  limit = 10,
  excludeSameSite = true,
  excludeSameDoi = true
): Promise<AnalogueResult> {
  const response = await axios.post(`${API}/calibration/modern-analogues`, {
    target_sampleid: targetSampleid,
    calibration_sampleids: calibrationSampleids,
    limit,
    exclude_same_site: excludeSameSite,
    exclude_same_doi: excludeSameDoi,
  });
  return response.data;
}
