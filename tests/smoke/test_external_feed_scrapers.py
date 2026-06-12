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


def test_scores24_extracts_our_choice_and_normalizes_pick():
    module = _load_module(
        "scores24_choice_test",
        ROOT / "scripts" / "scrapers" / "scores24_scraper.py",
    )
    html = """
    <section>
      <div>Editorial Prediction</div>
      <p>We are backing the home side.</p>
      <div class="choice">
        <div>Our choice</div>
        <div><span>Pittsburgh Pirates Win</span> at odds of <span>-147*</span></div>
        <div>*The odds are relevant for the time of publication.</div>
      </div>
    </section>
    """
    tip, odds = module.extract_our_choice(html)
    assert tip == "Pittsburgh Pirates Win"
    assert odds == -147
    assert module._clean_pick(
        tip,
        {"away": "Miami Marlins", "home": "Pittsburgh Pirates"},
    ) == "Pittsburgh Pirates ML (Miami Marlins @ Pittsburgh Pirates)"


def test_scores24_candidate_urls_cover_wrong_dates_and_site_team_aliases():
    module = _load_module(
        "scores24_candidates_test",
        ROOT / "scripts" / "scrapers" / "scores24_scraper.py",
    )
    wnba_urls = module.candidate_prediction_urls(
        "wnba",
        "2026-06-12",
        {"away": "Golden State Valkyries", "home": "Seattle Storm"},
    )
    mlb_urls = module.candidate_prediction_urls(
        "mlb",
        "2026-06-12",
        {"away": "Detroit Tigers", "home": "Cleveland Guardians"},
    )
    assert any("m-13-06-2026-seattle-storm-w-golden-state-valkyries-w--prediction" in url for url in wnba_urls)
    assert any("cleveland-gardians-detroit-tigers-prediction" in url for url in mlb_urls)


def test_scores24_matches_official_slate_and_keeps_separate_sources():
    module = _load_module(
        "scores24_slate_test",
        ROOT / "scripts" / "scrapers" / "scores24_scraper.py",
    )
    listing = """
    <a href="/en/basketball/m-12-06-2026-washington-mystics-w-toronto-tempo-prediction">
      Washington Mystics (W) Toronto Tempo (W) Prediction
    </a>
    <a href="/en/basketball/m-14-06-2026-portland-fire-dallas-wings-w--prediction">
      Portland Fire Dallas Wings (W) Prediction
    </a>
    """
    detail = """
    <html><head><title>Washington Mystics vs Toronto Tempo Prediction</title></head>
    <body><div><div>Our choice</div><div>Total points Over (164.5) at odds of -172*</div></div></body>
    </html>
    """

    class FakeClient:
        def get_html(self, url: str, attempts: int = 3):
            if url.endswith("/l-usa-wnba/predictions"):
                return listing, 200, False
            if "washington-mystics" in url and "toronto-tempo" in url:
                return detail, 200, False
            return "", 404, False

    result = module.scrape_scores24(
        "wnba",
        "2026-06-12",
        client=FakeClient(),
        matchups=[
            {
                "away": "Toronto Tempo",
                "home": "Washington Mystics",
                "start_time": "2026-06-12T23:30:00Z",
            }
        ],
    )
    assert result["ok"] is True
    assert result["meta"]["expectedMatchups"] == 1
    assert result["meta"]["matchedPicks"] == 1
    assert result["picks"] == [
        {
            "source": "Scores24WNBA",
            "pick": "Over 164.5 (Toronto Tempo @ Washington Mystics)",
            "tip": "Total points Over (164.5)",
            "sport": "WNBA",
            "odds": -172,
            "units": 1,
            "probability": None,
            "edge": None,
            "decision": "BET",
            "date": "2026-06-12",
            "matchup": "Toronto Tempo @ Washington Mystics",
            "game": "Toronto Tempo @ Washington Mystics",
            "away_team": "Toronto Tempo",
            "home_team": "Washington Mystics",
            "start_time": "2026-06-12T23:30:00Z",
            "source_url": (
                "https://scores24.live/en/basketball/"
                "m-12-06-2026-washington-mystics-w-toronto-tempo-prediction"
            ),
        }
    ]
    assert module.SPORT_CONFIG["mlb"]["source"] == "Scores24MLB"


def test_scores24_retries_blocked_matchup_without_hammering_candidates(monkeypatch):
    module = _load_module(
        "scores24_retry_test",
        ROOT / "scripts" / "scrapers" / "scores24_scraper.py",
    )
    monkeypatch.setenv("SCORES24_BLOCK_RETRY_DELAY_SECONDS", "0")
    monkeypatch.setenv("SCORES24_BLOCK_RETRY_ROUNDS", "1")
    detail = """
    <html><head><title>Los Angeles Angels vs Tampa Bay Rays Prediction</title></head>
    <body><div><div>Our choice</div><div>Tampa Bay Rays Win at odds of -179*</div></div></body>
    </html>
    """

    class FakeClient:
        def __init__(self):
            self.detail_calls = 0

        def get_html(self, url: str, attempts: int = 3):
            if url.endswith("/l-usa-mlb/predictions"):
                return "", 200, False
            self.detail_calls += 1
            if self.detail_calls == 1:
                return "Cloudflare", 429, True
            return detail, 200, False

    client = FakeClient()
    result = module.scrape_scores24(
        "mlb",
        "2026-06-12",
        client=client,
        matchups=[{"away": "Tampa Bay Rays", "home": "Los Angeles Angels", "start_time": ""}],
    )
    assert result["ok"] is True
    assert result["meta"]["matchedPicks"] == 1
    assert client.detail_calls == 2


def test_scores24_fails_closed_when_blocked_retry_stays_blocked(monkeypatch):
    module = _load_module(
        "scores24_blocked_test",
        ROOT / "scripts" / "scrapers" / "scores24_scraper.py",
    )
    monkeypatch.setenv("SCORES24_BLOCK_RETRY_DELAY_SECONDS", "0")
    monkeypatch.setenv("SCORES24_BLOCK_RETRY_ROUNDS", "1")

    class FakeClient:
        def __init__(self):
            self.detail_calls = 0

        def get_html(self, url: str, attempts: int = 3):
            if url.endswith("/l-usa-mlb/predictions"):
                return "", 200, False
            self.detail_calls += 1
            return "Cloudflare", 429, True

    client = FakeClient()
    result = module.scrape_scores24(
        "mlb",
        "2026-06-12",
        client=client,
        matchups=[{"away": "Tampa Bay Rays", "home": "Los Angeles Angels", "start_time": ""}],
    )
    assert result["ok"] is False
    assert "blocked before it could finish" in result["error"]
    assert client.detail_calls == 2


def test_external_feed_schedule_registers_separate_scores24_models():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    refresh = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")
    for model_key in ("scores24_wnba", "scores24_mlb"):
        assert model_key in workflow
        assert model_key in refresh
    assert "python -m camoufox fetch" in workflow
    assert 'cron: "10,40 14 * * *"' in workflow
    assert 'cron: "10 20 * * *"' in workflow
