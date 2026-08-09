"""Stable repository interface over the existing optimized data layer.

The compatibility module ``backend.database`` retains the proven SQL, cache,
pool, streaming export, and CSV fallback implementations. API code imports
through this boundary so those implementations can be split internally later
without affecting handlers or scientific services.
"""

from backend.database import (
    calibration_quality_postgres,
    load_runtime_frames,
    publication_options_postgres,
    search_postgres,
    search_page_postgres,
    stream_taxa_csv_postgres,
    taxa_aggregate_postgres,
    taxon_sample_values_postgres,
    using_postgres,
)

__all__ = [
    "calibration_quality_postgres",
    "load_runtime_frames",
    "publication_options_postgres",
    "search_postgres",
    "search_page_postgres",
    "stream_taxa_csv_postgres",
    "taxa_aggregate_postgres",
    "taxon_sample_values_postgres",
    "using_postgres",
]
