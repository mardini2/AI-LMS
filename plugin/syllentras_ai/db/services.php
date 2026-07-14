<?php

defined('MOODLE_INTERNAL') || die();

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
        ],
        'restrictedusers' => 0,
        'enabled' => 1,
        'downloadfiles' => 1,
        'uploadfiles' => 0,
    ],
];
