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
 * List private AI Content activities for one student.
 */
class list_private_content extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id'),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $userid
     * @return array
     */
    public static function execute(int $courseid, int $userid): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/group/lib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'userid' => $userid,
        ]);

        $courseid = (int) $params['courseid'];
        $userid = (int) $params['userid'];

        if ($courseid < 2) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'courseid is required');
        }
        if ($userid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'userid is required');
        }

        $course = get_course($courseid);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0])) {
            throw new moodle_exception('invaliduser', 'error');
        }

        $group = groups_get_group_by_idnumber($course->id, 'syllentras_ai_' . $userid);
        if (!$group) {
            return ['items' => []];
        }

        $modinfo = get_fast_modinfo($course);
        $sectionnum = null;
        foreach ($modinfo->get_section_info_all() as $sectioninfo) {
            $sectionname = trim(get_section_name($course, $sectioninfo));
            if (strcasecmp($sectionname, placement::SECTION_NAME) === 0) {
                $sectionnum = (int) $sectioninfo->section;
                break;
            }
        }

        if ($sectionnum === null) {
            return ['items' => []];
        }

        $sectioncmids = $modinfo->sections[$sectionnum] ?? [];
        $items = [];
        $sortorder = 0;

        foreach ($sectioncmids as $cmid) {
            $cminfo = $modinfo->cms[$cmid] ?? null;
            if (!$cminfo || $cminfo->deletioninprogress) {
                continue;
            }
            if ($cminfo->modname !== 'page' && $cminfo->modname !== 'quiz') {
                continue;
            }
            if (!placement::availability_requires_group($cminfo->availability, (int) $group->id)) {
                continue;
            }

            $kind = placement::detect_kind($cminfo->modname, (int) $cminfo->instance);
            $timemodified = 0;
            $cmrecord = $cminfo->get_course_module_record(true);
            if ($cmrecord && !empty($cmrecord->timemodified)) {
                $timemodified = (int) $cmrecord->timemodified;
            }

            $items[] = [
                'cmid' => (int) $cminfo->id,
                'modname' => $cminfo->modname,
                'name' => $cminfo->name,
                'kind' => $kind,
                'viewurl' => placement::view_url_for($cminfo->modname, (int) $cminfo->id),
                'sortorder' => $sortorder,
                'timemodified' => $timemodified,
            ];
            $sortorder++;
        }

        return ['items' => $items];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'items' => new external_multiple_structure(
                new external_single_structure([
                    'cmid' => new external_value(PARAM_INT, 'Course module id'),
                    'modname' => new external_value(PARAM_PLUGIN, 'Module name'),
                    'name' => new external_value(PARAM_TEXT, 'Activity name'),
                    'kind' => new external_value(PARAM_ALPHANUMEXT, 'study_guide|flashcards|practice_quiz'),
                    'viewurl' => new external_value(PARAM_URL, 'Browser view URL'),
                    'sortorder' => new external_value(PARAM_INT, 'Index in AI Content section sequence'),
                    'timemodified' => new external_value(PARAM_INT, 'course_modules.timemodified unix time'),
                ])
            ),
        ]);
    }
}
