from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class LandingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str]] = []
        self.stylesheets: list[str] = []
        self.scripts: list[dict[str, str]] = []
        self.main_ids: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "a":
            self.links.append(values)
        elif tag == "link" and values.get("rel") == "stylesheet":
            self.stylesheets.append(values.get("href", ""))
        elif tag == "script":
            self.scripts.append(values)
        elif tag == "main":
            self.main_ids.append(values.get("id", ""))


def _landing() -> tuple[str, LandingParser]:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    parser = LandingParser()
    parser.feed(html)
    return html, parser


def test_landing_has_personal_metadata_and_accessible_structure():
    html, parser = _landing()

    assert "<title>Harsh — Projects, experiments, and things I’m building</title>" in html
    assert 'content="https://harsh.bet/"' in html
    assert '<link rel="canonical" href="https://harsh.bet/"' in html
    assert 'class="skip-link" href="#main-content"' in html
    assert parser.main_ids == ["main-content"]
    assert parser.stylesheets == ["./src/styles/landing.css"]
    assert any(
        script.get("type") == "module" and script.get("src") == "./src/main.ts"
        for script in parser.scripts
    )
    assert "fonts.googleapis.com" not in html


def test_landing_routes_every_project_to_a_standalone_site():
    _, parser = _landing()
    expected_paths = {
        "/daymark/",
        "/slate/",
        "/pickledger/",
        "/genes/",
        "/research/",
        "/fare/",
        "/gym/",
        "/portfolio/",
    }
    project_links = [
        link for link in parser.links if "project-card" in link.get("class", "").split()
    ]

    assert {link.get("href") for link in project_links} == expected_paths
    assert len(project_links) == len(expected_paths)
    assert all(link.get("target") == "_blank" for link in project_links)
    assert all({"noopener", "noreferrer"} <= set(link.get("rel", "").split()) for link in project_links)
    assert all(link.get("aria-label", "").endswith("in a new tab") for link in project_links)


def test_landing_uses_the_accessible_aggie_maroon_palette():
    html, _ = _landing()
    css = (ROOT / "src" / "styles" / "landing.css").read_text(encoding="utf-8")

    assert '<meta name="theme-color" content="#500000"' in html
    assert "--accent: #500000;" in css
    assert "--paper-strong: #d6d3c4;" in css
    assert "--white: #ffffff;" in css


def test_landing_is_small_and_progressively_enhanced():
    script = (ROOT / "src" / "main.ts").read_text(encoding="utf-8")
    css = (ROOT / "src" / "styles" / "landing.css").read_text(encoding="utf-8")

    assert "current-year" in script
    assert "prefers-reduced-motion" in script
    assert "IntersectionObserver" in script
    assert "prefers-reduced-motion" in css
    assert ":focus-visible" in css
    assert "@media (max-width: 720px)" in css
    assert not (ROOT / "data").exists()
    assert not (ROOT / "models").exists()
    assert not (ROOT / "player_props").exists()


def test_pages_workflow_deploys_only_the_landing_artifact():
    workflow = (ROOT / ".github" / "workflows" / "deploy-pages.yml").read_text(encoding="utf-8")

    assert "actions/checkout@v5" in workflow
    assert "actions/setup-node@v5" in workflow
    assert "npm run build" in workflow
    assert "python3 scripts/site_upcheck.py" in workflow
    assert "actions/upload-pages-artifact@v3" in workflow
    assert "actions/deploy-pages@v4" in workflow
    assert "ref: pickledger" not in workflow
    assert "working-directory:" not in workflow
