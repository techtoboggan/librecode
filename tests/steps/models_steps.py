"""Step implementations for models.feature"""

from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

scenarios("../features/models.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """App loaded via page fixture."""
    page.wait_for_selector("button, input, [data-component]", timeout=10000)


@given("no providers are configured")
def no_providers():
    """Default mock state — no providers configured."""
    pass


@when(parsers.parse('I click "{text}" in the bottom bar'))
def click_bottom_bar(page: Page, text: str):
    """Click element in bottom bar."""
    page.get_by_text(text, exact=False).first.click()
    page.wait_for_timeout(500)


@then("the model selection dialog should be visible")
def model_dialog_visible(page: Page):
    """Assert model dialog is open."""
    dialog = page.locator("[role='dialog'], [data-component='model-selector'], [data-component='dialog']")
    expect(dialog.first).to_be_visible(timeout=5000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text NOT visible."""
    locator = page.get_by_text(text, exact=False)
    expect(locator).to_have_count(0, timeout=3000)


@then("I should see guidance to connect a provider")
def see_connect_guidance(page: Page):
    """Assert provider connection guidance."""
    content = page.content().lower()
    assert any(word in content for word in ["connect", "provider", "add"]), \
        "Expected provider connection guidance on page"
