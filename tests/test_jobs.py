"""Background-job compatibility tests that do not require Redis."""

import os
import unittest
from unittest.mock import patch

from backend.jobs import QUEUE_NAMES, _request_fingerprint, submit_nmds
from backend.schemas.requests import NmdsRequest


class BackgroundJobTests(unittest.TestCase):
    def test_nmds_and_analogue_use_independent_queues(self):
        self.assertNotEqual(QUEUE_NAMES["nmds"], QUEUE_NAMES["modern_analogue"])

    def test_identical_requests_have_identical_fingerprints(self):
        first = NmdsRequest(sampleids=[1, 2, 3], n_init=4)
        second = NmdsRequest(sampleids=[1, 2, 3], n_init=4)
        changed = NmdsRequest(sampleids=[1, 2, 3], n_init=5)
        self.assertEqual(
            _request_fingerprint("nmds", first),
            _request_fingerprint("nmds", second),
        )
        self.assertNotEqual(
            _request_fingerprint("nmds", first),
            _request_fingerprint("nmds", changed),
        )

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
