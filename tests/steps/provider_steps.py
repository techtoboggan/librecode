"""Step implementations for provider.feature"""

import pytest
from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

scenarios("../features/provider.feature")


# ── Given steps ──

@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """App is already loaded via the page fixture — just verify it's interactive."""
    page.wait_for_selector("button, input, [data-component]", timeout=10000)


@given(parsers.parse('LiteLLM is running on "{url}"'))
def litellm_running(url: str):
    """Skip if LiteLLM isn't actually running (for autodiscovery tests)."""
    import urllib.request
    try:
        urllib.request.urlopen(f"{url}/v1/models", timeout=3)
    except Exception:
        pytest.skip("LiteLLM not running — skipping autodiscovery test")


@given(parsers.parse('LiteLLM is NOT running on "{url}"'))
def litellm_not_running(url: str):
    """Verify LiteLLM is NOT accessible."""
    import urllib.request
    try:
        urllib.request.urlopen(f"{url}/v1/models", timeout=2)
        pytest.skip("LiteLLM IS running — can't test fallback")
    except Exception:
        pass


@given("no providers are configured")
def no_providers():
    """Default mock state has no configured providers."""
    pass


# ── When steps ──

@when(parsers.parse('I click "{text}" in the bottom bar'))
def click_bottom_bar(page: Page, text: str):
    """Click an element in the bottom bar by text."""
    page.get_by_text(text, exact=False).first.click()
    page.wait_for_timeout(500)


@when(parsers.parse('I click "{text}"'))
def click_text(page: Page, text: str):
    """Click any visible element by text."""
    page.get_by_text(text, exact=False).first.click()
    page.wait_for_timeout(500)


@when(parsers.parse('I search for "{query}" in the provider dialog'))
def search_providers(page: Page, query: str):
    """Type in the provider search input."""
    inputs = page.locator("input[placeholder*='search' i], input[type='search'], [role='dialog'] input, [role='combobox']")
    inputs.first.fill(query)
    page.wait_for_timeout(500)


# ── Then steps ──

@then(parsers.parse('I should see "{text}" in the provider list'))
def see_in_provider_list(page: Page, text: str):
    """Assert text appears in the current view."""
    expect(page.get_by_text(text, exact=False).first).to_be_visible(timeout=5000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text does NOT appear on the page."""
    locator = page.get_by_text(text, exact=False)
    expect(locator).to_have_count(0, timeout=3000)


@then("I should see LiteLLM models in the model list")
def see_litellm_models(page: Page):
    """Assert that models are visible in the selector."""
    models = page.locator("[data-component='model-item'], [role='option'], [role='listitem']")
    expect(models.first).to_be_visible(timeout=5000)


@then(parsers.parse('I should see "{text}" guidance'))
def see_guidance(page: Page, text: str):
    """Assert guidance text is visible."""
    expect(page.get_by_text(text, exact=False).first).to_be_visible(timeout=5000)
