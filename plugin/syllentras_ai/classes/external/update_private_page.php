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
        ]);
    }

    /**
     * @param int $cmid
     * @param int $userid
     * @param string $content
     * @return array
     */
    public static function execute(int $cmid, int $userid, string $content): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/course/lib.php');
        require_once($CFG->dirroot . '/group/lib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'cmid' => $cmid,
            'userid' => $userid,
            'content' => $content,
        ]);

        $cmid = (int) $params['cmid'];
        $userid = (int) $params['userid'];
        $content = $params['content'] ?? '';

        if ($cmid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'cmid is required');
        }
        if ($userid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'userid is required');
        }
        if (trim($content) === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'content is required');
        }

        $cm = get_coursemodule_from_id('page', $cmid, 0, false, MUST_EXIST);
        $course = get_course($cm->course);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0])) {
            throw new moodle_exception('invaliduser', 'error');
        }

        $modinfo = get_fast_modinfo($course);
        $cminfo = $modinfo->get_cm($cmid);
        $sectioninfo = $modinfo->get_section_info($cminfo->sectionnum);
        $sectionname = trim(get_section_name($course, $sectioninfo));
        if (strcasecmp($sectionname, placement::SECTION_NAME) !== 0) {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'Page is not in the AI Content section'
            );
        }

        $group = groups_get_group_by_idnumber($course->id, 'syllentras_ai_' . $userid);
        if (!$group) {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'Student AI Content group not found'
            );
        }

        if (!self::availability_requires_group($cm->availability, (int) $group->id)) {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'Page is not restricted to this student'
            );
        }

        $page = $DB->get_record('page', ['id' => $cm->instance], '*', MUST_EXIST);
        $page->content = $content;
        $page->contentformat = FORMAT_HTML;
        $page->timemodified = time();
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

    /**
     * True if availability JSON requires the given group id (direct group condition).
     *
     * @param string|null $availabilityjson
     * @param int $groupid
     * @return bool
     */
    private static function availability_requires_group(?string $availabilityjson, int $groupid): bool {
        if ($availabilityjson === null || trim($availabilityjson) === '') {
            return false;
        }
        $tree = json_decode($availabilityjson, true);
        if (!is_array($tree)) {
            return false;
        }
        return self::availability_tree_has_group($tree, $groupid);
    }

    /**
     * @param array $node
     * @param int $groupid
     * @return bool
     */
    private static function availability_tree_has_group(array $node, int $groupid): bool {
        if (isset($node['type']) && $node['type'] === 'group') {
            return (int) ($node['id'] ?? 0) === $groupid;
        }
        if (!empty($node['c']) && is_array($node['c'])) {
            foreach ($node['c'] as $child) {
                if (is_array($child) && self::availability_tree_has_group($child, $groupid)) {
                    return true;
                }
            }
        }
        return false;
    }
}
