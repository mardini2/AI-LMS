<?php
namespace local_syllentras_ai\external;

defined('MOODLE_INTERNAL') || die();

use context_course;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;
use local_syllentras_ai\local\placement;
use moodle_exception;
use moodle_url;

/**
 * Update the HTML content of a private AI Content Page (study guide / flashcards).
 */
class update_private_page extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id of the Page'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id (owner)'),
            'content' => new external_value(PARAM_RAW, 'Page body HTML'),
            'name' => new external_value(PARAM_TEXT, 'Optional new page name', VALUE_DEFAULT, ''),
        ]);
    }

    /**
     * @param int $cmid
     * @param int $userid
     * @param string $content
     * @param string $name
     * @return array
     */
    public static function execute(int $cmid, int $userid, string $content, string $name = ''): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/course/lib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'cmid' => $cmid,
            'userid' => $userid,
            'content' => $content,
            'name' => $name,
        ]);

        $cmid = (int) $params['cmid'];
        $userid = (int) $params['userid'];
        $content = $params['content'] ?? '';
        $name = trim((string) ($params['name'] ?? ''));

        if (trim($content) === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'content is required');
        }

        $cm = get_coursemodule_from_id('page', $cmid, 0, false, MUST_EXIST);
        $course = get_course($cm->course);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        $owned = placement::assert_student_owned_cm($course, $cmid, $userid, 'page');

        $page = $DB->get_record('page', ['id' => $owned['instanceid']], '*', MUST_EXIST);
        $page->content = $content;
        $page->contentformat = FORMAT_HTML;
        $page->timemodified = time();
        if ($name !== '') {
            if (\core_text::strlen($name) > 200) {
                $name = \core_text::substr($name, 0, 200);
            }
            $page->name = $name;
            if (function_exists('set_coursemodule_name')) {
                set_coursemodule_name($cmid, $name);
            }
        }
        $DB->update_record('page', $page);

        rebuild_course_cache($course->id, true);

        $viewurl = (new moodle_url('/mod/page/view.php', ['id' => $cmid]))->out(false);

        return [
            'pageid' => (int) $page->id,
            'cmid' => $cmid,
            'name' => $page->name,
            'viewurl' => $viewurl,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'pageid' => new external_value(PARAM_INT, 'Page instance id'),
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'name' => new external_value(PARAM_TEXT, 'Page name'),
            'viewurl' => new external_value(PARAM_URL, 'Browser view URL'),
        ]);
    }
}
