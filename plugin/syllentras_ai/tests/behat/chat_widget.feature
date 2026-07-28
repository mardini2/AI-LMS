@syllentras_ai @javascript
Feature: Chat widget basic interaction
  In order to get help with course material
  As a student
  I need to be able to open the chat widget and send a message

  Background:
    Given the following "courses" exist:
      | fullname | shortname | category |
      | Course 1 | C1        | 0        |
    And the following "users" exist:
      | username | firstname | lastname | email |
      | student1 | Student   | One      | student1@example.com |
    And the following "course enrolments" exist:
      | user     | course | role    |
      | student1 | C1     | student |

  Scenario: Student can open the chat widget
    Given I log in as "student1"
    And I am on "Course 1" course homepage
    When I click on "#syllentras-chat-btn" "css_element"
    Then "#syllentras-chat-panel" "css_element" should be visible