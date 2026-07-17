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
