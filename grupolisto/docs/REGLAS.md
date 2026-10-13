# Reglas de reservas, disponibilidad y pagos

## Disponibilidad
1. **Gestionada en la app**: `availability_rules` (franja, capacidad, exclusiva o compartida con cupo de agencia) + `availability_closures`.
   Ocupado = `allocations` sin liberar que sean `confirmed`, o `hold` no caducado. Se evalúa e inserta dentro de una transacción `BEGIN IMMEDIATE`
   → dos solicitudes simultáneas para el último cupo: gana una, la otra recibe 409 «Sin cupo».
2. **Bajo solicitud**: el proveedor responde antes de confirmar. La ausencia de respuesta **nunca** se interpreta como disponibilidad:
   pasado el plazo se crea una incidencia («reclamar o buscar alternativa»).
3. **Compartida con otros canales** y sin calendario externo fiable ⇒ además del cupo, exige confirmación del proveedor.
4. Los bloqueos caducan (por defecto 48 h, configurable). La caducidad y las cancelaciones liberan el cupo; un bloqueo caducado no se puede confirmar.

## Servicios y reserva
- Flujo de un servicio: `requested → pending_availability (solicitud enviada) → available (el proveedor confirma) → confirmed (decisión interna «Confirmar servicio»)`.
  Con cupo propio: `requested → held → confirmed`. `rejected` → buscar alternativa y reasignar. Aceptar la propuesta o pagar la señal **no** confirma servicios.
- Una alternativa del proveedor o un coste distinto quedan en revisión: no cambian nada hasta que el equipo los acepta.
- **Reserva completa** ⇔ todos los servicios obligatorios no cancelados están confirmados/realizados **y** el cobrado neto ≥ señal requerida. Si falta algo: parcial o pendiente.
- Cambio de fecha/asistentes/servicios: se calcula (importes y capacidad) → `event_changes` pendiente → aceptación del cliente (enlace) o registro manual por el equipo →
  se aplica de forma atómica (si falla la capacidad de cualquier servicio, no se aplica nada) → los servicios bajo solicitud o con disponibilidad compartida vuelven a pedir confirmación.
- Cancelaciones: penalización solo si cancela el cliente dentro del plazo no gratuito del servicio (copia en `terms`). El reembolso sugerido = cobrado neto − nuevo total.

## Cobros a clientes
- Importe cobrable = total − cobrado neto − cobros abiertos. Ningún cobro o enlace (organizador o participante) puede superarlo.
- Un justificante del cliente deja el cobro en **«en proceso»**. Solo finanzas lo pasa a **«verificado»** (o la pasarela con firma válida). Verificar es idempotente.
- Webhook de Stripe: firma `Stripe-Signature` verificada con tolerancia de 5 min; `webhook_events` (UNIQUE) garantiza un único procesado; importe distinto ⇒ no se verifica; `company_id` del metadato debe coincidir.
- Reembolsos: parciales o totales, nunca por encima de lo cobrado; el original pasa a «reembolsado» al devolverse por completo. No se almacenan datos de tarjeta.

## Pagos a proveedores (separados de los cobros)
- Las obligaciones (anticipo y saldo) se generan/actualizan al confirmar, cambiar o cancelar un servicio. **Nunca se pagan solas**: ni por un mensaje, ni por confirmar, ni por completar el evento.
- Preparar orden y registrar pago exigen perfil financiero. El pago exige referencia o justificante y evita duplicados (`already_paid`, clave de idempotencia).
- El aviso «pago realizado» al proveedor solo se envía cuando el pago queda registrado y verificado.
- La ejecución real de transferencias requiere la integración bancaria (pendiente): hoy se registra el pago hecho fuera de la app.

## IVA y márgenes
PVP y costes se introducen con impuestos incluidos. Margen = base imponible de venta − base imponible de coste (cada una con su IVA), tras repartir descuentos
proporcionalmente (método del mayor resto, sin perder céntimos). Los totales a cliente son con IVA incluido y así se rotulan.

## Seguridad
- Sesión por cookie `HttpOnly; SameSite=Lax` (+`Secure` con HTTPS); contraseñas con scrypt; mismo error ante usuario inexistente o clave errónea; límite de intentos.
- Permisos por perfil en `src/perm.js`, comprobados en cada ruta (`router.authorize`). El proveedor solo ve sus solicitudes/servicios y **nunca** precios de venta ni datos personales del cliente (salvo nombre de pila y teléfono si el servicio lo marca y ya está confirmado).
- CSRF: mutaciones con sesión exigen JSON y `Origin` coherente. Cabeceras CSP/`nosniff`/`X-Frame-Options`. Archivos: lista blanca de tipos + comprobación de contenido, máx. 5 MB, servidos solo autenticados y como descarga.
- Credenciales de integraciones cifradas (AES-256-GCM) y nunca devueltas por la API.

## Cobertura de la prueba de funcionamiento (`npm test`)
Recorrido de 12 → 14 personas (propuestas, aceptación, señal, respuesta por proveedor, reserva completa solo con todo confirmado + señal, cambio con recálculo y reconfirmación,
cobro del saldo, prestación y liquidación) y casos límite: último cupo simultáneo, caducidad de bloqueo, pago notificado dos veces, proveedor que rechaza, alternativa/coste en revisión,
cancelación parcial con penalización y reembolso, pagos de participantes, fallo de envío con reintentos, consentimientos/WhatsApp, seguimiento que se detiene, horario de envío,
aislamiento entre empresas, permisos por perfil, revocación/versiones/copia congelada de precios, borrador IA con revisión humana y anonimización.
