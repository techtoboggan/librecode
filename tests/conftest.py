"""
LibreCode BDD Test Configuration

Fully self-contained: starts a mock API server + Vite dev server
automatically. No real backend, no real providers, no external deps.

Usage:
    pytest tests/ -v              # Run all BDD tests
    pytest tests/ -m smoke        # Smoke tests only
    pytest tests/ -m provider     # Provider tests only
"""

import os
import subprocess
import time
import urllib.request

import pytest
from playwright.sync_api import sync_playwright, Page, Browser, BrowserContext

from mock_server import start_mock_server

# Ports
MOCK_API_PORT = 4096
VITE_PORT = int(os.environ.get("LIBRECODE_TEST_PORT", "3333"))
VITE_URL = f"http://localhost:{VITE_PORT}"


@pytest.fixture(scope="session", autouse=True)
def mock_api():
    """Start the mock API server for the entire test session."""
    server = start_mock_server(MOCK_API_PORT)
    yield server
    server.shutdown()


@pytest.fixture(scope="session")
def vite_server():
    """Start the Vite dev server for the entire test session."""
    # Check if already running
    try:
        urllib.request.urlopen(VITE_URL, timeout=2)
        yield VITE_URL  # Already running, reuse it
        return
    except Exception:
        pass

    # Start Vite
    app_dir = os.path.join(os.path.dirname(__file__), "..", "packages", "app")
    env = {
        **os.environ,
        "VITE_LIBRECODE_SERVER_HOST": "127.0.0.1",
        "VITE_LIBRECODE_SERVER_PORT": str(MOCK_API_PORT),
    }
    proc = subprocess.Popen(
        ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", str(VITE_PORT)],
        cwd=app_dir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # Wait for Vite to be ready
    for _ in range(30):
        try:
            urllib.request.urlopen(VITE_URL, timeout=1)
            break
        except Exception:
            time.sleep(1)
    else:
        proc.terminate()
        pytest.fail("Vite dev server failed to start within 30 seconds")

    yield VITE_URL
    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture(scope="session")
def browser():
    """Launch a Chromium browser for the test session."""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def context(browser: Browser):
    """Create a fresh browser context for each test."""
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 800},
        ignore_https_errors=True,
    )
    yield ctx
    ctx.close()


@pytest.fixture
def page(context: BrowserContext, vite_server: str):
    """Create a page pointed at the Vite dev server."""
    pg = context.new_page()
    pg.goto(vite_server, wait_until="load", timeout=30000)
    # Wait for the app shell to render — use a specific unique element
    pg.wait_for_load_state("domcontentloaded")
    # Give the SPA a moment to hydrate
    pg.wait_for_timeout(3000)
    yield pg
    pg.close()
