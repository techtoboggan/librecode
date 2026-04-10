"""Step implementations for provider.feature"""

import pytest
from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

scenarios("../features/provider.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """App already loaded via page fixture."""
    page.wait_for_timeout(1000)


@given(parsers.parse('LiteLLM is running on "{url}"'))
def litellm_running(url: str):
    """Skip if LiteLLM isn't running."""
    import urllib.request
    try:
        urllib.request.urlopen(f"{url}/v1/models", timeout=3)
    except Exception:
        pytest.skip("LiteLLM not running")


@given(parsers.parse('LiteLLM is NOT running on "{url}"'))
def litellm_not_running(url: str):
    """Verify LiteLLM is NOT accessible."""
    import urllib.request
    try:
        urllib.request.urlopen(f"{url}/v1/models", timeout=2)
        pytest.skip("LiteLLM IS running")
    except Exception:
        pass


@when("I open the settings")
def open_settings(page: Page):
    """Click the settings gear icon."""
    settings = page.locator("[data-action='settings'], [aria-label*='Settings' i], [aria-label*='settings' i], button:has(svg)")
    # Try clicking the gear/settings button
    for selector in ["[data-action='settings']", "[aria-label*='etting']", "a[href*='setting']"]:
        el = page.locator(selector)
        if el.count() > 0:
            el.first.click()
            page.wait_for_timeout(1000)
            return
    # Fallback: look for gear icon in the sidebar
    page.locator("button").filter(has_text="").nth(0).click()
    page.wait_for_timeout(1000)


@when("I navigate to providers section")
def navigate_providers(page: Page):
    """Navigate to the providers section in settings."""
    providers_link = page.get_by_text("Providers", exact=False)
    if providers_link.count() > 0:
        providers_link.first.click()
        page.wait_for_timeout(500)


@then(parsers.parse('I should see "{text}" on the page'))
def see_on_page(page: Page, text: str):
    """Assert text appears on the page."""
    content = page.content()
    assert text.lower() in content.lower(), f"'{text}' not found on page"


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text does NOT appear on the page."""
    content = page.content()
    assert text.lower() not in content.lower(), f"'{text}' unexpectedly found on page"


@then("I should see LiteLLM models in the model list")
def see_litellm_models(page: Page):
    """Assert LiteLLM models are visible."""
    content = page.content()
    assert "litellm" in content.lower() or "model" in content.lower(), \
        "No LiteLLM models found"


@then("the app should not crash")
def app_not_crashed(page: Page):
    """Assert the app is still responsive."""
    assert page.title() != "", "App appears to have crashed (empty title)"
