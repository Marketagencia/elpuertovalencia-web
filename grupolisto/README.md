# GrupoListo (nombre provisional)

Aplicación web en español, adaptada a móvil, para gestionar grupos y eventos desde la primera consulta hasta la liquidación
a proveedores. Pensada primero para una agencia de Valencia y diseñada **multiempresa** (cada empresa solo ve sus datos).

- **Sin dependencias npm**: Node.js ≥ 22.5 (probado con 24) con `node:sqlite` integrado. Servidor HTTP + API JSON + interfaz web sin build.
- Importes en **céntimos (euros)**, fechas `dd/mm/aaaa`, zona horaria **Europe/Madrid**.
- Esta carpeta es independiente de la web estática del resto del repositorio.

## Puesta en marcha

```bash
cd grupolisto
npm run seed          # crea la base de datos con DATOS FICTICIOS marcados [DEMO]
npm start             # http://localhost:3100
npm test              # 23 pruebas de recorrido completo y casos límite (API real, permisos activos)
```

Usuarios de demostración (contraseña `Demo-Clave-2026`; **cámbiala o bórralos antes de usar datos reales**):

| Usuario | Perfil |
|---|---|
| `admin@demo.test` | Administrador |
| `comercial@demo.test` | Comercial |
| `operaciones@demo.test` | Operaciones |
| `finanzas@demo.test` | Finanzas |
| `proveedor.karting@demo.test`, `proveedor.restaurante@demo.test` | Proveedor (portal) |

Para una empresa real, sin datos de demostración:

```bash
node src/create-company.js "Mi agencia" mi-agencia admin@miagencia.com "UnaClaveLargaYUnica"
```

Variables de entorno: `PORT` (3100), `APP_BASE_URL` (URL pública, p. ej. `https://app.miagencia.com`; se usa en los enlaces privados),
`APP_SECRET` (clave maestra que cifra las credenciales de integraciones; si falta se genera `data/.secret`),
`GL_DATA_DIR` (por defecto `./data`: base de datos y archivos subidos).

### Producción
- Ejecuta detrás de un proxy HTTPS (nginx/Caddy). Con `APP_BASE_URL=https://…` la cookie de sesión se marca `Secure`.
- **Copias de seguridad**: `npm run backup` (copia consistente de la BD con `VACUUM INTO` + archivos). Prográmalo con cron y copia el resultado fuera del servidor.
- Es un único proceso con SQLite: válido para una agencia y decenas de usuarios. Para el modelo SaaS con mucho volumen, el siguiente paso es migrar a PostgreSQL (el esquema ya lleva `company_id` en todo).
- Cambia las contraseñas demo, define `APP_SECRET` y haz copia de `data/` (incluye `.secret` si no usas `APP_SECRET`).

## Qué hay (Fase 1 completa + parte de Fase 2)

Menú: Inicio · Clientes · Presupuestos · Eventos y reservas · Calendario · Servicios y packs · Proveedores · Comunicaciones · Cobros · Pagos y liquidaciones · Informes · Configuración.

| Área | Estado |
|---|---|
| Usuarios y permisos (6 perfiles), permisos aplicados **en el servidor** | ✅ |
| Varias marcas por empresa (logo, contacto, condiciones, plantillas) | ✅ |
| Clientes, consultas, embudo configurable, tareas, alertas «sin atender», historial, consentimientos | ✅ |
| Formulario web de consultas (`POST /api/public/leads/:slug`, con honeypot y consentimiento) | ✅ |
| Catálogo: servicios (tarifas persona/grupo/unidad/tramos, IVA, antelación, cancelación, capacidad), packs sin duplicar conceptos | ✅ |
| Presupuestos: opciones, versiones, enlace privado revocable, PDF imprimible, aceptación con versión + hash de condiciones + fecha + IP | ✅ |
| Aceptar o pagar **no** confirma servicios pendientes de proveedor («pendiente de confirmación») | ✅ |
| Reserva: estado independiente por servicio (8 estados) y estado global derivado (pendiente / parcial / completa) | ✅ |
| Disponibilidad: cupos en la app, bloqueos con caducidad, sin sobreventa (transacción), compartida ⇒ exige confirmación del proveedor | ✅ |
| Solicitudes a proveedores (portal + enlace privado), confirmar/rechazar/alternativa/coste/requisitos/adjuntos, revisión interna | ✅ |
| Cambios de fecha/asistentes/servicios: recálculo, comprobación de capacidad, reconfirmación, aceptación registrada, historial | ✅ |
| Cobros: señal, saldo, pagos de participantes (enlaces individuales), justificantes (→ «en proceso»), verificación, reembolsos, antiduplicados | ✅ |
| Pagos a proveedores: obligaciones, orden de pago, registro verificado, liquidaciones por proveedor/periodo, previsión de tesorería | ✅ |
| Comunicaciones: plantillas con variables, cola, reintentos, estados reales, horario Europe/Madrid, consentimientos, respuestas entrantes | ✅ |
| Automatizaciones (cliente y proveedor) con plazos configurables, sin duplicados, que se detienen solas | ✅ (11 programadas + avisos por evento) |
| Asistente: extracción de datos, datos que faltan, sugerencias del catálogo, borrador; **revisión humana obligatoria** | ✅ reglas locales (sin LLM) |
| Dashboard e informes de rentabilidad (facturación, cobros, margen y caja por separado; base imponible), CSV | ✅ |
| Auditoría, exportación, anonimización de clientes, conservación de documentos, copia de seguridad | ✅ |

## Integraciones: conectadas y pendientes

Ninguna integración externa se simula: sin credenciales, el mensaje queda **«Pendiente de conectar»** (no «enviado»), el cobro online no se ofrece, etc.
Se configuran en *Configuración → Integraciones* (credenciales cifradas AES-256-GCM, nunca devueltas al navegador).

| Integración | Estado |
|---|---|
| Base de datos, autenticación, permisos, multiempresa | ✅ Conectado (SQLite local) |
| **Email** (Resend) | ⏳ Pendiente de credenciales (`api_key`, `from` con dominio verificado). Adaptador escrito, **no probado contra Resend real** |
| **WhatsApp Business** (Cloud API oficial de Meta) | ⏳ Pendiente: `phone_number_id`, `access_token`, `app_secret`, `verify_token` y plantillas aprobadas. Webhook de estados/entrantes con firma implementado (`/api/webhooks/whatsapp/:slug`). No probado contra Meta |
| **Pasarela de pago** (Stripe Checkout) | ⏳ Pendiente: `secret_key`, `webhook_secret`. Webhook firmado e idempotente implementado y probado (`/api/webhooks/stripe/:slug`); la creación de sesión Checkout no está probada contra Stripe real |
| Banco (ejecución de transferencias, conciliación bancaria) | ⏳ No implementado. Las órdenes se preparan y el pago se **registra** a mano; requiere integración PSD2/SEPA |
| IA generativa (Claude API) | ⏳ No conectada: el asistente usa reglas locales |
| Calendarios externos de proveedores (disponibilidad sincronizada) | ⏳ Fase 3. Mientras tanto, disponibilidad compartida ⇒ confirmación del proveedor |
| Entrada de consultas por email/WhatsApp | ⏳ Preparada (`recordInbound`, webhook WhatsApp); falta conectar el buzón de email |

**Datos que necesito de ti para conectarlas**: dominio y remitente de email verificado, cuenta de WhatsApp Business con plantillas aprobadas (nombre de cada plantilla), claves de Stripe y URL pública definitiva.

## Limitaciones honestas
- El «PDF» es un documento HTML con estilos de impresión (Guardar como PDF desde el navegador); no hay generación binaria en servidor.
- No hay facturación fiscal a clientes (solo registro de cobros). Las facturas de proveedores se registran como número + documento.
- Alta de nuevas empresas y suscripciones (Fase 3): hoy solo por línea de comandos (`create-company.js`); no hay autoservicio ni cobro de suscripción.
- Perfiles de permisos fijos (6); no hay editor de permisos por empresa.
- Límite de peticiones y bloqueo de intentos de login en memoria (se reinicia con el proceso).
- Planificador (caducidad de bloqueos, automatizaciones, cola) cada 60 s dentro del mismo proceso.

Más detalle: [docs/MODELO_DATOS.md](docs/MODELO_DATOS.md) · [docs/REGLAS.md](docs/REGLAS.md).
