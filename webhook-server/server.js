const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '5mb' }));

const BEARER_TOKEN = process.env.WEBHOOK_TOKEN || 'aseo_wh_3ebd747fde4a55a82161edd9eb2c4266';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Marketagencia';
const GITHUB_REPO = process.env.GITHUB_REPO || 'elpuertovalencia-web';

app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, slug, metaDescription, content_html } = req.body;
  if (!slug || !content_html || !title) {
    return res.status(400).json({ error: 'Faltan campos: title, slug, content_html' });
  }

  const today = new Date().toISOString().split('T')[0];
  const canonicalUrl = `https://elpuertovalencia.com/blog/${slug}/`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-16708029936"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'AW-16708029936');
</script>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)} | El Puerto Valencia</title>
  <meta name="description" content="${esc(metaDescription || '')}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${canonicalUrl}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:title" content="${esc(title)} | El Puerto Valencia" />
  <meta property="og:description" content="${esc(metaDescription || '')}" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:site_name" content="El Puerto Valencia" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": "${escJ(title)}",
    "description": "${escJ(metaDescription || '')}",
    "datePublished": "${today}",
    "dateModified": "${today}",
    "url": "${canonicalUrl}",
    "mainEntityOfPage": { "@type": "WebPage", "@id": "${canonicalUrl}" },
    "publisher": { "@type": "Organization", "name": "El Puerto Valencia", "logo": { "@type": "ImageObject", "url": "https://elpuertovalencia.com/logo.png" } },
    "author": { "@type": "Organization", "name": "El Puerto Valencia" }
  }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{--azul-marino:#12003e;--azul-medio:#2b0080;--dorado:#ff5c35;--rosa:#e91e8c;--blanco:#ffffff;--gris-claro:#f4f0ff;--gris-texto:#444444;--radio:12px}
    body{font-family:'Inter',sans-serif;color:var(--azul-marino);background:var(--blanco)}
    h1,h2,h3{font-family:'Playfair Display',serif;line-height:1.2}
    a{text-decoration:none;color:inherit}
    .container{max-width:760px;margin:0 auto;padding:0 24px}
    nav{position:fixed;top:0;left:0;right:0;z-index:100;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;background:rgba(10,22,40,0.95);backdrop-filter:blur(12px);border-bottom:1px solid rgba(201,168,76,0.2)}
    .nav-logo img{height:48px;width:auto}
    .nav-back{color:rgba(255,255,255,0.8);font-size:0.9rem;display:flex;align-items:center;gap:6px}
    .nav-back:hover{color:#fff}
    .article-hero{padding:120px 0 60px;background:linear-gradient(135deg,var(--azul-marino),var(--azul-medio))}
    .article-tag{display:inline-block;background:linear-gradient(135deg,var(--dorado),var(--rosa));color:#fff;font-size:0.72rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:6px 14px;border-radius:999px;margin-bottom:18px}
    .article-hero h1{font-size:clamp(1.8rem,4vw,2.8rem);color:#fff;margin-bottom:16px;max-width:680px}
    .article-meta{color:rgba(255,255,255,0.6);font-size:0.88rem}
    .article-body{padding:60px 0 80px}
    .article-body h2{font-size:1.6rem;color:var(--azul-marino);margin:40px 0 16px}
    .article-body h3{font-size:1.2rem;color:var(--azul-marino);margin:28px 0 12px}
    .article-body p{font-size:1rem;color:var(--gris-texto);line-height:1.8;margin-bottom:20px}
    .article-body ul,.article-body ol{padding-left:22px;margin-bottom:20px}
    .article-body li{font-size:1rem;color:var(--gris-texto);line-height:1.8;margin-bottom:8px}
    .article-body strong{color:var(--azul-marino)}
    .article-body a{color:var(--dorado);text-decoration:underline}
    .article-cta{background:linear-gradient(135deg,var(--azul-marino),var(--azul-medio));border-radius:16px;padding:40px;text-align:center;margin:48px 0}
    .article-cta h3{color:#fff;font-size:1.4rem;margin-bottom:12px}
    .article-cta p{color:rgba(255,255,255,0.75);margin-bottom:24px}
    .btn{display:inline-block;padding:15px 32px;border-radius:50px;font-weight:600;font-size:0.95rem;background:linear-gradient(135deg,var(--dorado),var(--rosa));color:#fff}
    .btn:hover{opacity:0.9}
    .back-link{display:inline-flex;align-items:center;gap:8px;color:var(--dorado);font-size:0.9rem;font-weight:600;margin-bottom:40px}
    footer{background:var(--azul-marino);padding:48px 24px;text-align:center;border-top:1px solid rgba(201,168,76,0.25)}
    footer p{font-size:0.88rem;color:rgba(255,255,255,0.5);margin-bottom:4px}
    .footer-sep{width:40px;height:3px;background:linear-gradient(90deg,var(--dorado),var(--rosa));margin:20px auto;border-radius:2px}
  </style>
</head>
<body>
  <nav>
    <a href="https://elpuertovalencia.com" class="nav-logo">
      <img src="https://elpuertovalencia.com/logo.webp" alt="El Puerto Valencia" width="120" height="60" />
    </a>
    <a href="https://elpuertovalencia.com/blog.html" class="nav-back">← Volver al blog</a>
  </nav>

  <section class="article-hero">
    <div class="container">
      <span class="article-tag">Blog</span>
      <h1>${esc(title)}</h1>
      <p class="article-meta">${today} · El Puerto Valencia</p>
    </div>
  </section>

  <section class="article-body">
    <div class="container">
      <a href="https://elpuertovalencia.com/blog.html" class="back-link">← Todos los artículos</a>
      ${content_html}
      <div class="article-cta">
        <h3>¿Listo para vivir la experiencia?</h3>
        <p>Reserva tu evento en El Puerto Valencia y disfruta de una noche inolvidable junto a la Marina de Valencia.</p>
        <a href="https://elpuertovalencia.com/#contacto" class="btn">Pedir presupuesto</a>
      </div>
    </div>
  </section>

  <footer>
    <div class="footer-sep"></div>
    <p>© ${new Date().getFullYear()} El Puerto Valencia · Todos los derechos reservados</p>
    <p>Marina de Valencia · Tel: <a href="tel:+34644044860" style="color:rgba(255,255,255,0.5)">644 044 860</a></p>
  </footer>
</body>
</html>`;

  try {
    const filePath = `blog/${slug}/index.html`;
    const content = Buffer.from(html, 'utf8').toString('base64');

    // Check if file exists (to get SHA for update)
    let sha;
    try {
      const existing = await githubRequest('GET', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`);
      sha = existing.sha;
    } catch (e) { /* file doesn't exist yet, that's fine */ }

    const body = {
      message: `Auto-publicar artículo: ${title}`,
      content,
      ...(sha ? { sha } : {})
    };

    await githubRequest('PUT', `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`, body);

    console.log(`✅ Artículo publicado en GitHub: blog/${slug}/`);
    res.json({ success: true, url: canonicalUrl });
  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'elpuerto-webhook',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        const json = JSON.parse(raw);
        if (res.statusCode >= 400) reject(new Error(json.message || raw));
        else resolve(json);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escJ(str) {
  return String(str).replace(/\\/g,'\\\\').replace(/"/g,'\\"');
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server en puerto ${PORT}`));
