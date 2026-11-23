<?php
/**
 * Kotak Neo Outbound IP Finder for cPanel
 * Upload this file to your cPanel public_html/ and visit it in browser:
 * e.g. https://yourdomain.com/get_my_ip.php
 *
 * This will tell you the EXACT outbound IP to enter in Kotak Neo "Add IP" portal!
 */

header('Content-Type: application/json; charset=utf-8');

// 1. Inbound IP seen by server
$inbound_ip = $_SERVER['SERVER_ADDR'] ?? gethostbyname($_SERVER['SERVER_NAME'] ?? 'localhost');

// 2. Outbound IP seen by external services (this is what Kotak Securities sees!)
$ch = curl_init("https://api.ipify.org?format=json");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 6);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
$outbound_res = curl_exec($ch);
curl_close($ch);

$outbound_ip = null;
if ($outbound_res) {
    $parsed = json_decode($outbound_res, true);
    $outbound_ip = $parsed['ip'] ?? null;
}

// Fallback check via ifconfig.me
if (!$outbound_ip) {
    $ch = curl_init("https://ifconfig.me/ip");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    $outbound_ip = trim(curl_exec($ch));
    curl_close($ch);
}

echo json_encode([
    'status' => 'success',
    'outbound_public_ip' => $outbound_ip,
    'inbound_server_ip' => $inbound_ip,
    'instructions' => 'Copy the outbound_public_ip value above and whitelist it in your Kotak Neo Portal: Kotak Neo -> More -> Trade API -> Add IP.'
], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
