import axios from "axios";

const API =
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000";

export async function getTaxaBySamples(
  sampleids: number[],
  level = "genus",
  limit = 25
) {
  const response = await axios.get(
    `${API}/taxa/by-samples`,
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

export async function getTaxaSampleProfiles(sampleids: number[], limit = 8) {
  const response = await axios.post(`${API}/taxa/sample-profiles`, {
    sampleids,
    level: "genus",
    limit,
  });

  return response.data;
}
