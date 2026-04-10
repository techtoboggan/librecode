Feature: Desktop Application
  As a LibreCode user
  I want the app to be properly branded
  So that I know I'm using LibreCode, not another product

  @desktop @smoke
  Scenario: Window title shows LibreCode
    Given the LibreCode app is running at "http://localhost:1420"
    Then the page title should contain "LibreCode"

  @desktop @smoke
  Scenario: Home screen shows LibreCode branding
    Given the LibreCode app is running at "http://localhost:1420"
    Then I should see the "LIBRE" logo mark on the page
    And I should NOT see "opencode" on the page
    And I should NOT see "OpenCode" on the page

  @desktop
  Scenario: No opencode references in UI
    Given the LibreCode app is running at "http://localhost:1420"
    Then the page source should not contain "opencode" (excluding history references)
    And the page source should not contain "Zen" (excluding theme names)
