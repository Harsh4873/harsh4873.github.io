from __future__ import annotations

import importlib.util
import json
import subprocess
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
                "datetime": "Jun 12, 2026, 1:00 AM",
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
        ["Chicago Sky @ Indiana Fever"],
    )
    assert rows[0]["league"] == "USA - WNBA"
    assert rows[0]["tip"] == "Indiana Fever -9.5"


def test_sportsgambler_wnba_listing_and_detail(monkeypatch):
    module = _load_module(
        "sportsgambler_scraper_test",
        ROOT / "scripts" / "scrapers" / "sportsgambler_scraper.py",
    )
    detail_url = "https://www.sportsgambler.com/betting-tips/basketball/chicago-sky-vs-indiana-fever-prediction-odds-2026-06-11/"
    late_url = "https://www.sportsgambler.com/betting-tips/basketball/phoenix-mercury-vs-dallas-wings-prediction-odds-2026-06-11/"
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
                },
                {
                    "@type": "ListItem",
                    "item": {
                        "@type": "SportsEvent",
                        "name": "Dallas Wings vs Phoenix Mercury",
                        "startDate": "2026-06-13T01:00:00Z",
                        "url": late_url,
                    },
                },
            ],
        },
    }
    listing_html = f'<script type="application/ld+json">{json.dumps(listing)}</script>'
    detail_html = '<div class="tpbot_container"><div class="tpbot_title">Our Game Prediction</div><a class="tpbot_tip"><span>Pick</span><span>Fever -9.5 @ -112</span></a></div>'
    late_html = '<div class="tpbot_container"><div class="tpbot_title">Our Game Prediction</div><a class="tpbot_tip"><span>Pick</span><span>Under 170.5 Points @ -110</span></a></div>'

    class Response:
        def __init__(self, text: str):
            self.text = text

    monkeypatch.setattr(
        module.requests,
        "get",
        lambda url, **_kwargs: Response(detail_html if url == detail_url else late_html if url == late_url else listing_html),
    )
    rows = module.scrape_wnba(
        date(2026, 6, 11),
        ["Chicago Sky @ Indiana Fever", "Phoenix Mercury @ Dallas Wings"],
    )
    assert rows == [
        {
            "datetime": "2026-06-11T23:00:00Z",
            "league": "WNBA",
            "matchup": "Indiana Fever vs Chicago Sky",
            "tip": "Fever -9.5",
            "odds": "-112",
            "href": detail_url,
        },
        {
            "datetime": "2026-06-13T01:00:00Z",
            "league": "WNBA",
            "matchup": "Dallas Wings vs Phoenix Mercury",
            "tip": "Under 170.5 Points",
            "odds": "-110",
            "href": late_url,
        },
    ]


def test_sportsgambler_rejects_partial_basketball_feed(monkeypatch):
    module = _load_module(
        "sportsgambler_partial_test",
        ROOT / "scripts" / "scrapers" / "sportsgambler_scraper.py",
    )
    detail_url = "https://www.sportsgambler.com/betting-tips/basketball/example-prediction-odds-2026-06-11/"
    listing = {
        "item": {
            "@type": "SportsEvent",
            "name": "Example Away vs Example Home",
            "startDate": "2026-06-11T23:00:00Z",
            "url": detail_url,
        }
    }
    listing_html = f'<script type="application/ld+json">{json.dumps(listing)}</script>'

    class Response:
        def __init__(self, text: str):
            self.text = text

    monkeypatch.setattr(
        module.requests,
        "get",
        lambda url, **_kwargs: Response("<html>No prediction block yet</html>" if url == detail_url else listing_html),
    )

    try:
        module.scrape_wnba(date(2026, 6, 11))
    except RuntimeError as exc:
        assert "partial WNBA scrape: parsed 0 of 1" in str(exc)
    else:
        raise AssertionError("partial SportsGambler WNBA scrape must fail instead of publishing")


def test_sportsgambler_rejects_missing_known_matchup(monkeypatch):
    module = _load_module(
        "sportsgambler_missing_matchup_test",
        ROOT / "scripts" / "scrapers" / "sportsgambler_scraper.py",
    )
    listing = {
        "item": {
            "@type": "SportsEvent",
            "name": "Indiana Fever vs Chicago Sky",
            "startDate": "2026-06-11T23:00:00Z",
            "url": "https://example.com/fever-sky",
        }
    }

    class Response:
        text = f'<script type="application/ld+json">{json.dumps(listing)}</script>'

    monkeypatch.setattr(module.requests, "get", lambda *_args, **_kwargs: Response())

    try:
        module.scrape_wnba(
            date(2026, 6, 11),
            ["Chicago Sky @ Indiana Fever", "Phoenix Mercury @ Dallas Wings"],
        )
    except RuntimeError as exc:
        assert "missing 1 known slate matchup" in str(exc)
        assert "Phoenix Mercury @ Dallas Wings" in str(exc)
    else:
        raise AssertionError("missing known slate matchup must fail instead of publishing")


def test_server_passes_known_matchups_to_sportsgambler(monkeypatch):
    import pickgrader_server as server

    captured: list[str] = []
    monkeypatch.setattr(
        server,
        "_known_basketball_slate_matchups",
        lambda _date, _sport: ["Phoenix Mercury @ Dallas Wings"],
    )
    monkeypatch.setattr(server, "_save_admin_picks_doc", lambda *_args, **_kwargs: None)

    def fake_run(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "Match: Dallas Wings vs Phoenix Mercury\n"
                "League: WNBA\n"
                "Tip: Under 170.5 Points\n"
                "Odds: -110\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(server, "_subprocess_run", fake_run)
    result = server.run_sportsgambler_scraper("2026-06-11", ["wnba"])

    assert result["ok"] is True
    assert captured[-2:] == ["--expected-matchup", "Phoenix Mercury @ Dallas Wings"]


def test_external_feed_schedule_requests_wnba():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    refresh = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")
    server = (ROOT / "pickgrader_server.py").read_text(encoding="utf-8")
    assert '--sports "nba,mlb,wnba"' in workflow
    assert 'default="nba,mlb,wnba"' in refresh
    assert '"wnba": "wnba"' in server
    assert '{"NBA", "WNBA", "MLB"}' in server
