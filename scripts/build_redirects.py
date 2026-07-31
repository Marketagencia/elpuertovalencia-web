#!/usr/bin/env python3
"""Genera el mapa de redirecciones 301 de nginx a partir de las URLs 404
detectadas en Search Console (Tabla.csv), mapeando el contenido antiguo de
WordPress a sus equivalentes en el sitio nuevo."""
import csv

SPECIFIC = {
    # --- Guías 2026 con equivalente exacto en el blog nuevo ---
    "/despedida-de-soltera-2026-guia-para-una-celebracion-mediterranea-e-inolvidable/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/pruebas-para-despedida-de-soltera-en-valencia-2026-ideas-originales-y-retos-mediterraneos/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/ideas-para-una-despedida-de-soltera-sin-alcohol-en-valencia-diversion-con-esencia-mediterranea/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/ideas-para-despedida-de-soltera-con-poco-presupuesto-celebra-con-estilo-en-2026/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/como-organizar-una-despedida-de-soltera-paso-a-paso-en-valencia-guia-2026/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/comida-para-despedidas-de-soltera-en-valencia-menus-y-experiencias-2026/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/7-errores-comunes-al-planificar-una-despedida-en-valencia-y-como-evitarlos-2026/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/como-cobrar-el-dinero-a-los-amigos-para-la-despedida-en-valencia-guia-2026/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/como-gestionar-un-grupo-de-whatsapp-para-una-despedida-sin-morir-en-el-intento-guia-2026/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/como-sobrevivir-a-una-despedida-el-manual-definitivo-para-una-celebracion-impecable/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/que-llevar-a-una-despedida/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/como-organizar-despedida-tematica-valencia/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/como-organizar-la-despedida-perfecta/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/mejores-planes-despedida-femenina-valencia/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/despedidas-de-soltera-en-valencia/": "/blog/despedidas-de-soltera-en-valencia-2026/",
    "/despedidas-en-valencia/": "/blog/despedidas-de-soltera-en-valencia-2026/",

    "/packs-para-despedidas-de-soltero-en-valencia-2026-guia-de-experiencias-todo-incluido/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/despedidas-de-soltero-en-valencia-2026-guia-para-una-celebracion-mediterranea-exclusiva/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/despedidas-de-soltero-valencia/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/despedidas_de_soltero_valencia/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/packs-despedidas-valencia/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/packs-celebracion-todo-incluido-grupos/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/que-incluye-un-pack-despedida/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",
    "/como-elegir-pack-despedida/": "/blog/packs-despedidas-de-soltero-en-valencia-2026/",

    "/menus-para-grupos-en-valencia-guia-gastronomica-2026-frente-al-mediterraneo/": "/blog/restaurante-puerto-valencia-menus-para-grupos-y-eventos/",
    "/menus-para-grupos-valencia/": "/blog/restaurante-puerto-valencia-menus-para-grupos-y-eventos/",

    "/cena-con-espectaculo-en-valencia-guia-para-una-noche-mediterranea-inolvidable/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-con-espectaculo-valencia-para-grupos/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-espectaculo-valencia/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-espectaculo-valencia/img_5173/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-espectaculo-valencia/img_5181/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-espectaculo-valencia/img_5205/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-espectaculo-valencia/img_6088/": "/blog/cena-con-espectaculo-en-valencia/",
    "/cena-espectaculo-valencia/pack-cena-puerto-copia-2/": "/blog/cena-con-espectaculo-en-valencia/",
    "/como-elegir-cena-espectaculo-grupal/": "/blog/cena-con-espectaculo-en-valencia/",
    "/mejores-cenas-animadas-valencia-grupos/": "/blog/cena-con-espectaculo-en-valencia/",
    "/shop/restaurante-comidas/cena-show/": "/blog/cena-con-espectaculo-en-valencia/",

    "/checklist-para-eventos-de-empresa-2026-como-organizar-una-experiencia-inolvidable/": "/blog/checklist-para-eventos-de-empresa-2026/",

    "/comida-y-tardeo-en-valencia-la-guia-definitiva-para-el-plan-grupal-perfecto-en-2026/": "/blog/comida-y-tardeo-en-valencia/",
    "/comida-y-tardeo-valencia/": "/blog/comida-y-tardeo-en-valencia/",
    "/como-disfrutar-de-una-comida-con-tardeo-y-charanga-para-despedidas-de-soltera-o-soltero-en-el-restaurante-el-puerto-valencia/": "/blog/comida-y-tardeo-en-valencia/",
    "/pack-comida-charanga/": "/blog/comida-y-tardeo-en-valencia/",
    "/comida-dj-charanga-despedidas/img_1622/": "/blog/comida-y-tardeo-en-valencia/",
    "/comida-dj-charanga-despedidas/img_4057/": "/blog/comida-y-tardeo-en-valencia/",
    "/comida-dj-charanga-despedidas/img_5004/": "/blog/comida-y-tardeo-en-valencia/",
    "/comida-dj-charanga-despedidas/img_5416/": "/blog/comida-y-tardeo-en-valencia/",
    "/comida-dj-charanga-despedidas/img_7918/": "/blog/comida-y-tardeo-en-valencia/",
    "/shop/restaurante-comidas/comida-con-charanga-valencia/": "/blog/comida-y-tardeo-en-valencia/",

    "/restaurante-para-despedidas-en-valencia-2026-la-guia-de-ocio-en-la-marina/": "/blog/restaurante-para-despedidas-en-valencia-2026/",

    "/ideas-para-fiestas-de-cumpleanos-inolvidables-guia-maestra-de-celebracion-2026/": "/blog/ideas-para-fiestas-de-cumpleanos-inolvidables/",
    "/ideas-originales-cumpleanos-adultos/": "/blog/ideas-para-fiestas-de-cumpleanos-inolvidables/",
    "/ideas-para-celebraciones-grupales/": "/blog/ideas-para-fiestas-de-cumpleanos-inolvidables/",

    "/locales-grandes-para-eventos-como-elegir-el-espacio-ideal-para-celebraciones-multitudinarias/": "/blog/locales-para-fiestas-en-valencia/",
    "/alquiler-de-locales-para-fiestas-en-valencia-guia-para-eventos-mediterraneos-2026/": "/blog/locales-para-fiestas-en-valencia/",

    "/restaurantes-con-musica-en-vivo-en-valencia-guia-para-cenas-inolvidables-en-2026/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",
    "/restaurantes-tematicos-en-valencia-guia-para-cenas-originales-y-espectaculos-unicos-en-2026/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",
    "/cenas-y-comidas-para-grupos/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",
    "/eventos-para-grupos-valencia/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",
    "/planes-en-grupo-valencia/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",
    "/restaurante-grupos-valencia-celebrar-bien/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",
    "/restaurante-con-fiesta-valencia-para-grupos/": "/blog/mejores-restaurantes-para-grupos-en-valencia/",

    # --- Comidas de empresa ---
    "/cena-de-empresa-valencia/": "/blog/cenas-de-empresa-en-valencia-2026/",
    "/comida-de-empresa-valencia/": "/comidas-de-empresa/",
    "/comida-de-empresa-valencia/whatsapp-image-2025-10-29-at-16-55-38/": "/comidas-de-empresa/",
    "/shop/restaurante-comidas/comida-de-empresa-valencia/": "/comidas-de-empresa/",
    "/team-building-para-grandes-grupos-en-valencia-ideas-y-estrategias-2026/": "/comidas-de-empresa/",
    "/team-building-para-equipos-pequenos-ideas-exclusivas-y-experiencias-en-valencia-2026/": "/comidas-de-empresa/",

    # --- Actividades (sin post propio, la home tiene la sección #actividades) ---
    "/motos-de-agua-en-valencia-la-guia-definitiva-para-grupos-y-despedidas-2026/": "/#actividades",
    "/motos-de-agua-para-despedidas/": "/#actividades",
    "/alquilar-motos-de-agua-valencia/": "/#actividades",
    "/paintball-valencia-la-guia-definitiva-de-estrategia-y-adrenalina-grupal-en-2026/": "/#actividades",
    "/paintball-valencia-despedidas-soltera-soltero/": "/#actividades",
    "/humor-amarillo-2026-la-guia-maestra-para-una-experiencia-de-grupo-legendaria/": "/#actividades",
    "/humor-amarillo-valencia/": "/#actividades",
    "/gymkana-tematica-el-arte-de-la-aventura-inmersiva-para-grupos-en-2026/": "/#actividades",
    "/alquiler-de-barco-en-valencia-2026-la-guia-maestra-para-grupos-y-eventos/": "/#actividades",
    "/las-mejores-fiestas-en-barco-en-valencia-2026-guia-de-experiencias-en-alta-mar/": "/#actividades",
    "/dinamicas-de-grupo-divertidas-para-adultos-guia-2026-para-eventos-inolvidables/": "/#actividades",
    "/limusina-despedida-soltera-y-soltero-valencia/": "/#actividades",
    "/limusina-restaurantes-despedidas/": "/#actividades",
    "/karting-race-valencia/": "/#actividades",
    "/tiro-con-arco-valencia/": "/#actividades",
    "/paddle-surf-valencia/": "/#actividades",
    "/paddle-surf-valencia/paddle-3/": "/#actividades",
    "/mega-big-paddle-valencia/": "/#actividades",
    "/mega-big-paddle-valencia/mega-paddle-1-jpeg/": "/#actividades",
    "/bautismo-buceo-valencia/": "/#actividades",
    "/descenso-de-barranco/": "/#actividades",
    "/descenso-por-rio-en-kayak/": "/#actividades",
    "/cata-de-cerveza-valencia/": "/#actividades",
    "/bubbles-valencia/": "/#actividades",
    "/tubing-valencia-despedidas-valencia/": "/#actividades",
    "/capea-campera/": "/#actividades",
    "/capea-campera/laser-game-crea-despedidas/": "/#actividades",
    "/banana-boat-party-valencia/": "/#actividades",
    "/boat-party-valencia-grupos/": "/#actividades",
    "/fiesta-barco-valencia-grupos/": "/#actividades",
    "/fiesta-privada-velero/": "/#actividades",
    "/fiestas-en-barco-valencia/": "/#actividades",
    "/alquiler-de-barco-para-fiesta-sin-fallar/": "/#actividades",
    "/pack-comida-fiesta-barco-valencia/": "/#actividades",
    "/stripperboy/": "/#actividades",
    "/dj-para-celebraciones-privadas/": "/#actividades",
    "/banana-boat-valencia-la-experiencia-definitiva-de-adrenalina-y-cohesion-grupal/": "/#actividades",
    "/shop/fiesta/tibaparty/": "/#actividades",
    "/shop/packs/comida-fiesta-en-barco-2/": "/#actividades",
    "/shop/packs/comida-fiesta-en-barco-cena/": "/#actividades",

    # --- Legal / contacto / utilidad ---
    "/aviso-legal/": "/",
    "/politica-privacidad/": "/",
    "/condiciones-de-uso/": "/",
    "/politica-cancelacion/": "/",
    "/contacto/": "/#contacto",
    "/contact/": "/#contacto",
    "/mi-cuenta/lost-password/": "/",
    "/restaurante-el-puerto-valencia/": "/",
    "/restaurante-el-puerto-valencia/menu-de-nochevieja-2018/": "/",
    "/restaurante-el-puerto-valencia/separador-1/": "/",
    "/restaurante-tematico/": "/",
    "/celebraciones/": "/",
    "/barra-libre-para-grupos-valencia/": "/",
    "/cena-nochevieja-fin-de-ano/menu-nochevieja-2025-26/": "/",
    "/wp-content/uploads/2025/11/Menu-Nochevieja-2025-26.pdf": "/",
    "/ofertas/cena-de-nochevieja-2019-en-valencia/nochevieja-2019/": "/",
    "/ofertas/cenas-de-empresa-en-navidad/": "/comidas-de-empresa/",
    "/ofertas/despedidas-de-soltera-y-soltero-cumpleanos-y-celebraciones/": "/",
    "/packs/": "/",
    "/packs/comida-charanga-valencia/": "/blog/comida-y-tardeo-en-valencia/",
    "/packs/pack-25/": "/",
    "/packs/pack-25-2/": "/",
    "/packs/pack-79/": "/",
    "/?page_id=6228": "/",
}

# Prefijos sin equivalente 1:1 (archivos de taxonomía WordPress, contenido de
# demo del theme, WooCommerce): se gestionan con reglas de nginx aparte.
SKIP_PREFIXES = (
    "/tag/", "/category/", "/product-category/",
    "/home-2/", "/portfolio/", "/shop-2/", "/wishlist/", "/compare/",
    "/cdn-cgi/",
)
SKIP_EXACT = {
    "/green-interior-design-inspiration/",
    "/minimalist-japanese-inspired-furniture/",
    "/reinterprets-the-classic-bookshelf/",
    "/the-big-design-wall-likes-pictures/",
    "/amp/",
    "/Dossier 2026.pdf",  # ya existe en el sitio nuevo, no es un 404 real
}


def strip_amp(path: str) -> str:
    if path.endswith("/amp/"):
        return path[: -len("amp/")]
    if path.endswith("/amp"):
        return path[: -len("amp")]
    return path


def main():
    with open("Tabla.csv", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        paths = set()
        for row in reader:
            url = row["URL"]
            path = url.split("elpuertovalencia.com", 1)[1]
            path = path.split("?", 1)[0]
            paths.add(path)

    entries = {}
    unmatched = []
    for path in sorted(paths):
        if path == "/":
            continue  # la home ya funciona; algunas 404 antiguas eran /?query
        base = strip_amp(path)
        if path in SKIP_EXACT or base in SKIP_EXACT or any(
            path.startswith(p) for p in SKIP_PREFIXES
        ):
            continue
        target = SPECIFIC.get(path) or SPECIFIC.get(base)
        if target:
            entries[path] = target
        else:
            unmatched.append(path)

    with open("redirects.map", "w", encoding="utf-8") as f:
        f.write("# Generado por scripts/build_redirects.py — no editar a mano.\n")
        f.write("# Redirecciones 301 de URLs antiguas (WordPress) a sus equivalentes nuevos.\n")
        for path, target in entries.items():
            escaped = path.replace('"', '\\"')
            f.write(f'    "{escaped}" "{target}";\n')

    print(f"{len(entries)} URLs mapeadas -> redirects.map")
    print(f"{len(unmatched)} URLs sin mapear (quedarán en 404):")
    for u in unmatched:
        print(f"  {u}")


if __name__ == "__main__":
    main()
