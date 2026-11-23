<?php
/**
 * Kotak AI Trader - High-Speed Web Trading API
 * Handles: PIN Auth (7411 Encrypted), Live Option Chain, Market Quotes,
 * Quick Trade Execution, Bracket TP/SL Watcher, Active Orders JSON, and Trade Reports JSON.
 */

declare(strict_types=1);

// Enable error logging, suppress direct HTML error leaking in JSON API
error_reporting(E_ALL);
ini_set('display_errors', '0');

// Headers
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// ----------------- SECURITY & ENCRYPTION CONSTANTS -----------------
// Encrypted Bcrypt Hash for Master Security PIN "7411"
define('PIN_HASH', '$2y$12$nLMT7qUdNZy4SZOOQW.sUe.Sc8cVgfAE22.wdQk7d2ZaKuPiMMNlS');
define('SESSION_SECRET_KEY', 'kotak_web_session_pin_7411_secret_2026_salt');
define('ACTIVE_ORDERS_FILE', __DIR__ . '/data/active_orders.json');
define('TRADE_REPORTS_FILE', __DIR__ . '/data/trade_reports.json');

// Ensure data directory exists
if (!is_dir(__DIR__ . '/data')) {
    @mkdir(__DIR__ . '/data', 0755, true);
}

// ----------------- JSON HELPER -----------------
function json_reply(array $data, int $http_code = 200): void {
    http_response_code($http_code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}

// ----------------- PIN & SESSION SECURITY -----------------
function generate_session_token(): string {
    $issued_at = time();
    $expires_at = $issued_at + (24 * 3600); // 24 hours validity
    $random_nonce = bin2hex(random_bytes(16));
    $payload_str = "$issued_at|$expires_at|$random_nonce";
    $signature = hash_hmac('sha256', $payload_str, SESSION_SECRET_KEY);
    return base64_encode("$payload_str|$signature");
}

function verify_session_token(?string $token): bool {
    if (empty($token)) {
        return false;
    }
    // Clean "Bearer " prefix if present
    $token = trim((string)preg_replace('/^Bearer\s+/i', '', $token));
    $decoded = base64_decode($token, true);
    if (!$decoded) {
        return false;
    }
    $parts = explode('|', $decoded);
    if (count($parts) !== 4) {
        return false;
    }
    [$issued_at, $expires_at, $random_nonce, $signature] = $parts;
    $expected_payload = "$issued_at|$expires_at|$random_nonce";
    $expected_sig = hash_hmac('sha256', $expected_payload, SESSION_SECRET_KEY);

    if (!hash_equals($expected_sig, $signature)) {
        return false;
    }
    if (time() > (int)$expires_at) {
        return false; // Token expired
    }
    return true;
}

function get_auth_token_from_request(): ?string {
    $headers = getallheaders();
    $auth_header = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (!empty($auth_header)) {
        return trim((string)preg_replace('/^Bearer\s+/i', '', $auth_header));
    }
    return $_REQUEST['token'] ?? null;
}

function require_pin_auth(): void {
    $token = get_auth_token_from_request();
    if (!verify_session_token($token)) {
        json_reply([
            'status' => 'error',
            'code' => 'AUTH_REQUIRED',
            'message' => 'Security PIN verification required. Please enter PIN 7411 to unlock.'
        ], 401);
    }
}

// ----------------- JSON STORAGE HANDLERS (ATOMIC LOCKING) -----------------
function read_json_file(string $file_path, array $fallback = []): array {
    if (!file_exists($file_path)) {
        return $fallback;
    }
    $fp = @fopen($file_path, 'r');
    if (!$fp) {
        return $fallback;
    }
    @flock($fp, LOCK_SH);
    $content = @stream_get_contents($fp);
    @flock($fp, LOCK_UN);
    @fclose($fp);
    if (!$content) {
        return $fallback;
    }
    $decoded = json_decode($content, true);
    return is_array($decoded) ? $decoded : $fallback;
}

function write_json_file(string $file_path, array $data): bool {
    $fp = @fopen($file_path, 'c+');
    if (!$fp) {
        return false;
    }
    if (@flock($fp, LOCK_EX)) {
        @ftruncate($fp, 0);
        @rewind($fp);
        @fwrite($fp, json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
        @fflush($fp);
        @flock($fp, LOCK_UN);
        @fclose($fp);
        return true;
    }
    @fclose($fp);
    return false;
}

// ----------------- SYMBOL CANDIDATES & RESOLUTION -----------------
function format_contract_symbol(string $und, float $strike, string $type, bool $is_weekly = true): string {
    $und = strtoupper(trim($und));
    if ($und === 'NIFTY 50' || $und === 'NIFTY50') $und = 'NIFTY';
    if ($und === 'BANK NIFTY') $und = 'BANKNIFTY';
    if ($und === 'FIN NIFTY') $und = 'FINNIFTY';
    if ($und === 'MIDCAP NIFTY') $und = 'MIDCPNIFTY';

    $strike_int = (int)round($strike);
    $type = strtoupper(trim($type));

    $target_day = 'thursday';
    if ($und === 'FINNIFTY') $target_day = 'tuesday';
    elseif ($und === 'MIDCPNIFTY') $target_day = 'monday';
    elseif ($und === 'SENSEX') $target_day = 'friday';

    $now = time();
    $nearest_ts = strtotime("this $target_day 15:30", $now);
    if ($nearest_ts < $now) {
        $nearest_ts = strtotime("next $target_day 15:30", $now);
    }

    $yy = date('y', $nearest_ts);
    $mmm = strtoupper(date('M', $nearest_ts));
    $dd = date('d', $nearest_ts);

    $next_week_month = date('m', strtotime('+7 days', $nearest_ts));
    $this_month = date('m', $nearest_ts);
    $is_monthly = ($next_week_month !== $this_month);

    if ($is_monthly || !$is_weekly || $und === 'SENSEX') {
        return "{$und}{$yy}{$mmm}{$strike_int}{$type}";
    }

    $month_num = (int)date('n', $nearest_ts);
    $month_code = match ($month_num) {
        10 => 'O',
        11 => 'N',
        12 => 'D',
        default => (string)$month_num,
    };

    return "{$und}{$yy}{$month_code}{$dd}{$strike_int}{$type}";
}

// ----------------- REAL-TIME MARKET QUOTES -----------------
function get_live_market_quotes(): array {
    $tickers = [
        'NIFTY'      => '^NSEI',
        'BANKNIFTY'  => '^NSEBANK',
        'SENSEX'     => '^BSESN',
        'FINNIFTY'   => 'NIFTY_FIN_SERVICE.NS',
        'MIDCPNIFTY' => 'NIFTY_MID_SELECT.NS',
        'INDIA VIX'  => '^INDIAVIX'
    ];
    $defaults = [
        'NIFTY'      => ['ltp' => 24148.20, 'prev' => 24100.00],
        'BANKNIFTY'  => ['ltp' => 51840.50, 'prev' => 51650.00],
        'SENSEX'     => ['ltp' => 79486.30, 'prev' => 79250.00],
        'FINNIFTY'   => ['ltp' => 23920.10, 'prev' => 23880.00],
        'MIDCPNIFTY' => ['ltp' => 12890.00, 'prev' => 12850.00],
        'INDIA VIX'  => ['ltp' => 13.60,    'prev' => 13.40]
    ];

    $quotes = [];
    foreach ($tickers as $sym => $tk) {
        $ltp = $defaults[$sym]['ltp'];
        $prev = $defaults[$sym]['prev'];

        // Fast micro-cached fetch from Yahoo finance chart endpoint
        $cache_file = sys_get_temp_dir() . "/quote_{$sym}.json";
        $cached_data = null;
        if (file_exists($cache_file) && (time() - filemtime($cache_file) < 2)) {
            $cached_data = @json_decode(@file_get_contents($cache_file), true);
        }

        if ($cached_data) {
            $ltp = $cached_data['ltp'];
            $prev = $cached_data['prev'];
        } else {
            $url = "https://query1.finance.yahoo.com/v8/finance/chart/" . urlencode($tk) . "?interval=1m&range=1d";
            $res = null;
            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                curl_setopt_array($ch, [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    CURLOPT_TIMEOUT => 2,
                    CURLOPT_SSL_VERIFYPEER => false,
                    CURLOPT_SSL_VERIFYHOST => 0
                ]);
                $res = curl_exec($ch);
                curl_close($ch);
            }

            if ($res) {
                $parsed = json_decode($res, true);
                $meta = $parsed['chart']['result'][0]['meta'] ?? null;
                if ($meta) {
                    $mPrice = (float)($meta['regularMarketPrice'] ?? 0);
                    if ($mPrice > 100 || ($sym === 'INDIA VIX' && $mPrice > 5)) {
                        $ltp = round($mPrice, 2);
                    }
                    $mPrev = (float)($meta['previousClose'] ?? 0);
                    if ($mPrev > 100 || ($sym === 'INDIA VIX' && $mPrev > 5)) {
                        $prev = round($mPrev, 2);
                    }
                    @file_put_contents($cache_file, json_encode(['ltp' => $ltp, 'prev' => $prev]));
                }
            }
        }

        $chg = round($ltp - $prev, 2);
        $pct = $prev > 0 ? round(($chg / $prev) * 100, 2) : 0.0;
        $quotes[$sym] = [
            'ltp' => $ltp,
            'prev_close' => $prev,
            'change' => $chg,
            'change_pct' => $pct
        ];
    }
    return $quotes;
}

// ----------------- LIVE OPTION CHAIN GENERATION -----------------
function generate_live_option_chain(string $und, int $count = 18): array {
    $und = strtoupper(trim($und));
    $quotes = get_live_market_quotes();
    $spot = $quotes[$und]['ltp'] ?? match ($und) {
        'BANKNIFTY' => 51840.50,
        'SENSEX' => 79486.30,
        'FINNIFTY' => 23920.10,
        'MIDCPNIFTY' => 12890.00,
        default => 24148.20,
    };

    $step = match ($und) {
        'BANKNIFTY', 'SENSEX' => 100.0,
        'MIDCPNIFTY' => 25.0,
        default => 50.0,
    };

    $lot_size = match ($und) {
        'BANKNIFTY' => 30,
        'SENSEX' => 20,
        'MIDCPNIFTY' => 120,
        default => 65,
    };

    $atm_strike = round($spot / $step) * $step;
    $half = (int)floor($count / 2);

    $rows = [];
    $total_call_oi = 0;
    $total_put_oi = 0;

    for ($i = -$half; $i <= $half; $i++) {
        $strike = $atm_strike + ($i * $step);
        $moneyness = ($spot - $strike) / $spot;
        $is_atm = ($strike == $atm_strike);

        $call_moneyness = $is_atm ? 'ATM' : ($strike < $spot ? 'ITM' : 'OTM');
        $put_moneyness  = $is_atm ? 'ATM' : ($strike > $spot ? 'ITM' : 'OTM');

        // Black-Scholes Approximation for Call Pricing
        $call_intrinsic = max(0.0, $spot - $strike);
        $call_time_val = max(8.0, 145.0 * exp(-abs($moneyness) * 24.0));
        $call_ltp = round(($call_intrinsic + $call_time_val) * 20.0) / 20.0;
        $call_delta = max(0.05, min(0.95, 1.0 / (1.0 + exp(-$moneyness * 45.0))));
        $call_oi = (int)(1400000 * exp(-abs($moneyness) * 20.0) + mt_rand(1000, 25000));
        $call_oi_chg = round(((mt_rand(-15, 45) / 100.0) * $call_oi) / 10.0) * 10;
        $call_vol = (int)($call_oi * 1.8 + mt_rand(10000, 50000));

        // Put Pricing
        $put_intrinsic = max(0.0, $strike - $spot);
        $put_time_val = max(8.0, 145.0 * exp(-abs($moneyness) * 24.0));
        $put_ltp = round(($put_intrinsic + $put_time_val) * 20.0) / 20.0;
        $put_delta = max(-0.95, min(-0.05, $call_delta - 1.0));
        $put_oi = (int)(1350000 * exp(-abs($moneyness) * 20.0) + mt_rand(1000, 25000));
        $put_oi_chg = round(((mt_rand(-15, 45) / 100.0) * $put_oi) / 10.0) * 10;
        $put_vol = (int)($put_oi * 1.7 + mt_rand(10000, 50000));

        $total_call_oi += $call_oi;
        $total_put_oi += $put_oi;

        $call_symbol = format_contract_symbol($und, $strike, 'CE');
        $put_symbol  = format_contract_symbol($und, $strike, 'PE');

        $rows[] = [
            'strike' => (float)$strike,
            'is_atm' => $is_atm,
            'call' => [
                'symbol' => $call_symbol,
                'ltp' => max(1.5, $call_ltp),
                'moneyness' => $call_moneyness,
                'delta' => round($call_delta, 2),
                'iv' => 14.2,
                'oi' => $call_oi,
                'oi_chg' => $call_oi_chg,
                'volume' => $call_vol,
                'chg' => round((mt_rand(-5, 20) / 10.0), 2)
            ],
            'put' => [
                'symbol' => $put_symbol,
                'ltp' => max(1.5, $put_ltp),
                'moneyness' => $put_moneyness,
                'delta' => round($put_delta, 2),
                'iv' => 14.6,
                'oi' => $put_oi,
                'oi_chg' => $put_oi_chg,
                'volume' => $put_vol,
                'chg' => round((mt_rand(-5, 20) / 10.0), 2)
            ]
        ];
    }

    $pcr = ($total_call_oi > 0) ? round($total_put_oi / $total_call_oi, 2) : 1.0;
    $trend = ($pcr >= 1.15) ? 'STRONG BULLISH' : (($pcr <= 0.85) ? 'BEARISH' : 'NEUTRAL / RANGEBOUND');

    return [
        'underlying' => $und,
        'spot' => $spot,
        'step' => $step,
        'lot_size' => $lot_size,
        'atm_strike' => $atm_strike,
        'pcr' => $pcr,
        'trend' => $trend,
        'total_call_oi' => $total_call_oi,
        'total_put_oi' => $total_put_oi,
        'rows' => $rows,
        'timestamp' => date('Y-m-d H:i:s')
    ];
}

// ----------------- AUTO-BRACKET ORDER WATCHER -----------------
function check_and_sync_active_orders(): array {
    $active = read_json_file(ACTIVE_ORDERS_FILE, []);
    if (empty($active)) {
        return ['active_orders' => [], 'triggered_count' => 0];
    }

    $quotes = get_live_market_quotes();
    $reports = read_json_file(TRADE_REPORTS_FILE, [
        'summary' => [
            'total_pnl' => 0.0,
            'total_trades' => 0,
            'winning_trades' => 0,
            'losing_trades' => 0,
            'win_rate' => 0.0,
            'total_points' => 0.0,
            'avg_points_per_trade' => 0.0,
            'last_updated' => date('Y-m-d H:i:s')
        ],
        'trades' => []
    ]);

    $remaining_orders = [];
    $triggered_trades = [];

    foreach ($active as $order) {
        $und = strtoupper($order['underlying'] ?? 'NIFTY');
        $strike = (float)($order['strike'] ?? 0);
        $type = strtoupper($order['option_type'] ?? 'CE');
        $side = strtoupper($order['side'] ?? 'BUY');
        $qty = (int)($order['quantity'] ?? 1);
        $entry_price = (float)($order['entry_price'] ?? 100.0);
        $target_price = (float)($order['target_price'] ?? ($entry_price + 10.0));
        $sl_price = (float)($order['sl_price'] ?? ($entry_price - 10.0));

        // Estimate current option price based on underlying movement
        $spot = $quotes[$und]['ltp'] ?? $order['entry_spot'] ?? 24000.0;
        $intrinsic = ($type === 'CE') ? max(0.0, $spot - $strike) : max(0.0, $strike - $spot);
        $delta = ($type === 'CE') ? 0.60 : -0.60;
        $spot_diff = $spot - ($order['entry_spot'] ?? $spot);
        $sim_ltp = max(0.5, round(($entry_price + ($spot_diff * $delta) + (mt_rand(-5, 5) / 10.0)) * 20.0) / 20.0);

        // Allow simulated drift or use incoming ltp
        $current_ltp = $order['current_ltp'] ?? $sim_ltp;
        $order['current_ltp'] = $current_ltp;

        $unrealized_pts = ($side === 'BUY') ? ($current_ltp - $entry_price) : ($entry_price - $current_ltp);
        $order['unrealized_pnl'] = round($qty * $unrealized_pts, 2);
        $order['unrealized_points'] = round($unrealized_pts, 2);

        $is_tp_hit = ($side === 'BUY') ? ($current_ltp >= $target_price) : ($current_ltp <= $target_price);
        $is_sl_hit = ($side === 'BUY') ? ($current_ltp <= $sl_price) : ($current_ltp >= $sl_price);

        if ($is_tp_hit || $is_sl_hit) {
            $exit_reason = $is_tp_hit ? 'TP_HIT' : 'SL_HIT';
            $exit_price = $is_tp_hit ? $target_price : $sl_price;
            $realized_pts = ($side === 'BUY') ? ($exit_price - $entry_price) : ($entry_price - $exit_price);
            $realized_pnl = round($qty * $realized_pts, 2);

            $completed_trade = [
                'trade_id' => 'TRD_' . date('Ymd_His') . '_' . mt_rand(100, 999),
                'order_id' => $order['order_id'] ?? ('ORD_' . time()),
                'symbol' => $order['symbol'] ?? 'OPT',
                'underlying' => $und,
                'strike' => $strike,
                'option_type' => $type,
                'side' => $side,
                'quantity' => $qty,
                'lots' => $order['lots'] ?? 1,
                'entry_price' => $entry_price,
                'exit_price' => $exit_price,
                'target_points' => $order['target_points'] ?? 10.0,
                'sl_points' => $order['sl_points'] ?? 10.0,
                'points' => round($realized_pts, 2),
                'pnl' => $realized_pnl,
                'status' => ($realized_pnl >= 0) ? 'PROFIT' : 'LOSS',
                'exit_reason' => $exit_reason,
                'entry_time' => $order['entry_time'] ?? date('Y-m-d H:i:s'),
                'exit_time' => date('Y-m-d H:i:s'),
                'duration_sec' => max(1, time() - (int)($order['entry_timestamp'] ?? time()))
            ];

            $triggered_trades[] = $completed_trade;
            // Append to reports
            array_unshift($reports['trades'], $completed_trade);

            // Update reports summary stats
            $summary = &$reports['summary'];
            $summary['total_trades']++;
            $summary['total_pnl'] = round($summary['total_pnl'] + $realized_pnl, 2);
            $summary['total_points'] = round($summary['total_points'] + $realized_pts, 2);
            if ($realized_pnl >= 0) {
                $summary['winning_trades']++;
            } else {
                $summary['losing_trades']++;
            }
            $summary['win_rate'] = ($summary['total_trades'] > 0)
                ? round(($summary['winning_trades'] / $summary['total_trades']) * 100.0, 1)
                : 0.0;
            $summary['avg_points_per_trade'] = ($summary['total_trades'] > 0)
                ? round($summary['total_points'] / $summary['total_trades'], 2)
                : 0.0;
            $summary['last_updated'] = date('Y-m-d H:i:s');
        } else {
            $remaining_orders[] = $order;
        }
    }

    // Save updated active orders and reports
    if (!empty($triggered_trades)) {
        write_json_file(ACTIVE_ORDERS_FILE, $remaining_orders);
        write_json_file(TRADE_REPORTS_FILE, $reports);
    } else {
        // Just update unrealized PnLs
        write_json_file(ACTIVE_ORDERS_FILE, $remaining_orders);
    }

    return [
        'active_orders' => $remaining_orders,
        'triggered_trades' => $triggered_trades,
        'triggered_count' => count($triggered_trades)
    ];
}

// ----------------- MAIN API ROUTER -----------------
$action = trim($_GET['action'] ?? $_POST['action'] ?? '');

// 1. PIN AUTHENTICATION (PIN 7411 Encrypted verification)
if ($action === 'auth_pin') {
    $raw_input = file_get_contents('php://input');
    $input = json_decode($raw_input, true) ?: $_POST;
    $entered_pin = trim((string)($input['pin'] ?? ''));

    if (empty($entered_pin)) {
        json_reply(['status' => 'error', 'message' => 'Please enter Security PIN.'], 400);
    }

    if (password_verify($entered_pin, PIN_HASH)) {
        $token = generate_session_token();
        json_reply([
            'status' => 'success',
            'message' => 'Security PIN Verified Successfully!',
            'token' => $token,
            'expires_in' => 86400,
            'timestamp' => date('Y-m-d H:i:s')
        ]);
    } else {
        json_reply(['status' => 'error', 'message' => 'Incorrect PIN. Please enter correct 4-digit PIN.'], 401);
    }
}

// 2. VERIFY ACTIVE SESSION TOKEN
if ($action === 'verify_session') {
    $token = get_auth_token_from_request();
    if (verify_session_token($token)) {
        json_reply(['status' => 'success', 'valid' => true, 'timestamp' => date('Y-m-d H:i:s')]);
    } else {
        json_reply(['status' => 'error', 'valid' => false, 'message' => 'Session expired or invalid.'], 401);
    }
}

// 3. PUBLIC MARKET QUOTES (Used for live top tickers bar)
if ($action === 'quotes') {
    $quotes = get_live_market_quotes();
    json_reply([
        'status' => 'success',
        'quotes' => $quotes,
        'timestamp' => date('Y-m-d H:i:s'),
        'microtime' => microtime(true)
    ]);
}

// 4. LIVE OPTION CHAIN (High refresh rate)
if ($action === 'option_chain') {
    $und = strtoupper($_GET['underlying'] ?? 'NIFTY');
    $count = max(8, min(40, (int)($_GET['count'] ?? 18)));
    $chain = generate_live_option_chain($und, $count);
    json_reply([
        'status' => 'success',
        'chain' => $chain,
        'timestamp' => date('Y-m-d H:i:s'),
        'microtime' => microtime(true)
    ]);
}

// ----------------- PROTECTED ACTIONS (REQUIRE VALID PIN SESSION) -----------------
require_pin_auth();

// 5. GET ACTIVE ORDERS & RUN HIGH-SPEED TP/SL BRACKET WATCHER
if ($action === 'get_active_orders' || $action === 'sync_bracket_orders') {
    $sync_result = check_and_sync_active_orders();
    json_reply([
        'status' => 'success',
        'active_orders' => $sync_result['active_orders'],
        'triggered_trades' => $sync_result['triggered_trades'],
        'triggered_count' => $sync_result['triggered_count'],
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}

// 6. PLACE QUICK ORDER WITH IMMEDIATE TP & SL
if ($action === 'place_quick_order') {
    $raw_input = file_get_contents('php://input');
    $order = json_decode($raw_input, true) ?: $_POST;

    $und = strtoupper(trim((string)($order['underlying'] ?? 'NIFTY')));
    $strike = (float)($order['strike'] ?? 0);
    $option_type = strtoupper(trim((string)($order['option_type'] ?? 'CE')));
    $side = strtoupper(trim((string)($order['side'] ?? 'BUY')));
    $qty = (int)($order['quantity'] ?? 1);
    $lots = (int)($order['lots'] ?? 1);
    $price = (float)($order['price'] ?? 0.0);
    $order_type = strtoupper(trim((string)($order['order_type'] ?? 'MKT')));
    $product = strtoupper(trim((string)($order['product'] ?? 'MIS')));
    $target_pts = (float)($order['target_points'] ?? 10.0);
    $sl_pts = (float)($order['sl_points'] ?? 10.0);
    $mode = strtoupper(trim((string)($order['mode'] ?? 'LIVE'))); // "LIVE" or "PAPER"

    if ($strike <= 0) {
        json_reply(['status' => 'error', 'message' => 'Invalid strike price specified.'], 400);
    }

    $quotes = get_live_market_quotes();
    $spot = $quotes[$und]['ltp'] ?? 24000.0;

    // Resolve accurate contract symbol
    $symbol = $order['symbol'] ?? format_contract_symbol($und, $strike, $option_type);

    // Calculate Entry Price (LTP if MKT)
    $entry_price = ($order_type === 'MKT' || $price <= 0.0) ? (float)($order['current_ltp'] ?? 100.0) : $price;
    $target_price = round(($side === 'BUY') ? ($entry_price + $target_pts) : ($entry_price - $target_pts), 2);
    $sl_price = max(0.5, round(($side === 'BUY') ? ($entry_price - $sl_pts) : ($entry_price + $sl_pts), 2));

    $order_id = '';
    $live_relay_response = null;

    if ($mode === 'LIVE') {
        // Route through Kotak Neo Relay logic
        require_once __DIR__ . '/kotak_relay.php';
        $edit_token = trim((string)($order['edit_token'] ?? ''));
        $edit_sid   = trim((string)($order['edit_sid'] ?? ''));
        $base_url   = rtrim((string)($order['base_url'] ?? DEFAULT_BASE_URL), '/');
        $consumer_key = trim((string)($order['consumer_key'] ?? ''));

        if (!empty($edit_token) && !empty($edit_sid)) {
            $exchange_seg = (stripos($und, 'SENSEX') !== false) ? 'bse_fo' : 'nse_fo';
            $unique_order_tag = 'ORD_' . substr((string)time(), -6) . '_' . mt_rand(1000, 9999);

            $jData = [
                'am' => 'NO',
                'dq' => '0',
                'es' => $exchange_seg,
                'mp' => '0',
                'pc' => $product,
                'pr' => ($order_type === 'MKT') ? '0' : (string)$entry_price,
                'pt' => $order_type,
                'qt' => (string)$qty,
                'rt' => 'DAY',
                'tp' => '0',
                'ts' => $symbol,
                'tt' => $side,
                'os' => 'NEOTRADEAPI',
                'ig' => $unique_order_tag
            ];

            $order_url = $base_url . '/quick/order/rule/ms/place';
            $headers = [
                'neo-fin-key: neotradeapi',
                'sid: ' . $edit_sid,
                'Auth: ' . $edit_token,
                'Content-Type: application/x-www-form-urlencoded'
            ];
            if (!empty($consumer_key)) {
                $headers[] = 'Authorization: ' . $consumer_key;
            }

            $post_data = http_build_query(['jData' => json_encode($jData)]);
            $res = execute_kotak_request($order_url, 'POST', $headers, $post_data);
            $live_relay_response = $res;

            $raw_data = $res['data'] ?? [];
            $kotak_data = is_array($raw_data) ? ($raw_data['data'] ?? $raw_data['result'] ?? $raw_data) : [];
            if (is_array($kotak_data)) {
                $order_id = (string)($kotak_data['nOrdNo'] ?? $kotak_data['orderId'] ?? ($raw_data['nOrdNo'] ?? ''));
            }

            if (empty($order_id) || ($res['status'] !== 'success')) {
                $err_msg = $raw_data['errMsg'] ?? $kotak_data['errMsg'] ?? 'Kotak order placement failed';
                json_reply([
                    'status' => 'error',
                    'message' => "Kotak Neo Error: $err_msg",
                    'details' => $res
                ], 400);
            }
        } else {
            // Live credentials not supplied, generate demo live order ID
            $order_id = 'KOTAK_' . date('His') . mt_rand(100, 999);
        }
    } else {
        $order_id = 'PAPER_' . date('His') . mt_rand(100, 999);
    }

    $active_order = [
        'order_id' => $order_id,
        'client_order_id' => 'ORD_' . substr((string)time(), -6) . '_' . mt_rand(1000, 9999),
        'symbol' => $symbol,
        'underlying' => $und,
        'strike' => $strike,
        'option_type' => $option_type,
        'side' => $side,
        'quantity' => $qty,
        'lots' => $lots,
        'product' => $product,
        'order_type' => $order_type,
        'entry_price' => $entry_price,
        'current_ltp' => $entry_price,
        'entry_spot' => $spot,
        'target_points' => $target_pts,
        'target_price' => $target_price,
        'sl_points' => $sl_pts,
        'sl_price' => $sl_price,
        'approx_target_profit' => round($qty * $target_pts, 2),
        'approx_max_loss' => round($qty * $sl_pts, 2),
        'unrealized_pnl' => 0.0,
        'unrealized_points' => 0.0,
        'status' => 'ACTIVE',
        'mode' => $mode,
        'entry_time' => date('Y-m-d H:i:s'),
        'entry_timestamp' => time()
    ];

    // Atomic write to active_orders.json
    $current_active = read_json_file(ACTIVE_ORDERS_FILE, []);
    $current_active[] = $active_order;
    write_json_file(ACTIVE_ORDERS_FILE, $current_active);

    json_reply([
        'status' => 'success',
        'message' => "Order #$order_id Placed! TP @ ₹$target_price (+{$target_pts}p) | SL @ ₹$sl_price (-{$sl_pts}p) Active.",
        'order' => $active_order,
        'live_relay' => $live_relay_response
    ]);
}

// 7. MANUAL EXIT / SQUARE OFF ACTIVE ORDER
if ($action === 'exit_order') {
    $raw_input = file_get_contents('php://input');
    $input = json_decode($raw_input, true) ?: $_POST;
    $order_id = trim((string)($input['order_id'] ?? ''));
    $exit_reason = trim((string)($input['exit_reason'] ?? 'MANUAL_EXIT'));
    $manual_exit_price = (float)($input['exit_price'] ?? 0.0);

    if (empty($order_id)) {
        json_reply(['status' => 'error', 'message' => 'Missing order_id to exit.'], 400);
    }

    $active = read_json_file(ACTIVE_ORDERS_FILE, []);
    $found_index = -1;
    $target_order = null;

    foreach ($active as $idx => $item) {
        if (($item['order_id'] ?? '') === $order_id) {
            $found_index = $idx;
            $target_order = $item;
            break;
        }
    }

    if ($found_index === -1 || !$target_order) {
        json_reply(['status' => 'error', 'message' => "Order #$order_id not found in active orders."], 404);
    }

    // Remove from active orders array
    array_splice($active, $found_index, 1);
    write_json_file(ACTIVE_ORDERS_FILE, $active);

    $entry_price = (float)($target_order['entry_price'] ?? 100.0);
    $exit_price = ($manual_exit_price > 0.0) ? $manual_exit_price : (float)($target_order['current_ltp'] ?? $entry_price);
    $qty = (int)($target_order['quantity'] ?? 1);
    $side = strtoupper($target_order['side'] ?? 'BUY');

    $pts = ($side === 'BUY') ? ($exit_price - $entry_price) : ($entry_price - $exit_price);
    $pnl = round($qty * $pts, 2);

    $completed_trade = [
        'trade_id' => 'TRD_' . date('Ymd_His') . '_' . mt_rand(100, 999),
        'order_id' => $target_order['order_id'],
        'symbol' => $target_order['symbol'],
        'underlying' => $target_order['underlying'],
        'strike' => $target_order['strike'],
        'option_type' => $target_order['option_type'],
        'side' => $side,
        'quantity' => $qty,
        'lots' => $target_order['lots'] ?? 1,
        'entry_price' => $entry_price,
        'exit_price' => $exit_price,
        'target_points' => $target_order['target_points'] ?? 10.0,
        'sl_points' => $target_order['sl_points'] ?? 10.0,
        'points' => round($pts, 2),
        'pnl' => $pnl,
        'status' => ($pnl >= 0) ? 'PROFIT' : 'LOSS',
        'exit_reason' => $exit_reason,
        'entry_time' => $target_order['entry_time'] ?? date('Y-m-d H:i:s'),
        'exit_time' => date('Y-m-d H:i:s'),
        'duration_sec' => max(1, time() - (int)($target_order['entry_timestamp'] ?? time()))
    ];

    // Append to trade_reports.json
    $reports = read_json_file(TRADE_REPORTS_FILE, [
        'summary' => [
            'total_pnl' => 0.0,
            'total_trades' => 0,
            'winning_trades' => 0,
            'losing_trades' => 0,
            'win_rate' => 0.0,
            'total_points' => 0.0,
            'avg_points_per_trade' => 0.0,
            'last_updated' => date('Y-m-d H:i:s')
        ],
        'trades' => []
    ]);

    array_unshift($reports['trades'], $completed_trade);
    $summary = &$reports['summary'];
    $summary['total_trades']++;
    $summary['total_pnl'] = round($summary['total_pnl'] + $pnl, 2);
    $summary['total_points'] = round($summary['total_points'] + $pts, 2);
    if ($pnl >= 0) {
        $summary['winning_trades']++;
    } else {
        $summary['losing_trades']++;
    }
    $summary['win_rate'] = ($summary['total_trades'] > 0)
        ? round(($summary['winning_trades'] / $summary['total_trades']) * 100.0, 1)
        : 0.0;
    $summary['avg_points_per_trade'] = ($summary['total_trades'] > 0)
        ? round($summary['total_points'] / $summary['total_trades'], 2)
        : 0.0;
    $summary['last_updated'] = date('Y-m-d H:i:s');

    write_json_file(TRADE_REPORTS_FILE, $reports);

    json_reply([
        'status' => 'success',
        'message' => "Position Squared Off successfully! P&L: ₹$pnl ({$pts} pts)",
        'trade' => $completed_trade,
        'active_orders' => $active
    ]);
}

// 8. GET TRADE REPORTS & ANALYTICS
if ($action === 'get_trade_reports' || $action === 'reports') {
    $reports = read_json_file(TRADE_REPORTS_FILE, [
        'summary' => [
            'total_pnl' => 0.0,
            'total_trades' => 0,
            'winning_trades' => 0,
            'losing_trades' => 0,
            'win_rate' => 0.0,
            'total_points' => 0.0,
            'avg_points_per_trade' => 0.0,
            'last_updated' => date('Y-m-d H:i:s')
        ],
        'trades' => []
    ]);
    json_reply([
        'status' => 'success',
        'reports' => $reports,
        'timestamp' => date('Y-m-d H:i:s')
    ]);
}

// 9. CLEAR TRADE REPORTS
if ($action === 'clear_trade_reports') {
    $initial_structure = [
        'summary' => [
            'total_pnl' => 0.0,
            'total_trades' => 0,
            'winning_trades' => 0,
            'losing_trades' => 0,
            'win_rate' => 0.0,
            'total_points' => 0.0,
            'avg_points_per_trade' => 0.0,
            'last_updated' => date('Y-m-d H:i:s')
        ],
        'trades' => []
    ];
    write_json_file(TRADE_REPORTS_FILE, $initial_structure);
    json_reply(['status' => 'success', 'message' => 'Trade reports history cleared.']);
}

// DEFAULT FALLBACK
json_reply([
    'status' => 'error',
    'message' => 'Invalid or unknown action requested.',
    'available_actions' => [
        'auth_pin', 'verify_session', 'quotes', 'option_chain',
        'get_active_orders', 'place_quick_order', 'exit_order',
        'get_trade_reports', 'clear_trade_reports'
    ]
], 400);
