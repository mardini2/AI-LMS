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

    /**
     * True if availability JSON requires the given group id (direct group condition).
     *
     * @param string|null $availabilityjson
     * @param int $groupid
     * @return bool
     */
    public static function availability_requires_group(?string $availabilityjson, int $groupid): bool {
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

    /**
     * Assert a course module is in AI Content and restricted to the student's group.
     *
     * @param stdClass $course
     * @param int $cmid
     * @param int $userid
     * @param string|null $modname Restrict to this modname (page|quiz), or null for either.
     * @return array{cm:\cm_info,modname:string,instanceid:int,name:string,kind:string,groupid:int}
     */
    public static function assert_student_owned_cm(
        stdClass $course,
        int $cmid,
        int $userid,
        ?string $modname = null
    ): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/group/lib.php');

        if ($cmid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'cmid is required');
        }
        if ($userid < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'userid is required');
        }
        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0])) {
            throw new moodle_exception('invaliduser', 'error');
        }

        $modinfo = get_fast_modinfo($course);
        try {
            $cminfo = $modinfo->get_cm($cmid);
        } catch (\Throwable $e) {
            throw new moodle_exception('invalidcoursemodule', 'error');
        }

        $resolvedmod = $cminfo->modname;
        if ($modname !== null && $resolvedmod !== $modname) {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'Unexpected activity type'
            );
        }
        if ($resolvedmod !== 'page' && $resolvedmod !== 'quiz') {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'Activity type is not supported'
            );
        }

        $sectioninfo = $modinfo->get_section_info($cminfo->sectionnum);
        $sectionname = trim(get_section_name($course, $sectioninfo));
        if (strcasecmp($sectionname, self::SECTION_NAME) !== 0) {
            throw new moodle_exception(
                'invalidparameter',
                'error',
                '',
                null,
                'Activity is not in the AI Content section'
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

        if (!self::availability_requires_group($cminfo->availability, (int) $group->id)) {
            // cm_info availability can be empty in some contexts; fall back to DB.
            $availabilityjson = $DB->get_field('course_modules', 'availability', ['id' => $cmid]);
            if (!self::availability_requires_group(
                is_string($availabilityjson) ? $availabilityjson : null,
                (int) $group->id
            )) {
                throw new moodle_exception(
                    'invalidparameter',
                    'error',
                    '',
                    null,
                    'Activity is not restricted to this student'
                );
            }
        }

        $kind = self::detect_kind($resolvedmod, (int) $cminfo->instance);

        return [
            'cm' => $cminfo,
            'modname' => $resolvedmod,
            'instanceid' => (int) $cminfo->instance,
            'name' => $cminfo->name,
            'kind' => $kind,
            'groupid' => (int) $group->id,
        ];
    }

    /**
     * Assert ownership then delete the course module synchronously.
     *
     * @param stdClass $course
     * @param int $cmid
     * @param int $userid
     * @return array{modname:string,kind:string,name:string}
     */
    public static function delete_owned_cm(stdClass $course, int $cmid, int $userid): array {
        $owned = self::assert_student_owned_cm($course, $cmid, $userid);
        $actions = new \core_courseformat\local\cmactions($course);
        $actions->delete($cmid, false);
        return [
            'modname' => $owned['modname'],
            'kind' => $owned['kind'],
            'name' => $owned['name'],
        ];
    }

    /**
     * Soft lookup for on-page toolbar injection (no exception on miss).
     *
     * @param stdClass $course
     * @param int $cmid
     * @param int $userid
     * @return array{cmid:int,modname:string,name:string,kind:string}|null
     */
    public static function try_get_owned_cm(stdClass $course, int $cmid, int $userid): ?array {
        try {
            $owned = self::assert_student_owned_cm($course, $cmid, $userid);
            return [
                'cmid' => $cmid,
                'modname' => $owned['modname'],
                'name' => $owned['name'],
                'kind' => $owned['kind'],
            ];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * @param string $modname
     * @param int $instanceid
     * @return string study_guide|flashcards|practice_quiz
     */
    public static function detect_kind(string $modname, int $instanceid): string {
        global $DB;

        if ($modname === 'quiz') {
            return 'practice_quiz';
        }
        if ($modname !== 'page') {
            return 'study_guide';
        }
        $content = (string) $DB->get_field('page', 'content', ['id' => $instanceid]);
        if (
            strpos($content, 'data-syll-fc-study') !== false ||
            strpos($content, 'class="syll-fc') !== false ||
            strpos($content, "class='syll-fc") !== false ||
            strpos($content, 'syll-fc ') !== false
        ) {
            return 'flashcards';
        }
        return 'study_guide';
    }

    /**
     * Rename a student-owned AI Content activity (page or quiz).
     *
     * @param stdClass $course
     * @param int $cmid
     * @param int $userid
     * @param string $name
     * @return array{cmid:int,modname:string,name:string,kind:string,viewurl:string}
     */
    public static function rename_owned_cm(
        stdClass $course,
        int $cmid,
        int $userid,
        string $name
    ): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/course/lib.php');

        $name = trim($name);
        if ($name === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'name is required');
        }
        if (\core_text::strlen($name) > 200) {
            $name = \core_text::substr($name, 0, 200);
        }

        $owned = self::assert_student_owned_cm($course, $cmid, $userid);
        $modname = $owned['modname'];
        $instanceid = $owned['instanceid'];

        if ($modname === 'page') {
            $page = $DB->get_record('page', ['id' => $instanceid], '*', MUST_EXIST);
            $page->name = $name;
            $page->timemodified = time();
            $DB->update_record('page', $page);
        } else {
            $quiz = $DB->get_record('quiz', ['id' => $instanceid], '*', MUST_EXIST);
            $quiz->name = $name;
            $quiz->timemodified = time();
            $DB->update_record('quiz', $quiz);
        }

        if (function_exists('set_coursemodule_name')) {
            set_coursemodule_name($cmid, $name);
        }

        rebuild_course_cache($course->id, true);

        $viewurl = self::view_url_for($modname, $cmid);

        return [
            'cmid' => $cmid,
            'modname' => $modname,
            'name' => $name,
            'kind' => $owned['kind'],
            'viewurl' => $viewurl,
        ];
    }

    /**
     * @param string $modname
     * @param int $cmid
     * @return string
     */
    public static function view_url_for(string $modname, int $cmid): string {
        $path = $modname === 'quiz' ? '/mod/quiz/view.php' : '/mod/page/view.php';
        return (new \moodle_url($path, ['id' => $cmid]))->out(false);
    }
}
