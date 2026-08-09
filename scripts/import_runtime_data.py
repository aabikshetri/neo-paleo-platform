"""Replace Neo's PostgreSQL runtime tables with the processed local dataset."""

from __future__ import annotations

import math
import os
from pathlib import Path
import sys
import json

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.database import (
    PUBLICATIONS_INDEX,
    SEARCH_INDEX,
    SITES_INDEX,
    TAXA_INDEX,
    _investigator_frame,
)


SCHEMA = PROJECT_ROOT / "backend" / "schema.sql"


def clean(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, float) and math.isnan(value):
        return None
    return value.item() if hasattr(value, "item") else value


def copy_frame(connection, table: str, columns: list[str], frame: pd.DataFrame):
    column_sql = ", ".join(columns)
    with connection.cursor() as cursor:
        with cursor.copy(f"COPY {table} ({column_sql}) FROM STDIN") as copy:
            for row in frame[columns].itertuples(index=False, name=None):
                copy.write_row(tuple(clean(value) for value in row))


def load_samples() -> pd.DataFrame:
    samples = pd.read_csv(SEARCH_INDEX)
    dois = pd.read_csv(SITES_INDEX, usecols=["datasetid", "doi"])
    samples = samples.merge(
        dois.drop_duplicates("datasetid"), on="datasetid", how="left"
    )
    investigators = _investigator_frame()
    if not investigators.empty:
        samples = samples.merge(investigators, on="datasetid", how="left")
    if "investigators" not in samples:
        samples["investigators"] = None
    coordinates = samples["geography"].map(parse_coordinates)
    samples["longitude"] = coordinates.map(lambda value: value[0])
    samples["latitude"] = coordinates.map(lambda value: value[1])
    samples["pH"] = pd.to_numeric(samples["pH"], errors="coerce")
    samples["water_table_depth"] = pd.to_numeric(
        samples["water_table_depth"], errors="coerce"
    )
    samples.loc[(samples["pH"] < 0) | (samples["pH"] > 14), "pH"] = pd.NA
    samples.loc[
        samples["water_table_depth"] <= -90, "water_table_depth"
    ] = pd.NA
    return samples.rename(columns={"pH": "ph", "pH_units": "ph_units"})


def parse_coordinates(geography):
    try:
        value = json.loads(geography)
        if value["type"] == "Point":
            longitude, latitude = value["coordinates"]
            return longitude, latitude
        if value["type"] == "Polygon":
            ring = value["coordinates"][0]
            return (
                sum(point[0] for point in ring) / len(ring),
                sum(point[1] for point in ring) / len(ring),
            )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        pass
    return None, None


def main():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL must be set before importing data")
    try:
        import psycopg
    except ImportError as error:
        raise SystemExit(
            "psycopg is required. Run: pip install -r backend/requirements.txt"
        ) from error

    samples = load_samples()
    taxa = pd.read_csv(TAXA_INDEX)
    taxa = taxa[taxa["sampleid"].isin(set(samples["sampleid"]))].copy()
    relationships = pd.read_csv(PUBLICATIONS_INDEX)
    publication_columns = [
        "publicationid", "year", "citation", "articletitle", "journal",
        "volume", "issue", "pages", "doi", "url",
    ]
    publications = relationships[publication_columns].drop_duplicates(
        "publicationid"
    )
    publications["year"] = pd.to_numeric(
        publications["year"], errors="coerce"
    ).astype("Int64")
    dataset_publications = relationships[
        ["datasetid", "publicationid", "primarypub"]
    ].drop_duplicates()

    sample_columns = [
        "sampleid", "datasetid", "siteid", "sitename", "collectionunitid",
        "collectionunit", "handle", "datasettype", "samplename", "depth",
        "altitude", "geography", "latitude", "longitude", "waterdepth_site",
        "ph", "ph_units",
        "water_table_depth", "water_table_depth_units", "doi", "investigators",
    ]
    taxa_columns = [
        "datasetid", "siteid", "sitename", "collectionunitid", "handle",
        "sampleid", "depth", "taxonid", "taxon_name", "abundance", "units",
        "taxongroup", "ecologicalgroup", "geography", "altitude",
    ]

    with psycopg.connect(database_url) as connection:
        with connection.cursor() as cursor:
            cursor.execute(SCHEMA.read_text())
            cursor.execute(
                "TRUNCATE sample_taxon_profiles, taxon_abundances, dataset_publications, publications, "
                "samples RESTART IDENTITY CASCADE"
            )
        copy_frame(connection, "samples", sample_columns, samples)
        copy_frame(connection, "taxon_abundances", taxa_columns, taxa)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO sample_taxon_profiles (sampleid, lumped_taxon, percentage)
                SELECT sampleid,
                       CASE WHEN btrim(taxon_name) = '' THEN 'Unknown'
                            ELSE btrim(taxon_name) END AS lumped_taxon,
                       SUM(abundance) / MAX(sample_total) * 100.0
                FROM (
                    SELECT sampleid, taxon_name, abundance,
                           SUM(abundance) OVER (PARTITION BY sampleid) AS sample_total
                    FROM taxon_abundances
                    WHERE abundance IS NOT NULL AND abundance > 0
                      AND taxon_name IS NOT NULL
                ) normalized
                GROUP BY sampleid,
                         CASE WHEN btrim(taxon_name) = '' THEN 'Unknown'
                              ELSE btrim(taxon_name) END
                """
            )
        copy_frame(connection, "publications", publication_columns, publications)
        copy_frame(
            connection,
            "dataset_publications",
            ["datasetid", "publicationid", "primarypub"],
            dataset_publications,
        )
        with connection.cursor() as cursor:
            cursor.execute("REFRESH MATERIALIZED VIEW publication_sample_summary")
            cursor.execute("REFRESH MATERIALIZED VIEW sample_coverage_summary")
            cursor.execute(
                """
                INSERT INTO data_refreshes (
                    source, sample_count, taxon_observation_count,
                    publication_count, notes
                ) VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    "Neotoma processed runtime import",
                    len(samples),
                    len(taxa),
                    len(publications),
                    "Imported by scripts/import_runtime_data.py",
                ),
            )

    print(f"Imported {len(samples):,} samples")
    print(f"Imported {len(taxa):,} taxon observations")
    print(f"Imported {len(publications):,} publications")
    print(f"Imported {len(dataset_publications):,} publication links")


if __name__ == "__main__":
    main()
