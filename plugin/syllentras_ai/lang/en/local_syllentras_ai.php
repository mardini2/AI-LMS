<?php
// Language strings for local_syllentras_ai.
// Required by Moodle — at minimum the plugin name must be defined here.

defined('MOODLE_INTERNAL') || die();

$string['pluginname']    = 'Syllentras AI';
$string['chat_title']    = 'Course Assistant';
$string['chat_placeholder'] = 'Ask a question about this course...';
$string['chat_send']     = 'Send';
$string['chat_open']     = 'Open AI Assistant';
$string['chat_close']    = 'Close';
$string['chat_error']    = 'Something went wrong. Please try again.';
$string['privacy:metadata'] = 'The Syllentras AI plugin sends course content and user questions to an external API service for LLM processing. No data is stored by this plugin directly.';

$string['syllentras_ai:manageplacement'] = 'Manage Syllentras AI content placement (section and private groups)';
$string['syllentras_ai:manageplacement_help'] = 'Allows ensuring the shared AI Content section and per-student private groups used for AI-generated course activities.';
$string['usernotenrolled'] = 'The user is not enrolled in this course.';
$string['practicequizintro'] = 'Practice quiz created by Syllentras AI. This does not count toward your course grade.';
$string['studyguideintro'] = 'Study guide created by Syllentras AI. This is a private practice aid and is not graded.';
