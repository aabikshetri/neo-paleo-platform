import axios from "axios";

const API =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const searchRequests = new Map<string, Promise<any[]>>();
const selectionRequests = new Map<string, Promise<any[]>>();
let publicationRequest: Promise<any[]> | null = null;
let activeSearchController: AbortController | null = null;

export type SearchSummary = {
  samples: number;
  sites: number;
  mean_pH: number | null;
  mean_water_table_depth: number | null;
};

export type SearchPage = {
  rows: any[];
  total: number;
  page: number;
  page_size: number;
  selection_token: string;
  summary: SearchSummary;
};

export async function searchDatasets(params = {}) {
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(
      ([_, value]) =>
        value !== "" &&
        value !== null &&
        value !== undefined
    )
  );

  const key = new URLSearchParams(
    Object.entries(cleanParams).map(([name, value]) => [name, String(value)])
  ).toString();
  const existing = searchRequests.get(key);
  if (existing) return existing;

  if (searchRequests.size >= 20) searchRequests.clear();
  const request = axios.get(`${API}/search`, { params: cleanParams })
    .then((response) => response.data)
    .catch((error) => {
      searchRequests.delete(key);
      throw error;
    });
  searchRequests.set(key, request);
  return request;
}

export async function searchDatasetPage(params = {}, page = 1, pageSize = 250): Promise<SearchPage> {
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value != null)
  );
  const requestParams = { ...cleanParams, page, page_size: pageSize };
  activeSearchController?.abort();
  const controller = new AbortController();
  activeSearchController = controller;
  try {
    const response = await axios.get(`${API}/search-page`, {
      params: requestParams,
      signal: controller.signal,
    });
    return response.data;
  } finally {
    if (activeSearchController === controller) activeSearchController = null;
  }
}

export function isRequestCanceled(error: unknown) {
  return axios.isCancel(error);
}

export async function getSelectionRows(selectionToken: string): Promise<any[]> {
  const existing = selectionRequests.get(selectionToken);
  if (existing) return existing;
  if (selectionRequests.size >= 10) selectionRequests.clear();
  const request = axios.get(`${API}/selection/rows`, {
    params: { selection_token: selectionToken },
  }).then((response) => response.data).catch((error) => {
    selectionRequests.delete(selectionToken);
    throw error;
  });
  selectionRequests.set(selectionToken, request);
  return request;
}

export async function getPublicationOptions() {
  if (publicationRequest) return publicationRequest;
  publicationRequest = axios.get(`${API}/publication-options`)
    .then((response) => response.data)
    .catch((error) => {
      publicationRequest = null;
      throw error;
    });
  return publicationRequest;
}
