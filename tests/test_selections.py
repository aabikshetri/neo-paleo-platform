"""Selection-token and paginated-search compatibility tests."""

import os
import unittest

os.environ.pop("DATABASE_URL", None)

from backend.handlers.explorer import search_page, selection_rows
from backend.services.selections import decode_selection, encode_selection


class SelectionTokenTests(unittest.TestCase):
    def test_token_round_trip_is_deterministic(self):
        filters = {"ph_min": "4", "site_contains": " bog ", "unused": "ignored"}
        token = encode_selection(filters)
        self.assertEqual(token, encode_selection(filters))
        self.assertEqual(decode_selection(token), {"ph_min": 4.0, "site_contains": "bog"})

    def test_invalid_token_is_rejected(self):
        with self.assertRaises(ValueError):
            decode_selection("not-a-token")

    def test_page_and_selection_resolve_identical_filter(self):
        page = search_page(page=1, page_size=25, ph_min=4.0)
        selected = selection_rows(page["selection_token"])
        self.assertEqual(page["total"], len(selected))
        self.assertEqual(page["rows"], selected[:25])
        self.assertEqual(page["summary"]["samples"], len(selected))


if __name__ == "__main__":
    unittest.main()
