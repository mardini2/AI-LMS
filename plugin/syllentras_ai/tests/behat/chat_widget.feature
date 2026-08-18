@syllentras_ai @javascript
Feature: Chat widget basic interaction
  In order to get help with course material
  As a student
  I need to be able to open the chat widget, send a message, and come back to it

  Background:
    Given the following "courses" exist:
      | fullname | shortname | category |
      | Course 1 | C1        | 0        |
    And the following "users" exist:
      | username | firstname | lastname | email                |
      | student1 | Student   | One      | student1@example.com |
    And the following "course enrolments" exist:
      | user     | course | role    |
      | student1 | C1     | student |
    # Selenium loads Moodle at http://webserver; the Nest API is the "api" service.
    And the following config values are set as admin:
      | api_url | http://api:3000 | local_syllentras_ai |

  Scenario: Student can open the chat widget
    Given I log in as "student1"
    And I am on "Course 1" course homepage
    When I click on "#syllentras-chat-btn" "css_element"
    Then "#syllentras-chat-panel" "css_element" should be visible

  Scenario: Student can send a message and see an assistant reply
    Given I log in as "student1"
    And I am on "Course 1" course homepage
    When I click on "#syllentras-chat-btn" "css_element"
    And I wait until the Syllentras chat is ready
    And I type "What is a page fault?" in the Syllentras chat input
    And I send the Syllentras chat message
    Then I should see a Syllentras user message containing "What is a page fault?"
    And I should see a Syllentras assistant reply containing "Behat stub:"

  Scenario: Closing the widget hides the panel and shows the launcher
    Given I log in as "student1"
    And I am on "Course 1" course homepage
    When I click on "#syllentras-chat-btn" "css_element"
    And I wait until the Syllentras chat is ready
    And I click on "#syllentras-chat-close" "css_element"
    Then "#syllentras-chat-panel" "css_element" should not be visible
    # The launcher uses display:flex, which wins over the HTML hidden attribute,
    # so the bubble stays in the corner; only the expanded panel toggles.
    And "#syllentras-chat-btn" "css_element" should be visible

  Scenario: Reopening the widget restores the course Main conversation
    Given I log in as "student1"
    And I am on "Course 1" course homepage
    When I click on "#syllentras-chat-btn" "css_element"
    And I wait until the Syllentras chat is ready
    And I type "Remind me about paging" in the Syllentras chat input
    And I send the Syllentras chat message
    And I should see a Syllentras assistant reply containing "Behat stub:"
    And I click on "#syllentras-chat-close" "css_element"
    And I click on "#syllentras-chat-btn" "css_element"
    Then "#syllentras-chat-panel" "css_element" should be visible
    And I should see "Main" in the "#syllentras-chat-active-title" "css_element"
    And I should see a Syllentras user message containing "Remind me about paging"
    And I should see a Syllentras assistant reply containing "Behat stub:"

  Scenario: The chat widget is not shown to visitors who are not logged in
    Given I am on homepage
    Then "#syllentras-chat-root" "css_element" should not exist

  Scenario: Dashboard chat is Home rather than a course Main conversation
    Given I log in as "student1"
    And I am on homepage
    When I click on "#syllentras-chat-btn" "css_element"
    And I wait until the Syllentras chat is ready
    Then "#syllentras-chat-panel" "css_element" should be visible
    And I should see "Home" in the "#syllentras-chat-active-title" "css_element"
    And I should see "#Home" in the "#syllentras-chat-active-tag" "css_element"
