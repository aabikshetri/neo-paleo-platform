"""Read-only integration checks for an imported AmoebaScope PostgreSQL database."""

import os
import unittest


DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "Set TEST_DATABASE_URL to run PostgreSQL checks")
class PostgreSQLIntegrityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        cls.connection = psycopg.connect(DATABASE_URL, autocommit=True)

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()

    def scalar(self, query):
        with self.connection.cursor() as cursor:
            cursor.execute(query)
            return cursor.fetchone()[0]

    def test_expected_runtime_counts(self):
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM samples"), 4389)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM taxon_abundances"), 65042)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM dataset_publications"), 6326)

    def test_taxon_observations_have_samples(self):
        orphan_count = self.scalar("""
            SELECT COUNT(*)
            FROM taxon_abundances t
            LEFT JOIN samples s USING (sampleid)
            WHERE s.sampleid IS NULL
        """)
        self.assertEqual(orphan_count, 0)

    def test_precomputed_profiles_sum_to_100_percent(self):
        invalid_count = self.scalar("""
            SELECT COUNT(*) FROM (
                SELECT sampleid
                FROM sample_taxon_profiles
                GROUP BY sampleid
                HAVING ABS(SUM(percentage) - 100.0) > 1e-8
            ) invalid
        """)
        self.assertEqual(invalid_count, 0)

    def test_publication_links_resolve(self):
        orphan_count = self.scalar("""
            SELECT COUNT(*)
            FROM dataset_publications dp
            LEFT JOIN publications p USING (publicationid)
            WHERE p.publicationid IS NULL
        """)
        self.assertEqual(orphan_count, 0)

    def test_materialized_summaries_match_runtime_tables(self):
        if self.scalar("SELECT to_regclass('publication_sample_summary')") is None:
            self.skipTest("Materialized summaries are optional until the next runtime import")
        self.assertEqual(
            self.scalar("SELECT SUM(sample_count) > 0 FROM publication_sample_summary"),
            True,
        )
        self.assertEqual(
            self.scalar("SELECT COUNT(*) FROM sample_coverage_summary"),
            self.scalar("SELECT COUNT(*) FROM samples"),
        )

    def test_legacy_schema_query_fallbacks(self):
        sampleids = self.scalar(
            "SELECT ARRAY(SELECT sampleid FROM samples ORDER BY sampleid LIMIT 2)"
        )
        previous = os.environ.get("DATABASE_URL")
        os.environ["DATABASE_URL"] = DATABASE_URL
        try:
            from backend import database

            publication_options = database.publication_options_postgres()
            quality = database.calibration_quality_postgres(sampleids)
            rows, total, summary = database.search_page_postgres(
                page=1,
                page_size=25,
                publicationid=None,
            )
        finally:
            database.close_database_pool()
            if previous is None:
                os.environ.pop("DATABASE_URL", None)
            else:
                os.environ["DATABASE_URL"] = previous
        self.assertGreater(len(publication_options), 0)
        self.assertEqual(quality["sample_count"], 2)
        self.assertEqual(len(rows), 25)
        self.assertEqual(total, summary["samples"])


if __name__ == "__main__":
    unittest.main()
