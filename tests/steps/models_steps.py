"""Step implementations for models.feature"""

from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page

scenarios("../features/models.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """App already loaded via page fixture."""
    page.wait_for_timeout(1000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text does NOT appear on the page."""
    content = page.content()
    assert text.lower() not in content.lower(), f"'{text}' unexpectedly found on page"
