<?php
/**
 * Renderizador de artículos — El Puerto Valencia
 * Sube este archivo a la raíz de tu web en Hostinger.
 */

define('ARTICLES_DIR', __DIR__ . '/articulos_data/');

$slug = preg_replace('/[^a-z0-9-]/', '', $_GET['slug'] ?? '');

if (!$slug) {
    header('Location: /');
    exit;
}

$file = ARTICLES_DIR . $slug . '.json';
if (!file_exists($file)) {
    http_response_code(404);
    header('Location: /');
    exit;
}

$article = json_decode(file_get_contents($file), true);
if (!$article) {
    header('Location: /');
    exit;
}

$title       = htmlspecialchars($article['title'] ?? '');
$meta_desc   = htmlspecialchars($article['meta_description'] ?? $title);
$body        = $article['body'] ?? '';
$image       = htmlspecialchars($article['featured_image_url'] ?? '');
$published   = $article['published_at'] ?? '';
$date_fmt    = $published ? date('j \d\e F \d\e Y', strtotime($published)) : '';

// Traducir mes al español
$meses = ['January'=>'enero','February'=>'febrero','March'=>'marzo','April'=>'abril',
          'May'=>'mayo','June'=>'junio','July'=>'julio','August'=>'agosto',
          'September'=>'septiembre','October'=>'octubre','November'=>'noviembre','December'=>'diciembre'];
$date_fmt = strtr($date_fmt, $meses);

$canonical = 'https://elpuertovalencia.com/' . $slug;
?>
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= $title ?> | El Puerto Valencia</title>
  <meta name="description" content="<?= $meta_desc ?>">
  <link rel="canonical" href="<?= $canonical ?>">
  <meta property="og:title" content="<?= $title ?>">
  <meta property="og:description" content="<?= $meta_desc ?>">
  <?php if ($image): ?><meta property="og:image" content="<?= $image ?>"><?php endif; ?>
  <meta property="og:url" content="<?= $canonical ?>">
  <meta property="og:type" content="article">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Inter',sans-serif; background:#0e0030; color:#333; }

    /* NAV */
    nav { background:#12003e; padding:14px 40px; display:flex; align-items:center; gap:16px; position:sticky; top:0; z-index:100; box-shadow:0 2px 12px rgba(0,0,0,.4); }
    nav a.logo img { height:48px; display:block; }
    nav a.back { margin-left:auto; color:rgba(255,255,255,.75); font-size:.88rem; text-decoration:none; display:flex; align-items:center; gap:6px; }
    nav a.back:hover { color:#ff5c35; }

    /* HERO */
    .article-hero { background:linear-gradient(135deg,#12003e 0%,#2b0080 60%,#6a0572 100%); padding:60px 24px 48px; text-align:center; }
    .article-hero .kw { display:inline-block; background:rgba(255,92,53,.18); color:#ff5c35; font-size:.78rem; font-weight:600; letter-spacing:.08em; text-transform:uppercase; padding:4px 14px; border-radius:20px; margin-bottom:20px; }
    .article-hero h1 { font-family:'Playfair Display',serif; font-size:clamp(1.6rem,4vw,2.6rem); color:#fff; max-width:820px; margin:0 auto 16px; line-height:1.3; }
    .article-hero .meta { color:rgba(255,255,255,.55); font-size:.85rem; }

    /* BODY */
    .article-wrap { max-width:820px; margin:0 auto; background:#fff; border-radius:0 0 16px 16px; overflow:hidden; }
    .article-image img { width:100%; display:block; max-height:480px; object-fit:cover; }
    .article-content { padding:44px 48px 48px; }

    /* Tipografía del cuerpo */
    .article-content p  { line-height:1.85; margin-bottom:18px; color:#3a3a3a; font-size:1.02rem; }
    .article-content h2 { font-family:'Playfair Display',serif; font-size:1.55rem; color:#12003e; margin:38px 0 14px; line-height:1.3; }
    .article-content h3 { font-size:1.15rem; font-weight:600; color:#2b0080; margin:26px 0 10px; }
    .article-content ul, .article-content ol { margin:14px 0 18px 26px; }
    .article-content li  { line-height:1.75; color:#3a3a3a; margin-bottom:8px; }
    .article-content a   { color:#e91e8c; text-decoration:none; border-bottom:1px solid rgba(233,30,140,.3); }
    .article-content a:hover { border-color:#e91e8c; }

    /* Key takeaways box */
    .article-content .key-takeaways { background:#f4f0ff; border-left:4px solid #2b0080; border-radius:0 10px 10px 0; padding:22px 26px; margin:26px 0; }
    .article-content .key-takeaways h2 { font-size:1.1rem; margin:0 0 12px; color:#12003e; }
    .article-content .key-takeaways ul { margin:0 0 0 18px; }

    /* Table of contents */
    .article-content .table-of-contents { background:#fafafa; border:1px solid #e8e0ff; border-radius:10px; padding:20px 24px; margin:26px 0; }
    .article-content .table-of-contents h2 { font-size:1rem; margin:0 0 10px; color:#12003e; }
    .article-content .table-of-contents ul { margin:0 0 0 18px; }
    .article-content .table-of-contents li { margin-bottom:5px; }

    /* CTA */
    .cta-box { background:linear-gradient(135deg,#12003e,#e91e8c); color:#fff; padding:44px 40px; text-align:center; margin-top:48px; }
    .cta-box h3 { font-family:'Playfair Display',serif; font-size:1.8rem; margin-bottom:10px; }
    .cta-box p  { opacity:.88; margin-bottom:26px; font-size:1.05rem; }
    .cta-box a  { display:inline-block; background:#ff5c35; color:#fff; padding:14px 36px; border-radius:50px; text-decoration:none; font-weight:700; font-size:1rem; letter-spacing:.03em; transition:transform .2s,box-shadow .2s; }
    .cta-box a:hover { transform:translateY(-2px); box-shadow:0 8px 24px rgba(255,92,53,.45); }

    /* FOOTER */
    footer { background:#12003e; color:rgba(255,255,255,.5); text-align:center; padding:22px; font-size:.82rem; }
    footer a { color:rgba(255,255,255,.7); text-decoration:none; }
    footer a:hover { color:#ff5c35; }

    @media(max-width:600px){
      .article-content { padding:28px 20px 36px; }
      nav { padding:12px 16px; }
    }
  </style>
</head>
<body>

<nav>
  <a href="/" class="logo"><img src="/logo.png" alt="El Puerto Valencia"></a>
  <a href="/" class="back">← Volver</a>
</nav>

<div class="article-hero">
  <h1><?= $title ?></h1>
  <?php if ($date_fmt): ?><p class="meta">Publicado el <?= $date_fmt ?></p><?php endif; ?>
</div>

<div class="article-wrap">
  <?php if ($image): ?>
  <div class="article-image">
    <img src="<?= $image ?>" alt="<?= $title ?>" loading="lazy">
  </div>
  <?php endif; ?>

  <div class="article-content">
    <?= $body ?>

    <div class="cta-box">
      <h3>¿Lo celebramos juntos?</h3>
      <p>Presupuesto gratuito y sin compromiso en tiempo récord.</p>
      <a href="/#contacto">Solicitar presupuesto</a>
    </div>
  </div>
</div>

<footer>
  <p>© <?= date('Y') ?> El Puerto Valencia &nbsp;·&nbsp;
     <a href="tel:+34644044860">+34 644 044 860</a> &nbsp;·&nbsp;
     <a href="mailto:info@elpuertovalencia.com">info@elpuertovalencia.com</a> &nbsp;·&nbsp;
     <a href="/">Inicio</a>
  </p>
</footer>

</body>
</html>
