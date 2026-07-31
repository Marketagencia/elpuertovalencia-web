#!/usr/bin/env python3
"""Genera páginas estáticas del blog a partir de posts/*.md.

Sustituye el render por JavaScript (fetch a la API de GitHub + marked.js)
por HTML estático real, para que Google pueda indexar título, descripción
y contenido sin ejecutar JS ni depender de una API externa.

Uso: python3 scripts/build_blog.py
Se ejecuta automáticamente en cada push a posts/** vía
.github/workflows/build-blog.yml
"""
import html
import re
from datetime import datetime
from pathlib import Path

import markdown
import yaml

ROOT = Path(__file__).resolve().parent.parent
POSTS_DIR = ROOT / "posts"
BLOG_DIR = ROOT / "blog"
BLOG_INDEX = ROOT / "blog.html"
HOME_INDEX = ROOT / "index.html"
SITEMAP = ROOT / "sitemap.xml"
SITE_URL = "https://elpuertovalencia.com"

INTERNAL_LINK_RE = re.compile(r"blog-post\.html\?post=([\w.\-]+?)\.md")

MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]


def slug_from_filename(name: str) -> str:
    name = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", name)
    return re.sub(r"\.md$", "", name)


def format_date(date_str: str) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d")
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


def slugify_heading(text: str) -> str:
    value = text.strip().lower()
    value = re.sub(r"[^\w\s-]", "", value, flags=re.UNICODE)
    return re.sub(r"\s+", "-", value)


def add_heading_ids(body_html: str) -> str:
    def repl(m):
        tag, text = m.group(1), m.group(2)
        slug = slugify_heading(re.sub(r"<[^>]+>", "", text))
        return f'<{tag} id="{slug}">{text}</{tag}>'
    return re.sub(r"<(h2|h3)>(.*?)</\1>", repl, body_html)


def rewrite_internal_links(body_md: str) -> str:
    def repl(m):
        target_slug = slug_from_filename(m.group(1) + ".md")
        return f"../{target_slug}/"
    return INTERNAL_LINK_RE.sub(repl, body_md)


def load_posts():
    posts = []
    for path in sorted(POSTS_DIR.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        m = re.match(r"^---\n([\s\S]*?)\n---\n([\s\S]*)$", text)
        if not m:
            continue
        meta = yaml.safe_load(m.group(1)) or {}
        body_md = rewrite_internal_links(m.group(2))
        body_html = add_heading_ids(markdown.markdown(body_md, extensions=["extra"]))
        posts.append({
            "filename": path.name,
            "slug": slug_from_filename(path.name),
            "meta": meta,
            "body_html": body_html,
        })
    posts.sort(key=lambda p: p["meta"].get("date", ""), reverse=True)
    return posts


POST_TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title} | El Puerto Valencia</title>
  <meta name="description" content="{excerpt}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="{url}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{title} | El Puerto Valencia" />
  <meta property="og:description" content="{excerpt}" />
  <meta property="og:image" content="{image_abs}" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:site_name" content="El Puerto Valencia" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title} | El Puerto Valencia" />
  <meta name="twitter:description" content="{excerpt}" />
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    "headline": {title_json},
    "description": {excerpt_json},
    "datePublished": "{date}",
    "dateModified": "{date}",
    "image": {image_json},
    "url": "{url}",
    "mainEntityOfPage": {{ "@type": "WebPage", "@id": "{url}" }},
    "publisher": {{
      "@type": "Organization",
      "name": "El Puerto Valencia",
      "logo": {{ "@type": "ImageObject", "url": "{site_url}/logo.png" }}
    }},
    "author": {{ "@type": "Organization", "name": "El Puerto Valencia" }}
  }}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
    :root{{--azul-marino:#12003e;--azul-medio:#2b0080;--dorado:#ff5c35;--rosa:#e91e8c;--blanco:#ffffff;--gris-claro:#f4f0ff;--gris-texto:#444444;--radio:12px}}
    body{{font-family:'Inter',sans-serif;color:var(--azul-marino);background:var(--blanco)}}
    h1,h2,h3{{font-family:'Playfair Display',serif;line-height:1.2}}
    a{{text-decoration:none;color:inherit}}
    .container{{max-width:760px;margin:0 auto;padding:0 24px}}

    nav{{position:fixed;top:0;left:0;right:0;z-index:100;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;background:rgba(10,22,40,0.95);backdrop-filter:blur(12px);border-bottom:1px solid rgba(201,168,76,0.2)}}
    .nav-logo img{{height:48px;width:auto}}
    .nav-back{{color:rgba(255,255,255,0.8);font-size:0.9rem;display:flex;align-items:center;gap:6px}}
    .nav-back:hover{{color:#fff}}

    .post-hero{{width:100%;height:380px;object-fit:cover;display:block;margin-top:80px}}
    .post-hero-placeholder{{width:100%;height:200px;background:linear-gradient(135deg,var(--azul-medio),var(--rosa));margin-top:80px}}

    .post-content{{padding:48px 0 80px}}
    .post-meta{{display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap}}
    .post-date-tag{{background:linear-gradient(135deg,var(--dorado),var(--rosa));color:#fff;font-size:0.75rem;font-weight:700;padding:4px 12px;border-radius:999px}}
    .post-content h1{{font-size:clamp(1.8rem,4vw,2.6rem);color:var(--azul-marino);margin-bottom:28px;line-height:1.15}}

    .post-body{{font-size:1.05rem;line-height:1.8;color:var(--gris-texto)}}
    .post-body h2{{font-family:'Playfair Display',serif;font-size:1.5rem;color:var(--azul-marino);margin:36px 0 14px}}
    .post-body h3{{font-family:'Playfair Display',serif;font-size:1.2rem;color:var(--azul-marino);margin:28px 0 10px}}
    .post-body p{{margin-bottom:18px}}
    .post-body ul,.post-body ol{{padding-left:24px;margin-bottom:18px}}
    .post-body li{{margin-bottom:6px}}
    .post-body strong{{color:var(--azul-marino)}}
    .post-body a{{color:var(--dorado);text-decoration:underline}}
    .post-body img{{max-width:100%;border-radius:var(--radio);margin:24px 0}}
    .post-body blockquote{{border-left:4px solid var(--rosa);padding:12px 20px;background:var(--gris-claro);border-radius:0 8px 8px 0;margin:24px 0;font-style:italic}}

    .post-cta{{background:linear-gradient(135deg,var(--azul-marino),var(--azul-medio));border-radius:var(--radio);padding:40px;text-align:center;margin:48px 0}}
    .post-cta h3{{color:#fff;font-size:1.4rem;margin-bottom:10px}}
    .post-cta p{{color:rgba(255,255,255,0.75);margin-bottom:24px}}
    .post-cta a{{display:inline-block;padding:14px 32px;border-radius:50px;background:linear-gradient(135deg,var(--dorado),var(--rosa));color:#fff;font-weight:600}}

    .back-link{{display:inline-flex;align-items:center;gap:6px;color:var(--dorado);font-weight:600;margin-bottom:32px;font-size:0.9rem}}

    footer{{background:var(--azul-marino);padding:40px 24px;text-align:center;border-top:1px solid rgba(201,168,76,0.25)}}
    footer p{{color:rgba(255,255,255,0.5);font-size:0.88rem}}
    .footer-sep{{width:40px;height:3px;background:linear-gradient(90deg,var(--dorado),var(--rosa));margin:16px auto;border-radius:2px}}
  </style>
</head>
<body>

  <nav>
    <a href="../../index.html" class="nav-logo"><img src="../../logo.png" alt="El Puerto Valencia" width="120" height="60" /></a>
    <a href="../../blog.html" class="nav-back">← Blog</a>
  </nav>

  <div id="post-hero">{hero_html}</div>

  <section>
    <div class="container">
      <div class="post-content">
        <a class="back-link" href="../../blog.html">← Volver al blog</a>
        <div class="post-meta">
          <span class="post-date-tag">{date_human}</span>
        </div>
        <h1>{title}</h1>
        <div class="post-body">{body_html}</div>
        <div class="post-cta">
          <h3>¿Listo para organizar tu evento?</h3>
          <p>Solicita tu presupuesto gratuito y te lo preparamos en 24 horas.</p>
          <a href="../../index.html#contacto">Solicitar presupuesto</a>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="footer-sep"></div>
    <p>© 2026 El Puerto Valencia · <a href="../../index.html" style="color:rgba(255,255,255,0.5)">Volver a la web</a></p>
  </footer>
</body>
</html>
"""


def json_str(value: str) -> str:
    import json
    return json.dumps(value or "", ensure_ascii=False)


def build_post_page(post):
    meta = post["meta"]
    title = html.escape(meta.get("title", ""))
    excerpt = html.escape(meta.get("excerpt", ""))
    date = meta.get("date", "")
    image = meta.get("image", "")
    image_abs = f"{SITE_URL}{image}" if image else f"{SITE_URL}/logo.png"
    url = f"{SITE_URL}/blog/{post['slug']}/"

    if image:
        hero_html = f'<img class="post-hero" src="../../{image.lstrip("/")}" alt="{title}">'
    else:
        hero_html = '<div class="post-hero-placeholder"></div>'

    page = POST_TEMPLATE.format(
        title=title,
        excerpt=excerpt,
        url=url,
        image_abs=image_abs,
        title_json=json_str(meta.get("title", "")),
        excerpt_json=json_str(meta.get("excerpt", "")),
        date=date,
        image_json=json_str(image_abs),
        site_url=SITE_URL,
        hero_html=hero_html,
        date_human=format_date(date) if date else "",
        body_html=post["body_html"],
    )

    out_dir = BLOG_DIR / post["slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.html").write_text(page, encoding="utf-8")


BLOG_INDEX_TEMPLATE = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog | El Puerto Valencia</title>
  <meta name="description" content="Ideas, guías y novedades para organizar despedidas, cumpleaños y eventos de empresa en Valencia." />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="https://elpuertovalencia.com/blog.html" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:wght@700;900&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <style>
    *,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
    :root{{--azul-marino:#12003e;--azul-medio:#2b0080;--dorado:#ff5c35;--rosa:#e91e8c;--blanco:#ffffff;--gris-claro:#f4f0ff;--gris-texto:#444444;--radio:12px;--sombra:0 8px 32px rgba(233,30,140,0.12)}}
    body{{font-family:'Inter',sans-serif;color:var(--azul-marino);background:var(--blanco)}}
    h1,h2,h3{{font-family:'Playfair Display',serif;line-height:1.15}}
    a{{text-decoration:none;color:inherit}}
    .container{{max-width:1100px;margin:0 auto;padding:0 24px}}

    nav{{position:fixed;top:0;left:0;right:0;z-index:100;padding:18px 24px;display:flex;justify-content:space-between;align-items:center;background:rgba(10,22,40,0.95);backdrop-filter:blur(12px);border-bottom:1px solid rgba(201,168,76,0.2)}}
    .nav-logo img{{height:48px;width:auto}}
    .nav-back{{color:rgba(255,255,255,0.8);font-size:0.9rem;display:flex;align-items:center;gap:6px}}
    .nav-back:hover{{color:#fff}}

    .blog-hero{{background:linear-gradient(135deg,var(--azul-marino),var(--azul-medio));padding:120px 0 60px;text-align:center}}
    .blog-hero .tag{{display:inline-block;background:linear-gradient(135deg,var(--dorado),var(--rosa));color:#fff;font-size:0.72rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;padding:6px 14px;border-radius:999px;margin-bottom:18px}}
    .blog-hero h1{{font-family:'Bebas Neue',sans-serif;font-size:clamp(3rem,8vw,5rem);color:#fff;letter-spacing:0.04em;margin-bottom:16px}}
    .blog-hero p{{color:rgba(255,255,255,0.75);font-size:1.05rem;max-width:500px;margin:0 auto}}

    .blog-grid{{padding:64px 0}}
    .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:28px}}

    .post-card{{background:#fff;border-radius:var(--radio);overflow:hidden;box-shadow:var(--sombra);transition:transform 0.25s;display:flex;flex-direction:column}}
    .post-card:hover{{transform:translateY(-5px)}}
    .post-img{{height:200px;background:linear-gradient(135deg,var(--azul-medio),var(--rosa));overflow:hidden;position:relative}}
    .post-img img{{width:100%;height:100%;object-fit:cover}}
    .post-img .no-img{{display:flex;align-items:center;justify-content:center;height:100%;font-size:3rem}}
    .post-date{{position:absolute;bottom:12px;left:12px;background:rgba(18,0,62,0.8);color:#fff;font-size:0.72rem;font-weight:600;padding:4px 10px;border-radius:999px;backdrop-filter:blur(4px)}}
    .post-body{{padding:24px;flex:1;display:flex;flex-direction:column}}
    .post-body h2{{font-size:1.2rem;margin-bottom:10px;color:var(--azul-marino)}}
    .post-body p{{font-size:0.9rem;color:var(--gris-texto);line-height:1.6;flex:1;margin-bottom:16px}}
    .post-body a.read-more{{display:inline-block;color:var(--dorado);font-weight:600;font-size:0.88rem}}
    .post-body a.read-more:hover{{color:var(--rosa)}}

    footer{{background:var(--azul-marino);padding:40px 24px;text-align:center;border-top:1px solid rgba(201,168,76,0.25)}}
    footer p{{color:rgba(255,255,255,0.5);font-size:0.88rem}}
    .footer-sep{{width:40px;height:3px;background:linear-gradient(90deg,var(--dorado),var(--rosa));margin:16px auto;border-radius:2px}}

    @media(max-width:600px){{.grid{{grid-template-columns:1fr}}}}
  </style>
</head>
<body>

  <nav>
    <a href="index.html" class="nav-logo"><img src="logo.png" alt="El Puerto Valencia" width="120" height="60" /></a>
    <a href="index.html" class="nav-back">← Volver a la web</a>
  </nav>

  <div class="blog-hero">
    <div class="container">
      <span class="tag">📝 Nuestro blog</span>
      <h1>Ideas & Novedades</h1>
      <p>Guías, tendencias y todo lo que necesitas para organizar el evento perfecto en Valencia</p>
    </div>
  </div>

  <section class="blog-grid">
    <div class="container">
      <div class="grid">
{cards}
      </div>
    </div>
  </section>

  <footer>
    <div class="footer-sep"></div>
    <p>© 2026 El Puerto Valencia · <a href="index.html" style="color:rgba(255,255,255,0.5)">Volver a la web</a></p>
  </footer>
</body>
</html>
"""

CARD_TEMPLATE = """        <div class="post-card">
          <div class="post-img">
            {img}
            <span class="post-date">{date_human}</span>
          </div>
          <div class="post-body">
            <h2>{title}</h2>
            <p>{excerpt}</p>
            <a class="read-more" href="blog/{slug}/">Leer artículo →</a>
          </div>
        </div>"""


def build_blog_index(posts):
    cards = []
    for post in posts:
        meta = post["meta"]
        title = html.escape(meta.get("title", "Sin título"))
        excerpt = html.escape(meta.get("excerpt", ""))
        image = meta.get("image", "")
        if image:
            img = f'<img src="{image}" alt="{title}" loading="lazy">'
        else:
            img = '<div class="no-img">📝</div>'
        cards.append(CARD_TEMPLATE.format(
            img=img,
            date_human=format_date(meta.get("date", "")) if meta.get("date") else "",
            title=title,
            excerpt=excerpt,
            slug=post["slug"],
        ))
    BLOG_INDEX.write_text(BLOG_INDEX_TEMPLATE.format(cards="\n".join(cards)), encoding="utf-8")


def update_sitemap(posts):
    text = SITEMAP.read_text(encoding="utf-8")
    blocks = re.split(r"(?=  <url>)", text)
    header = blocks[0]
    kept = [b for b in blocks[1:] if "blog-post.html?post=" not in b and b.strip()]
    kept_text = "".join(kept)
    if not kept_text.endswith("\n"):
        kept_text += "\n"

    footer_match = re.search(r"</urlset>\s*$", text)
    footer = "</urlset>\n"

    new_blocks = []
    for post in posts:
        date = post["meta"].get("date", "")
        new_blocks.append(
            f'  <url>\n'
            f'    <loc>{SITE_URL}/blog/{post["slug"]}/</loc>\n'
            f'    <lastmod>{date}</lastmod>\n'
            f'    <changefreq>monthly</changefreq>\n'
            f'    <priority>0.7</priority>\n'
            f'  </url>\n'
        )

    new_text = header + kept_text + "".join(new_blocks) + footer
    SITEMAP.write_text(new_text, encoding="utf-8")


HOME_CARD_TEMPLATE = """        <div class="bp-card">
          <div class="bp-img">
            {img}
            <span class="bp-date">{date_human}</span>
          </div>
          <div class="bp-body">
            <h3>{title}</h3>
            <p>{excerpt}</p>
            <a class="bp-read-more" href="blog/{slug}/">Leer artículo →</a>
          </div>
        </div>"""


def update_home_preview(posts, max_posts=3):
    text = HOME_INDEX.read_text(encoding="utf-8")
    cards = []
    for post in posts[:max_posts]:
        meta = post["meta"]
        title = html.escape(meta.get("title", "Sin título"))
        excerpt = html.escape(meta.get("excerpt", ""))
        image = meta.get("image", "")
        img = f'<img src="{image}" alt="{title}" loading="lazy">' if image else ""
        cards.append(HOME_CARD_TEMPLATE.format(
            img=img,
            date_human=format_date(meta.get("date", "")) if meta.get("date") else "",
            title=title,
            excerpt=excerpt,
            slug=post["slug"],
        ))
    cards_html = "\n" + "\n".join(cards) + "\n        "
    new_text = re.sub(
        r"(<!-- BLOG_PREVIEW_CARDS_START -->)[\s\S]*?(<!-- BLOG_PREVIEW_CARDS_END -->)",
        lambda m: f"{m.group(1)}{cards_html}{m.group(2)}",
        text,
    )
    HOME_INDEX.write_text(new_text, encoding="utf-8")


def main():
    posts = load_posts()
    BLOG_DIR.mkdir(exist_ok=True)
    for post in posts:
        build_post_page(post)
    build_blog_index(posts)
    update_sitemap(posts)
    update_home_preview(posts)
    print(f"Generadas {len(posts)} páginas de blog en /blog/, blog.html, index.html y sitemap.xml actualizados.")


if __name__ == "__main__":
    main()
