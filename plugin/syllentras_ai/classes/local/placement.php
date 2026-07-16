<?php
namespace local_syllentras_ai\local;

defined('MOODLE_INTERNAL') || die();

use context_course;
use moodle_exception;
use stdClass;

/**
 * Shared AI Content section + private student group placement.
 */
class placement {

    /** @var string Stable display name for the shared course section. */
    public const SECTION_NAME = 'AI Content';

    /**
     * Ensure AI Content section + private student group (idempotent).
     *
     * @param int $courseid Course id.
     * @param int $userid Student user id.
     * @param bool $checkcapability When true, require manageplacement in course context.
     * @return array{sectionid:int,sectionnum:int,groupid:int,groupname:string,availabilityjson:string}
     */
    public static function ensure(int $courseid, int $userid, bool $checkcapability = true): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/course/lib.php');
        require_once($CFG->dirroot . '/group/lib.php');

        $course = get_course($courseid);
        $context = context_course::instance($course->id);

        if ($checkcapability) {
            require_capability('local/syllentras_ai:manageplacement', $context);
        }

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
     * @param stdClass $course Course record.
     * @return stdClass Section record.
     */
    private static function ensure_ai_content_section(stdClass $course): stdClass {
        global $DB;

        $sections = $DB->get_records('course_sections', ['course' => $course->id], 'section ASC');
        foreach ($sections as $section) {
            if (trim((string) $section->name) === self::SECTION_NAME) {
                return $section;
            }
        }

        // position 0 = append at end. skipcheck must be false.
        $created = course_create_section($course, 0, false);
        course_update_section($course, $created, ['name' => self::SECTION_NAME]);

        return $DB->get_record('course_sections', ['id' => $created->id], '*', MUST_EXIST);
    }

    /**
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
