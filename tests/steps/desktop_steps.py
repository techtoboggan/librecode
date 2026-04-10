"""Step implementations for desktop.feature"""

from pytest_bdd import scenarios, given, when, then, parsers
from playwright.sync_api import Page, expect

scenarios("../features/desktop.feature")


@given(parsers.parse('the LibreCode app is running at "{url}"'))
def app_running(page: Page, url: str):
    """Navigate to the app and wait for load."""
    page.goto(url, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("text=Build anything, text=Select model, button", timeout=15000)


@then(parsers.parse('the page title should contain "{text}"'))
def page_title_contains(page: Page, text: str):
    """Assert the page/window title contains the expected text."""
    expect(page).to_have_title(f"*{text}*", timeout=5000)


@then(parsers.parse('I should see the "{text}" logo mark on the page'))
def see_logo_mark(page: Page, text: str):
    """Assert the logo mark/text is visible on the page."""
    # The LC mark is rendered as SVG text or an image
    logo = page.locator(f"text='{text}', [data-component='logo-mark'], [data-component='logo-splash']").first
    expect(logo).to_be_visible(timeout=5000)


@then(parsers.parse('I should NOT see "{text}" on the page'))
def not_see_on_page(page: Page, text: str):
    """Assert text does NOT appear on the visible page."""
    locator = page.get_by_text(text, exact=True)
    expect(locator).to_have_count(0, timeout=3000)


@then(parsers.parse('the page source should not contain "{text}" (excluding history references)'))
def source_not_contain(page: Page, text: str):
    """Assert the page source doesn't contain the text (with exclusions)."""
    content = page.content()
    # Filter out acceptable references
    lines = content.split("\n")
    violations = []
    for i, line in enumerate(lines):
        if text.lower() in line.lower():
            # Allow: "forked from opencode", historical ADR references
            if "fork" in line.lower() or "history" in line.lower() or "adr" in line.lower():
                continue
            violations.append(f"Line {i}: {line.strip()[:100]}")

    assert len(violations) == 0, f"Found '{text}' in page source:\n" + "\n".join(violations[:5])


@then(parsers.parse('the page source should not contain "{text}" (excluding theme names)'))
def source_not_contain_excluding_themes(page: Page, text: str):
    """Assert page source doesn't contain text (excluding theme file references)."""
    content = page.content()
    lines = content.split("\n")
    violations = []
    for i, line in enumerate(lines):
        if text.lower() in line.lower():
            # Allow: zenburn theme, zen garden, etc.
            if "zenburn" in line.lower() or "theme" in line.lower():
                continue
            violations.append(f"Line {i}: {line.strip()[:100]}")

    assert len(violations) == 0, f"Found '{text}' in page source:\n" + "\n".join(violations[:5])
