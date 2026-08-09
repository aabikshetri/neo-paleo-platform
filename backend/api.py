"""Backward-compatible API entry point.

Deployments may continue using ``backend.api:app`` while implementation lives
in the application factory, routers, schemas, runtime, and service modules.
"""

from backend.main import app
from backend.handlers.explorer import health, search
from backend.services.scientific import (
    build_summary,
    build_taxon_profiles,
    doi_tokens,
    get_lon_lat,
    limit_taxa_groups,
    lump_taxon_name,
    normalize_doi,
    run_environmental_pca,
)

__all__ = [
    "app",
    "health",
    "search",
    "build_summary",
    "build_taxon_profiles",
    "doi_tokens",
    "get_lon_lat",
    "limit_taxa_groups",
    "lump_taxon_name",
    "normalize_doi",
    "run_environmental_pca",
]
