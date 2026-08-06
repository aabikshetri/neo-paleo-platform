"""Runtime data access for Neo.

PostgreSQL is used when DATABASE_URL is set. Processed CSV files remain a
development/migration fallback so the scientific API can be migrated without
changing all calculations at once.
"""

from __future__ import annotations

import json
import os
import atexit
import csv
import io
from collections import OrderedDict
from threading import Lock
from time import monotonic
from pathlib import Path

import pandas as pd

_pool = None
_query_cache = OrderedDict()
_query_cache_lock = Lock()
_query_cache_max = max(16, int(os.getenv("DATABASE_CACHE_SIZE", "64")))
_query_cache_ttl = max(1, int(os.getenv("DATABASE_CACHE_TTL_SECONDS", "120")))
_refresh_version = (0.0, None)


BASE_DIR = Path(__file__).resolve().parent
PROCESSED_DIR = BASE_DIR / "data" / "processed"
SEARCH_INDEX = PROCESSED_DIR / "testate_search_index.csv"
TAXA_INDEX = PROCESSED_DIR / "taxa_abundance.csv"
SITES_INDEX = PROCESSED_DIR / "testate_amoebae_surface_sites.csv"
PUBLICATIONS_INDEX = PROCESSED_DIR / "dataset_publications.csv"
METADATA_JSON = BASE_DIR.parent / "scripts" / "all_testate_amoebae_surface_samples.json"


def database_url() -> str | None:
    return os.getenv("DATABASE_URL")


def using_postgres() -> bool:
    return bool(database_url())


def _connect(url: str):
    try:
        import psycopg
    except ImportError as error:
        raise RuntimeError(
            "DATABASE_URL is set, but psycopg is not installed. "
            "Run: pip install -r backend/requirements.txt"
        ) from error
    return psycopg.connect(url)


def _connection():
    """Borrow a reusable PostgreSQL connection from the process-local pool."""
    global _pool
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    if _pool is None:
        try:
            from psycopg_pool import ConnectionPool
        except ImportError as error:
            raise RuntimeError(
                "PostgreSQL pooling is unavailable. Run: "
                "pip install -r backend/requirements.txt"
            ) from error
        _pool = ConnectionPool(
            conninfo=url,
            min_size=1,
            max_size=max(2, int(os.getenv("DATABASE_POOL_SIZE", "8"))),
            timeout=10,
            open=True,
        )
    return _pool.connection()


def close_database_pool():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


atexit.register(close_database_pool)


def _current_refresh_version():
    """Refresh-aware cache generation, checked at most once every five seconds."""
    global _refresh_version
    now = monotonic()
    if now - _refresh_version[0] < 5:
        return _refresh_version[1]
    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT MAX(refreshid) FROM data_refreshes")
            version = cursor.fetchone()[0]
    _refresh_version = (now, version)
    return version


def _cached(namespace: str, key: tuple, producer):
    cache_key = (namespace, _current_refresh_version(), key)
    now = monotonic()
    with _query_cache_lock:
        cached = _query_cache.get(cache_key)
        if cached and now - cached[0] <= _query_cache_ttl:
            _query_cache.move_to_end(cache_key)
            return cached[1]
        if cached:
            del _query_cache[cache_key]
    value = producer()
    with _query_cache_lock:
        _query_cache[cache_key] = (now, value)
        _query_cache.move_to_end(cache_key)
        while len(_query_cache) > _query_cache_max:
            _query_cache.popitem(last=False)
    return value


def _frame_from_cursor(cursor) -> pd.DataFrame:
    rows = cursor.fetchall()
    columns = [column.name for column in cursor.description]
    return pd.DataFrame(rows, columns=columns)


def load_from_postgres(url: str) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT datasetid, siteid, sitename, collectionunitid,
                       collectionunit, handle, datasettype, sampleid,
                       samplename, depth, altitude, geography, waterdepth_site,
                       ph AS "pH", ph_units AS "pH_units", water_table_depth,
                       water_table_depth_units, doi, investigators,
                       latitude, longitude
                FROM samples
                ORDER BY sampleid
                """
            )
            samples = _frame_from_cursor(cursor)

            cursor.execute(
                """
                SELECT datasetid, siteid, sitename, collectionunitid, handle,
                       sampleid, depth, taxonid, taxon_name, abundance, units,
                       taxongroup, ecologicalgroup, geography, altitude
                FROM taxon_abundances
                ORDER BY sampleid, taxon_name
                """
            )
            taxa = _frame_from_cursor(cursor)

            cursor.execute(
                """
                SELECT dp.datasetid, dp.publicationid,
                       dp.primarypub, p.year, p.citation, p.articletitle,
                       p.journal, p.volume, p.issue, p.pages, p.doi, p.url
                FROM dataset_publications dp
                JOIN publications p USING (publicationid)
                ORDER BY p.citation, dp.datasetid
                """
            )
            publications = _frame_from_cursor(cursor)

    return samples, taxa, publications


def search_postgres(
    *,
    ph_min=None,
    ph_max=None,
    water_min=None,
    water_max=None,
    lat_min=None,
    lat_max=None,
    lon_min=None,
    lon_max=None,
    site_contains=None,
    publicationid=None,
) -> list[dict]:
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    conditions = []
    parameters = []
    joins = ""
    if publicationid is not None:
        joins = "JOIN dataset_publications dp ON dp.datasetid = s.datasetid"
        conditions.append("dp.publicationid = %s")
        parameters.append(publicationid)
    filters = [
        ("s.ph >= %s", ph_min),
        ("s.ph <= %s", ph_max),
        ("s.water_table_depth >= %s", water_min),
        ("s.water_table_depth <= %s", water_max),
        ("s.latitude >= %s", lat_min),
        ("s.latitude <= %s", lat_max),
        ("s.longitude >= %s", lon_min),
        ("s.longitude <= %s", lon_max),
    ]
    for condition, value in filters:
        if value is not None:
            conditions.append(condition)
            parameters.append(value)
    if site_contains:
        conditions.append("s.sitename ILIKE %s")
        parameters.append(f"%{site_contains}%")
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = f"""
        SELECT DISTINCT s.datasetid, s.siteid, s.sitename, s.sampleid,
               s.ph AS "pH", s.water_table_depth, s.altitude,
               s.latitude, s.longitude, s.doi
        FROM samples s
        {joins}
        {where}
        ORDER BY s.sampleid
        LIMIT 5000
    """
    def run():
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, parameters)
                frame = _frame_from_cursor(cursor)
        frame = frame.astype(object).where(pd.notnull(frame), None)
        return frame.to_dict(orient="records")

    cache_key = (
        ph_min, ph_max, water_min, water_max, lat_min, lat_max,
        lon_min, lon_max, site_contains, publicationid,
    )
    return _cached("search", cache_key, run)


def publication_options_postgres() -> list[dict]:
    url = database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    def run():
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                """
                SELECT p.publicationid, p.citation, p.year, p.doi,
                       COUNT(DISTINCT s.sampleid)::INTEGER AS sample_count,
                       COUNT(DISTINCT s.sampleid) FILTER (
                           WHERE dp.primarypub IS TRUE
                       )::INTEGER AS primary_sample_count
                FROM publications p
                JOIN dataset_publications dp USING (publicationid)
                JOIN samples s ON s.datasetid = dp.datasetid
                GROUP BY p.publicationid, p.citation, p.year, p.doi
                ORDER BY LOWER(p.citation)
                """
                )
                frame = _frame_from_cursor(cursor)
        frame["filter_value"] = frame["publicationid"].map(
            lambda value: f"publication:{int(value)}"
        )
        frame = frame.astype(object).where(pd.notnull(frame), None)
        return frame.to_dict(orient="records")

    return _cached("publication_options", (), run)


def taxa_aggregate_postgres(sampleids: list[int]) -> list[dict]:
    if not sampleids:
        return []
    def run():
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                """
                WITH selected AS (
                    SELECT sampleid, lumped_taxon, percentage
                    FROM sample_taxon_profiles
                    WHERE sampleid = ANY(%s)
                ), sample_total AS (
                    SELECT COUNT(DISTINCT sampleid)::DOUBLE PRECISION AS count
                    FROM selected
                )
                SELECT lumped_taxon,
                       SUM(percentage) / sample_total.count AS percentage
                FROM selected CROSS JOIN sample_total
                GROUP BY lumped_taxon, sample_total.count
                ORDER BY percentage DESC, lumped_taxon
                """,
                    (sampleids,),
                )
                frame = _frame_from_cursor(cursor)
        if frame.empty:
            return []
        frame["percentage"] = frame["percentage"].astype(float)
        frame["abundance"] = frame["percentage"]
        return frame.to_dict(orient="records")

    return _cached("taxa_aggregate", tuple(sampleids), run)


def taxon_sample_values_postgres(sampleids: list[int], taxa: list[str]) -> list[dict]:
    if not sampleids or not taxa:
        return []
    def run():
        with _connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                """
                SELECT sampleid, lumped_taxon, percentage
                FROM sample_taxon_profiles
                WHERE sampleid = ANY(%s) AND lumped_taxon = ANY(%s)
                """,
                    (sampleids, taxa),
                )
                rows = cursor.fetchall()
        grouped = {}
        for sampleid, taxon, percentage in rows:
            grouped.setdefault(int(sampleid), {})[taxon] = float(percentage)
        return [
            {
                "sampleid": sampleid,
                "composition": [
                    {"lumped_taxon": taxon, "percentage": grouped.get(sampleid, {}).get(taxon, 0.0)}
                    for taxon in taxa
                ],
                "combined_percentage": sum(grouped.get(sampleid, {}).get(taxon, 0.0) for taxon in taxa),
            }
            for sampleid in sampleids
        ]

    return _cached("taxon_sample_values", (tuple(sampleids), tuple(taxa)), run)


def calibration_quality_postgres(sampleids: list[int]) -> dict:
    if not sampleids:
        return {}
    def run():
        with _connection() as connection:
          with connection.cursor() as cursor:
            cursor.execute(
                """
                WITH selected AS (
                    SELECT * FROM samples WHERE sampleid = ANY(%s)
                ), richness AS (
                    SELECT p.sampleid, COUNT(*)::INTEGER AS taxon_count
                    FROM sample_taxon_profiles p JOIN selected s USING (sampleid)
                    GROUP BY p.sampleid
                ), doi_tokens AS (
                    SELECT DISTINCT NULLIF(
                        regexp_replace(lower(btrim(token)),
                            '^(https?://doi\\.org/|doi:)', ''), ''
                    ) AS doi
                    FROM selected, LATERAL regexp_split_to_table(selected.doi, ';') token
                    WHERE selected.doi IS NOT NULL
                )
                SELECT COUNT(*)::INTEGER AS sample_count,
                       COUNT(DISTINCT siteid)::INTEGER AS site_count,
                       COUNT(DISTINCT datasetid)::INTEGER AS dataset_count,
                       COUNT(*) FILTER (WHERE doi IS NOT NULL)::INTEGER AS samples_with_doi,
                       (SELECT COUNT(*) FROM doi_tokens WHERE doi IS NOT NULL)::INTEGER AS unique_doi_count,
                       (SELECT COUNT(*) FROM richness)::INTEGER AS taxa_sample_count,
                       COUNT(*) FILTER (WHERE ph IS NULL)::INTEGER AS missing_ph,
                       COUNT(*) FILTER (WHERE water_table_depth IS NULL)::INTEGER AS missing_water_table,
                       COUNT(*) FILTER (WHERE doi IS NULL)::INTEGER AS missing_doi,
                       (SELECT COUNT(*) FROM richness WHERE taxon_count < 5)::INTEGER AS low_richness_samples,
                       (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY taxon_count) FROM richness) AS median_taxon_richness,
                       MIN(ph) AS ph_min, MAX(ph) AS ph_max,
                       MIN(water_table_depth) AS water_min, MAX(water_table_depth) AS water_max
                FROM selected
                """,
                (sampleids,),
            )
            row = cursor.fetchone()
            columns = [column.name for column in cursor.description]
            result = dict(zip(columns, row))
            cursor.execute(
                """
                SELECT DISTINCT btrim(water_table_depth_units) AS unit
                FROM samples
                WHERE sampleid = ANY(%s) AND water_table_depth_units IS NOT NULL
                ORDER BY unit
                """,
                (sampleids,),
            )
            units = [row[0] for row in cursor.fetchall()]
        sample_count = result["sample_count"]
        return {
            "sample_count": sample_count,
            "site_count": result["site_count"],
            "dataset_count": result["dataset_count"],
            "samples_with_doi": result["samples_with_doi"],
            "unique_doi_count": result["unique_doi_count"],
            "taxa_sample_count": result["taxa_sample_count"],
            "missing_taxa": sample_count - result["taxa_sample_count"],
            "missing_ph": result["missing_ph"],
            "missing_water_table": result["missing_water_table"],
            "missing_doi": result["missing_doi"],
            "low_richness_samples": result["low_richness_samples"],
            "median_taxon_richness": float(result["median_taxon_richness"]) if result["median_taxon_richness"] is not None else None,
            "ph_range": {"min": result["ph_min"], "max": result["ph_max"]},
            "water_table_range": {"min": result["water_min"], "max": result["water_max"]},
            "water_table_units": units,
        }

    return _cached("calibration_quality", tuple(sampleids), run)


CSV_METADATA_COLUMNS = [
    "sampleid", "datasetid", "siteid", "sitename", "collectionunit", "handle",
    "pH", "water_table_depth", "water_table_depth_units", "altitude", "doi",
]


def stream_taxa_csv_postgres(sampleids: list[int]):
    """Yield the existing wide export one row at a time instead of buffering it."""
    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT DISTINCT taxon_name
                FROM taxon_abundances
                WHERE sampleid = ANY(%s) AND abundance IS NOT NULL
                ORDER BY taxon_name
                """,
                (sampleids,),
            )
            taxa = [row[0] for row in cursor.fetchall()]

    header = CSV_METADATA_COLUMNS + [f"taxon_{name}_abundance" for name in taxa]
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    yield buffer.getvalue()

    with _connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT sampleid, datasetid, siteid, sitename, collectionunit,
                       handle, ph, water_table_depth, water_table_depth_units,
                       altitude, doi
                FROM samples
                WHERE sampleid = ANY(%s)
                ORDER BY sampleid
                """,
                (sampleids,),
            )
            metadata_rows = cursor.fetchall()
            cursor.execute(
                """
                SELECT sampleid, taxon_name, SUM(abundance)
                FROM taxon_abundances
                WHERE sampleid = ANY(%s) AND abundance IS NOT NULL
                GROUP BY sampleid, taxon_name
                ORDER BY sampleid, taxon_name
                """,
                (sampleids,),
            )
            abundance_rows = cursor.fetchall()

    abundance_by_sample = {}
    for sampleid, taxon, abundance in abundance_rows:
        abundance_by_sample.setdefault(int(sampleid), {})[taxon] = abundance
    for metadata in metadata_rows:
        sample_values = abundance_by_sample.get(int(metadata[0]), {})
        buffer = io.StringIO()
        writer = csv.writer(buffer, lineterminator="\n")
        writer.writerow([*metadata, *(sample_values.get(taxon, 0) for taxon in taxa)])
        yield buffer.getvalue()


def _investigator_frame() -> pd.DataFrame:
    if not METADATA_JSON.exists():
        return pd.DataFrame(columns=["datasetid", "investigators"])
    try:
        metadata_records = json.loads(METADATA_JSON.read_text())
        rows = []
        for response in metadata_records:
            for item in response.get("data", []):
                site = item.get("site", {})
                collection_unit = site.get("collectionunit", {})
                datasets = (
                    collection_unit.get("datasets", site.get("datasets", []))
                    if isinstance(collection_unit, dict)
                    else site.get("datasets", [])
                )
                for dataset in datasets:
                    names = [
                        person.get("contactname", "").strip()
                        for person in dataset.get("datasetpi", [])
                        if person.get("contactname")
                    ]
                    rows.append(
                        {
                            "datasetid": dataset.get("datasetid"),
                            "investigators": "; ".join(names),
                        }
                    )
        return pd.DataFrame(rows).drop_duplicates("datasetid")
    except (OSError, ValueError, TypeError):
        return pd.DataFrame(columns=["datasetid", "investigators"])


def load_from_csv() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    samples = pd.read_csv(SEARCH_INDEX)
    if SITES_INDEX.exists():
        dois = pd.read_csv(SITES_INDEX, usecols=["datasetid", "doi"])
        samples = samples.merge(
            dois.drop_duplicates("datasetid"), on="datasetid", how="left"
        )
    investigators = _investigator_frame()
    if not investigators.empty:
        samples = samples.merge(investigators, on="datasetid", how="left")
    if "investigators" not in samples:
        samples["investigators"] = None

    taxa = pd.read_csv(TAXA_INDEX)
    publications = (
        pd.read_csv(PUBLICATIONS_INDEX)
        if PUBLICATIONS_INDEX.exists()
        else pd.DataFrame(
            columns=["datasetid", "publicationid", "primarypub", "citation"]
        )
    )
    return samples, taxa, publications


def load_runtime_frames() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    url = database_url()
    if url:
        print("Loading Neo runtime data from PostgreSQL")
        return load_from_postgres(url)
    print("DATABASE_URL is not set; loading Neo runtime data from processed CSVs")
    return load_from_csv()
