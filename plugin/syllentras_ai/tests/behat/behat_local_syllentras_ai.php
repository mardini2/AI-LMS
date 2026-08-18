<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Behat steps for the Syllentras chat widget.
 *
 * @package   local_syllentras_ai
 * @category  test
 * @copyright 2026
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

// NOTE: no MOODLE_INTERNAL test here, this file may be required by behat before including /config.php.

require_once(__DIR__ . '/../../../../lib/behat/behat_base.php');

/**
 * Custom steps that wait on async chat UI the core Mink steps cannot express.
 *
 * @package   local_syllentras_ai
 * @category  test
 */
class behat_local_syllentras_ai extends behat_base {

    /**
     * Wait until the general conversation has loaded far enough to send.
     *
     * Opening the launcher kicks off /conversations/open; sendMessage() no-ops
     * until conversationId is set. The seeded welcome bubble is the visible
     * signal that that handshake finished.
     *
     * @Given /^I wait until the Syllentras chat is ready$/
     */
    public function i_wait_until_the_syllentras_chat_is_ready(): void {
        $this->spin(function () {
            $panel = $this->getSession()->getPage()->find('css', '#syllentras-chat-panel');
            if (!$panel || !$panel->isVisible()) {
                return false;
            }
            $input = $this->getSession()->getPage()->find('css', '#syllentras-chat-input');
            if (!$input || !$input->isVisible()) {
                return false;
            }
            $assistants = $this->getSession()->getPage()->findAll(
                'css',
                '#syllentras-chat-messages .syllentras-msg.assistant'
            );
            foreach ($assistants as $node) {
                $text = trim($node->getText());
                if ($text !== '' && $text !== '...') {
                    return true;
                }
            }
            return false;
        }, false, behat_base::get_extended_timeout());
    }

    /**
     * @When /^I type "(?P<message>(?:[^"]|\\")*)" in the Syllentras chat input$/
     * @param string $message
     */
    public function i_type_in_the_syllentras_chat_input(string $message): void {
        $input = $this->find('css', '#syllentras-chat-input');
        $input->setValue($message);
    }

    /**
     * @When /^I send the Syllentras chat message$/
     */
    public function i_send_the_syllentras_chat_message(): void {
        $this->find('css', '#syllentras-chat-send')->click();
    }

    /**
     * @Then /^I should see a Syllentras user message containing "(?P<needle>(?:[^"]|\\")*)"$/
     * @param string $needle
     */
    public function i_should_see_a_syllentras_user_message_containing(string $needle): void {
        $this->assert_message_bubble_contains('user', $needle, false);
    }

    /**
     * A finished assistant turn — not the "..." placeholder and not the
     * seeded Main/Home welcome (those already exist before the student types).
     *
     * @Then /^I should see a Syllentras assistant reply containing "(?P<needle>(?:[^"]|\\")*)"$/
     * @param string $needle
     */
    public function i_should_see_a_syllentras_assistant_reply_containing(string $needle): void {
        $this->assert_message_bubble_contains('assistant', $needle, true);
    }

    /**
     * Spin until a chat bubble of the given role contains $needle.
     *
     * @param string $role user|assistant
     * @param string $needle
     * @param bool $skipwelcome
     */
    private function assert_message_bubble_contains(
        string $role,
        string $needle,
        bool $skipwelcome
    ): void {
        $this->spin(function () use ($role, $needle, $skipwelcome) {
            $nodes = $this->getSession()->getPage()->findAll(
                'css',
                '#syllentras-chat-messages .syllentras-msg.' . $role
            );
            foreach ($nodes as $node) {
                $text = trim(preg_replace('/\s+/', ' ', $node->getText()) ?? '');
                if ($text === '' || $text === '...') {
                    continue;
                }
                if ($skipwelcome && $this->is_seeded_welcome($text)) {
                    continue;
                }
                if (str_contains($text, $needle)) {
                    return true;
                }
            }
            return false;
        }, false, behat_base::get_extended_timeout());
    }

    /**
     * Same heuristic as boot.js isSeededWelcomeBubble().
     *
     * @param string $text
     * @return bool
     */
    private function is_seeded_welcome(string $text): bool {
        return (bool) preg_match("/I'm Syllentras AI/i", $text)
            && (bool) preg_match('/chat in any language/i', $text);
    }
}
