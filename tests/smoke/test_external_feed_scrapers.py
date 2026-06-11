from __future__ import annotations

import importlib.util
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_sportytrader_wnba_config_and_card_extraction():
    module = _load_module(
        "sportytrader_scraper_test",
        ROOT / "scripts" / "scrapers" / "sportytrader_scraper.py",
    )
    assert module.SPORT_CONFIG["wnba"]["url"].endswith("/wnba-58202/")
    rows = module._extract_rows(
        [
            {
                "datetime": "Jun 11, 2026, 6:00 PM",
                "league": "USA - WNBA",
                "home": "Indiana Fever",
                "away": "Chicago Sky",
                "tip": "Indiana Fever -9.5",
                "odds": "-110",
                "href": "https://www.sportytrader.com/us/picks/chicago-sky-indiana-fever-354049/",
            }
        ],
        module._parse_target_date("2026-06-11"),
        "wnba",
    )
    assert rows[0]["league"] == "USA - WNBA"
    assert rows[0]["tip"] == "Indiana Fever -9.5"


def test_sportsgambler_wnba_listing_and_detail(monkeypatch):
    module = _load_module(
        "sportsgambler_scraper_test",
        ROOT / "scripts" / "scrapers" / "sportsgambler_scraper.py",
    )
    detail_url = "https://www.sportsgambler.com/betting-tips/basketball/chicago-sky-vs-indiana-fever-prediction-odds-2026-06-11/"
    listing = {
        "@context": "https://schema.org",
        "mainEntity": {
            "@type": "ItemList",
            "itemListElement": [
                {
                    "@type": "ListItem",
                    "item": {
                        "@type": "SportsEvent",
                        "name": "Indiana Fever vs Chicago Sky",
                        "startDate": "2026-06-11T23:00:00Z",
                        "url": detail_url,
                    },
                }
            ],
        },
    }
    listing_html = f'<script type="application/ld+json">{json.dumps(listing)}</script>'
    detail_html = '<div class="tpbot_container"><div class="tpbot_title">Our Game Prediction</div><a class="tpbot_tip"><span>Pick</span><span>Fever -9.5 @ -112</span></a></div>'

    class Response:
        def __init__(self, text: str):
            self.text = text

    monkeypatch.setattr(
        module.requests,
        "get",
        lambda url, **_kwargs: Response(detail_html if url == detail_url else listing_html),
    )
    rows = module.scrape_wnba(date(2026, 6, 11))
    assert rows == [
        {
            "datetime": "2026-06-11T23:00:00Z",
            "league": "WNBA",
            "matchup": "Indiana Fever vs Chicago Sky",
            "tip": "Fever -9.5",
            "odds": "-112",
            "href": detail_url,
        }
    ]


def test_external_feed_schedule_requests_wnba():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    refresh = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")
    server = (ROOT / "pickgrader_server.py").read_text(encoding="utf-8")
    assert '--sports "nba,mlb,wnba"' in workflow
    assert 'default="nba,mlb,wnba"' in refresh
    assert '"wnba": "wnba"' in server
    assert '{"NBA", "WNBA", "MLB"}' in server
