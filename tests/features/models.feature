Feature: Model Selection
  As a LibreCode user
  I want to select AI models from connected providers
  So that I can use the right model for my task

  @models @smoke
  Scenario: No free model messaging
    Given the LibreCode app is running at "http://localhost:1420"
    Then I should NOT see "Free models" on the page
    And I should NOT see "provided by LibreCode" on the page

  @models
  Scenario: No Zen or Go messaging
    Given the LibreCode app is running at "http://localhost:1420"
    Then I should NOT see "LibreCode Zen" on the page
    And I should NOT see "LibreCode Go" on the page
    And I should NOT see "$10 per month" on the page
