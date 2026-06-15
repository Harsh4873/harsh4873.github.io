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


def test_sportytrader_fifa_world_cup_config_and_known_matchup_alias():
    module = _load_module(
        "sportytrader_fifa_scraper_test",
        ROOT / "scripts" / "scrapers" / "sportytrader_scraper.py",
    )
    assert module.SPORT_CONFIG["fifa_world_cup"]["url"].endswith("/world-cup-1811/")
    assert "team !== values[index - 1]" in module.SPORTYTRADER_CARDS_JS
    rows = module._extract_rows(
        [
            {
                "datetime": "Jun 13, 2026, 11:00 PM",
                "league": "World - World Cup",
                "home": "Australia",
                "away": "Türkiye",
                "tip": "Turkey to Win & Under 3.5 Goals",
                "odds": "+130",
                "href": "https://www.sportytrader.com/us/picks/australia-turkiye-123/",
            }
        ],
        module._parse_target_date("2026-06-13"),
        "fifa_world_cup",
        ["Turkey @ Australia", "Switzerland @ Qatar"],
    )
    assert rows[0]["league"] == "World - World Cup"
    assert rows[0]["tip"] == "Turkey to Win & Under 3.5 Goals"


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


def test_sportsgambler_uses_known_matchups_as_a_whitelist(monkeypatch):
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

    listing_html = f'<script type="application/ld+json">{json.dumps(listing)}</script>'
    detail_html = '<div class="tpbot_container"><div class="tpbot_title">Our Game Prediction</div><a class="tpbot_tip"><span>Pick</span><span>Fever -9.5 @ -112</span></a></div>'

    class Response:
        def __init__(self, text: str):
            self.text = text

    monkeypatch.setattr(
        module.requests,
        "get",
        lambda url, **_kwargs: Response(detail_html if url == "https://example.com/fever-sky" else listing_html),
    )
    rows = module.scrape_wnba(
        date(2026, 6, 11),
        ["Chicago Sky @ Indiana Fever", "Phoenix Mercury @ Dallas Wings"],
    )
    assert [row["matchup"] for row in rows] == ["Indiana Fever vs Chicago Sky"]


def test_sportsgambler_mlb_uses_known_matchups_as_a_whitelist(monkeypatch):
    module = _load_module(
        "sportsgambler_mlb_slate_test",
        ROOT / "scripts" / "scrapers" / "sportsgambler_scraper.py",
    )
    listing_html = """
    <div class="tipbox_item" id="official">
      <div class="tipsbox_title">
        <h3><span>Chicago Cubs vs St. Louis Cardinals</span></h3>
        <div class="tipsbox_meta"><span>Jun 13, 2026</span><span>- MLB</span></div>
      </div>
      <div class="tipbox_tip"><span>Pick</span><span>Chicago Cubs to Win @ -115</span></div>
    </div>
    <div class="tipbox_item" id="other-date">
      <div class="tipsbox_title">
        <h3><span>Boston Red Sox vs New York Yankees</span></h3>
        <div class="tipsbox_meta"><span>Jun 14, 2026</span><span>- MLB</span></div>
      </div>
      <div class="tipbox_tip"><span>Pick</span><span>New York Yankees to Win @ -120</span></div>
    </div>
    """

    class Response:
        text = listing_html

    monkeypatch.setattr(module.requests, "get", lambda *_args, **_kwargs: Response())
    rows = module.scrape_mlb(
        date(2026, 6, 13),
        ["St. Louis Cardinals @ Chicago Cubs"],
    )

    assert [row["matchup"] for row in rows] == ["Chicago Cubs vs St. Louis Cardinals"]


def test_sportsgambler_fifa_world_cup_preserves_asian_handicap(monkeypatch):
    module = _load_module(
        "sportsgambler_fifa_test",
        ROOT / "scripts" / "scrapers" / "sportsgambler_scraper.py",
    )
    detail_url = "https://www.sportsgambler.com/betting-tips/football/qatar-vs-switzerland-prediction-lineups-odds-2026-06-13/"
    listing = {
        "item": {
            "@type": "SportsEvent",
            "name": "Qatar vs Switzerland",
            "startDate": "2026-06-13T19:00:00Z",
            "url": detail_url,
        }
    }
    listing_html = f'<script type="application/ld+json">{json.dumps(listing)}</script>'
    detail_html = '<div class="tpbot_container"><div class="tpbot_title">Our Match Prediction</div><a class="tpbot_tip"><span>Pick</span><span>Switzerland Asian Hcp -1.75 @ -114</span></a></div>'

    class Response:
        def __init__(self, text: str):
            self.text = text

    monkeypatch.setattr(
        module.requests,
        "get",
        lambda url, **_kwargs: Response(detail_html if url == detail_url else listing_html),
    )
    rows = module.scrape_fifa_world_cup(date(2026, 6, 13), ["Switzerland @ Qatar"])
    assert rows[0]["tip"] == "Switzerland Asian Hcp -1.75"
    assert rows[0]["odds"] == "-114"
    assert rows[0]["league"] == "FIFA WC"


def test_server_passes_known_matchups_to_sportsgambler(monkeypatch):
    import pickgrader_server as server

    captured: list[str] = []
    monkeypatch.setattr(
        server,
        "_known_external_slate_matchups",
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


def test_server_preserves_fifa_asian_handicap_without_auto_grading(monkeypatch):
    import pickgrader_server as server

    captured: list[str] = []
    monkeypatch.setattr(
        server,
        "_known_external_slate_matchups",
        lambda _date, _sport: ["Switzerland @ Qatar"],
    )
    monkeypatch.setattr(server, "_save_admin_picks_doc", lambda *_args, **_kwargs: None)

    def fake_run(command, **_kwargs):
        captured.extend(command)
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "Match: Qatar vs Switzerland\n"
                "League: FIFA WC\n"
                "Tip: Switzerland Asian Hcp -1.75\n"
                "Odds: -114\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(server, "_subprocess_run", fake_run)
    result = server.run_sportsgambler_scraper("2026-06-13", ["fifa_world_cup"])

    assert result["ok"] is True
    assert captured[-2:] == ["--expected-matchup", "Switzerland @ Qatar"]
    assert result["picks"][0]["pick"] == "Switzerland Asian Hcp -1.75 (Qatar vs Switzerland)"
    assert result["picks"][0]["market_type"] == "soccer_asian_handicap"
    assert result["picks"][0]["grade_supported"] is False
    assert result["picks"][0]["calibration_excluded"] is True


def test_server_routes_external_player_prop_out_of_team_markets(monkeypatch):
    import pickgrader_server as server

    monkeypatch.setattr(
        server,
        "_known_external_slate_matchups",
        lambda _date, _sport: ["Pittsburgh Pirates @ Los Angeles Dodgers"],
    )
    monkeypatch.setattr(server, "_save_admin_picks_doc", lambda *_args, **_kwargs: None)

    def fake_run(command, **_kwargs):
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=(
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
                "Match: Pittsburgh Pirates vs Los Angeles Dodgers\n"
                "League: MLB\n"
                "Tip: Shohei Ohtani 7+ Strikeouts\n"
                "Odds: +110\n"
                "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(server, "_subprocess_run", fake_run)
    result = server.run_sportytrader_scraper("2026-06-13", ["mlb"])
    pick = result["picks"][0]

    assert pick["scope"] == "player"
    assert pick["market_type"] == "external_player_prop"
    assert pick["grade_supported"] is True


def test_external_compound_market_is_not_auto_graded():
    import pickgrader_server as server

    pick = {
        "source": "SportyTrader",
        "sport": "MLB",
        "pick": "Brewers to win and over 7.5 runs (Brewers vs Phillies)",
        "decision": "BET",
        "result": "win",
    }

    assert server.apply_external_pick_metadata(pick) == 3
    assert pick["market_type"] == "compound"
    assert pick["grade_supported"] is False
    assert pick["result"] == "pending"


def test_known_fifa_slate_uses_in_house_cache_before_external_scrapers(monkeypatch, tmp_path):
    import pickgrader_server as server

    cache_dir = tmp_path / "data" / "model_cache"
    cache_dir.mkdir(parents=True)
    (cache_dir / "2026-06-13.json").write_text(
        json.dumps({
            "date": "2026-06-13",
            "models": {
                "fifa_world_cup": {
                    "games": [
                        {"away_team": "Switzerland", "home_team": "Qatar"},
                        {"matchup": "Türkiye @ Australia"},
                    ]
                }
            },
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(server, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(server, "fetch_scoreboard", lambda *_args, **_kwargs: {"events": []})

    matchups = server._known_external_slate_matchups("2026-06-13", "fifa_world_cup")
    assert matchups == ["Switzerland @ Qatar", "Türkiye @ Australia"]


def test_external_feed_schedule_requests_wnba_and_fifa_world_cup():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    refresh = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")
    server = (ROOT / "pickgrader_server.py").read_text(encoding="utf-8")
    assert '--sports "nba,mlb,wnba,fifa_world_cup"' in workflow
    assert 'default="nba,mlb,wnba,fifa_world_cup"' in refresh
    assert '"wnba": "wnba"' in server
    assert '"fifa_world_cup": "fifa_world_cup"' in server
    assert '"fifa_world_cup": {"label": "FIFA WC"' in server


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
    fifa_urls = module.candidate_prediction_urls(
        "fifa_world_cup",
        "2026-06-13",
        {"away": "Switzerland", "home": "Qatar"},
    )
    assert any("m-13-06-2026-seattle-storm-w-golden-state-valkyries-w--prediction" in url for url in wnba_urls)
    assert any("cleveland-gardians-detroit-tigers-prediction" in url for url in mlb_urls)
    assert any("m-14-06-2026-qatar-switzerland-prediction" in url for url in fifa_urls)


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


def test_scores24_fifa_world_cup_keeps_specialty_market_ungraded():
    module = _load_module(
        "scores24_fifa_test",
        ROOT / "scripts" / "scrapers" / "scores24_scraper.py",
    )
    payload = module._pick_payload(
        module.SPORT_CONFIG["fifa_world_cup"],
        "2026-06-13",
        {"away": "Morocco", "home": "Brazil", "start_time": "2026-06-13T22:00:00Z"},
        "https://scores24.live/en/soccer/m-14-06-2026-brazil-morocco-prediction",
        "Ismael Saibari 1+ Shot on Target",
        115,
    )
    assert payload["source"] == "Scores24FIFAWorldCup"
    assert payload["sport"] == "FIFA WC"
    assert payload["scope"] == "player"
    assert payload["market_type"] == "external_player_prop"
    assert payload["grade_supported"] is False
    assert payload["calibration_excluded"] is True


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


def test_local_scores24_publisher_registers_separate_models():
    workflow = (ROOT / ".github" / "workflows" / "external-feed-refresh.yml").read_text(encoding="utf-8")
    refresh = (ROOT / "scripts" / "refresh_external_feeds.py").read_text(encoding="utf-8")
    publisher = (ROOT / "scripts" / "scrapers" / "scores24_publish_local.sh").read_text(encoding="utf-8")
    for model_key in ("scores24_wnba", "scores24_mlb", "scores24_fifa_world_cup"):
        assert model_key in refresh
        assert model_key in publisher
    assert 'default="sportytrader,sportsgambler"' in refresh
    assert "scores24_wnba" not in workflow
    assert "scores24_fifa_world_cup" not in workflow
    assert "gh" not in publisher.split('GH_BIN="/opt/homebrew/bin/gh"', 1)[0]
    assert "workflow run deploy-pages.yml" in publisher
    assert "Skipped Pages deploy until the full" in publisher
    assert "steps.commit-feeds.outputs.deployable == 'true'" in workflow
    assert 'cron: "10,40 14 * * *"' in workflow
    assert 'cron: "10 20 * * *"' in workflow
