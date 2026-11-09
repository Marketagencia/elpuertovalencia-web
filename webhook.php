<?php
/**
 * AutoSEO Webhook Receiver — El Puerto Valencia
 * Sube este archivo a la raíz de tu web en Hostinger.
 * URL del webhook en AutoSEO: https://elpuertovalencia.com/webhook.php
 */

define('WEBHOOK_TOKEN', 'aseo_wh_00c09995ad37b44fb3c7cae2bd59dea5');
define('ARTICLES_DIR', __DIR__ . '/articulos_data/');

// Verificar método
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['error' => 'Método no permitido']));
}

// Verificar token de autorización
$auth = $_SERVER['HTTP_AUTHORIZATION'] ?? getallheaders()['Authorization'] ?? '';
if ($auth !== 'Bearer ' . WEBHOOK_TOKEN) {
    http_response_code(401);
    exit(json_encode(['error' => 'No autorizado']));
}

// Leer payload JSON
$payload = json_decode(file_get_contents('php://input'), true);
if (!$payload) {
    http_response_code(400);
    exit(json_encode(['error' => 'JSON inválido']));
}

$event   = $payload['event']   ?? '';
$article = $payload['article'] ?? null;

if (in_array($event, ['article.published', 'article.updated']) && $article) {
    $url  = $article['url'] ?? '';
    $slug = basename(rtrim($url, '/'));

    if ($slug) {
        if (!is_dir(ARTICLES_DIR)) {
            mkdir(ARTICLES_DIR, 0755, true);
        }
        file_put_contents(
            ARTICLES_DIR . $slug . '.json',
            json_encode($article, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)
        );
    }
}

header('Content-Type: application/json');
echo json_encode(['ok' => true]);
