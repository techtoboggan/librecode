Feature: Provider Management
  As a LibreCode user
  I want to connect LLM providers
  So that I can use AI models for coding assistance

  @provider @smoke
  Scenario: LiteLLM appears in provider search
    Given the LibreCode app is running at "http://localhost:1420"
    When I open the settings
    And I navigate to providers section
    Then I should see "LiteLLM" on the page

  @provider
  Scenario: Popular providers are listed
    Given the LibreCode app is running at "http://localhost:1420"
    When I open the settings
    And I navigate to providers section
    Then I should see "Anthropic" on the page
    And I should see "OpenAI" on the page

  @provider
  Scenario: No hosted LibreCode provider
    Given the LibreCode app is running at "http://localhost:1420"
    When I open the settings
    And I navigate to providers section
    Then I should NOT see "Free models provided by" on the page
    And I should NOT see "LibreCode Zen" on the page

  @provider
  Scenario: LiteLLM autodiscovery when running
    Given LiteLLM is running on "http://localhost:4000"
    And the LibreCode app is running at "http://localhost:1420"
    Then I should see LiteLLM models in the model list

  @provider
  Scenario: Graceful fallback when LiteLLM not running
    Given LiteLLM is NOT running on "http://localhost:4000"
    And the LibreCode app is running at "http://localhost:1420"
    Then the app should not crash
