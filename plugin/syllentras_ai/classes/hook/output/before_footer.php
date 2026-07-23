<?php
namespace local_syllentras_ai\hook\output;

defined('MOODLE_INTERNAL') || die();

/**
 * Hook listener that injects the Syllentras AI chat widget before </body>.
 *
 * Markup: templates/chat_widget.php
 * Styles: styles.css (Moodle auto-includes)
 * Script: js/purify.min.js, js/marked.min.js, js/chat/boot.js,
 *          js/Sortable.min.js, js/flashcards-study.js
 *          (boot.js bundles js/chat/* modules — rebuild with
 *           .\dev.ps1 rebuild-chat-js or ./dev.sh rebuild-chat-js
 *           or manually with python plugin/syllentras_ai/js/_build_boot.py)
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
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/purify.min.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/marked.min.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/chat/boot.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/Sortable.min.js<?php echo $jsqs; ?>"></script>
        <script src="<?php echo $wwwroot; ?>/local/syllentras_ai/js/flashcards-study.js<?php echo $jsqs; ?>"></script>
        <?php
        $hook->add_html(ob_get_clean());
    }
}
