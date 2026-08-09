from fastapi import APIRouter

from backend.handlers import explorer

router = APIRouter(tags=["search"])
router.add_api_route("/search", explorer.search, methods=["GET"])
router.add_api_route("/search-page", explorer.search_page, methods=["GET"])
router.add_api_route("/selection/rows", explorer.selection_rows, methods=["GET"])
router.add_api_route("/publication-options", explorer.publication_options, methods=["GET"])
