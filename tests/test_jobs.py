"""Background-job compatibility tests that do not require Redis."""

import os
import unittest
from unittest.mock import patch

from backend.jobs import submit_nmds
from backend.schemas.requests import NmdsRequest


class BackgroundJobTests(unittest.TestCase):
    def test_nmds_job_falls_back_to_synchronous_execution_without_redis(self):
        previous = os.environ.pop("REDIS_URL", None)
        request = NmdsRequest(sampleids=[1, 2, 3])
        try:
            with patch("backend.jobs.calibration_nmds", return_value={"points": [], "stress": 0.1}):
                result = submit_nmds(request)
        finally:
            if previous is not None:
                os.environ["REDIS_URL"] = previous
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["result"]["stress"], 0.1)
