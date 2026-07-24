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
use question_bank;

/**
 * Export a private AI Content activity for PDF download (page HTML or quiz Q/A).
 */
class get_private_content_export extends external_api {

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
        global $CFG, $DB;

        require_once($CFG->libdir . '/questionlib.php');

        $params = self::validate_parameters(self::execute_parameters(), [
            'cmid' => $cmid,
            'userid' => $userid,
        ]);
        $cmid = (int) $params['cmid'];
        $userid = (int) $params['userid'];

        $cm = get_coursemodule_from_id('', $cmid, 0, false, MUST_EXIST);
        $course = get_course($cm->course);
        $context = context_course::instance($course->id);
        self::validate_context($context);
        require_capability('local/syllentras_ai:manageplacement', $context);

        $owned = placement::assert_student_owned_cm($course, $cmid, $userid);

        $contenthtml = '';
        $questions = [];

        if ($owned['modname'] === 'page') {
            $page = $DB->get_record('page', ['id' => $owned['instanceid']], '*', MUST_EXIST);
            $contenthtml = (string) ($page->content ?? '');
        } else if ($owned['modname'] === 'quiz') {
            $questions = self::load_quiz_questions((int) $owned['instanceid']);
        }

        return [
            'cmid' => $cmid,
            'modname' => $owned['modname'],
            'kind' => $owned['kind'],
            'name' => $owned['name'],
            'coursename' => format_string($course->fullname, true, ['context' => $context]),
            'contenthtml' => $contenthtml,
            'questions' => $questions,
        ];
    }

    /**
     * Load multichoice / truefalse questions from a quiz for export.
     *
     * @param int $quizid
     * @return array
     */
    private static function load_quiz_questions(int $quizid): array {
        global $DB;

        $sql = "SELECT qs.slot, qv.questionid
                  FROM {quiz_slots} qs
                  JOIN {question_references} qr
                    ON qr.itemid = qs.id
                   AND qr.component = 'mod_quiz'
                   AND qr.questionarea = 'slot'
                  JOIN {question_versions} qv
                    ON qv.questionbankentryid = qr.questionbankentryid
                   AND (
                        (qr.version IS NOT NULL AND qv.version = qr.version)
                     OR (qr.version IS NULL AND qv.version = (
                            SELECT MAX(v.version)
                              FROM {question_versions} v
                             WHERE v.questionbankentryid = qr.questionbankentryid
                        ))
                   )
                 WHERE qs.quizid = :quizid
              ORDER BY qs.slot ASC";

        $rows = $DB->get_records_sql($sql, ['quizid' => $quizid]);
        $questions = [];
        $number = 0;

        foreach ($rows as $row) {
            $questionid = (int) $row->questionid;
            if ($questionid < 1) {
                continue;
            }
            try {
                $question = question_bank::load_question($questionid);
            } catch (\Throwable $e) {
                continue;
            }

            $qtype = $question->get_type_name();
            if ($qtype !== 'multichoice' && $qtype !== 'truefalse') {
                continue;
            }

            $number++;
            $answers = [];
            if (!empty($question->answers) && is_iterable($question->answers)) {
                foreach ($question->answers as $answer) {
                    $text = isset($answer->answer)
                        ? trim(html_to_text((string) $answer->answer, 0, false))
                        : '';
                    $answers[] = [
                        'text' => $text,
                        'fraction' => (float) ($answer->fraction ?? 0),
                    ];
                }
            }

            // True/false options are often missing or blank on the loaded question
            // object; synthesize True/False from rightanswer when needed.
            if ($qtype === 'truefalse') {
                $answers = self::normalize_truefalse_answers($question, $answers);
            }

            $questions[] = [
                'number' => $number,
                'qtype' => $qtype,
                'questiontext' => trim(html_to_text((string) $question->questiontext, 0, false)),
                'answers' => $answers,
            ];
        }

        return $questions;
    }

    /**
     * Ensure true/false export always has True/False choices with fractions.
     *
     * @param object $question Loaded question definition
     * @param array $answers Answers collected from $question->answers
     * @return array
     */
    private static function normalize_truefalse_answers(object $question, array $answers): array {
        $truefraction = null;
        $falsefraction = null;

        foreach ($answers as $answer) {
            $text = strtolower(trim((string) ($answer['text'] ?? '')));
            $fraction = (float) ($answer['fraction'] ?? 0);
            if (in_array($text, ['true', 't', 'yes', '1'], true)) {
                $truefraction = $fraction;
            } else if (in_array($text, ['false', 'f', 'no', '0'], true)) {
                $falsefraction = $fraction;
            }
        }

        if ($truefraction !== null && $falsefraction !== null) {
            return [
                ['text' => 'True', 'fraction' => $truefraction],
                ['text' => 'False', 'fraction' => $falsefraction],
            ];
        }

        // Moodle truefalse exposes the correct boolean on rightanswer when
        // answer rows are missing or unlabeled.
        if (isset($question->rightanswer)) {
            $right = (bool) $question->rightanswer;
        } else if ($truefraction !== null) {
            $right = $truefraction > 0;
        } else if ($falsefraction !== null) {
            $right = !($falsefraction > 0);
        } else {
            $right = true;
        }

        return [
            ['text' => 'True', 'fraction' => $right ? 1.0 : 0.0],
            ['text' => 'False', 'fraction' => $right ? 0.0 : 1.0],
        ];
    }

    /**
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return new external_single_structure([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'modname' => new external_value(PARAM_ALPHA, 'Module name (page|quiz)'),
            'kind' => new external_value(PARAM_ALPHANUMEXT, 'study_guide|flashcards|practice_quiz'),
            'name' => new external_value(PARAM_TEXT, 'Activity name'),
            'coursename' => new external_value(PARAM_TEXT, 'Course full name'),
            'contenthtml' => new external_value(PARAM_RAW, 'Page body HTML (empty for quiz)'),
            'questions' => new external_multiple_structure(
                new external_single_structure([
                    'number' => new external_value(PARAM_INT, '1-based question number'),
                    'qtype' => new external_value(PARAM_ALPHANUMEXT, 'multichoice|truefalse'),
                    'questiontext' => new external_value(PARAM_RAW, 'Question stem (plain text)'),
                    'answers' => new external_multiple_structure(
                        new external_single_structure([
                            'text' => new external_value(PARAM_RAW, 'Answer text'),
                            'fraction' => new external_value(PARAM_FLOAT, 'Grade fraction 0..1'),
                        ])
                    ),
                ]),
                'Quiz questions (empty for pages)'
            ),
        ]);
    }
}
