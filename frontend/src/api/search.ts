import axios from "axios";

const API =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export async function searchDatasets(params = {}) {
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(
      ([_, value]) =>
        value !== "" &&
        value !== null &&
        value !== undefined
    )
  );

  const response = await axios.get(`${API}/search`, {
    params: cleanParams,
  });

  return response.data;
}

export async function getPublicationOptions() {
  const response = await axios.get(`${API}/publication-options`);
  return response.data;
}
