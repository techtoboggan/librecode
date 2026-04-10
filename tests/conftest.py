"""
LibreCode BDD Test Configuration

Provides fixtures for Playwright browser automation against the
LibreCode desktop app (via its Vite dev server on localhost:1420).

Usage:
    # Install deps
    pip install -r tests/requirements.txt
    playwright install chromium

    # Run all BDD tests
    pytest tests/ -m "not slow"

    # Run smoke tests only
    pytest tests/ -m smoke

    # Run with HTML report
    pytest tests/ --html=tests/report.html
"""

import pytest
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext


@pytest.fixture(scope="session")
def browser():
    """Launch a browser for the test session."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def context(browser: Browser):
    """Create a fresh browser context for each test."""
    context = browser.new_context(
        viewport={"width": 1280, "height": 800},
        ignore_https_errors=True,
    )
    yield context
    context.close()


@pytest.fixture
def page(context: BrowserContext):
    """Create a fresh page for each test."""
    page = context.new_page()
    yield page
    page.close()


@pytest.fixture
def app_url():
    """The URL where the LibreCode app is running."""
    return "http://localhost:1420"


@pytest.fixture
def app_page(page: Page, app_url: str):
    """Navigate to the LibreCode app and wait for it to load."""
    page.goto(app_url, wait_until="networkidle", timeout=30000)
    # Wait for the app to be interactive (the prompt input appears)
    page.wait_for_selector("[data-component='prompt-input'], input, textarea", timeout=15000)
    return page
