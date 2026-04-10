Feature: Model Selection
  As a LibreCode user
  I want to select AI models from connected providers
  So that I can use the right model for my task

  @models @smoke
  Scenario: Model selector opens
    Given the LibreCode app is running at "http://localhost:1420"
    When I click "Select model" in the bottom bar
    Then the model selection dialog should be visible

  @models
  Scenario: No free model messaging
    Given the LibreCode app is running at "http://localhost:1420"
    When I click "Select model" in the bottom bar
    Then I should NOT see "Free models" on the page
    And I should NOT see "provided by LibreCode" on the page

  @models
  Scenario: Connect provider guidance shown when no providers
    Given the LibreCode app is running at "http://localhost:1420"
    And no providers are configured
    When I click "Select model" in the bottom bar
    Then I should see guidance to connect a provider
