<?php
namespace local_syllentras_ai\hook\output;

defined('MOODLE_INTERNAL') || die();

/**
 * Hook listener that injects the Syllentras AI chat widget before </body>.
 *
 * Markup: templates/chat_widget.php
 * Styles: styles.css (Moodle auto-includes)
 * Script: js/purify.min.js, js/marked.min.js, js/chat/boot.js,
 *          js/Sortable.min.js, js/flashcards-study.js, js/ai-content-manage.js
 *          (boot.js bundles js/chat/* modules — rebuild with
 *           .\dev.ps1 rebuild-chat-js or ./dev.sh rebuild-chat-js
 *           or manually with python plugin/syllentras_ai/js/_build_boot.py)
 *          PDF export loads js/vendor/pdfmake.min.js + vfs_fonts.js on demand.
 */
class before_footer {

    public static function callback(\core\hook\output\before_footer_html_generation $hook): void {
        global $CFG, $PAGE, $USER;

        if (!isloggedin() || isguestuser()) {
            return;
        }

        $apiurl = rtrim(get_config('local_syllentras_ai', 'api_url') ?: 'http://localhost:3000', '/');

        $courseid = (int) ($PAGE->course->id ?? 0);
        $coursename = ($courseid > 1) ? format_string($PAGE->course->fullname) : '';
        $moodleuserid = (int) $USER->id;
        $userfirstname = format_string($USER->firstname);
        $sections = [];

        if ($courseid > 1) {
            $modinfo = get_fast_modinfo($PAGE->course);
            foreach ($modinfo->get_section_info_all() as $sectioninfo) {
                if (empty($sectioninfo->uservisible)) {
                    continue;
                }

                $sectionnumber = (int) $sectioninfo->section;
                $sectionname = trim(get_section_name($PAGE->course, $sectioninfo));
                if ($sectionname === '') {
                    $sectionname = ($sectionnumber === 0) ? 'General' : 'Section ' . $sectionnumber;
                }

                // Skip the shared AI Content placement section — not a study topic.
                if (strcasecmp($sectionname, \local_syllentras_ai\local\placement::SECTION_NAME) === 0) {
                    continue;
                }

                $sections[] = [
                    'id' => (int) $sectioninfo->id,
                    'number' => $sectionnumber,
                    'name' => format_string($sectionname),
                ];
            }
        }

        $widgetconfigjson = json_encode([
            'apiUrl' => $apiurl,
            'courseId' => $courseid,
            'courseName' => $coursename,
            'moodleUserId' => $moodleuserid,
            'userFirstName' => $userfirstname,
            'courseSections' => $sections,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($widgetconfigjson === false) {
            return;
        }

        $ownedjson = 'null';
        $cmid = self::resolve_current_cmid();
        if ($courseid > 1 && $cmid > 0) {
            $owned = \local_syllentras_ai\local\placement::try_get_owned_cm(
                $PAGE->course,
                $cmid,
                $moodleuserid
            );
            if ($owned) {
                // Quizzes: only show Rename/Delete on the landing view, not attempt/review.
                if ($owned['kind'] === 'practice_quiz' && !self::is_quiz_landing_page()) {
                    $owned = null;
                }
            }
            if ($owned) {
                $ownedpayload = [
                    'cmId' => (int) $owned['cmid'],
                    'modname' => $owned['modname'],
                    'kind' => $owned['kind'],
                    'name' => $owned['name'],
                    'courseViewUrl' => (new \moodle_url('/course/view.php', ['id' => $courseid]))->out(false),
                ];
                $encoded = json_encode($ownedpayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                if ($encoded !== false) {
                    $ownedjson = $encoded;
                }
            }
        }

        $wwwroot = $CFG->wwwroot;
        $jsver = '';
        if (\function_exists('get_component_version')) {
            $jsver = (string) \get_component_version('local_syllentras_ai');
        }
        if ($jsver === '') {
            $jsver = (string) (\get_config('local_syllentras_ai', 'version') ?: '');
        }
        $jsqs = $jsver !== '' ? ('?v=' . rawurlencode($jsver)) : '';
        ob_start();
        include(__DIR__ . '/../../../templates/chat_widget.php');
        ?>
        <script>window.__SYLL_AI_CONTENT__ = <?php echo $ownedjson; ?>;</script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/purify.min.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/marked.min.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/chat/boot.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/Sortable.min.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/flashcards-study.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/ai-content-manage.js<?php echo $jsqs; ?>"></script>
        <?php
        $hook->add_html(ob_get_clean());
    }

    /**
     * Resolve the current activity cm id for on-page AI Content tools.
     *
     * Prefer module context, then $PAGE->cm, then request params used by page/quiz.
     */
    private static function resolve_current_cmid(): int {
        global $PAGE;

        if (!empty($PAGE->context) && (int) $PAGE->context->contextlevel === CONTEXT_MODULE) {
            $cmid = (int) $PAGE->context->instanceid;
            if ($cmid > 0) {
                return $cmid;
            }
        }

        if (!empty($PAGE->cm) && !empty($PAGE->cm->id)) {
            return (int) $PAGE->cm->id;
        }

        $cmid = optional_param('id', 0, PARAM_INT);
        if ($cmid > 0 && self::request_looks_like_module_view()) {
            return $cmid;
        }

        $cmid = optional_param('cmid', 0, PARAM_INT);
        if ($cmid > 0) {
            return $cmid;
        }

        return 0;
    }

    /**
     * True when the current script is likely a module view/attempt page.
     */
    private static function request_looks_like_module_view(): bool {
        return (bool) preg_match('#/mod/(page|quiz)/#', self::current_request_path());
    }

    /**
     * True on the quiz landing page (/mod/quiz/view.php) before an attempt.
     */
    private static function is_quiz_landing_page(): bool {
        return (bool) preg_match('#/mod/quiz/view\.php$#', self::current_request_path());
    }

    /**
     * Path portion of the current Moodle request (no query string).
     */
    private static function current_request_path(): string {
        global $PAGE;

        $path = '';
        if (!empty($PAGE->url)) {
            $path = (string) $PAGE->url->get_path();
        }
        if ($path === '' && !empty($_SERVER['SCRIPT_NAME'])) {
            $path = (string) $_SERVER['SCRIPT_NAME'];
        }

        return $path;
    }
}
