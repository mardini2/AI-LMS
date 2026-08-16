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

/**
 * Rename a private AI Content activity (page or quiz) for one student.
 */
class rename_private_activity extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id (owner)'),
            'name' => new external_value(PARAM_TEXT, 'New activity name'),
        ]);
    }

    /**
     * @param int $cmid
     * @param int $userid
     * @param string $name
     * @return array
     */
    public static function execute(int $cmid, int $userid, string $name): array {
        $params = self::validate_parameters(self::execute_parameters(), [
            'cmid' => $cmid,
            'userid' => $userid,
            'name' => $name,
        ]);

        $cmid = (int) $params['cmid'];
        $userid = (int) $params['userid'];
        $name = trim($params['name']);

        if ($name === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'name is required');
        }

        $cm = get_coursemodule_from_id(null, $cmid, 0, false, MUST_EXIST);
        $course = get_course($cm->course);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        return placement::rename_owned_cm($course, $cmid, $userid, $name);
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'modname' => new external_value(PARAM_PLUGIN, 'Module name'),
            'name' => new external_value(PARAM_TEXT, 'Activity name'),
            'kind' => new external_value(PARAM_ALPHANUMEXT, 'study_guide|flashcards|practice_quiz'),
            'viewurl' => new external_value(PARAM_URL, 'Browser view URL'),
        ]);
    }
}
