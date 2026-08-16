<?php
defined('MOODLE_INTERNAL') || die();

$capabilities = [
    'local/syllentras_ai:manageplacement' => [
        'riskbitmask' => RISK_SPAM | RISK_DATALOSS,
        'captype' => 'write',
        'contextlevel' => CONTEXT_COURSE,
        'archetypes' => [
            'manager' => CAP_ALLOW,
            'editingteacher' => CAP_ALLOW,
        ],
    ],
];
