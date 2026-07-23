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
 * Delete a private AI Content activity (page or quiz) for one student.
 */
class delete_private_activity extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id (owner)'),
        ]);
    }

    /**
     * @param int $cmid
     * @param int $userid
     * @return array
     */
    public static function execute(int $cmid, int $userid): array {
        global $CFG;

        require_once($CFG->dirroot . '/course/lib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'cmid' => $cmid,
            'userid' => $userid,
        ]);

        $cmid = (int) $params['cmid'];
        $userid = (int) $params['userid'];

        if ($cmid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'cmid is required');
        }
        if ($userid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'userid is required');
        }

        $cm = get_coursemodule_from_id(null, $cmid, 0, false, MUST_EXIST);
        $course = get_course($cm->course);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        $owned = placement::assert_student_owned_cm($course, $cmid, $userid);
        $courseid = (int) $course->id;

        course_delete_module($cmid, true);

        return [
            'cmid' => $cmid,
            'courseid' => $courseid,
            'modname' => $owned['modname'],
            'kind' => $owned['kind'],
            'deleted' => true,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'Deleted course module id'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'modname' => new external_value(PARAM_PLUGIN, 'Module name'),
            'kind' => new external_value(PARAM_ALPHANUMEXT, 'study_guide|flashcards|practice_quiz'),
            'deleted' => new external_value(PARAM_BOOL, 'Always true on success'),
        ]);
    }
}
