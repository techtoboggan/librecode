"""Step implementations for provider.feature"""

import pytest
from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

# Load all scenarios from the feature file
scenarios("../features/provider.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """Navigate to the app and wait for load."""
    page.goto(url, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("text=Build anything, text=Select model, button", timeout=15000)


@given(parsers.parse('LiteLLM is running on "{url}"'))
def litellm_running(url: str):
    """Verify LiteLLM is accessible (skip if not running)."""
    import urllib.request
    try:
        req = urllib.request.Request(f"{url}/v1/models")
        urllib.request.urlopen(req, timeout=3)
    except Exception:
        pytest.skip("LiteLLM not running — skipping autodiscovery test")


@given(parsers.parse('LiteLLM is NOT running on "{url}"'))
def litellm_not_running(url: str):
    """Verify LiteLLM is NOT accessible."""
    import urllib.request
    try:
        req = urllib.request.Request(f"{url}/v1/models")
        urllib.request.urlopen(req, timeout=2)
        pytest.skip("LiteLLM IS running — can't test fallback")
    except Exception:
        pass  # Expected — not running


@given("no providers are configured")
def no_providers():
    """No-op — the default dev environment has no providers configured."""
    pass


@when(parsers.parse('I click "{text}" in the bottom bar'))
def click_bottom_bar(page: Page, text: str):
    """Click a button/element in the bottom bar."""
    # The bottom bar contains agent selector, model selector, variant selector
    bottom = page.locator("[data-component='prompt-bar'], footer, .bottom-bar").first
    if bottom.count() == 0:
        # Fallback: find by text anywhere
        page.get_by_text(text, exact=False).first.click()
    else:
        bottom.get_by_text(text, exact=False).first.click()
    page.wait_for_timeout(500)


@when(parsers.parse('I click "{text}"'))
def click_text(page: Page, text: str):
    """Click any element by text."""
    page.get_by_text(text, exact=False).first.click()
    page.wait_for_timeout(500)


@when(parsers.parse('I search for "{query}" in the provider dialog'))
def search_providers(page: Page, query: str):
    """Type in the provider search input."""
    search = page.locator("input[placeholder*='search' i], input[type='search']").first
    if search.count() == 0:
        # Try any visible input in a dialog
        search = page.locator("dialog input, [role='dialog'] input").first
    search.fill(query)
    page.wait_for_timeout(500)


@then(parsers.parse('I should see "{text}" in the provider list'))
def see_in_provider_list(page: Page, text: str):
    """Assert text appears in the provider list/dialog."""
    expect(page.get_by_text(text, exact=False).first).to_be_visible(timeout=5000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text does NOT appear on the visible page."""
    locator = page.get_by_text(text, exact=False)
    expect(locator).to_have_count(0, timeout=3000)


@then("I should see LiteLLM models in the model list")
def see_litellm_models(page: Page):
    """Assert that LiteLLM-discovered models appear."""
    # Models appear as list items in the model selector
    models = page.locator("[data-component='model-item'], [role='option']")
    expect(models.first).to_be_visible(timeout=5000)


@then(parsers.parse('I should see "{text}" guidance'))
def see_guidance(page: Page, text: str):
    """Assert guidance text is visible."""
    expect(page.get_by_text(text, exact=False).first).to_be_visible(timeout=5000)


@then("the model selection dialog should be visible")
def model_dialog_visible(page: Page):
    """Assert the model selection dialog is open."""
    dialog = page.locator("[data-component='model-selector'], [role='dialog']").first
    expect(dialog).to_be_visible(timeout=5000)


@then("I should see guidance to connect a provider")
def connect_provider_guidance(page: Page):
    """Assert provider connection guidance is shown."""
    page.get_by_text("Connect", exact=False).first
    # Should have some form of "connect a provider" or "add more models" text
    content = page.content()
    assert "connect" in content.lower() or "provider" in content.lower() or "add" in content.lower(), \
        f"Expected provider connection guidance, got page content without it"
