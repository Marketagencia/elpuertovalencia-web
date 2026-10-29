const express = require('express');
const https = require('https');

const app = express();
app.use(express.json({ limit: '5mb' }));

const BEARER_TOKEN = process.env.WEBHOOK_TOKEN || 'aseo_wh_3ebd747fde4a55a82161edd9eb2c4266';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'Marketagencia';
const GITHUB_REPO = process.env.GITHUB_REPO || 'elpuertovalencia-web';

// ─── Utilidades ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function githubRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'elpuerto-webhook',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(json.message || raw));
          else resolve(json);
        } catch(e) {
          reject(new Error('Invalid JSON response: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Endpoint principal — recibe webhooks de AutoSEO ──────────────────────────

app.post('/webhook', async (req, res) => {
  // Validar token
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${BEARER_TOKEN}`) {
    console.log('❌ Token inválido:', auth);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📨 Webhook recibido:', JSON.stringify(req.body).slice(0, 300));

  // AutoSEO envía payload PLANO:
  // { event, id, title, slug, published_url, metaDescription, content_html, content_markdown, ... }
  const event = req.body.event || '';

  // Si no es un evento de publicación/actualización, responder OK y salir
  if (!['article.published', 'article.updated'].includes(event)) {
    console.log('ℹ️  Evento ignorado:', event || '(sin evento)');
    return res.json({ ok: true, skipped: true, reason: 'event_not_handled' });
  }

  // Extraer campos del payload plano de AutoSEO
  const title = req.body.title || '';
  const slug = req.body.slug || '';
  const metaDescription = req.body.metaDescription || req.body.meta_description || title;
  const content_html = req.body.content_html || req.body.body || '';
  const featuredImage = req.body.featured_image_url || req.body.featuredImageUrl || '';
  const publishedAt = req.body.published_at || req.body.publishedAt || '';
  const publishedUrl = req.body.published_url || req.body.publishedUrl || '';

  if (!slug || !title || !content_html) {
    console.log('❌ Faltan campos. slug:', slug, 'title:', title, 'content_html:', !!content_html);
    return res.status(400).json({ error: 'Faltan campos obligatorios: title, slug, content_html' });
  }

  // Fecha en español
  let dateFmt = '';
  if (publishedAt) {
    const d = new Date(publishedAt);
    const meses = ['enero','febrero','marzo','abril','mayo','junio',
                   'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    dateFmt = `${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
  }

  const canonicalUrl = `https://elpuertovalencia.com/${slug}/`;
  const year = new Date().getFullYear();

  // Generar HTML del artículo con el diseño de El Puerto Valencia
  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | El Puerto Valencia</title>
  <meta name="description" content="${esc(metaDescription)}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(metaDescription)}">
  ${featuredImage ? `<meta property="og:image" content="${esc(featuredImage)}">` : ''}
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:type" content="article">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#0e0030;color:#333}
    nav{background:#12003e;padding:14px 40px;display:flex;align-items:center;gap:16px;position:sticky;top:0;z-index:100;box-shadow:0 2px 12px rgba(0,0,0,.4)}
    nav a.logo img{height:48px;display:block}
    nav a.back{margin-left:auto;color:rgba(255,255,255,.75);font-size:.88rem;text-decoration:none;display:flex;align-items:center;gap:6px}
    nav a.back:hover{color:#ff5c35}
    .article-hero{background:linear-gradient(135deg,#12003e 0%,#2b0080 60%,#6a0572 100%);padding:60px 24px 48px;text-align:center}
    .article-hero h1{font-family:'Playfair Display',serif;font-size:clamp(1.6rem,4vw,2.6rem);color:#fff;max-width:820px;margin:0 auto 16px;line-height:1.3}
    .article-hero .meta{color:rgba(255,255,255,.55);font-size:.85rem}
    .article-wrap{max-width:820px;margin:0 auto;background:#fff;border-radius:0 0 16px 16px;overflow:hidden}
    .article-image img{width:100%;display:block;max-height:480px;object-fit:cover}
    .article-content{padding:44px 48px 48px}
    .article-content p{line-height:1.85;margin-bottom:18px;color:#3a3a3a;font-size:1.02rem}
    .article-content h2{font-family:'Playfair Display',serif;font-size:1.55rem;color:#12003e;margin:38px 0 14px;line-height:1.3}
    .article-content h3{font-size:1.15rem;font-weight:600;color:#2b0080;margin:26px 0 10px}
    .article-content ul,.article-content ol{margin:14px 0 18px 26px}
    .article-content li{line-height:1.75;color:#3a3a3a;margin-bottom:8px}
    .article-content a{color:#e91e8c;text-decoration:none;border-bottom:1px solid rgba(233,30,140,.3)}
    .article-content a:hover{border-color:#e91e8c}
    .cta-box{background:linear-gradient(135deg,#12003e,#e91e8c);color:#fff;padding:44px 40px;text-align:center;margin-top:48px}
    .cta-box h3{font-family:'Playfair Display',serif;font-size:1.8rem;margin-bottom:10px}
    .cta-box p{opacity:.88;margin-bottom:26px;font-size:1.05rem}
    .cta-box a{display:inline-block;background:#ff5c35;color:#fff;padding:14px 36px;border-radius:50px;text-decoration:none;font-weight:700;font-size:1rem;transition:transform .2s,box-shadow .2s}
    .cta-box a:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,92,53,.45)}
    footer{background:#12003e;color:rgba(255,255,255,.5);text-align:center;padding:22px;font-size:.82rem}
    footer a{color:rgba(255,255,255,.7);text-decoration:none}
    footer a:hover{color:#ff5c35}
    @media(max-width:600px){.article-content{padding:28px 20px 36px}nav{padding:12px 16px}}
  </style>
</head>
<body>
<nav>
  <a href="/" class="logo"><img src="/logo.png" alt="El Puerto Valencia"></a>
  <a href="/" class="back">← Volver</a>
</nav>
<div class="article-hero">
  <h1>${esc(title)}</h1>
  ${dateFmt ? `<p class="meta">Publicado el ${dateFmt}</p>` : ''}
</div>
<div class="article-wrap">
  ${featuredImage ? `<div class="article-image"><img src="${esc(featuredImage)}" alt="${esc(title)}" loading="lazy"></div>` : ''}
  <div class="article-content">
    ${content_html}
    <div class="cta-box">
      <h3>¿Lo celebramos juntos?</h3>
      <p>Presupuesto gratuito y sin compromiso en tiempo récord.</p>
      <a href="/#contacto">Solicitar presupuesto</a>
    </div>
  </div>
</div>
<footer>
  <p>© ${year} El Puerto Valencia &nbsp;·&nbsp;
     <a href="tel:+34644044860">+34 644 044 860</a> &nbsp;·&nbsp;
     <a href="mailto:info@elpuertovalencia.com">info@elpuertovalencia.com</a> &nbsp;·&nbsp;
     <a href="/">Inicio</a>
  </p>
</footer>
</body>
</html>`;

  // Subir a GitHub como artículo estático
  try {
    const filePath = `articulos/${slug}.html`;
    const apiPath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    const content = Buffer.from(html).toString('base64');

    // Comprobar si el archivo ya existe (para obtener su SHA)
    let sha;
    try {
      const existing = await githubRequest('GET', apiPath, null);
      sha = existing.sha;
    } catch (e) {
      // No existe todavía, es nuevo
    }

    await githubRequest('PUT', apiPath, {
      message: `AutoSEO: ${event} — ${slug}`,
      content,
      ...(sha ? { sha } : {})
    });

    console.log(`✅ Artículo publicado: ${slug} → ${canonicalUrl}`);
    return res.json({ ok: true, slug, url: canonicalUrl });

  } catch (err) {
    console.error('❌ Error GitHub:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Webhook server en puerto ${PORT}`));
