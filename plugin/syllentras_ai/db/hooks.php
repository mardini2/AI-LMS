<?php
// Registers hook listeners for local_syllentras_ai.
// Moodle 5.x uses a PSR-14-style hook system. This file maps hook classes to
// static callback methods on our listener classes. Moodle reads and caches
// this file — purge caches after any change here (.\dev.ps1 moodle-purge).

defined('MOODLE_INTERNAL') || die();

$callbacks = [
    [
        'hook'     => \core\hook\output\before_footer_html_generation::class,
        'callback' => \local_syllentras_ai\hook\output\before_footer::class . '::callback',
        'priority' => 500,
    ],
];
