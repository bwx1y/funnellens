<?php
session_start();

// ================= KONFIGURASI META APP =================
$app_id       = '1785089045832816';
$app_secret   = '2acd0eede03d0caa95bfa45fb135144a';
$redirect_uri = 'http://localhost:8080/meta-oauth.php';
$api_version  = 'v21.0';

// HANYA meminta izin baca (Read-Only) untuk iklan dan kampanye milik user
$scopes = 'ads_read';

function callMetaApi(string $url, array $params = []): array {
    if (!empty($params)) {
        $url .= '?' . http_build_query($params);
    }

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_TIMEOUT        => 30,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

    if (curl_errno($ch)) {
        $error_msg = curl_error($ch);
        curl_close($ch);
        die("cURL Error: " . htmlspecialchars($error_msg));
    }
    curl_close($ch);

    $decoded = json_decode($response, true);
    if ($httpCode >= 400 || isset($decoded['error'])) {
        $errMsg = $decoded['error']['message'] ?? 'Unknown Meta API Error';
        die("Meta API Error ({$httpCode}): " . htmlspecialchars($errMsg));
    }

    return $decoded;
}

if (isset($_GET['error'])) {
    die('Login dibatalkan: ' . htmlspecialchars($_GET['error_description'] ?? $_GET['error']));
}

// 1. Arahkan user ke halaman login dengan scope ads_read saja
if (!isset($_GET['code'])) {
    $_SESSION['meta_oauth_state'] = bin2hex(random_bytes(16));

    $auth_url = "https://www.facebook.com/{$api_version}/dialog/oauth?" . http_build_query([
        'client_id'     => $app_id,
        'redirect_uri'  => $redirect_uri,
        'state'         => $_SESSION['meta_oauth_state'],
        'scope'         => $scopes,
        'response_type' => 'code',
    ]);

    header('Location: ' . $auth_url);
    exit;
}

// 2. Validasi State CSRF
if (empty($_GET['state']) || empty($_SESSION['meta_oauth_state']) || !hash_equals($_SESSION['meta_oauth_state'], $_GET['state'])) {
    unset($_SESSION['meta_oauth_state']);
    die('Error: State tidak valid.');
}
unset($_SESSION['meta_oauth_state']);

// 3. Tukar code menjadi Short-Lived Token
$short_token_data = callMetaApi("https://graph.facebook.com/{$api_version}/oauth/access_token", [
    'client_id'     => $app_id,
    'redirect_uri'  => $redirect_uri,
    'client_secret' => $app_secret,
    'code'          => $_GET['code'],
]);

// 4. Tukar menjadi Long-Lived Token (60 Hari)
$long_token_data = callMetaApi("https://graph.facebook.com/{$api_version}/oauth/access_token", [
    'grant_type'        => 'fb_exchange_token',
    'client_id'         => $app_id,
    'client_secret'     => $app_secret,
    'fb_exchange_token' => $short_token_data['access_token'],
]);

$long_lived_token = $long_token_data['access_token'];

// 5. Ambil daftar Ad Account dan Kampanye milik user tersebut
$ad_accounts = callMetaApi("https://graph.facebook.com/{$api_version}/me/adaccounts", [
    'fields'       => 'id,name,account_status,campaigns{id,name,status,objective,daily_budget,start_time}',
    'access_token' => $long_lived_token,
]);

header('Content-Type: application/json');
echo json_encode([
    'status'       => 'success',
    'permission'   => 'ads_read (Read-Only)',
    'access_token' => $long_lived_token,
    'ad_accounts'  => $ad_accounts['data'] ?? [],
], JSON_PRETTY_PRINT);