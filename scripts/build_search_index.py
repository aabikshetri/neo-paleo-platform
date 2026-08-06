# neotoma_build_index.py

import json
import time
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from tqdm import tqdm


BASE = "https://api.neotomadb.org/v2.0"

DATASET_LIST = Path("data/processed/testate_amoebae_surface_sites.csv")
RAW_DIR = Path("data/raw/downloads")
OUT_DIR = Path("data/processed")

SEARCH_INDEX_OUT = OUT_DIR / "testate_search_index.csv"
FAILED_OUT = OUT_DIR / "failed_downloads.csv"

RAW_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_WORKERS = 4

TARGETS = {
    "ph": "pH",
    "water table depth": "water_table_depth",
}

thread_local = threading.local()


def get_session():
    if not hasattr(thread_local, "session"):
        session = requests.Session()

        retry = Retry(
            total=2,
            backoff_factor=1,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["GET"],
        )

        adapter = HTTPAdapter(
            pool_connections=20,
            pool_maxsize=20,
            max_retries=retry,
        )

        session.mount("https://", adapter)
        session.mount("http://", adapter)

        session.headers.update({
            "User-Agent": "Mozilla/5.0"
        })

        thread_local.session = session

    return thread_local.session


def load_dataset_ids():
    df = pd.read_csv(DATASET_LIST)

    ids = (
        df["datasetid"]
        .dropna()
        .astype(int)
        .drop_duplicates()
        .tolist()
    )

    return ids


def cache_path(datasetid):
    return RAW_DIR / f"{datasetid}.json"


def fetch_download(datasetid, retries=2):
    path = cache_path(datasetid)

    if path.exists():
        return True

    url = f"{BASE}/data/downloads/{datasetid}"
    session = get_session()

    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, timeout=(5, 30))

            if r.status_code == 200:
                js = r.json()

                path.write_text(
                    json.dumps(js, separators=(",", ":"))
                )

                return True

            print(f"{datasetid}: status {r.status_code}, attempt {attempt}")

        except Exception as e:
            print(f"{datasetid}: {e}, attempt {attempt}")

        time.sleep(1.5 * attempt)

    return False


def download_missing_jsons(ids):
    ids_to_fetch = [
        dsid for dsid in ids
        if not cache_path(dsid).exists()
    ]

    print("total datasets:", len(ids))
    print("already cached:", len(ids) - len(ids_to_fetch))
    print("remaining to fetch:", len(ids_to_fetch))

    failed = []

    if not ids_to_fetch:
        return failed

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_download, dsid): dsid
            for dsid in ids_to_fetch
        }

        for future in tqdm(as_completed(futures), total=len(futures)):
            dsid = futures[future]

            try:
                ok = future.result()

                if not ok:
                    failed.append(dsid)

            except Exception as e:
                print(f"{dsid}: future failed: {e}")
                failed.append(dsid)

    return failed


def extract_from_json(js):
    rows = []

    for item in js.get("data", []):
        site = item.get("site", {})
        cu = site.get("collectionunit", {})
        dataset = cu.get("dataset", site.get("dataset", {}))

        for sample in dataset.get("samples", []):
            row = {
                "datasetid": dataset.get("datasetid"),
                "siteid": site.get("siteid"),
                "sitename": site.get("sitename"),
                "collectionunitid": cu.get("collectionunitid"),
                "collectionunit": cu.get("collectionunit"),
                "handle": cu.get("handle"),
                "datasettype": dataset.get("datasettype"),
                "sampleid": sample.get("sampleid"),
                "samplename": sample.get("samplename"),
                "depth": sample.get("depth"),
                "altitude": site.get("altitude"),
                "geography": site.get("geography"),
                "waterdepth_site": cu.get("waterdepth"),
            }

            for datum in sample.get("datum", []):
                name = str(datum.get("variablename", "")).strip().lower()

                if name in TARGETS:
                    clean_name = TARGETS[name]
                    row[clean_name] = datum.get("value")
                    row[clean_name + "_units"] = datum.get("units")

            if "pH" in row or "water_table_depth" in row:
                rows.append(row)

    return rows


def build_search_index_from_cache():
    json_files = list(RAW_DIR.glob("*.json"))

    print("cached json files:", len(json_files))

    all_rows = []
    bad_jsons = []

    for path in tqdm(json_files):
        try:
            js = json.loads(path.read_text())
            rows = extract_from_json(js)
            all_rows.extend(rows)

        except Exception as e:
            print(f"bad json {path.name}: {e}")
            bad_jsons.append(path.name)

    df = pd.DataFrame(all_rows)

    for col in ["pH", "water_table_depth", "depth", "waterdepth_site", "altitude"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df.to_csv(SEARCH_INDEX_OUT, index=False)

    print("\nSEARCH INDEX BUILT")
    print("rows:", len(df))
    print("saved:", SEARCH_INDEX_OUT)

    if len(df):
        print(df.head())

        if "pH" in df.columns and "water_table_depth" in df.columns:
            print(df[["pH", "water_table_depth"]].describe())

            matched = df[
                (df["pH"] < 5) &
                (df["water_table_depth"] > 10)
            ]

            match_out = OUT_DIR / "ph_lt5_water_gt10.csv"
            matched.to_csv(match_out, index=False)

            print("\nquery: pH < 5 and water_table_depth > 10")
            print("matches:", len(matched))
            print("saved:", match_out)

    if bad_jsons:
        bad_out = OUT_DIR / "bad_json_files.csv"
        pd.DataFrame({"file": bad_jsons}).to_csv(bad_out, index=False)
        print("bad json files:", len(bad_jsons))
        print("saved:", bad_out)

    return df


def main():
    ids = load_dataset_ids()

    failed = download_missing_jsons(ids)

    pd.DataFrame({"datasetid": failed}).to_csv(
        FAILED_OUT,
        index=False
    )

    print("failed downloads:", len(failed))
    print("saved:", FAILED_OUT)

    build_search_index_from_cache()


if __name__ == "__main__":
    main()