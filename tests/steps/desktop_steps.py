"""Step implementations for desktop.feature"""

from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

scenarios("../features/desktop.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """App loaded via page fixture."""
    page.wait_for_selector("button, input, [data-component]", timeout=10000)


@then(parsers.parse('the page title should contain "{text}"'))
def page_title_contains(page: Page, text: str):
    """Assert the page title contains expected text."""
    title = page.title()
    assert text.lower() in title.lower(), f"Expected '{text}' in title, got '{title}'"


@then(parsers.parse('I should see the "{text}" logo mark on the page'))
def see_logo_mark(page: Page, text: str):
    """Assert the logo mark is visible."""
    # Check for SVG text, data attributes, or visible text
    logo = page.locator(f"text='{text}'").first
    expect(logo).to_be_visible(timeout=5000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text NOT visible."""
    locator = page.get_by_text(text, exact=True)
    expect(locator).to_have_count(0, timeout=3000)


@then(parsers.parse('the page source should not contain "{text}" (excluding history references)'))
def source_not_contain(page: Page, text: str):
    """Assert page source doesn't contain text."""
    content = page.content()
    lines = [l for l in content.split("\n")
             if text.lower() in l.lower()
             and "fork" not in l.lower()
             and "history" not in l.lower()]
    assert len(lines) == 0, f"Found '{text}' in page:\n" + "\n".join(lines[:3])


@then(parsers.parse('the page source should not contain "{text}" (excluding theme names)'))
def source_not_contain_themes(page: Page, text: str):
    """Assert page source doesn't contain text (excluding themes)."""
    content = page.content()
    lines = [l for l in content.split("\n")
             if text.lower() in l.lower()
             and "zenburn" not in l.lower()
             and "theme" not in l.lower()]
    assert len(lines) == 0, f"Found '{text}' in page:\n" + "\n".join(lines[:3])
