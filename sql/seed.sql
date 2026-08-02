-- ============================================================
-- نظام إدارة التمويل - Seed Data (بيانات تجريبية)
-- Version: 1.0.0
-- Last Updated: 2026-08-02
-- ============================================================

-- ملاحظة: هذا الملف يحتوي على بيانات تجريبية للاختبار فقط
-- لا يتم تشغيله في بيئة الإنتاج

-- ============================================================
-- 1. عميل تجريبي
-- ============================================================

INSERT INTO clients (name, phone, email, address, notes)
VALUES (
    'أحمد محمد علي',
    '01012345678',
    'ahmed@example.com',
    'القاهرة - مصر',
    'عميل تجريبي للاختبار'
);

-- ============================================================
-- 2. ممول تجريبي
-- ============================================================

INSERT INTO investors (name, phone, email, address, notes)
VALUES (
    'خالد إبراهيم',
    '01098765432',
    'khaled@example.com',
    'الإسكندرية - مصر',
    'ممول تجريبي للاختبار'
);

-- ============================================================
-- 3. عملية تجريبية
-- ============================================================

INSERT INTO operations (
    name, type, client_id, amount, expected_profit, final_profit,
    start_date, duration_days, end_date, status, notes
)
VALUES (
    'تمويل مشروع أحمد - دورة 1',
    'financing',
    (SELECT id FROM clients WHERE name = 'أحمد محمد علي' LIMIT 1),
    500000.00,
    50000.00,
    50000.00,
    '2026-08-01',
    30,
    '2026-08-31',
    'draft',
    'عملية تجريبية للاختبار'
);

-- ============================================================
-- 4. مساهمة ممول في العملية
-- ============================================================

INSERT INTO operation_investors (operation_id, investor_id, contribution, profit)
VALUES (
    (SELECT id FROM operations WHERE name = 'تمويل مشروع أحمد - دورة 1' LIMIT 1),
    (SELECT id FROM investors WHERE name = 'خالد إبراهيم' LIMIT 1),
    500000.00,
    50000.00
);

-- ============================================================
-- 5. تحويل تجريبي
-- ============================================================

INSERT INTO transfers (
    type, purpose, operation_id, amount, transfer_date,
    notes, party_type, transaction_category
)
VALUES (
    'company_to_client',
    'client_funding',
    (SELECT id FROM operations WHERE name = 'تمويل مشروع أحمد - دورة 1' LIMIT 1),
    500000.00,
    '2026-08-01',
    'تمويل العميل - تحويل تجريبي',
    'client',
    'client_deposit_in'
);

-- ============================================================
-- 6. سجل نشاط تجريبي
-- ============================================================

INSERT INTO activity_logs (user_email, action, entity_type, details)
VALUES (
    'admin@system.com',
    'إنشاء النظام',
    'system',
    'تم إنشاء قاعدة البيانات والبيانات التجريبية'
);

-- ============================================================
-- 7. User Profiles
-- ============================================================

-- ملاحظة: يتم إنشاء هذه السجلات يدوياً بعد إنشاء المستخدمين
-- من Supabase Dashboard، لأن id يجب أن يكون UUID من auth.users

-- مثال (استبدل UUID بـ User ID الفعلي):
-- INSERT INTO user_profiles (id, role, permission, is_active)
-- VALUES ('YOUR-USER-UUID-HERE', 'admin', 'admin', TRUE);

-- ============================================================
-- END OF SEED DATA
-- ============================================================
