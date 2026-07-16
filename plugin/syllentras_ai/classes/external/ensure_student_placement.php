<?php
namespace local_syllentras_ai\external;

defined('MOODLE_INTERNAL') || die();

use context_course;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;
use moodle_exception;
use stdClass;

/**
 * Ensure a shared AI Content section and a private per-student group exist.
 */
class ensure_student_placement extends external_api {

    /** @var string Stable display name for the shared course section. */
    public const SECTION_NAME = 'AI Content';

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
        global $CFG, $DB;

        require_once($CFG->dirroot . '/course/lib.php');
        require_once($CFG->dirroot . '/group/lib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'userid' => $userid,
        ]);
        $courseid = $params['courseid'];
        $userid = $params['userid'];

        $course = get_course($courseid);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0])) {
            throw new moodle_exception('invaliduser', 'error');
        }

        if (!is_enrolled($context, $userid, '', true)) {
            throw new moodle_exception('usernotenrolled', 'local_syllentras_ai');
        }

        self::ensure_course_groups_enabled($course);

        $section = self::ensure_ai_content_section($course);
        $group = self::ensure_student_group($course->id, $userid);

        $availability = [
            'op' => '&',
            'c' => [
                ['type' => 'group', 'id' => (int) $group->id],
            ],
            'showc' => [false],
        ];

        return [
            'sectionid' => (int) $section->id,
            'sectionnum' => (int) $section->section,
            'groupid' => (int) $group->id,
            'groupname' => $group->name,
            'availabilityjson' => json_encode($availability, JSON_UNESCAPED_UNICODE),
        ];
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

    /**
     * Enable visible groups on the course when group mode is off.
     *
     * @param stdClass $course Course record (may be updated in-place).
     */
    private static function ensure_course_groups_enabled(stdClass $course): void {
        global $DB;

        if ((int) $course->groupmode !== 0) {
            return;
        }

        $DB->set_field('course', 'groupmode', VISIBLEGROUPS, ['id' => $course->id]);
        $course->groupmode = VISIBLEGROUPS;
        rebuild_course_cache($course->id, true);
    }

    /**
     * Find or create the shared AI Content section.
     *
     * @param stdClass $course Course record.
     * @return stdClass Section record (id + section number).
     */
    private static function ensure_ai_content_section(stdClass $course): stdClass {
        global $DB;

        $sections = $DB->get_records('course_sections', ['course' => $course->id], 'section ASC');
        foreach ($sections as $section) {
            if (trim((string) $section->name) === self::SECTION_NAME) {
                return $section;
            }
        }

        // position 0 = append at end. skipcheck must be false: with skipcheck true,
        // Moodle treats position 0 as literal section number 0 (General) and fails.
        $created = course_create_section($course, 0, false);
        course_update_section($course, $created, ['name' => self::SECTION_NAME]);

        $section = $DB->get_record('course_sections', ['id' => $created->id], '*', MUST_EXIST);
        return $section;
    }

    /**
     * Find or create the private group for this student and ensure membership.
     *
     * @param int $courseid Course id.
     * @param int $userid Student user id.
     * @return stdClass Group record.
     */
    private static function ensure_student_group(int $courseid, int $userid): stdClass {
        $idnumber = 'syllentras_ai_' . $userid;
        $groupname = 'Syllentras AI — ' . $userid;

        $group = groups_get_group_by_idnumber($courseid, $idnumber);
        if (!$group) {
            $data = new stdClass();
            $data->courseid = $courseid;
            $data->name = $groupname;
            $data->idnumber = $idnumber;
            $data->description = 'Private Syllentras AI content group for user ' . $userid;
            $data->descriptionformat = FORMAT_PLAIN;
            $groupid = groups_create_group($data);
            $group = groups_get_group($groupid, '*', MUST_EXIST);
        }

        if (!groups_is_member($group->id, $userid)) {
            groups_add_member($group->id, $userid);
        }

        return $group;
    }
}
