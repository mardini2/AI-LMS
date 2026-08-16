<?php
namespace local_syllentras_ai\external;

defined('MOODLE_INTERNAL') || die();

use context_module;
use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_multiple_structure;
use core_external\external_single_structure;
use core_external\external_value;
use mod_quiz\quiz_attempt;
use moodle_exception;
use stdClass;

/**
 * Return the latest finished practice-quiz attempt with per-question results.
 */
class get_practice_attempt_review extends external_api {

    /**
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'quizid' => new external_value(PARAM_INT, 'Quiz instance id'),
            'userid' => new external_value(PARAM_INT, 'Student Moodle user id'),
        ]);
    }

    /**
     * @param int $quizid
     * @param int $userid
     * @return array
     */
    public static function execute(int $quizid, int $userid): array {
        global $CFG, $DB;

        require_once($CFG->dirroot . '/mod/quiz/locallib.php');
        require_once($CFG->dirroot . '/mod/quiz/lib.php');
        require_once($CFG->libdir . '/questionlib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'quizid' => $quizid,
            'userid' => $userid,
        ]);
        $quizid = $params['quizid'];
        $userid = $params['userid'];

        $quiz = $DB->get_record('quiz', ['id' => $quizid], '*', MUST_EXIST);
        $cm = get_coursemodule_from_instance('quiz', $quiz->id, $quiz->course, false, MUST_EXIST);
        $context = context_module::instance($cm->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        if (!$DB->record_exists('user', ['id' => $userid, 'deleted' => 0])) {
            throw new moodle_exception('invaliduser', 'error');
        }

        $attempts = quiz_get_user_attempts($quiz->id, $userid, 'finished', false);
        if (empty($attempts)) {
            return [
                'hasattempt' => false,
                'attemptid' => 0,
                'state' => '',
                'score' => 0.0,
                'maxscore' => 0.0,
                'questions' => [],
            ];
        }

        /** @var stdClass $attemptrec */
        $attemptrec = end($attempts);
        $attemptobj = quiz_attempt::create((int) $attemptrec->id);

        $questions = [];
        $score = 0.0;
        $maxscore = 0.0;

        foreach ($attemptobj->get_slots() as $slot) {
            $qa = $attemptobj->get_question_attempt($slot);
            $question = $qa->get_question(false);
            $mark = $qa->get_mark();
            $maxmark = (float) $qa->get_max_mark();
            $markvalue = $mark === null ? 0.0 : (float) $mark;
            $score += $markvalue;
            $maxscore += $maxmark;

            $state = $qa->get_state();
            $iscorrect = $state->is_correct();

            $questiontext = '';
            if ($question && isset($question->questiontext)) {
                $questiontext = trim(html_to_text($question->questiontext, 0, false));
            }
            if ($questiontext === '') {
                $questiontext = (string) $qa->get_question_summary();
            }

            $name = '';
            if ($question && !empty($question->name)) {
                $name = (string) $question->name;
            }

            $questions[] = [
                'slot' => (int) $slot,
                'name' => $name !== '' ? $name : 'Question ' . $slot,
                'questiontext' => $questiontext,
                'studentanswer' => (string) ($qa->get_response_summary() ?? ''),
                'rightanswer' => (string) ($qa->get_right_answer_summary() ?? ''),
                'iscorrect' => (bool) $iscorrect,
                'mark' => $markvalue,
                'maxmark' => $maxmark,
            ];
        }

        if ($maxscore <= 0 && !empty($quiz->sumgrades)) {
            $maxscore = (float) $quiz->sumgrades;
            $score = (float) $attemptobj->get_sum_marks();
        }

        return [
            'hasattempt' => true,
            'attemptid' => (int) $attemptrec->id,
            'state' => (string) $attemptrec->state,
            'score' => round($score, 2),
            'maxscore' => round($maxscore, 2),
            'questions' => $questions,
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'hasattempt' => new external_value(PARAM_BOOL, 'Whether a finished attempt exists'),
            'attemptid' => new external_value(PARAM_INT, 'Attempt id (0 if none)'),
            'state' => new external_value(PARAM_ALPHANUMEXT, 'Attempt state'),
            'score' => new external_value(PARAM_FLOAT, 'Marks earned'),
            'maxscore' => new external_value(PARAM_FLOAT, 'Marks available'),
            'questions' => new external_multiple_structure(
                new external_single_structure([
                    'slot' => new external_value(PARAM_INT, 'Question slot'),
                    'name' => new external_value(PARAM_TEXT, 'Question name'),
                    'questiontext' => new external_value(PARAM_RAW, 'Question stem text'),
                    'studentanswer' => new external_value(PARAM_RAW, 'Student response summary'),
                    'rightanswer' => new external_value(PARAM_RAW, 'Correct answer summary'),
                    'iscorrect' => new external_value(PARAM_BOOL, 'Whether marked fully correct'),
                    'mark' => new external_value(PARAM_FLOAT, 'Mark awarded'),
                    'maxmark' => new external_value(PARAM_FLOAT, 'Max mark for the question'),
                ])
            ),
        ]);
    }
}
