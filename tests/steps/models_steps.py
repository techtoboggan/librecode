"""Step implementations for models.feature"""

from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

scenarios("../features/models.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """Navigate to the app and wait for load."""
    page.goto(url, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("text=Build anything, text=Select model, button", timeout=15000)


@given("no providers are configured")
def no_providers():
    """No-op — default dev env has no providers."""
    pass


@when(parsers.parse('I click "{text}" in the bottom bar'))
def click_bottom_bar(page: Page, text: str):
    """Click element in the bottom bar."""
    page.get_by_text(text, exact=False).first.click()
    page.wait_for_timeout(500)


@then("the model selection dialog should be visible")
def model_dialog_visible(page: Page):
    """Assert model selection dialog is open."""
    dialog = page.locator("[role='dialog'], [data-component='model-selector']").first
    expect(dialog).to_be_visible(timeout=5000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text NOT visible."""
    locator = page.get_by_text(text, exact=False)
    expect(locator).to_have_count(0, timeout=3000)


@then("I should see guidance to connect a provider")
def see_connect_guidance(page: Page):
    """Assert connect provider guidance visible."""
    content = page.content()
    assert "connect" in content.lower() or "provider" in content.lower(), \
        "Expected provider connection guidance"
