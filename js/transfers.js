// ============================================================
// نظام إدارة التمويل - Transfers Module (Parties Ledger)
// Version: 5.0.0 (Complete Rewrite - Aligned with System Philosophy)
// Last Updated: 2026-08-04
// ============================================================
//
// الفلسفة:
// - التحويلات هي المصدر الوحيد للحركات المالية (Single Source of Truth)
// - الحسابات تُستنتج من التحويلات ولا تُخزن
// - المستخدم يختار "من" و"إلى"، والنظام يستنتج النوع
// - كل تحويل يؤثر على: Dashboard, Client, Investor, Operation, Statements
//
// يعتمد على:
// - core.js (APP, runQuery, debug, showToast, openModal, closeModal, ...)
// - auth.js (canEdit)
// - app.js (Event Delegation)
//
// يُعتمد عليه من:
// - operations.js (openTransferModal مع prefill, PURPOSE_TEXT_AR)
// - dashboard.js (حساب الأرصدة)
// ============================================================

// ============================================================
// 1. STATE
// ============================================================

var TRANSFERS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null, operations: null },
    listCache: { lastLoad: null, records: null }
};

// ============================================================
// 2. TRANSFER FLOW MAP (✅ تم إصلاح investor_to_company)
// ============================================================

var TRANSFER_FLOW_MAP = Object.freeze({
    'company_to_client': {
        party_type: 'client',
        transaction_category: 'client_deposit_in',
        transfer_type: 'company_to_client',
        purpose_options: ['client_funding', 'additional_funding', 'settlement', 'other'],
        label: 'تمويل عميل'
    },
    'client_to_company': {
        party_type: 'client',
        transaction_category: 'client_use_out',
        transfer_type: 'client_to_company',
        purpose_options: ['client_repayment', 'settlement', 'other'],
        label: 'سداد من عميل'
    },
    'company_to_investor': {
        party_type: 'investor',
        transaction_category: 'investor_return_out',
        transfer_type: 'company_to_investor',
        purpose_options: ['capital_return', 'profit_distribution', 'settlement', 'other'],
        label: 'تحويل لممول'
    },
    // ✅ إصلاح: transfer_type كان 'company_to_investor' (معكوس!)
    'investor_to_company': {
        party_type: 'investor',
        transaction_category: 'investor_capital_in',
        transfer_type: 'investor_to_company',
        purpose_options: ['client_funding', 'settlement', 'other'],
        label: 'إيداع من ممول'
    },
    'client_to_investor': {
        party_type: 'client',
        transaction_category: 'client_to_investor',
        transfer_type: 'client_to_investor',
        purpose_options: ['settlement', 'other'],
        label: 'تحويل من عميل لممول'
    },
    'investor_to_client': {
        party_type: 'investor',
        transaction_category: 'investor_to_client',
        transfer_type: 'investor_to_client',
        purpose_options: ['settlement', 'other'],
        label: 'تحويل من ممول لعميل'
    }
});

var WORKFLOW_TRANSFER_PURPOSES = Object.freeze(['client_repayment', 'capital_return', 'profit_distribution']);

// ✅ جعله متاحاً في window scope لاستخدامه من operations.js
var PURPOSE_TEXT_AR = Object.freeze({
    client_funding: 'تمويل',
    client_repayment: 'سداد',
    capital_return: 'إرجاع رأس مال',
    profit_distribution: 'توزيع أرباح',
    settlement: 'تسوية',
    additional_funding: 'تمويل إضافي',
    other: 'أخرى'
});

// جعله متاحاً globally
if (typeof window !== 'undefined') {
    window.PURPOSE_TEXT_AR = PURPOSE_TEXT_AR;
}

// ============================================================
// 3. INITIALIZATION
// ============================================================

function initTransfers() {
    debug('💸 بدء تهيئة transfers.js', 'info');
    if (typeof registerScreenLoader === 'function') {
        registerScreenLoader('transfers', loadTransfers);
    }
    debug('✅ transfers.js جاهز', 'success');
}

// ============================================================
// 4. LOAD TRANSFERS
// ============================================================

async function loadTransfers() {
    debug('💸 بدأ loadTransfers', 'info');
    if (!isSupabaseReady()) return;

    showLoading();

    try {
        var results = await Promise.all([
            runQuery(function() {
                var query = APP.supabase.from('transfers')
                    .select('id, reference_number, type, purpose, operation_id, client_id, investor_id, amount, transfer_date, notes, party_type, transaction_category, is_archived, created_at')
                    .order('transfer_date', { ascending: false });

                if (TRANSFERS_STATE.filter) query = query.eq('party_type', TRANSFERS_STATE.filter);

                if (TRANSFERS_STATE.search) {
                    var searchTerm = '%' + TRANSFERS_STATE.search + '%';
                    query = query.or('reference_number.ilike.' + searchTerm + ',notes.ilike.' + searchTerm);
                }

                return query;
            }, { context: 'loadTransfers-trans', throwError: true }),
            loadClientsForTransfers(),
            loadInvestorsForTransfers(),
            loadOperationsForTransfers()
        ]);

        var transfers = results[0].data || [];
        var clients = results[1] || [];
        var investors = results[2] || [];
        var operations = results[3] || [];

        var indexes = buildTransfersIndexes(clients, investors, operations);

        transfers.forEach(function(t) {
            // ربط العميل
            if (t.client_id && indexes.clientsById[t.client_id]) {
                t.client = indexes.clientsById[t.client_id];
            } else if (t.operation_id && indexes.operationsById[t.operation_id]) {
                var op = indexes.operationsById[t.operation_id];
                t.client = op.client_id ? indexes.clientsById[op.client_id] : null;
            } else {
                t.client = null;
            }

            // ربط الممول
            t.investor = t.investor_id ? indexes.investorsById[t.investor_id] : null;

            // ربط العملية
            t.operation = t.operation_id ? indexes.operationsById[t.operation_id] : null;
        });

        TRANSFERS_STATE.records = transfers;
        TRANSFERS_STATE.listCache.records = transfers;
        TRANSFERS_STATE.listCache.lastLoad = Date.now();

        renderTransfersList();
        debug('✅ تم تحميل ' + transfers.length + ' تحويل', 'success');

    } catch (err) {
        debug('❌ خطأ في loadTransfers: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل التحويلات'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 5. REFERENCE DATA
// ============================================================

async function loadClientsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.clients) return TRANSFERS_STATE.referenceCache.clients;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('clients').select('id, name, is_archived').order('name');
        }, { context: 'loadClientsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.clients = result.data || [];
        return TRANSFERS_STATE.referenceCache.clients;
    } catch (e) { return []; }
}

async function loadInvestorsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.investors) return TRANSFERS_STATE.referenceCache.investors;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('investors').select('id, name, is_archived').order('name');
        }, { context: 'loadInvestorsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.investors = result.data || [];
        return TRANSFERS_STATE.referenceCache.investors;
    } catch (e) { return []; }
}

async function loadOperationsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.operations) return TRANSFERS_STATE.referenceCache.operations;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('operations')
                .select('id, name, client_id, amount, status, is_locked, is_archived')
                .order('name');
        }, { context: 'loadOperationsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.operations = result.data || [];
        return TRANSFERS_STATE.referenceCache.operations;
    } catch (e) { return []; }
}

function buildTransfersIndexes(clients, investors, operations) {
    var clientsById = {}, investorsById = {}, operationsById = {};
    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });
    operations.forEach(function(op) { operationsById[op.id] = op; });
    return { clientsById: clientsById, investorsById: investorsById, operationsById: operationsById };
}

// ============================================================
// 6. RENDER LIST (✅ إصلاح: عرض investor_to_company)
// ============================================================

function renderTransfersList() {
    var container = document.getElementById('transfersTable');
    if (!container) return;

    if (TRANSFERS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد تحويلات</div>';
        return;
    }

    var html = '<table><thead><tr>';
    html += '<th>الرقم</th><th>التاريخ</th><th>من</th><th>إلى</th><th>الغرض</th><th>المبلغ</th><th>العملية</th><th>ملاحظات</th>';
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead><tbody>';

    TRANSFERS_STATE.records.forEach(function(t) {
        var fromText = _getFromText(t);
        var toText = _getToText(t);
        var opText = t.operation ? escapeHtml(t.operation.name) : '-';

        html += '<tr>';
        html += '<td><strong>' + escapeHtml(t.reference_number || '-') + '</strong></td>';
        html += '<td>' + formatDate(t.transfer_date) + '</td>';
        html += '<td>' + fromText + '</td>';
        html += '<td>' + toText + '</td>';
        html += '<td>' + (PURPOSE_TEXT_AR[t.purpose] || t.purpose || '-') + '</td>';
        html += '<td class="amount-cell">' + formatMoney(t.amount) + '</td>';
        html += '<td>' + opText + '</td>';
        html += '<td>' + escapeHtml(truncateText(t.notes, 30)) + '</td>';

        if (canEdit()) {
            html += '<td class="actions-cell">';
            html += '<button class="btn btn-secondary btn-sm" data-action="editTransfer" data-param="' + t.id + '">✏️</button> ';
            html += '<button class="btn btn-danger btn-sm" data-action="deleteTransfer" data-param="' + t.id + '">🗑️</button>';
            html += '</td>';
        }

        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ✅ دوال مساعدة لعرض "من" و"إلى" لجميع الأنواع
function _getFromText(t) {
    switch (t.type) {
        case 'company_to_client':
        case 'company_to_investor':
            return '🏢 الشركة';

        case 'client_to_company':
        case 'client_to_investor':
            return t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : 'عميل';

        case 'investor_to_company':
        case 'investor_to_client':
            return t.investor ? '<a href="#" data-action="openInvestorFile" data-param="' + t.investor.id + '">' + escapeHtml(t.investor.name) + '</a>' : 'ممول';

        default:
            return '-';
    }
}

function _getToText(t) {
    switch (t.type) {
        case 'client_to_company':
        case 'investor_to_company':
            return '🏢 الشركة';

        case 'company_to_client':
        case 'investor_to_client':
            return t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : 'عميل';

        case 'company_to_investor':
        case 'client_to_investor':
            return t.investor ? '<a href="#" data-action="openInvestorFile" data-param="' + t.investor.id + '">' + escapeHtml(t.investor.name) + '</a>' : 'ممول';

        default:
            return '-';
    }
}

// ============================================================
// 7. OPEN MODAL (✅ إضافة دعم prefill)
// ============================================================

async function openTransferModal(transferId, prefill) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var titleEl = document.getElementById('transferModalTitle');
    if (!titleEl) return;

    await Promise.all([
        loadClientsForTransfers(),
        loadInvestorsForTransfers(),
        loadOperationsForTransfers()
    ]);

    // ملء قوائم from/to
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    var opEl = document.getElementById('transferOperation');

    if (fromTypeEl) {
        fromTypeEl.innerHTML = '<option value="">-- اختر المصدر --</option>' +
            '<option value="company">🏢 الشركة</option>' +
            '<option value="client">👤 عميل</option>' +
            '<option value="investor">💼 ممول</option>';
    }

    if (toTypeEl) {
        toTypeEl.innerHTML = '<option value="">-- اختر المستلم --</option>' +
            '<option value="company">🏢 الشركة</option>' +
            '<option value="client">👤 عميل</option>' +
            '<option value="investor">💼 ممول</option>';
    }

    // ملء قائمة العمليات
    if (opEl && TRANSFERS_STATE.referenceCache.operations) {
        var options = '<option value="">-- بدون عملية --</option>';
        TRANSFERS_STATE.referenceCache.operations.forEach(function(op) {
            if (!op.is_archived) {
                options += '<option value="' + op.id + '">' + escapeHtml(op.name) + '</option>';
            }
        });
        opEl.innerHTML = options;
    }

    resetTransferForm();

    if (transferId) {
        // وضع التعديل
        try {
            var result = await runQuery(function() {
                return APP.supabase.from('transfers').select('*').eq('id', transferId).single();
            }, { context: 'openTransferModal', throwError: true });

            if (result.data) populateTransferForm(result.data, 'تعديل تحويل');
        } catch (err) {
            showToast(handleSupabaseError(err, 'فتح بيانات التحويل'), 'error');
            return;
        }
    } else {
        titleEl.textContent = 'إضافة تحويل';

        // ✅ تعبئة مسبقة (Prefill) من operations.js
        if (prefill) {
            debug('📝 تعبئة مسبقة للتحويل: ' + JSON.stringify(prefill), 'info');
            _applyPrefill(prefill);
        }
    }

    var warningEl = document.getElementById('transferValidationWarning');
    if (warningEl) warningEl.innerHTML = '';

    openModal('transferModal');
}

// ✅ دالة جديدة: تطبيق التعبئة المسبقة
function _applyPrefill(prefill) {
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');

    if (prefill.fromType && fromTypeEl) fromTypeEl.value = prefill.fromType;
    if (prefill.toType && toTypeEl) toTypeEl.value = prefill.toType;

    // تحديث الحقول الديناميكية
    if (typeof updateTransferFields === 'function') updateTransferFields();

    // الانتظار حتى تظهر الحقول الديناميكية ثم تعبئتها
    setTimeout(function() {
        if (prefill.fromEntity) _setTransVal('transferFromEntity', prefill.fromEntity);
        if (prefill.toEntity) _setTransVal('transferToEntity', prefill.toEntity);
        if (prefill.amount) _setTransVal('transferAmount', prefill.amount);
        if (prefill.operationId) _setTransVal('transferOperation', prefill.operationId);
        if (prefill.date) _setTransVal('transferDate', prefill.date);
        if (prefill.purpose) _setTransVal('transferPurpose', prefill.purpose);

        // تحديث الملخص
        var fromType = _getTransVal('transferFromType');
        var toType = _getTransVal('transferToType');
        if (fromType && toType) updateTransferSummary(fromType, toType);

        debug('✅ تم تطبيق التعبئة المسبقة', 'success');
    }, 150);
}

function editTransfer(transferId) {
    openTransferModal(transferId);
}

// ============================================================
// 8. DYNAMIC FIELDS UPDATE
// ============================================================

function updateTransferFields() {
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    if (!fromTypeEl || !toTypeEl) return;

    var fromType = fromTypeEl.value;
    var toType = toTypeEl.value;

    var fromEntityRow = document.getElementById('transferFromEntityRow');
    var toEntityRow = document.getElementById('transferToEntityRow');
    var fromEntitySelect = document.getElementById('transferFromEntity');
    var toEntitySelect = document.getElementById('transferToEntity');
    var fromEntityLabel = document.getElementById('transferFromEntityLabel');
    var toEntityLabel = document.getElementById('transferToEntityLabel');

    // إخفاء الحقول الديناميكية أولاً
    if (fromEntityRow) fromEntityRow.style.display = 'none';
    if (toEntityRow) toEntityRow.style.display = 'none';
    if (fromEntitySelect) fromEntitySelect.value = '';
    if (toEntitySelect) toEntitySelect.value = '';

    // إظهار حقل اختيار العميل/الممول إذا لزم الأمر
    if ((fromType === 'client' || fromType === 'investor') && fromEntityRow && fromEntitySelect) {
        var fromData = populateEntitySelect(fromType);
        if (fromData) {
            if (fromEntityLabel) fromEntityLabel.textContent = fromData.label;
            fromEntitySelect.innerHTML = fromData.options;
            fromEntityRow.style.display = 'block';
        }
    }

    if ((toType === 'client' || toType === 'investor') && toEntityRow && toEntitySelect) {
        var toData = populateEntitySelect(toType);
        if (toData) {
            if (toEntityLabel) toEntityLabel.textContent = toData.label;
            toEntitySelect.innerHTML = toData.options;
            toEntityRow.style.display = 'block';
        }
    }

    // ✅ إظهار/إخفاء حقل الغرض حسب نوع التحويل
    _updatePurposeField(fromType, toType);

    // تحديث الملخص
    updateTransferSummary(fromType, toType);

    // تحديث الحقول المخفية
    var fromPartyEl = document.getElementById('transferFromParty');
    var toPartyEl = document.getElementById('transferToParty');
    if (fromPartyEl) fromPartyEl.value = fromType;
    if (toPartyEl) toPartyEl.value = toType;
}

function populateEntitySelect(type) {
    var entities = [];
    var label = '';

    if (type === 'client') {
        entities = TRANSFERS_STATE.referenceCache.clients || [];
        label = 'اختر العميل *';
    } else if (type === 'investor') {
        entities = TRANSFERS_STATE.referenceCache.investors || [];
        label = 'اختر الممول *';
    } else {
        return null;
    }

    var options = '<option value="">-- اختر --</option>';
    entities.forEach(function(e) {
        if (!e.is_archived) {
            options += '<option value="' + e.id + '">' + escapeHtml(e.name) + '</option>';
        }
    });

    return { options: options, label: label };
}

// ✅ دالة جديدة: تحديث حقل الغرض ديناميكياً
function _updatePurposeField(fromType, toType) {
    var purposeRow = document.getElementById('transferPurposeRow');

    // إذا لم يكن موجوداً، أنشئه ديناميكياً
    if (!purposeRow) {
        var amountGroup = document.querySelector('#transferModal .form-group label[for="transferAmount"]');
        if (!amountGroup) return;

        var formGroup = amountGroup.closest('.form-group');
        if (!formGroup) return;

        purposeRow = document.createElement('div');
        purposeRow.className = 'form-group';
        purposeRow.id = 'transferPurposeRow';
        purposeRow.innerHTML = '<label for="transferPurpose">الغرض *</label><select id="transferPurpose" class="form-control"></select>';

        formGroup.parentNode.insertBefore(purposeRow, formGroup);
    }

    var purposeSelect = document.getElementById('transferPurpose');
    if (!purposeSelect) return;

    if (!fromType || !toType) {
        purposeRow.style.display = 'none';
        return;
    }

    var flowKey = fromType + '_to_' + toType;
    var flow = TRANSFER_FLOW_MAP[flowKey];

    if (!flow || flow.purpose_options.length <= 1) {
        purposeRow.style.display = 'none';
        return;
    }

    // ملء خيارات الغرض
    var options = '';
    flow.purpose_options.forEach(function(purpose) {
        var label = PURPOSE_TEXT_AR[purpose] || purpose;
        options += '<option value="' + purpose + '">' + label + '</option>';
    });

    purposeSelect.innerHTML = options;
    purposeRow.style.display = 'block';

    debug('📋 تحديث حقل الغرض: ' + flow.purpose_options.join(', '), 'info');
}

function updateTransferSummary(fromType, toType) {
    var summaryEl = document.getElementById('transferSummary');
    var summaryFrom = document.getElementById('summaryFrom');
    var summaryTo = document.getElementById('summaryTo');
    var summaryCategory = document.getElementById('summaryCategory');

    if (!fromType || !toType || !summaryEl) {
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }

    var flowKey = fromType + '_to_' + toType;
    var flow = TRANSFER_FLOW_MAP[flowKey];

    if (!flow) {
        summaryEl.style.display = 'none';
        return;
    }

    var fromText = fromType === 'company' ? '🏢 الشركة' : (fromType === 'client' ? '👤 عميل' : '💼 ممول');
    var toText = toType === 'company' ? '🏢 الشركة' : (toType === 'client' ? '👤 عميل' : '💼 ممول');

    if (summaryFrom) summaryFrom.textContent = fromText;
    if (summaryTo) summaryTo.textContent = toText;
    if (summaryCategory) summaryCategory.textContent = flow.label;

    summaryEl.style.display = 'block';

    var categoryEl = document.getElementById('transferTransactionCategory');
    if (categoryEl) categoryEl.value = flow.transaction_category;
}

// ============================================================
// 9. POPULATE FORM (EDIT MODE)
// ============================================================

function populateTransferForm(transfer, title) {
    var titleEl = document.getElementById('transferModalTitle');
    if (titleEl) titleEl.textContent = title;

    // تحديد from/to من نوع التحويل
    var fromType = 'company', toType = 'company';

    switch (transfer.type) {
        case 'company_to_client': fromType = 'company'; toType = 'client'; break;
        case 'client_to_company': fromType = 'client'; toType = 'company'; break;
        case 'company_to_investor': fromType = 'company'; toType = 'investor'; break;
        case 'investor_to_company': fromType = 'investor'; toType = 'company'; break;
        case 'client_to_investor': fromType = 'client'; toType = 'investor'; break;
        case 'investor_to_client': fromType = 'investor'; toType = 'client'; break;
    }

    _setTransVal('transferFromType', fromType);
    _setTransVal('transferToType', toType);

    updateTransferFields();

    // تعبئة الكيانات
    if (transfer.client_id) {
        if (fromType === 'client') _setTransVal('transferFromEntity', transfer.client_id);
        else if (toType === 'client') _setTransVal('transferToEntity', transfer.client_id);
    }

    if (transfer.investor_id) {
        if (fromType === 'investor') _setTransVal('transferFromEntity', transfer.investor_id);
        else if (toType === 'investor') _setTransVal('transferToEntity', transfer.investor_id);
    }

    _setTransVal('transferAmount', transfer.amount);
    _setTransVal('transferOperation', transfer.operation_id);
    _setTransVal('transferDate', formatDateForInput(transfer.transfer_date));
    _setTransVal('transferNotes', transfer.notes);

    // ✅ تعبئة الغرض
    setTimeout(function() {
        if (transfer.purpose) _setTransVal('transferPurpose', transfer.purpose);
    }, 100);
}

function resetTransferForm() {
    var ids = ['transferId', 'transferFromType', 'transferToType', 'transferFromEntity',
               'transferToEntity', 'transferAmount', 'transferOperation', 'transferNotes',
               'transferTransactionCategory', 'transferPurpose'];

    ids.forEach(function(id) {
        _setTransVal(id, '');
    });

    _setTransVal('transferDate', getTodayDate());

    var fromEntityRow = document.getElementById('transferFromEntityRow');
    if (fromEntityRow) fromEntityRow.style.display = 'none';

    var toEntityRow = document.getElementById('transferToEntityRow');
    if (toEntityRow) toEntityRow.style.display = 'none';

    var purposeRow = document.getElementById('transferPurposeRow');
    if (purposeRow) purposeRow.style.display = 'none';

    var summary = document.getElementById('transferSummary');
    if (summary) summary.style.display = 'none';
}

// ============================================================
// 10. COLLECT FORM DATA (✅ إضافة purpose)
// ============================================================

function collectTransferFormData() {
    var fromType = _getTransVal('transferFromType');
    var toType = _getTransVal('transferToType');
    var fromEntity = _getTransVal('transferFromEntity');
    var toEntity = _getTransVal('transferToEntity');

    var clientId = null, investorId = null;

    if (fromType === 'client') clientId = fromEntity;
    else if (toType === 'client') clientId = toEntity;
    else if (fromType === 'investor') investorId = fromEntity;
    else if (toType === 'investor') investorId = toEntity;

    return {
        id: _getTransVal('transferId'),
        fromType: fromType,
        toType: toType,
        clientId: clientId,
        investorId: investorId,
        operationId: _getTransVal('transferOperation'),
        amount: _getTransVal('transferAmount'),
        transferDate: _getTransVal('transferDate'),
        notes: _getTransVal('transferNotes').trim(),
        transactionCategory: _getTransVal('transferTransactionCategory'),
        purpose: _getTransVal('transferPurpose')  // ✅ جديد
    };
}

// ============================================================
// 11. VALIDATION (✅ تحسين)
// ============================================================

async function validateTransferForm(formData) {
    if (isEmpty(formData.fromType) || isEmpty(formData.toType)) {
        showToast('❌ مصدر ووجهة الأموال مطلوبان', 'error');
        return false;
    }

    if (formData.fromType === formData.toType) {
        showToast('❌ لا يمكن التحويل من وإلى نفس الطرف', 'error');
        return false;
    }

    var flow = TRANSFER_FLOW_MAP[formData.fromType + '_to_' + formData.toType];
    if (!flow) {
        showToast('❌ هذا النوع من التحويل غير مسموح', 'error');
        return false;
    }

    // التحقق من اختيار الكيان
    if ((formData.fromType === 'client' || formData.fromType === 'investor') && !formData.clientId && !formData.investorId) {
        showToast('❌ يجب اختيار الطرف المصدر', 'error');
        return false;
    }

    if ((formData.toType === 'client' || formData.toType === 'investor') && !formData.clientId && !formData.investorId) {
        showToast('❌ يجب اختيار الطرف المستلم', 'error');
        return false;
    }

    if (!isPositiveNumber(formData.amount)) {
        showToast('❌ المبلغ يجب أن يكون أكبر من صفر', 'error');
        return false;
    }

    if (isEmpty(formData.transferDate)) {
        showToast('❌ التاريخ مطلوب', 'error');
        return false;
    }

    // ✅ التحقق من الغرض إذا كان مطلوباً
    if (flow.purpose_options.length > 1 && isEmpty(formData.purpose)) {
        showToast('❌ يرجى اختيار الغرض', 'error');
        return false;
    }

    // ✅ التحقق من العملية المرتبطة
    if (formData.operationId) {
        try {
            var opCheck = await runQuery(function() {
                return APP.supabase.from('operations')
                    .select('id, is_locked, status')
                    .eq('id', formData.operationId)
                    .single();
            }, { context: 'validateTransferForm-opCheck', throwError: false });

            if (opCheck.data) {
                if (opCheck.data.is_locked) {
                    showToast('⚠️ العملية المرتبطة مقفلة. سيتم إنشاء التحويل لكن لن يؤثر على العملية.', 'warning');
                }
            }
        } catch (e) {
            debug('⚠️ تعذر التحقق من العملية المرتبطة', 'warn');
        }
    }

    return true;
}

// ============================================================
// 12. SAVE TRANSFER (✅ استخدام purpose المختار + refresh الشاشات)
// ============================================================

async function saveTransfer() {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var formData = collectTransferFormData();

    if (!(await validateTransferForm(formData))) return;

    var flow = TRANSFER_FLOW_MAP[formData.fromType + '_to_' + formData.toType];

    // ✅ استخدام الغرض المختار بدلاً من أول خيار
    var selectedPurpose = formData.purpose || flow.purpose_options[0];

    var data = {
        type: flow.transfer_type,
        purpose: selectedPurpose,
        operation_id: formData.operationId || null,
        client_id: formData.clientId || null,
        investor_id: formData.investorId || null,
        amount: parseFloat(formData.amount),
        transfer_date: formData.transferDate,
        notes: formData.notes || null,
        party_type: flow.party_type,
        transaction_category: formData.transactionCategory || flow.transaction_category
    };

    showLoading();

    try {
        if (formData.id) {
            // تحديث
            var oldResult = await runQuery(function() {
                return APP.supabase.from('transfers').select('*').eq('id', formData.id).single();
            }, { context: 'saveTransfer-getOld', throwError: true });

            await runQuery(function() {
                return APP.supabase.from('transfers').update(data).eq('id', formData.id);
            }, { context: 'saveTransfer-update', throwError: true });

            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB('تعديل تحويل', 'transfer', formData.id,
                    JSON.stringify(oldResult.data), JSON.stringify(data),
                    'From: ' + formData.fromType + ' → To: ' + formData.toType, 'update');
            }

            showToast('✅ تم تحديث التحويل', 'success');
        } else {
            // إضافة
            var result = await runQuery(function() {
                return APP.supabase.from('transfers').insert(data).select();
            }, { context: 'saveTransfer-insert', throwError: true });

            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB('إضافة تحويل', 'transfer', result.data[0].id,
                        null, JSON.stringify(data),
                        'From: ' + formData.fromType + ' → To: ' + formData.toType, 'create');
                }

                showToast('✅ تم إضافة التحويل', 'success');
            }
        }

        closeModal('transferModal');
        clearTransfersListCache();
        loadTransfers();

        // ✅ تحديث الشاشات المرتبطة
        refreshRelatedScreens(data.operation_id);

    } catch (err) {
        debug('❌ خطأ في saveTransfer: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ التحويل'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 13. DELETE TRANSFER (✅ تحسين التحذيرات)
// ============================================================

async function deleteTransfer(transferId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var transfer = TRANSFERS_STATE.records.find(function(t) { return t.id === transferId; });
    if (!transfer) {
        showToast('❌ التحويل غير موجود', 'error');
        return;
    }

    // ✅ تحذير محسّن حسب نوع التحويل
    var warningMsg = '';

    if (WORKFLOW_TRANSFER_PURPOSES.indexOf(transfer.purpose) !== -1) {
        warningMsg = '⚠️ تحذير: هذا التحويل مرتبط بسير العمل وحذفه قد يؤثر على:\n';
        warningMsg += '• أرصدة العملاء/الممولين\n';
        warningMsg += '• حالة تمويل العملية\n';
        warningMsg += '• التقارير والـ Dashboard\n\n';
        warningMsg += 'هل أنت متأكد من الحذف؟';
    } else if (transfer.operation_id) {
        warningMsg = '⚠️ هذا التحويل مرتبط بعملية. حذفه سيؤثر على حالة التمويل.\n\nهل أنت متأكد؟';
    } else {
        warningMsg = 'هل أنت متأكد من حذف هذا التحويل؟';
    }

    if (!confirmAction(warningMsg)) return;

    showLoading();

    try {
        var oldResult = await runQuery(function() {
            return APP.supabase.from('transfers').select('*').eq('id', transferId).single();
        }, { context: 'deleteTransfer-getOld', throwError: true });

        await runQuery(function() {
            return APP.supabase.from('transfers').delete().eq('id', transferId);
        }, { context: 'deleteTransfer-delete', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('حذف تحويل', 'transfer', transferId,
                JSON.stringify(oldResult.data), null,
                'Amount: ' + (oldResult.data ? oldResult.data.amount : ''), 'delete');
        }

        showToast('✅ تم حذف التحويل', 'success');
        clearTransfersListCache();
        loadTransfers();

        // ✅ تحديث الشاشات المرتبطة
        refreshRelatedScreens(transfer.operation_id);

    } catch (err) {
        showToast(handleSupabaseError(err, 'حذف التحويل'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 14. REFRESH RELATED SCREENS (✅ جديد)
// ============================================================

function refreshRelatedScreens(operationId) {
    debug('🔄 تحديث الشاشات المرتبطة...', 'info');

    // تحديث Operations (حالة التمويل)
    if (operationId && typeof loadOpInvestorsTab === 'function') {
        loadOpInvestorsTab(operationId);
        debug('✅ تم تحديث تبويب ممولي العملية', 'success');
    }

    // تحديث Dashboard
    if (typeof loadDashboard === 'function' && APP.currentScreen === 'dashboard') {
        loadDashboard();
        debug('✅ تم تحديث Dashboard', 'success');
    }

    // تحديث Clients/Investors إذا كانت الشاشات مفتوحة
    if (typeof loadClients === 'function' && APP.currentScreen === 'clients') {
        loadClients();
    }

    if (typeof loadInvestors === 'function' && APP.currentScreen === 'investors') {
        loadInvestors();
    }
}

// ============================================================
// 15. SEARCH & FILTER
// ============================================================

function searchTransfers(searchTerm) {
    TRANSFERS_STATE.search = searchTerm || '';
    loadTransfers();
}

function filterTransfers(filterValue) {
    TRANSFERS_STATE.filter = filterValue || '';
    loadTransfers();
}

// ============================================================
// 16. CACHE MANAGEMENT
// ============================================================

function clearTransfersReferenceCache() {
    TRANSFERS_STATE.referenceCache.clients = null;
    TRANSFERS_STATE.referenceCache.investors = null;
    TRANSFERS_STATE.referenceCache.operations = null;
}

function clearTransfersListCache() {
    TRANSFERS_STATE.listCache.records = null;
    TRANSFERS_STATE.listCache.lastLoad = null;
}

// ============================================================
// 17. HELPER FUNCTIONS
// ============================================================

function _getTransVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function _setTransVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = (value !== null && value !== undefined) ? value : '';
}

// ============================================================
// 18. INIT
// ============================================================

if (typeof document !== 'undefined') {
    initTransfers();
}
