"""Unit tests for the amoeba-only scientific API helpers.

These tests use only the Python standard-library test runner. They intentionally
exercise pure transformations and the CSV fallback, not a live PostgreSQL
instance.
"""

import math
import os
import unittest

import pandas as pd

os.environ.pop("DATABASE_URL", None)

from backend import api


class DoiTests(unittest.TestCase):
    def test_normalize_doi_removes_known_prefixes(self):
        self.assertEqual(api.normalize_doi(" HTTPS://DOI.ORG/10.1000/ABC "), "10.1000/abc")
        self.assertEqual(api.normalize_doi("doi:10.1000/ABC"), "10.1000/abc")

    def test_normalize_doi_handles_missing_values(self):
        self.assertIsNone(api.normalize_doi(None))
        self.assertIsNone(api.normalize_doi(float("nan")))
        self.assertIsNone(api.normalize_doi("  "))

    def test_doi_tokens_split_and_deduplicate(self):
        self.assertEqual(
            api.doi_tokens("doi:10/a; https://doi.org/10/B;10/a"),
            {"10/a", "10/b"},
        )


class GeographyTests(unittest.TestCase):
    def test_point_returns_longitude_then_latitude(self):
        self.assertEqual(
            api.get_lon_lat('{"type":"Point","coordinates":[-71.5,42.3]}'),
            (-71.5, 42.3),
        )

    def test_polygon_returns_vertex_mean(self):
        geometry = '{"type":"Polygon","coordinates":[[[0,0],[2,0],[2,2],[0,2]]]}'
        self.assertEqual(api.get_lon_lat(geometry), (1.0, 1.0))

    def test_invalid_geography_is_nonfatal(self):
        self.assertEqual(api.get_lon_lat("not-json"), (None, None))


class TaxonProfileTests(unittest.TestCase):
    def test_taxon_name_lumping(self):
        self.assertEqual(api.lump_taxon_name("  Arcella vulgaris  ", "genus"), "Arcella")
        self.assertEqual(api.lump_taxon_name("Arcella vulgaris", "taxon"), "Arcella vulgaris")
        self.assertEqual(api.lump_taxon_name(None), "Unknown")

    def test_profiles_ignore_nonpositive_and_invalid_abundances(self):
        source = pd.DataFrame([
            {"sampleid": 1, "taxon_name": "Arcella vulgaris", "abundance": 10},
            {"sampleid": 1, "taxon_name": "Arcella vulgaris", "abundance": 5},
            {"sampleid": 1, "taxon_name": "Centropyxis aculeata", "abundance": 15},
            {"sampleid": 1, "taxon_name": "Ignored zero", "abundance": 0},
            {"sampleid": 2, "taxon_name": "Ignored text", "abundance": "missing"},
        ])
        profiles = api.build_taxon_profiles(source)
        sample = profiles[profiles["sampleid"] == 1].set_index("lumped_taxon")
        self.assertAlmostEqual(sample.loc["Arcella vulgaris", "percentage"], 50.0)
        self.assertAlmostEqual(sample.loc["Centropyxis aculeata", "percentage"], 50.0)
        self.assertAlmostEqual(sample["percentage"].sum(), 100.0)
        self.assertNotIn(2, profiles["sampleid"].tolist())

    def test_other_group_preserves_total_percentage(self):
        records = [
            {"lumped_taxon": "A", "percentage": 60.0, "abundance": 60.0},
            {"lumped_taxon": "B", "percentage": 25.0, "abundance": 25.0},
            {"lumped_taxon": "C", "percentage": 15.0, "abundance": 15.0},
        ]
        limited = api.limit_taxa_groups(records, 2)
        self.assertEqual([row["lumped_taxon"] for row in limited], ["A", "Other"])
        self.assertAlmostEqual(sum(row["percentage"] for row in limited), 100.0)


class EnvironmentalTests(unittest.TestCase):
    def test_summary_uses_available_values(self):
        frame = pd.DataFrame({
            "siteid": [1, 1, 2],
            "pH": [4.0, 6.0, float("nan")],
            "water_table_depth": [10.0, 20.0, 30.0],
            "altitude": [100.0, float("nan"), 200.0],
        })
        self.assertEqual(api.build_summary(frame), {
            "samples": 3,
            "sites": 2,
            "mean_ph": 5.0,
            "mean_water_table": 20.0,
            "mean_altitude": 150.0,
        })

    def test_pca_requires_three_complete_samples(self):
        frame = pd.DataFrame({
            "pH": [4.0, 5.0],
            "water_table_depth": [10.0, 20.0],
            "altitude": [100.0, 200.0],
        })
        result = api.run_environmental_pca(frame)
        self.assertEqual(result["pc1"], [])
        self.assertEqual(result["explained_variance"], [])

    def test_pca_returns_finite_coordinates(self):
        frame = pd.DataFrame({
            "pH": [4.0, 5.0, 6.0, 7.0],
            "water_table_depth": [5.0, 15.0, 10.0, 25.0],
            "altitude": [100.0, 150.0, 120.0, 220.0],
        })
        result = api.run_environmental_pca(frame)
        self.assertEqual(result["samples"], 4)
        self.assertEqual(len(result["pc1"]), 4)
        self.assertTrue(all(math.isfinite(value) for value in result["pc1"] + result["pc2"]))


class ApiSmokeTests(unittest.TestCase):
    def test_health_reports_loaded_amoeba_data(self):
        result = api.health()
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["data_source"], "csv")
        self.assertGreater(result["samples"], 0)
        self.assertGreater(result["taxon_observations"], 0)

    def test_invalid_publication_filter_returns_no_records(self):
        self.assertEqual(api.search(publication_contains="publication:not-a-number"), [])


if __name__ == "__main__":
    unittest.main()
