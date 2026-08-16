<?php
namespace local_syllentras_ai\external;

defined('MOODLE_INTERNAL') || die();

use context_course;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;
use local_syllentras_ai\local\placement;

/**
 * Ensure a shared AI Content section and a private per-student group exist.
 */
class ensure_student_placement extends external_api {

    /**
     * Describe parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'userid' => new external_value(PARAM_INT, 'Moodle user id of the student'),
        ]);
    }

    /**
     * Ensure AI Content section + private student group (idempotent).
     *
     * @param int $courseid Course id.
     * @param int $userid Student user id.
     * @return array Placement details for Path B activity creation.
     */
    public static function execute(int $courseid, int $userid): array {
        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'userid' => $userid,
        ]);

        $context = context_course::instance($params['courseid']);
        self::validate_context($context);

        return placement::ensure($params['courseid'], $params['userid'], true);
    }

    /**
     * Describe return values.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'sectionid' => new external_value(PARAM_INT, 'AI Content section id'),
            'sectionnum' => new external_value(PARAM_INT, 'AI Content section number'),
            'groupid' => new external_value(PARAM_INT, 'Private student group id'),
            'groupname' => new external_value(PARAM_TEXT, 'Private student group name'),
            'availabilityjson' => new external_value(
                PARAM_RAW,
                'Moodle availability JSON for restricting activities to the student group'
            ),
        ]);
    }
}
