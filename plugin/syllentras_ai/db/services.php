<?php

defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_syllentras_ai_ensure_student_placement' => [
        'classname' => 'local_syllentras_ai\external\ensure_student_placement',
        'methodname' => 'execute',
        'description' => 'Ensure the shared AI Content section and a private per-student group exist',
        'type' => 'write',
        'capabilities' => 'local/syllentras_ai:manageplacement',
        'ajax' => false,
    ],
    'local_syllentras_ai_create_practice_quiz' => [
        'classname' => 'local_syllentras_ai\external\create_practice_quiz',
        'methodname' => 'execute',
        'description' => 'Create a private practice quiz in the AI Content section for one student',
        'type' => 'write',
        'capabilities' => 'local/syllentras_ai:manageplacement',
        'ajax' => false,
    ],
];

// The API uses Moodle's built-in external functions directly. Keeping them in a
// plugin-owned service lets the token download files from webservice/pluginfile.php.
$services = [
    'Syllentras AI service' => [
        'shortname' => 'syllentras_ai',
        'functions' => [
            'core_course_get_contents',
            'core_course_get_courses',
            'core_enrol_get_users_courses',
            'mod_assign_get_assignments',
            'mod_forum_get_discussion_posts',
            'mod_forum_get_forum_discussions',
            'mod_forum_get_forums_by_courses',
            'mod_page_get_pages_by_courses',
            'local_syllentras_ai_ensure_student_placement',
            'local_syllentras_ai_create_practice_quiz',
        ],
        'restrictedusers' => 0,
        'enabled' => 1,
        'downloadfiles' => 1,
        'uploadfiles' => 0,
    ],
];
