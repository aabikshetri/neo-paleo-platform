"""Representative read-heavy AmoebaScope load profile."""

import random

from locust import HttpUser, between, task


class AmoebaScopeUser(HttpUser):
    wait_time = between(0.5, 2.0)

    def on_start(self):
        response = self.client.get("/search-page", name="search: initial")
        response.raise_for_status()
        self.selection = response.json()["selection_token"]

    @task(8)
    def filtered_search(self):
        minimum = random.choice([3.5, 4.0, 4.5, 5.0])
        self.client.get(
            "/search-page",
            params={"ph_min": minimum, "page_size": 250},
            name="search: filtered",
        )

    @task(4)
    def publication_options(self):
        self.client.get("/publication-options")

    @task(3)
    def coverage(self):
        self.client.post(
            "/calibration/quality",
            json={"selection_token": self.selection},
        )

    @task(2)
    def taxa(self):
        self.client.post(
            "/taxa/aggregate",
            json={"selection_token": self.selection, "level": "taxon", "limit": 100},
        )

    @task(1)
    def full_selection(self):
        self.client.get("/selection/rows", params={"selection_token": self.selection})
