-- ============================================================
-- نظام إدارة التمويل - Database Schema
-- Version: 1.1.0
-- Last Updated: 2026-08-02
-- ============================================================

-- ============================================================
-- 1. EXTENSIONS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 2. SEQUENCES (للأرقام المرجعية)
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS seq_clients_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_investors_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_operations_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_transfers_ref START 1;
CREATE SEQUENCE IF NOT EXISTS seq_activity_logs_ref START 1;

-- ============================================================
-- 3. TABLES (مع Foreign Keys مدمجة)
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 Clients (العملاء)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    notes           TEXT,
    reference_number TEXT UNIQUE,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3.2 Investors (الممولين)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS investors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    phone           TEXT,
    email           TEXT,
    address         TEXT,
    notes           TEXT,
    reference_number TEXT UNIQUE,
    is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3.3 Operations (العمليات)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    TEXT NOT NULL,
    type                    TEXT NOT NULL DEFAULT 'financing'
                            CHECK (type IN ('financing', 'supply')),
    client_id               UUID NOT NULL REFERENCES clients(id),
    amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    expected_profit         NUMERIC(15,2) DEFAULT 0 CHECK (expected_profit >= 0),
    final_profit            NUMERIC(15,2) DEFAULT 0 CHECK (final_profit >= 0),
    profit_approval_date    DATE,
    google_drive_url        TEXT,
    company_profit_type     TEXT CHECK (company_profit_type IN ('percentage', 'fixed', NULL)),
    company_profit_value    NUMERIC(15,2) DEFAULT 0,
    start_date              DATE NOT NULL,
    duration_days           INTEGER DEFAULT 0 CHECK (duration_days >= 0),
    end_date                DATE,
    status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
    notes                   TEXT,
    is_locked               BOOLEAN NOT NULL DEFAULT FALSE,
    is_archived             BOOLEAN NOT NULL DEFAULT FALSE,
    reference_number        TEXT UNIQUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3.4 Operation Investors (مساهمات الممولين في العمليات)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operation_investors (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    operation_id    UUID NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
    investor_id     UUID NOT NULL REFERENCES investors(id),
    contribution    NUMERIC(15,2) NOT NULL CHECK (contribution > 0),
    profit          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (profit >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (operation_id, investor_id)
);

-- ------------------------------------------------------------
-- 3.5 Transfers (التحويلات المالية)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type                    TEXT NOT NULL
                            CHECK (type IN ('company_to_client', 'client_to_company', 'company_to_investor')),
    purpose                 TEXT NOT NULL
                            CHECK (purpose IN (
                                'client_funding', 'client_repayment',
                                'capital_return', 'profit_distribution',
                                'settlement', 'additional_funding', 'other'
                            )),
    operation_id            UUID REFERENCES operations(id),
    investor_id             UUID REFERENCES investors(id),
    amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    transfer_date           DATE NOT NULL,
    notes                   TEXT,
    reference_number        TEXT UNIQUE,
    party_type              TEXT CHECK (party_type IN ('client', 'investor', 'company')),
    transaction_category    TEXT,
    is_archived             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3.6 Activity Logs (سجل النشاط - المصدر الوحيد)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_number TEXT UNIQUE,
    user_email      TEXT NOT NULL,
    user_id         UUID,
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       UUID,
    old_value       TEXT,
    new_value       TEXT,
    details         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 3.7 User Profiles (صلاحيات المستخدمين)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('admin', 'viewer', 'client', 'investor')),
    entity_id       UUID,
    permission      TEXT NOT NULL DEFAULT 'viewer'
                    CHECK (permission IN ('admin', 'viewer')),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 4. INDEXES
-- ============================================================

-- Clients
CREATE INDEX IF NOT EXISTS idx_clients_reference ON clients(reference_number);
CREATE INDEX IF NOT EXISTS idx_clients_archived ON clients(is_archived);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name);

-- Investors
CREATE INDEX IF NOT EXISTS idx_investors_reference ON investors(reference_number);
CREATE INDEX IF NOT EXISTS idx_investors_archived ON investors(is_archived);
CREATE INDEX IF NOT EXISTS idx_investors_name ON investors(name);

-- Operations
CREATE INDEX IF NOT EXISTS idx_operations_reference ON operations(reference_number);
CREATE INDEX IF NOT EXISTS idx_operations_client ON operations(client_id);
CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);
CREATE INDEX IF NOT EXISTS idx_operations_end_date ON operations(end_date);
CREATE INDEX IF NOT EXISTS idx_operations_locked ON operations(is_locked);
CREATE INDEX IF NOT EXISTS idx_operations_archived ON operations(is_archived);

-- Operation Investors
CREATE INDEX IF NOT EXISTS idx_op_inv_operation ON operation_investors(operation_id);
CREATE INDEX IF NOT EXISTS idx_op_inv_investor ON operation_investors(investor_id);

-- Transfers
CREATE INDEX IF NOT EXISTS idx_transfers_reference ON transfers(reference_number);
CREATE INDEX IF NOT EXISTS idx_transfers_operation ON transfers(operation_id);
CREATE INDEX IF NOT EXISTS idx_transfers_investor ON transfers(investor_id);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(transfer_date);
CREATE INDEX IF NOT EXISTS idx_transfers_purpose ON transfers(purpose);
CREATE INDEX IF NOT EXISTS idx_transfers_party_type ON transfers(party_type);

-- Activity Logs
CREATE INDEX IF NOT EXISTS idx_activity_reference ON activity_logs(reference_number);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_logs(user_email);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs(created_at DESC);

-- User Profiles
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON user_profiles(is_active);

-- ============================================================
-- 5. FUNCTIONS
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 تحديث updated_at تلقائياً
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 5.2 منع تعديل عملية مقفلة
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_locked_operation_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_locked = TRUE AND NEW.is_locked = TRUE THEN
        IF OLD.name IS DISTINCT FROM NEW.name
           OR OLD.amount IS DISTINCT FROM NEW.amount
           OR OLD.client_id IS DISTINCT FROM NEW.client_id
           OR OLD.status IS DISTINCT FROM NEW.status
           OR OLD.final_profit IS DISTINCT FROM NEW.final_profit
           OR OLD.start_date IS DISTINCT FROM NEW.start_date
           OR OLD.end_date IS DISTINCT FROM NEW.end_date
        THEN
            RAISE EXCEPTION 'لا يمكن تعديل عملية مقفلة. قم بفتح القفل أولاً.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 5.3 منع حذف activity_logs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_activity_log_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'لا يمكن حذف سجلات النشاط. السجل التاريخي محمي.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 6. TRIGGERS
-- ============================================================

-- ------------------------------------------------------------
-- 6.1 توليد reference_number عند INSERT (باستخدام Sequences)
-- ------------------------------------------------------------

-- Clients
CREATE OR REPLACE FUNCTION trg_clients_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_number IS NULL THEN
        NEW.reference_number := 'CL-' || LPAD(nextval('seq_clients_ref')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_clients_reference
    BEFORE INSERT ON clients
    FOR EACH ROW EXECUTE FUNCTION trg_clients_reference();

-- Investors
CREATE OR REPLACE FUNCTION trg_investors_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_number IS NULL THEN
        NEW.reference_number := 'INV-' || LPAD(nextval('seq_investors_ref')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_investors_reference
    BEFORE INSERT ON investors
    FOR EACH ROW EXECUTE FUNCTION trg_investors_reference();

-- Operations
CREATE OR REPLACE FUNCTION trg_operations_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_number IS NULL THEN
        NEW.reference_number := 'OP-' || LPAD(nextval('seq_operations_ref')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_operations_reference
    BEFORE INSERT ON operations
    FOR EACH ROW EXECUTE FUNCTION trg_operations_reference();

-- Transfers
CREATE OR REPLACE FUNCTION trg_transfers_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_number IS NULL THEN
        NEW.reference_number := 'TR-' || LPAD(nextval('seq_transfers_ref')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_transfers_reference
    BEFORE INSERT ON transfers
    FOR EACH ROW EXECUTE FUNCTION trg_transfers_reference();

-- Activity Logs
CREATE OR REPLACE FUNCTION trg_activity_reference()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_number IS NULL THEN
        NEW.reference_number := 'LOG-' || LPAD(nextval('seq_activity_logs_ref')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_activity_reference
    BEFORE INSERT ON activity_logs
    FOR EACH ROW EXECUTE FUNCTION trg_activity_reference();

-- ------------------------------------------------------------
-- 6.2 تحديث updated_at تلقائياً
-- ------------------------------------------------------------
CREATE TRIGGER trigger_clients_updated
    BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_investors_updated
    BEFORE UPDATE ON investors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_operations_updated
    BEFORE UPDATE ON operations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_user_profiles_updated
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 6.3 منع تعديل عملية مقفلة
-- ------------------------------------------------------------
CREATE TRIGGER trigger_operations_lock_check
    BEFORE UPDATE ON operations
    FOR EACH ROW EXECUTE FUNCTION prevent_locked_operation_update();

-- ------------------------------------------------------------
-- 6.4 منع حذف activity_logs
-- ------------------------------------------------------------
CREATE TRIGGER trigger_activity_no_delete
    BEFORE DELETE ON activity_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_activity_log_delete();

-- ============================================================
-- 7. RLS POLICIES
-- ============================================================

-- ملاحظة: RLS معطّل حالياً والاعتماد على Frontend (auth.js)
-- عند الحاجة لتفعيل RLS، يتم كتابة Policies حقيقية بناءً على user_profiles

-- مثال للـ RLS المستقبلية (غير مفعّل حالياً):
-- ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "clients_admin_all" ON clients
--     FOR ALL TO authenticated
--     USING (
--         EXISTS (
--             SELECT 1 FROM user_profiles
--             WHERE user_profiles.id = auth.uid()
--             AND user_profiles.permission = 'admin'
--         )
--     );

-- ============================================================
-- END OF SCHEMA
-- ============================================================
