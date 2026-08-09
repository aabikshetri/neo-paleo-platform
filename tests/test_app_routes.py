"""Regression tests for the public FastAPI route contract."""

import os
import unittest

os.environ.pop("DATABASE_URL", None)

from backend.main import app, create_app


EXPECTED_ROUTES = {
    ("GET", "/"),
    ("GET", "/health"),
    ("GET", "/summary"),
    ("GET", "/correlation"),
    ("GET", "/pca/environment"),
    ("GET", "/search"),
    ("GET", "/search-page"),
    ("GET", "/selection/rows"),
    ("GET", "/publication-options"),
    ("GET", "/taxa/lumped"),
    ("GET", "/taxa/top"),
    ("GET", "/taxa/by-samples"),
    ("POST", "/taxa/aggregate"),
    ("GET", "/taxa/composition-by-samples"),
    ("POST", "/taxa/sample-values"),
    ("POST", "/taxa/sample-profiles"),
    ("POST", "/calibration/quality"),
    ("POST", "/calibration/modern-analogues"),
    ("POST", "/calibration/nmds"),
    ("POST", "/jobs/nmds"),
    ("POST", "/jobs/modern-analogues"),
    ("GET", "/jobs/{job_id}"),
    ("POST", "/export/taxa-csv"),
}


def public_routes(application):
    return {
        (method, route.path)
        for route in application.routes
        for method in getattr(route, "methods", set())
        if route.path not in {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}
        and method not in {"HEAD", "OPTIONS"}
    }


class ApplicationStructureTests(unittest.TestCase):
    def test_public_route_contract_is_unchanged(self):
        self.assertEqual(public_routes(app), EXPECTED_ROUTES)

    def test_application_factory_creates_independent_app(self):
        another_app = create_app()
        self.assertIsNot(another_app, app)
        self.assertEqual(public_routes(another_app), EXPECTED_ROUTES)

    def test_openapi_contains_every_public_route(self):
        documented_paths = app.openapi()["paths"]
        for method, path in EXPECTED_ROUTES:
            self.assertIn(path, documented_paths)
            self.assertIn(method.lower(), documented_paths[path])


if __name__ == "__main__":
    unittest.main()
