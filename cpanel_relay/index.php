<?php
/**
 * Kotak Neo Relay & Web App Unified Entry Point
 * Automatically serves the Web App on browser GET requests,
 * and seamlessly routes API calls to kotak_relay.php or trade_api.php.
 */

declare(strict_types=1);

$has_action = !empty($_GET['action']) || !empty($_POST['action']) || !empty($_POST['payload']);
$raw_input = @file_get_contents('php://input');
$is_json_post = false;
if (!empty($raw_input)) {
    $first_char = trim($raw_input)[0] ?? '';
    if ($first_char === '{' || $first_char === '[') {
        $is_json_post = true;
    }
}

// API Routing
if ($has_action || $is_json_post) {
    $action = $_GET['action'] ?? $_POST['action'] ?? '';
    $trade_api_actions = [
        'auth_pin', 'verify_session', 'get_active_orders', 'sync_bracket_orders',
        'place_quick_order', 'exit_order', 'get_trade_reports', 'clear_trade_reports', 'option_chain'
    ];
    if (in_array($action, $trade_api_actions, true)) {
        require __DIR__ . '/trade_api.php';
        exit;
    }
    // Existing Kotak Relay routing
    require __DIR__ . '/kotak_relay.php';
    exit;
}

// If accessed via web browser without API parameters, launch the Web App!
require __DIR__ . '/trade.php';
