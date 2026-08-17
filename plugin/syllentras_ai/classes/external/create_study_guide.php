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
use stdClass;

/**
 * Create a private study guide Page in the AI Content section for one student.
 */
class create_study_guide extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id'),
            'name' => new external_value(PARAM_TEXT, 'Page name'),
            'intro' => new external_value(PARAM_RAW, 'Page intro HTML', VALUE_DEFAULT, ''),
            'content' => new external_value(PARAM_RAW, 'Page body HTML'),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $userid
     * @param string $name
     * @param string $intro
     * @param string $content
     * @return array
     */
    public static function execute(
        int $courseid,
        int $userid,
        string $name,
        string $intro,
        string $content
    ): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/course/modlib.php');
        require_once($CFG->libdir . '/resourcelib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'userid' => $userid,
            'name' => $name,
            'intro' => $intro,
            'content' => $content,
        ]);

        $courseid = $params['courseid'];
        $userid = $params['userid'];
        $name = trim($params['name']);
        $intro = $params['intro'] ?? '';
        $content = $params['content'] ?? '';

        if ($name === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'name is required');
        }
        if (trim($content) === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'content is required');
        }

        $course = get_course($courseid);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        $placement = placement::ensure($courseid, $userid, false);

        $moduleinfo = self::build_page_moduleinfo(
            $course,
            $placement['sectionnum'],
            $placement['availabilityjson'],
            $name,
            $intro,
            $content
        );
        $moduleinfo = add_moduleinfo($moduleinfo, $course);
        $cmid = (int) $moduleinfo->coursemodule;
        $page = $DB->get_record('page', ['id' => $moduleinfo->instance], '*', MUST_EXIST);

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
     * @param stdClass $course
     * @param int $sectionnum
     * @param string $availabilityjson
     * @param string $name
     * @param string $intro
     * @param string $content
     * @return stdClass
     */
    private static function build_page_moduleinfo(
        stdClass $course,
        int $sectionnum,
        string $availabilityjson,
        string $name,
        string $intro,
        string $content
    ): stdClass {
        global $DB;

        $moduleinfo = new stdClass();
        $moduleinfo->modulename = 'page';
        $moduleinfo->module = $DB->get_field('modules', 'id', ['name' => 'page'], MUST_EXIST);
        $moduleinfo->name = $name;
        $moduleinfo->intro = $intro !== '' ? $intro : get_string('studyguideintro', 'local_syllentras_ai');
        $moduleinfo->introformat = FORMAT_HTML;
        $moduleinfo->content = $content;
        $moduleinfo->contentformat = FORMAT_HTML;
        $moduleinfo->display = RESOURCELIB_DISPLAY_AUTO;
        $moduleinfo->displayoptions = serialize([
            'printheading' => 1,
            'printintro' => 0,
        ]);
        $moduleinfo->printintro = 0;
        $moduleinfo->printlastmodified = 0;
        $moduleinfo->section = $sectionnum;
        $moduleinfo->visible = 1;
        $moduleinfo->visibleoncoursepage = 1;
        $moduleinfo->cmidnumber = '';
        $moduleinfo->groupmode = 0;
        $moduleinfo->groupingid = 0;
        $moduleinfo->availability = $availabilityjson;
        $moduleinfo->completion = 0;
        $moduleinfo->completionview = 0;
        $moduleinfo->completionexpected = 0;
        $moduleinfo->showdescription = 0;

        return $moduleinfo;
    }
}
