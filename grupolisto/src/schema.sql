-- GrupoListo · modelo de datos (SQLite). Importes en céntimos (INTEGER). Fechas 'YYYY-MM-DD', horas 'HH:MM',
-- marcas de tiempo ISO-8601 UTC. TODA tabla de negocio lleva company_id (multiempresa estricta).

CREATE TABLE IF NOT EXISTS companies(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL DEFAULT '{}', plan TEXT NOT NULL DEFAULT 'interno', created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS brands(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL, logo_url TEXT, email TEXT, phone TEXT, address TEXT, web TEXT, iban TEXT,
  color TEXT DEFAULT '#0b6e99', terms_payment TEXT, terms_cancel TEXT, terms_general TEXT,
  is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id),
  email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','comercial','operaciones','finanzas','proveedor','cliente')),
  provider_id INTEGER, client_id INTEGER, active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions(
  id INTEGER PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id),
  company_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS pipeline_stages(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL,
  position INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'open' CHECK(kind IN ('open','won','lost','cancelled','done')),
  UNIQUE(company_id,key));

CREATE TABLE IF NOT EXISTS clients(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
  company_name TEXT, contact_pref TEXT DEFAULT 'email', consent_email INTEGER NOT NULL DEFAULT 0,
  consent_whatsapp INTEGER NOT NULL DEFAULT 0, notes TEXT, anonymized_at TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS consents(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, client_id INTEGER NOT NULL,
  channel TEXT NOT NULL, granted INTEGER NOT NULL, source TEXT, evidence TEXT, at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS leads(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, client_id INTEGER NOT NULL, brand_id INTEGER,
  title TEXT NOT NULL, event_type TEXT, dates_alt TEXT NOT NULL DEFAULT '[]',
  pax_estimated INTEGER, pax_final INTEGER, budget_cents INTEGER, services_requested TEXT,
  source TEXT, owner_user_id INTEGER, stage TEXT NOT NULL DEFAULT 'new', notes TEXT, preferences TEXT,
  lost_reason TEXT, last_contact_at TEXT, last_inbound_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_leads_co ON leads(company_id, stage);

CREATE TABLE IF NOT EXISTS interactions(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, lead_id INTEGER, client_id INTEGER,
  kind TEXT NOT NULL, body TEXT, user_id INTEGER, at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tasks(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, lead_id INTEGER, event_id INTEGER,
  assigned_to INTEGER, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'task', due_at TEXT, done_at TEXT, auto_key TEXT, created_at TEXT NOT NULL,
  UNIQUE(company_id, auto_key));

CREATE TABLE IF NOT EXISTS providers(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL, contact_name TEXT, email TEXT, phone TEXT,
  availability_mode TEXT NOT NULL DEFAULT 'on_request' CHECK(availability_mode IN ('managed','on_request')),
  external_sync INTEGER NOT NULL DEFAULT 0, cost_deposit_pct INTEGER NOT NULL DEFAULT 0,
  cost_due_days_before INTEGER NOT NULL DEFAULT 7, payment_terms TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS services(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'actividad', description TEXT, images TEXT NOT NULL DEFAULT '[]',
  location TEXT, duration_min INTEGER, min_pax INTEGER NOT NULL DEFAULT 1, max_pax INTEGER,
  price_model TEXT NOT NULL DEFAULT 'per_person' CHECK(price_model IN ('per_person','per_group','per_unit','tiers')),
  price_cents INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL DEFAULT 0, tiers TEXT NOT NULL DEFAULT '[]',
  tax_bp INTEGER NOT NULL DEFAULT 1000, cost_tax_bp INTEGER NOT NULL DEFAULT 1000,
  min_notice_days INTEGER NOT NULL DEFAULT 0, confirm_deadline_days INTEGER NOT NULL DEFAULT 0,
  payment_terms TEXT, cancel_terms TEXT, cancel_free_days INTEGER NOT NULL DEFAULT 7,
  cancel_penalty_pct INTEGER NOT NULL DEFAULT 100, resources TEXT, seasons TEXT, restrictions TEXT,
  share_contact INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS service_providers(
  service_id INTEGER NOT NULL, provider_id INTEGER NOT NULL, company_id INTEGER NOT NULL,
  cost_cents INTEGER, PRIMARY KEY(service_id, provider_id));

CREATE TABLE IF NOT EXISTS packs(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT,
  discount_pct INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pack_items(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, pack_id INTEGER NOT NULL, service_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1, optional INTEGER NOT NULL DEFAULT 0);

-- Disponibilidad gestionada en la app
CREATE TABLE IF NOT EXISTS availability_rules(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, provider_id INTEGER NOT NULL, service_id INTEGER NOT NULL,
  weekdays TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6', start_time TEXT NOT NULL, capacity_pax INTEGER NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0, agency_quota_pax INTEGER, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS availability_closures(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, provider_id INTEGER NOT NULL, service_id INTEGER,
  date_from TEXT NOT NULL, date_to TEXT NOT NULL, reason TEXT, created_by INTEGER, created_at TEXT NOT NULL);
-- Bloqueos provisionales (hold) y cupos confirmados. Un cupo ocupado = no liberado y (confirmed | hold no caducado)
CREATE TABLE IF NOT EXISTS allocations(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, event_service_id INTEGER NOT NULL,
  service_id INTEGER NOT NULL, provider_id INTEGER NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL,
  pax INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('hold','confirmed')), expires_at TEXT,
  released_at TEXT, release_reason TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_alloc_slot ON allocations(company_id, service_id, provider_id, date, start_time);

CREATE TABLE IF NOT EXISTS quotes(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, number TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  lead_id INTEGER, client_id INTEGER NOT NULL, brand_id INTEGER, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','changes_requested','accepted','rejected','expired','superseded')),
  valid_until TEXT, deposit_pct INTEGER NOT NULL DEFAULT 30, notes_client TEXT, terms TEXT NOT NULL DEFAULT '{}',
  token_hash TEXT, token_nonce TEXT, token_expires_at TEXT, token_revoked_at TEXT,
  sent_at TEXT, viewed_at TEXT, accepted_at TEXT, accepted_option_id INTEGER, accepted_version INTEGER,
  accepted_terms_hash TEXT, accepted_ip TEXT, accepted_by_name TEXT, followup_stopped INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0, reviewed_by INTEGER, reviewed_at TEXT,
  created_by INTEGER, created_at TEXT NOT NULL, event_id INTEGER, UNIQUE(company_id, number, version));
CREATE INDEX IF NOT EXISTS ix_quotes_token ON quotes(token_hash);
CREATE TABLE IF NOT EXISTS quote_options(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, quote_id INTEGER NOT NULL, name TEXT NOT NULL,
  pax INTEGER NOT NULL, event_date TEXT, start_time TEXT, discount_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS quote_lines(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, option_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('service','pack','pack_item','extra')),
  service_id INTEGER, pack_id INTEGER, parent_line_id INTEGER, provider_id INTEGER, description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1, unit TEXT, pax INTEGER, unit_price_cents INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0, total_price_cents INTEGER NOT NULL DEFAULT 0,
  total_cost_cents INTEGER NOT NULL DEFAULT 0, tax_bp INTEGER NOT NULL DEFAULT 1000, cost_tax_bp INTEGER NOT NULL DEFAULT 1000,
  optional INTEGER NOT NULL DEFAULT 0, selected INTEGER NOT NULL DEFAULT 1, mandatory INTEGER NOT NULL DEFAULT 1,
  start_time TEXT, snapshot TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, code TEXT NOT NULL, client_id INTEGER NOT NULL, lead_id INTEGER,
  quote_id INTEGER, quote_version INTEGER, brand_id INTEGER, name TEXT NOT NULL, date TEXT, start_time TEXT,
  pax INTEGER NOT NULL, owner_user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','completed')),
  booking_status TEXT NOT NULL DEFAULT 'pending' CHECK(booking_status IN ('pending','partial','confirmed')),
  payment_status TEXT NOT NULL DEFAULT 'pending',
  discount_bp INTEGER NOT NULL DEFAULT 0, deposit_pct INTEGER NOT NULL DEFAULT 30, deposit_required_cents INTEGER NOT NULL DEFAULT 0,
  balance_due_date TEXT, total_due_cents INTEGER NOT NULL DEFAULT 0, confirm_count INTEGER NOT NULL DEFAULT 0,
  final_pax_confirmed INTEGER NOT NULL DEFAULT 0, terms TEXT NOT NULL DEFAULT '{}', notes TEXT,
  created_at TEXT NOT NULL, completed_at TEXT, cancelled_at TEXT, UNIQUE(company_id, code));

CREATE TABLE IF NOT EXISTS event_services(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, event_id INTEGER NOT NULL, service_id INTEGER, provider_id INTEGER,
  pack_id INTEGER, name TEXT NOT NULL, date TEXT, start_time TEXT, pax INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 1,
  list_price_cents INTEGER NOT NULL DEFAULT 0, price_cents INTEGER NOT NULL DEFAULT 0, cost_cents INTEGER NOT NULL DEFAULT 0,
  tax_bp INTEGER NOT NULL DEFAULT 1000, cost_tax_bp INTEGER NOT NULL DEFAULT 1000, mandatory INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN
    ('requested','pending_availability','available','held','confirmed','rejected','cancelled','done')),
  reconfirm INTEGER NOT NULL DEFAULT 0, provider_confirmed INTEGER NOT NULL DEFAULT 0, needs_review INTEGER NOT NULL DEFAULT 0,
  terms TEXT NOT NULL DEFAULT '{}', cancel_penalty_cents INTEGER NOT NULL DEFAULT 0, cancel_cost_penalty_cents INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT, cancelled_by TEXT, done_at TEXT, rejected_reason TEXT, notes TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_es_event ON event_services(company_id, event_id);

CREATE TABLE IF NOT EXISTS provider_requests(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, event_service_id INTEGER NOT NULL, provider_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE, token_nonce TEXT, token_revoked_at TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','responded','cancelled')),
  payload TEXT NOT NULL, deadline_at TEXT, sent_at TEXT NOT NULL, last_reminder_at TEXT,
  response TEXT CHECK(response IN ('confirm','reject','alternative')), response_cost_cents INTEGER,
  response_notes TEXT, requirements TEXT, alt_date TEXT, alt_time TEXT, alt_status TEXT,
  review_status TEXT, responded_at TEXT, late INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS payments_in(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, event_id INTEGER NOT NULL, payer_name TEXT, payer_email TEXT,
  kind TEXT NOT NULL CHECK(kind IN ('deposit','balance','participant','refund')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), refunded_cents INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'transfer', status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','verified','failed','refunded','cancelled')),
  due_date TEXT, gateway TEXT, gateway_ref TEXT, proof_note TEXT, proof_doc_id INTEGER, refund_of INTEGER,
  token_hash TEXT, token_nonce TEXT, token_revoked_at TEXT, created_by INTEGER, verified_by INTEGER, verified_at TEXT,
  failed_reason TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pin_gateway ON payments_in(gateway, gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_pin_token ON payments_in(token_hash);

CREATE TABLE IF NOT EXISTS webhook_events(
  id INTEGER PRIMARY KEY, company_id INTEGER, source TEXT NOT NULL, external_id TEXT NOT NULL, payload TEXT,
  received_at TEXT NOT NULL, processed_at TEXT, result TEXT, UNIQUE(source, external_id));

CREATE TABLE IF NOT EXISTS payments_out(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, event_service_id INTEGER NOT NULL, event_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('deposit','balance')),
  amount_cents INTEGER NOT NULL DEFAULT 0, due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ordered','paid','cancelled')),
  method TEXT, reference TEXT, proof_doc_id INTEGER, invoice_doc_id INTEGER, invoice_ref TEXT,
  ordered_by INTEGER, ordered_at TEXT, paid_by INTEGER, paid_at TEXT, idem_key TEXT UNIQUE,
  created_at TEXT NOT NULL, UNIQUE(event_service_id, kind));

CREATE TABLE IF NOT EXISTS documents(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, name TEXT NOT NULL,
  kind TEXT, mime TEXT, path TEXT NOT NULL, size INTEGER, visibility TEXT NOT NULL DEFAULT 'internal',
  uploaded_by TEXT, created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS templates(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, brand_id INTEGER, key TEXT NOT NULL, channel TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'client', subject TEXT, body TEXT NOT NULL, wa_template_name TEXT,
  active INTEGER NOT NULL DEFAULT 1, UNIQUE(company_id, key, channel));

CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp','internal')),
  direction TEXT NOT NULL DEFAULT 'out', client_id INTEGER, provider_id INTEGER, lead_id INTEGER, event_id INTEGER,
  event_service_id INTEGER, to_addr TEXT, subject TEXT, body TEXT, template_key TEXT, meta TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','delivered','failed','blocked','not_configured','received','read')),
  error TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, external_id TEXT, dedupe_key TEXT,
  automatic INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL, sent_at TEXT,
  UNIQUE(company_id, dedupe_key));
CREATE INDEX IF NOT EXISTS ix_msg_q ON messages(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS automations(
  company_id INTEGER NOT NULL, key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, params TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY(company_id,key));

CREATE TABLE IF NOT EXISTS integrations(
  company_id INTEGER NOT NULL, key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, config_enc TEXT, updated_at TEXT,
  PRIMARY KEY(company_id,key));

CREATE TABLE IF NOT EXISTS event_changes(
  id INTEGER PRIMARY KEY, company_id INTEGER NOT NULL, event_id INTEGER NOT NULL, kind TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, price_delta_cents INTEGER NOT NULL DEFAULT 0,
  capacity_report TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending_acceptance' CHECK(status IN ('pending_acceptance','accepted','rejected','superseded')),
  proposed_by INTEGER, proposed_at TEXT NOT NULL, accepted_by TEXT, accepted_at TEXT, accepted_via TEXT, note TEXT,
  token_hash TEXT, token_nonce TEXT, token_revoked_at TEXT);

CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, company_id INTEGER, user_id INTEGER, actor TEXT, entity TEXT NOT NULL, entity_id INTEGER,
  action TEXT NOT NULL, detail TEXT, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_audit ON audit_log(company_id, entity, entity_id);
