# Modelo de datos

Esquema completo en [`src/schema.sql`](../src/schema.sql). Reglas comunes: importes en céntimos; fechas `AAAA-MM-DD`; marcas de tiempo ISO UTC;
**todas las tablas de negocio llevan `company_id`** y todas las lecturas/escrituras pasan por `byId()` / `db.update(…, id, company_id, …)`,
de modo que un identificador de otra empresa es indistinguible de uno inexistente (404).

```
companies ─┬─ brands (marcas: logo, contacto, IBAN, condiciones)
           ├─ users (rol: admin|comercial|operaciones|finanzas|proveedor|cliente; provider_id / client_id para portales)  ── sessions
           ├─ pipeline_stages (embudo configurable; kind: open|won|lost|cancelled|done)
           ├─ clients ── consents (registro de consentimientos) ── leads ── interactions, tasks (kind: task|incident)
           ├─ providers (availability_mode: managed|on_request; anticipo y vencimiento de costes)
           │    └─ service_providers ── services (tarifas, tramos, IVA, antelación, cancelación, capacidad) ── packs ── pack_items
           ├─ availability_rules / availability_closures / allocations (cupos, cierres, bloqueos y confirmaciones)
           ├─ quotes (número + versión, token privado) ── quote_options ── quote_lines (copia congelada de precio y condiciones en `snapshot`)
           ├─ events (booking_status y payment_status derivados) ── event_services (estado independiente) ── provider_requests
           │       ├─ event_changes (cambios propuestos/aceptados)    ├─ payments_in (cobros y reembolsos)    └─ payments_out (obligaciones y pagos)
           ├─ webhook_events (idempotencia: UNIQUE(source, external_id))
           ├─ templates, messages (cola, estados reales, dedupe_key), automations, integrations (config cifrada)
           └─ documents, audit_log
```

## Estados (separados a propósito)
- **Comercial** (`leads.stage`): configurable. «Reserva confirmada» y «Finalizado» los fija el sistema.
- **Propuesta** (`quotes.status`): draft · sent · changes_requested · accepted · rejected · expired · superseded.
- **Servicio** (`event_services.status`): requested · pending_availability · available · held · confirmed · rejected · cancelled · done.
- **Reserva** (`events.booking_status`, derivado): pending · partial · confirmed. **Cobro** (`payment_status`): pending · partial · paid · overpaid.
- **Cobro individual** (`payments_in.status`): pending · processing · verified · failed · refunded · cancelled.
- **Pago a proveedor** (`payments_out.status`): pending · ordered · paid · cancelled.
- **Mensaje** (`messages.status`): queued · sent · delivered · read · failed · blocked · not_configured · received.

## Enlaces privados
Token = `HMAC-SHA256(clave maestra, tabla:id:nonce)`. En BD solo se guarda su hash (`token_hash`) y el `nonce`; la app puede volver a mostrar el enlace,
pero con la BD sola no se puede falsificar uno. Revocar = poner `token_revoked_at` / rotar el nonce. Cada token abre **una** fila (una propuesta, una solicitud, un cobro, un cambio).
