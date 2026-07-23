<?php
namespace local_syllentras_ai\external;

defined('MOODLE_INTERNAL') || die();

use context_course;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use local_syllentras_ai\local\placement;
use moodle_exception;

/**
 * Delete multiple private AI Content activities for one student.
 */
class delete_private_activities extends external_api {

    /** @var int Max cmids accepted in one request. */
    public const MAX_CMIDS = 50;

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id (owner)'),
            'cmids' => new external_multiple_structure(
                new external_value(PARAM_INT, 'Course module id'),
                'Course module ids to delete'
            ),
        ]);
    }

    /**
     * @param int $userid
     * @param array $cmids
     * @return array
     */
    public static function execute(int $userid, array $cmids): array {
        $params = self::validate_parameters(self::execute_parameters(), [
            'userid' => $userid,
            'cmids' => $cmids,
        ]);

        $userid = (int) $params['userid'];
        if ($userid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'userid is required');
        }

        $raw = array_map('intval', $params['cmids']);
        $unique = [];
        foreach ($raw as $cmid) {
            if ($cmid > 0) {
                $unique[$cmid] = $cmid;
            }
        }
        $cmids = array_values($unique);

        if (count($cmids) > self::MAX_CMIDS) {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'At most ' . self::MAX_CMIDS . ' items can be deleted at once'
            );
        }

        if (!$cmids) {
            return ['deleted' => [], 'failed' => []];
        }

        // Resolve course from the first resolvable cm; all AI Content items share a course.
        $course = null;
        $courseid = 0;
        foreach ($cmids as $cmid) {
            $cm = get_coursemodule_from_id(null, $cmid, 0, false, IGNORE_MISSING);
            if ($cm) {
                $course = get_course($cm->course);
                $courseid = (int) $course->id;
                break;
            }
        }

        if (!$course) {
            $failed = [];
            foreach ($cmids as $cmid) {
                $failed[] = [
                    'cmid' => $cmid,
                    'message' => 'Invalid course module',
                ];
            }
            return ['deleted' => [], 'failed' => $failed];
        }

        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        $deleted = [];
        $failed = [];

        foreach ($cmids as $cmid) {
            try {
                $cm = get_coursemodule_from_id(null, $cmid, 0, false, IGNORE_MISSING);
                if (!$cm || (int) $cm->course !== $courseid) {
                    throw new moodle_exception(
                        'invalidparameter',
                        'error',
                        '',
                        null,
                        'Invalid course module'
                    );
                }
                $owned = placement::delete_owned_cm($course, $cmid, $userid);
                $deleted[] = [
                    'cmid' => $cmid,
                    'courseid' => $courseid,
                    'modname' => $owned['modname'],
                    'kind' => $owned['kind'],
                    'deleted' => true,
                ];
            } catch (\Throwable $e) {
                $message = $e->getMessage();
                if ($e instanceof moodle_exception && !empty($e->debuginfo)) {
                    $message = (string) $e->debuginfo;
                }
                $failed[] = [
                    'cmid' => $cmid,
                    'message' => $message !== '' ? $message : 'Could not delete',
                ];
            }
        }

        return [
            'deleted' => $deleted,
            'failed' => $failed,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        $deleteditem = new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'Deleted course module id'),
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'modname' => new external_value(PARAM_PLUGIN, 'Module name'),
            'kind' => new external_value(PARAM_ALPHANUMEXT, 'study_guide|flashcards|practice_quiz'),
            'deleted' => new external_value(PARAM_BOOL, 'Always true on success'),
        ]);
        $faileditem = new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'Course module id that failed'),
            'message' => new external_value(PARAM_TEXT, 'Error message'),
        ]);

        return new external_single_structure([
            'deleted' => new external_multiple_structure($deleteditem),
            'failed' => new external_multiple_structure($faileditem),
        ]);
    }
}
