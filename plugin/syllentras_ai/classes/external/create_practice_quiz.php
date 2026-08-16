<?php
namespace local_syllentras_ai\external;

defined('MOODLE_INTERNAL') || die();

use context_course;
use context_module;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use local_syllentras_ai\local\placement;
use moodle_exception;
use moodle_url;
use question_bank;
use stdClass;

/**
 * Create a private practice quiz in the AI Content section for one student.
 */
class create_practice_quiz extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'courseid' => new external_value(PARAM_INT, 'Course id'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id'),
            'name' => new external_value(PARAM_TEXT, 'Quiz name'),
            'intro' => new external_value(PARAM_RAW, 'Quiz intro HTML', VALUE_DEFAULT, ''),
            'questions' => new external_multiple_structure(
                new external_single_structure([
                    'type' => new external_value(PARAM_ALPHA, 'multichoice or truefalse'),
                    'name' => new external_value(PARAM_TEXT, 'Question name'),
                    'questiontext' => new external_value(PARAM_RAW, 'Question stem HTML/text'),
                    'answers' => new external_multiple_structure(
                        new external_single_structure([
                            'text' => new external_value(PARAM_RAW, 'Answer text'),
                            'fraction' => new external_value(PARAM_FLOAT, 'Grade fraction 0..1'),
                        ])
                    ),
                ])
            ),
        ]);
    }

    /**
     * @param int $courseid
     * @param int $userid
     * @param string $name
     * @param string $intro
     * @param array $questions
     * @return array
     */
    public static function execute(
        int $courseid,
        int $userid,
        string $name,
        string $intro,
        array $questions
    ): array {
        global $CFG, $DB, $USER;

        require_once($CFG->dirroot . '/course/modlib.php');
        require_once($CFG->dirroot . '/mod/quiz/locallib.php');
        require_once($CFG->libdir . '/questionlib.php');
        require_once($CFG->libdir . '/gradelib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'courseid' => $courseid,
            'userid' => $userid,
            'name' => $name,
            'intro' => $intro,
            'questions' => $questions,
        ]);

        $courseid = $params['courseid'];
        $userid = $params['userid'];
        $name = trim($params['name']);
        $intro = $params['intro'] ?? '';
        $questions = $params['questions'];

        if ($name === '') {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'name is required');
        }
        if (count($questions) < 1) {
            throw new moodle_exception('invalidparameter', 'error', '', null, 'At least one question is required');
        }

        $course = get_course($courseid);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        $placement = placement::ensure($courseid, $userid, false);

        // Modern Moodle only allows question bank categories in CONTEXT_MODULE.
        // Create the quiz activity first, then add questions under its module context.
        $moduleinfo = self::build_quiz_moduleinfo(
            $course,
            $placement['sectionnum'],
            $placement['availabilityjson'],
            $name,
            $intro,
            count($questions)
        );
        $moduleinfo = add_moduleinfo($moduleinfo, $course);
        $cmid = (int) $moduleinfo->coursemodule;
        $quiz = $DB->get_record('quiz', ['id' => $moduleinfo->instance], '*', MUST_EXIST);

        $modcontext = context_module::instance($cmid);
        $category = self::ensure_question_category($modcontext, $userid);

        $questionids = [];
        foreach ($questions as $q) {
            $type = strtolower($q['type']);
            if ($type !== 'multichoice' && $type !== 'truefalse') {
                throw new moodle_exception(
                    'invalidparameter',
                    'error',
                    '',
                    null,
                    'Unsupported question type: ' . $q['type']
                );
            }
            $questionids[] = self::create_question($category, $type, $q, $USER->id);
        }

        foreach ($questionids as $qid) {
            \quiz_add_quiz_question($qid, $quiz, 0);
        }
        // Moodle 4.5+/5.x: quiz_update_sumgrades() was replaced by the grade calculator.
        \mod_quiz\quiz_settings::create((int) $quiz->id)
            ->get_grade_calculator()
            ->recompute_quiz_sumgrades();

        self::exclude_from_course_total($course->id, (int) $quiz->id);

        $viewurl = (new moodle_url('/mod/quiz/view.php', ['id' => $cmid]))->out(false);

        return [
            'quizid' => (int) $quiz->id,
            'cmid' => $cmid,
            'name' => $quiz->name,
            'viewurl' => $viewurl,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'quizid' => new external_value(PARAM_INT, 'Quiz instance id'),
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'name' => new external_value(PARAM_TEXT, 'Quiz name'),
            'viewurl' => new external_value(PARAM_URL, 'Student-facing quiz URL'),
        ]);
    }

    /**
     * Ensure a per-student subcategory under the quiz module question bank.
     *
     * Moodle 4.5+/5.x only allows default/top categories in CONTEXT_MODULE.
     *
     * @param \context_module $modcontext Quiz module context.
     * @param int $userid Student id.
     * @return stdClass Category record.
     */
    private static function ensure_question_category($modcontext, int $userid): stdClass {
        global $DB;

        $default = question_get_default_category($modcontext->id, true);
        if (!$default) {
            throw new moodle_exception(
                'error',
                'error',
                '',
                null,
                'Could not create default question category for quiz module'
            );
        }

        $catname = 'Syllentras AI / user ' . $userid;
        $existing = $DB->get_record('question_categories', [
            'contextid' => $modcontext->id,
            'parent' => $default->id,
            'name' => $catname,
        ]);
        if ($existing) {
            return $existing;
        }

        // Prefer a dedicated subcategory; fall back to the module default category.
        $category = new stdClass();
        $category->name = $catname;
        $category->contextid = $modcontext->id;
        $category->info = 'Questions generated by Syllentras AI for user ' . $userid;
        $category->infoformat = FORMAT_PLAIN;
        $category->stamp = make_unique_id_code();
        $category->parent = $default->id;
        $category->sortorder = 999;
        $category->idnumber = 'syllentras_ai_qcat_' . $userid;
        $category->id = $DB->insert_record('question_categories', $category);
        return $category;
    }

    /**
     * @param stdClass $category
     * @param string $type
     * @param array $q
     * @param int $creatorid
     * @return int Question id.
     */
    private static function create_question(stdClass $category, string $type, array $q, int $creatorid): int {
        $form = new stdClass();
        $form->category = $category->id . ',' . $category->contextid;
        $form->name = trim($q['name']) !== '' ? trim($q['name']) : 'AI question';
        $form->questiontext = [
            'text' => $q['questiontext'],
            'format' => FORMAT_HTML,
        ];
        $form->generalfeedback = ['text' => '', 'format' => FORMAT_HTML];
        $form->defaultmark = 1;
        $form->penalty = 0;
        $form->status = \core_question\local\bank\question_version_status::QUESTION_STATUS_READY;

        if ($type === 'truefalse') {
            $correct = null;
            foreach ($q['answers'] as $answer) {
                if ((float) $answer['fraction'] > 0) {
                    $text = strtolower(trim(strip_tags($answer['text'])));
                    $correct = in_array($text, ['true', 't', 'yes', '1'], true) ? 1 : 0;
                    break;
                }
            }
            if ($correct === null) {
                $correct = 1;
            }
            $form->correctanswer = $correct;
            $form->feedbacktrue = ['text' => '', 'format' => FORMAT_HTML];
            $form->feedbackfalse = ['text' => '', 'format' => FORMAT_HTML];
        } else {
            $form->single = '1';
            $form->shuffleanswers = 1;
            $form->answernumbering = 'abc';
            $form->showstandardinstruction = 0;
            $form->correctfeedback = ['text' => '', 'format' => FORMAT_HTML];
            $form->partiallycorrectfeedback = ['text' => '', 'format' => FORMAT_HTML];
            $form->incorrectfeedback = ['text' => '', 'format' => FORMAT_HTML];
            $form->shownumcorrect = 0;

            $answers = [];
            $fractions = [];
            $feedbacks = [];
            foreach ($q['answers'] as $answer) {
                $answers[] = ['text' => $answer['text'], 'format' => FORMAT_HTML];
                $fractions[] = (string) ((float) $answer['fraction']);
                $feedbacks[] = ['text' => '', 'format' => FORMAT_HTML];
            }
            if (count($answers) < 2) {
                throw new moodle_exception(
                    'invalidparameter',
                    'error',
                    '',
                    null,
                    'Multichoice questions need at least 2 answers'
                );
            }
            $form->answer = $answers;
            $form->fraction = $fractions;
            $form->feedback = $feedbacks;
            $form->noanswers = count($answers);
        }

        $question = new stdClass();
        $question->qtype = $type;
        $question->createdby = $creatorid;
        $question->modifiedby = $creatorid;

        $qtype = question_bank::get_qtype($type);
        $saved = $qtype->save_question($question, $form);
        return (int) $saved->id;
    }

    /**
     * @param stdClass $course
     * @param int $sectionnum
     * @param string $availabilityjson
     * @param string $name
     * @param string $intro
     * @param int $questioncount
     * @return stdClass
     */
    private static function build_quiz_moduleinfo(
        stdClass $course,
        int $sectionnum,
        string $availabilityjson,
        string $name,
        string $intro,
        int $questioncount
    ): stdClass {
        global $DB;

        $moduleinfo = new stdClass();
        $moduleinfo->modulename = 'quiz';
        $moduleinfo->module = $DB->get_field('modules', 'id', ['name' => 'quiz'], MUST_EXIST);
        $moduleinfo->name = $name;
        $moduleinfo->intro = $intro !== '' ? $intro : get_string('practicequizintro', 'local_syllentras_ai');
        $moduleinfo->introformat = FORMAT_HTML;
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

        $moduleinfo->timeopen = 0;
        $moduleinfo->timeclose = 0;
        $moduleinfo->timelimit = 0;
        $moduleinfo->overduehandling = 'autosubmit';
        $moduleinfo->graceperiod = 0;
        $moduleinfo->preferredbehaviour = 'deferredfeedback';
        $moduleinfo->canredoquestions = 0;
        $moduleinfo->attempts = 0;
        $moduleinfo->attemptonlast = 0;
        $moduleinfo->grademethod = 1;
        $moduleinfo->decimalpoints = 2;
        $moduleinfo->questiondecimalpoints = -1;

        // quiz_process_options() rebuilds review* bitmasks from these form flags.
        // Raw reviewattempt/reviewmarks values are overwritten and ignored on create.
        $reviewtimes = ['during', 'immediately', 'open', 'closed'];
        $reviewfields = [
            'attempt',
            'correctness',
            'maxmarks',
            'marks',
            'specificfeedback',
            'generalfeedback',
            'rightanswer',
            'overallfeedback',
        ];
        foreach ($reviewfields as $field) {
            foreach ($reviewtimes as $when) {
                if ($field === 'overallfeedback' && $when === 'during') {
                    continue;
                }
                $prop = $field . $when;
                $moduleinfo->$prop = 1;
            }
        }

        $moduleinfo->questionsperpage = 1;
        $moduleinfo->navmethod = 'free';
        $moduleinfo->shuffleanswers = 1;
        $moduleinfo->sumgrades = $questioncount;
        $moduleinfo->grade = $questioncount;
        $moduleinfo->timecreated = time();
        $moduleinfo->timemodified = time();
        $moduleinfo->password = '';
        $moduleinfo->subnet = '';
        $moduleinfo->browsersecurity = '-';
        $moduleinfo->delay1 = 0;
        $moduleinfo->delay2 = 0;
        $moduleinfo->showuserpicture = 0;
        $moduleinfo->showblocks = 0;
        $moduleinfo->quizpassword = '';

        return $moduleinfo;
    }

    /**
     * Keep the quiz graded for the student but exclude from course total weight.
     *
     * @param int $courseid
     * @param int $quizid
     */
    private static function exclude_from_course_total(int $courseid, int $quizid): void {
        $gradeitem = \grade_item::fetch([
            'itemtype' => 'mod',
            'itemmodule' => 'quiz',
            'iteminstance' => $quizid,
            'courseid' => $courseid,
        ]);
        if (!$gradeitem) {
            return;
        }

        // Natural aggregation uses aggregationcoef2 as the weight.
        $gradeitem->aggregationcoef = 0;
        $gradeitem->aggregationcoef2 = 0;
        $gradeitem->weightoverride = 1;
        $gradeitem->update();
    }
}
