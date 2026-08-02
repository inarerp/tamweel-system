// ============================================================
// نظام إدارة التمويل - Transfers Module (Parties Ledger)
// Version: 3.1.0
// Last Updated: 2026-08-03
// ============================================================
//
// المسؤوليات:
// - initTransfers() - تسجيل الدالة في Registry
// - loadTransfers() - تحميل قائمة التحويلات (Parties Ledger)
// - openTransferModal() - Modal إضافة/تعديل تحويل
// - saveTransfer() - حفظ التحويل
// - deleteTransfer() - حذف التحويل
// - Transfer Type Logic (من → إلى)
// - Validate قبل الحفظ
// - Render (قائمة + Modal)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
// - auth.js (canEdit, canViewProfits, isAdmin, etc.)
// - calculations.js (calculateClientSummary, calculateInvestorSummary)
// - activity.js (window.logActivityToDB)
// - app.js (showScreen)
//
// ملاحظة: لا يحتوي على DOMContentLoaded (app.js هو Bootstrap)
// ============================================================


// ============================================================
// 1. STATE
// ============================================================

var TRANSFERS_STATE = {
    search: '',
    filter: '',
    records: [],
    
    referenceCache: {
        clients: null,
        investors: null,
        operations: null
    },
    listCache: {
        lastLoad: null,
        records: null
    }
};


// ============================================================
// 2. CONSTANTS - خريطة أنواع التحويلات
// ============================================================

/**
 * خريطة التحويلات المسموحة (من → إلى)
 * تحدد:
 * - party_type (من هو الطرف الرئيسي)
 * - transaction_category (نوع المعاملة تلقائياً)
 * - transfer_type (النوع القديم للتوافق)
 */
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
    'investor_to_company': {
        party_type: 'investor',
        transaction_category: 'investor_capital_in',
        transfer_type: 'company_to_investor',
        purpose_options: ['client_funding', 'settlement', 'other'],
        label: 'إيداع من ممول'
    }
});

/**
 * أنواع التحويلات المرتبطة بـ Workflow (محمية من الحذف)
 */
var WORKFLOW_TRANSFER_PURPOSES = Object.freeze([
    'client_repayment',
    'capital_return',
    'profit_distribution'
]);

/**
 * أسماء الغرض بالعربية
 */
var PURPOSE_TEXT_AR = Object.freeze({
    client_funding: 'تمويل',
    client_repayment: 'سداد',
    capital_return: 'إرجاع رأس مال',
    profit_distribution: 'توزيع أرباح',
    settlement: 'تسوية',
    additional_funding: 'تمويل إضافي',
    other: 'أخرى'
});


// ============================================================
// 3. INITIALIZATION
// ============================================================

function initTransfers() {
    debug('💸 بدء تهيئة transfers.js', 'info');
    registerScreenLoader('transfers', loadTransfers);
    debug('✅ transfers.js جاهز', 'success');
}


// ============================================================
// 4. MAIN LOADER (Parties Ledger)
// ============================================================

async function loadTransfers() {
    debug('💸 بدأ loadTransfers', 'info');
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    showLoading();
    
    try {
        var results = await Promise.all([
            runQuery(
                function() {
                    var query = APP.supabase
                        .from('transfers')
                        .select('id, reference_number, type, purpose, operation_id, client_id, investor_id, amount, transfer_date, notes, party_type, transaction_category, is_archived, created_at')
                        .order('transfer_date', { ascending: false });
                    
                    if (TRANSFERS_STATE.filter) {
                        query = query.eq('party_type', TRANSFERS_STATE.filter);
                    }
                    
                    if (TRANSFERS_STATE.search) {
                        var searchTerm = '%' + TRANSFERS_STATE.search + '%';
                        query = query.or(
                            'reference_number.ilike.' + searchTerm + 
                            ',notes.ilike.' + searchTerm
                        );
                    }
                    
                    return query;
                },
                { context: 'loadTransfers-trans', throwError: true }
            ),
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
            if (t.client_id && indexes.clientsById[t.client_id]) {
                t.client = indexes.clientsById[t.client_id];
            } else if (t.operation_id && indexes.operationsById[t.operation_id]) {
                var op = indexes.operationsById[t.operation_id];
                t.client = op.client_id ? indexes.clientsById[op.client_id] : null;
            } else {
                t.client = null;
            }
            
            t.investor = t.investor_id ? indexes.investorsById[t.investor_id] : null;
            t.operation = t.operation_id ? indexes.operationsById[t.operation_id] : null;
        });
        
        TRANSFERS_STATE.records = transfers;
        TRANSFERS_STATE.listCache.records = transfers;
        TRANSFERS_STATE.listCache.lastLoad = Date.now();
        
        debug('✅ تم تحميل ' + TRANSFERS_STATE.records.length + ' تحويل', 'success');
        
        renderTransfersList();
        
    } catch (err) {
        debug('❌ خطأ في loadTransfers: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل التحويلات'), 'error');
    } finally {
        hideLoading();
    }
}

async function loadClientsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.clients) {
        return TRANSFERS_STATE.referenceCache.clients;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('clients')
                    .select('id, name, is_archived')
                    .order('name');
            },
            { context: 'loadClientsForTransfers', throwError: true }
        );
        
        TRANSFERS_STATE.referenceCache.clients = result.data || [];
        return TRANSFERS_STATE.referenceCache.clients;
        
    } catch (err) {
        debug('❌ خطأ في loadClientsForTransfers: ' + err.message, 'error');
        return [];
    }
}

async function loadInvestorsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.investors) {
        return TRANSFERS_STATE.referenceCache.investors;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('investors')
                    .select('id, name, is_archived')
                    .order('name');
            },
            { context: 'loadInvestorsForTransfers', throwError: true }
        );
        
        TRANSFERS_STATE.referenceCache.investors = result.data || [];
        return TRANSFERS_STATE.referenceCache.investors;
        
    } catch (err) {
        debug('❌ خطأ في loadInvestorsForTransfers: ' + err.message, 'error');
        return [];
    }
}

async function loadOperationsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.operations) {
        return TRANSFERS_STATE.referenceCache.operations;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('operations')
                    .select('id, name, client_id, amount, status, is_locked, is_archived')
                    .order('name');
            },
            { context: 'loadOperationsForTransfers', throwError: true }
        );
        
        TRANSFERS_STATE.referenceCache.operations = result.data || [];
        return TRANSFERS_STATE.referenceCache.operations;
        
    } catch (err) {
        debug('❌ خطأ في loadOperationsForTransfers: ' + err.message, 'error');
        return [];
    }
}

function buildTransfersIndexes(clients, investors, operations) {
    var clientsById = {};
    var investorsById = {};
    var operationsById = {};
    
    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });
    operations.forEach(function(op) { operationsById[op.id] = op; });
    
    return {
        clientsById: clientsById,
        investorsById: investorsById,
        operationsById: operationsById
    };
}


// ============================================================
// 5. RENDER TRANSFERS LIST
// ============================================================

function renderTransfersList() {
    var container = document.getElementById('transfersTable');
    if (!container) {
        debug('⚠️ transfersTable غير موجود', 'warning');
        return;
    }
    
    if (TRANSFERS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد تحويلات</div>';
        return;
    }
    
    var html = '<table>';
    html += '<thead><tr>';
    html += '<th>الرقم</th>';
    html += '<th>التاريخ</th>';
    html += '<th>من</th>';
    html += '<th>إلى</th>';
    html += '<th>الغرض</th>';
    html += '<th>المبلغ</th>';
    html += '<th>ملاحظات</th>';
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    TRANSFERS_STATE.records.forEach(function(t) {
        var fromText = '';
        var toText = '';
        
        if (t.type === 'company_to_client') {
            fromText = 'الشركة';
            toText = t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : '-';
        } else if (t.type === 'client_to_company') {
            fromText = t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : '-';
            toText = 'الشركة';
        } else if (t.type === 'company_to_investor') {
            fromText = 'الشركة';
            toText = t.investor ? '<a href="#" data-action="openInvestorFile" data-param="' + t.investor.id + '">' + escapeHtml(t.investor.name) + '</a>' : '-';
        }
        
        var purposeText = PURPOSE_TEXT_AR[t.purpose] || t.purpose || '-';
        
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(t.reference_number || '-') + '</strong></td>';
        html += '<td>' + formatDate(t.transfer_date) + '</td>';
        html += '<td>' + fromText + '</td>';
        html += '<td>' + toText + '</td>';
        html += '<td>' + purposeText + '</td>';
        html += '<td>' + formatMoney(t.amount) + '</td>';
        html += '<td>' + escapeHtml(truncateText(t.notes, 30)) + '</td>';
        
        if (canEdit()) {
            html += '<td class="actions-cell">';
            html += '<button class="btn btn-secondary btn-sm" data-action="editTransfer" data-param="' + t.id + '">تعديل</button>';
            html += '<button class="btn btn-danger btn-sm" data-action="deleteTransfer" data-param="' + t.id + '">حذف</button>';
            html += '</td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    container.innerHTML = html;
}


// ============================================================
// 6. TRANSFER MODAL LOGIC
// ============================================================

/**
 * فتح Modal إضافة/تعديل تحويل
 */
async function openTransferModal(transferId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var titleEl = document.getElementById('transferModalTitle');
    var idEl = document.getElementById('transferId');
    
    if (!titleEl || !idEl) {
        debug('️ عناصر Modal غير موجودة', 'warning');
        return;
    }
    
    await Promise.all([
        loadClientsForTransfers(),
        loadInvestorsForTransfers(),
        loadOperationsForTransfers()
    ]);
    
    populateFromTypeSelect();
    populateToTypeSelect();
    populateOperationsSelect();
    
    resetTransferForm();
    
    if (transferId) {
        try {
            var result = await runQuery(
                function() {
                    return APP.supabase
                        .from('transfers')
                        .select('*')
                        .eq('id', transferId)
                        .single();
                },
                { context: 'openTransferModal', throwError: true }
            );
            
            var transfer = result.data;
            if (!transfer) {
                showToast('التحويل غير موجود', 'error');
                return;
            }
            
            populateTransferForm(transfer, 'تعديل تحويل');
            
        } catch (err) {
            debug('❌ خطأ في openTransferModal: ' + err.message, 'error');
            showToast(handleSupabaseError(err, 'فتح بيانات التحويل'), 'error');
            return;
        }
    } else {
        titleEl.textContent = 'إضافة تحويل';
    }
    
    var warningEl = document.getElementById('transferValidationWarning');
    if (warningEl) warningEl.innerHTML = '';
    
    openModal('transferModal');
}

/**
 * تعديل تحويل (من القائمة)
 */
function editTransfer(transferId) {
    openTransferModal(transferId);
}

/**
 * تعبئة قائمة "من"
 */
function populateFromTypeSelect() {
    var selectEl = document.getElementById('transferFromType');
    if (!selectEl) {
        console.error('❌ عنصر transferFromType غير موجود في HTML');
        return;
    }
    
    selectEl.innerHTML = '<option value="">-- اختر المصدر --</option>' +
        '<option value="company">الشركة</option>' +
        '<option value="client">عميل</option>' +
        '<option value="investor">ممول</option>';
}

/**
 * تعبئة قائمة "إلى"
 */
function populateToTypeSelect() {
    var selectEl = document.getElementById('transferToType');
    if (!selectEl) {
        console.error('❌ عنصر transferToType غير موجود في HTML');
        return;
    }
    
    selectEl.innerHTML = '<option value="">-- اختر المستلم --</option>' +
        '<option value="company">الشركة</option>' +
        '<option value="client">عميل</option>' +
        '<option value="investor">ممول</option>';
}

/**
 * تعبئة قائمة العمليات
 */
function populateOperationsSelect() {
    var selectEl = document.getElementById('transferOperation');
    if (!selectEl) {
        console.error('❌ عنصر transferOperation غير موجود في HTML');
        return;
    }
    
    if (!TRANSFERS_STATE.referenceCache.operations) return;
    
    var options = '<option value="">-- بدون عملية --</option>';
    TRANSFERS_STATE.referenceCache.operations.forEach(function(op) {
        if (!op.is_archived) {
            options += '<option value="' + op.id + '">' + escapeHtml(op.name) + '</option>';
        }
    });
    selectEl.innerHTML = options;
}

/**
 * تعبئة قائمة الأطراف الديناميكية
 */
function populateEntitySelect(type, selectedId) {
    var entities = [];
    var label = '';
    
    if (type === 'client') {
        entities = TRANSFERS_STATE.referenceCache.clients || [];
        label = 'اختر العميل *';
    } else if (type === 'investor') {
        entities = TRANSFERS_STATE.referenceCache.investors || [];
        label = 'اختر الممول *';
    }
    
    var options = '<option value="">-- اختر --</option>';
    entities.forEach(function(e) {
        if (!e.is_archived) {
            var selected = e.id === selectedId ? ' selected' : '';
            options += '<option value="' + e.id + '"' + selected + '>' + escapeHtml(e.name) + '</option>';
        }
    });
    
    return { options: options, label: label };
}

/**
 * تحديث الحقول الديناميكية عند تغيير "من" أو "إلى"
 * ✅ مع Null Checks
 */
function updateTransferFields() {
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    
    if (!fromTypeEl || !toTypeEl) {
        console.error('❌ عناصر transferFromType أو transferToType غير موجودة');
        return;
    }
    
    var fromType = fromTypeEl.value;
    var toType = toTypeEl.value;
    
    var fromEntityRow = document.getElementById('transferFromEntityRow');
    var toEntityRow = document.getElementById('transferToEntityRow');
    var fromEntitySelect = document.getElementById('transferFromEntity');
    var toEntitySelect = document.getElementById('transferToEntity');
    var fromEntityLabel = document.getElementById('transferFromEntityLabel');
    var toEntityLabel = document.getElementById('transferToEntityLabel');
    
    if (fromEntityRow) fromEntityRow.style.display = 'none';
    if (toEntityRow) toEntityRow.style.display = 'none';
    if (fromEntitySelect) fromEntitySelect.value = '';
    if (toEntitySelect) toEntitySelect.value = '';
    
    if (fromType && fromType !== 'company') {
        var fromData = populateEntitySelect(fromType);
        if (fromEntityLabel) fromEntityLabel.textContent = fromData.label;
        if (fromEntitySelect) fromEntitySelect.innerHTML = fromData.options;
        if (fromEntityRow) fromEntityRow.style.display = 'block';
    }
    
    if (toType && toType !== 'company') {
        var toData = populateEntitySelect(toType);
        if (toEntityLabel) toEntityLabel.textContent = toData.label;
        if (toEntitySelect) toEntitySelect.innerHTML = toData.options;
        if (toEntityRow) toEntityRow.style.display = 'block';
    }
    
    updateTransferSummary(fromType, toType);
    
    var fromPartyEl = document.getElementById('transferFromParty');
    var toPartyEl = document.getElementById('transferToParty');
    if (fromPartyEl) fromPartyEl.value = fromType;
    if (toPartyEl) toPartyEl.value = toType;
}

/**
 * تحديث ملخص التحويل
 * ✅ مع Null Checks
 */
function updateTransferSummary(fromType, toType) {
    var summaryEl = document.getElementById('transferSummary');
    var summaryFrom = document.getElementById('summaryFrom');
    var summaryTo = document.getElementById('summaryTo');
    var summaryCategory = document.getElementById('summaryCategory');
    
    if (!fromType || !toType) {
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }
    
    var flowKey = fromType + '_to_' + toType;
    var flow = TRANSFER_FLOW_MAP[flowKey];
    
    if (!flow) {
        if (summaryEl) summaryEl.style.display = 'none';
        return;
    }
    
    var fromText = fromType === 'company' ? 'الشركة' : (fromType === 'client' ? 'عميل' : 'ممول');
    var toText = toType === 'company' ? 'الشركة' : (toType === 'client' ? 'عميل' : 'ممول');
    
    if (summaryFrom) summaryFrom.textContent = fromText;
    if (summaryTo) summaryTo.textContent = toText;
    if (summaryCategory) summaryCategory.textContent = flow.label;
    
    if (summaryEl) summaryEl.style.display = 'block';
    
    var categoryEl = document.getElementById('transferTransactionCategory');
    if (categoryEl) categoryEl.value = flow.transaction_category;
}

/**
 * تعبئة نموذج التحويل (للتعديل)
 * ✅ مع Null Checks
 */
function populateTransferForm(transfer, title) {
    var titleEl = document.getElementById('transferModalTitle');
    if (titleEl) titleEl.textContent = title;
    
    var fromType = 'company';
    var toType = 'company';
    
    if (transfer.type === 'company_to_client') {
        fromType = 'company';
        toType = 'client';
    } else if (transfer.type === 'client_to_company') {
        fromType = 'client';
        toType = 'company';
    } else if (transfer.type === 'company_to_investor') {
        fromType = 'company';
        toType = 'investor';
    }
    
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    if (fromTypeEl) fromTypeEl.value = fromType;
    if (toTypeEl) toTypeEl.value = toType;
    
    updateTransferFields();
    
    if (transfer.client_id) {
        if (fromType === 'client') {
            var fromEntity = document.getElementById('transferFromEntity');
            if (fromEntity) fromEntity.value = transfer.client_id;
        } else if (toType === 'client') {
            var toEntity = document.getElementById('transferToEntity');
            if (toEntity) toEntity.value = transfer.client_id;
        }
    }
    
    if (transfer.investor_id) {
        if (fromType === 'investor') {
            var fromEntity = document.getElementById('transferFromEntity');
            if (fromEntity) fromEntity.value = transfer.investor_id;
        } else if (toType === 'investor') {
            var toEntity = document.getElementById('transferToEntity');
            if (toEntity) toEntity.value = transfer.investor_id;
        }
    }
    
    var amountEl = document.getElementById('transferAmount');
    if (amountEl) amountEl.value = transfer.amount || '';
    
    var opEl = document.getElementById('transferOperation');
    if (opEl) opEl.value = transfer.operation_id || '';
    
    var dateEl = document.getElementById('transferDate');
    if (dateEl) dateEl.value = formatDateForInput(transfer.transfer_date);
    
    var notesEl = document.getElementById('transferNotes');
    if (notesEl) notesEl.value = transfer.notes || '';
}

/**
 * تفريغ نموذج التحويل
 * ✅ مع Null Checks لمنع الأخطاء
 */
function resetTransferForm() {
    var ids = [
        'transferId',
        'transferFromType',
        'transferToType',
        'transferFromEntity',
        'transferToEntity',
        'transferAmount',
        'transferOperation',
        'transferNotes',
        'transferTransactionCategory'
    ];
    
    ids.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) {
            el.value = '';
        } else {
            console.error('❌ عنصر غير موجود: ' + id);
        }
    });
    
    var dateEl = document.getElementById('transferDate');
    if (dateEl) {
        dateEl.value = getTodayDate();
    } else {
        console.error('❌ عنصر transferDate غير موجود');
    }
    
    var fromEntityRow = document.getElementById('transferFromEntityRow');
    if (fromEntityRow) fromEntityRow.style.display = 'none';
    
    var toEntityRow = document.getElementById('transferToEntityRow');
    if (toEntityRow) toEntityRow.style.display = 'none';
    
    var summary = document.getElementById('transferSummary');
    if (summary) summary.style.display = 'none';
}


// ============================================================
// 7. VALIDATION
// ============================================================

function collectTransferFormData() {
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    var fromEntityEl = document.getElementById('transferFromEntity');
    var toEntityEl = document.getElementById('transferToEntity');
    var amountEl = document.getElementById('transferAmount');
    var opEl = document.getElementById('transferOperation');
    var dateEl = document.getElementById('transferDate');
    var notesEl = document.getElementById('transferNotes');
    var categoryEl = document.getElementById('transferTransactionCategory');
    
    var fromType = fromTypeEl ? fromTypeEl.value : '';
    var toType = toTypeEl ? toTypeEl.value : '';
    var fromEntity = fromEntityEl ? fromEntityEl.value : '';
    var toEntity = toEntityEl ? toEntityEl.value : '';
    
    var clientId = null;
    var investorId = null;
    
    if (fromType === 'client') clientId = fromEntity;
    else if (toType === 'client') clientId = toEntity;
    else if (fromType === 'investor') investorId = fromEntity;
    else if (toType === 'investor') investorId = toEntity;
    
    return {
        id: document.getElementById('transferId') ? document.getElementById('transferId').value : '',
        fromType: fromType,
        toType: toType,
        clientId: clientId,
        investorId: investorId,
        operationId: opEl ? opEl.value : '',
        amount: amountEl ? amountEl.value : '',
        transferDate: dateEl ? dateEl.value : '',
        notes: notesEl ? notesEl.value.trim() : '',
        transactionCategory: categoryEl ? categoryEl.value : ''
    };
}

async function validateTransferForm(formData) {
    if (isEmpty(formData.fromType)) {
        showToast('❌ مصدر الأموال مطلوب', 'error');
        return false;
    }
    
    if (isEmpty(formData.toType)) {
        showToast('❌ الجهة المستلمة مطلوبة', 'error');
        return false;
    }
    
    if (formData.fromType === formData.toType) {
        showToast('❌ لا يمكن التحويل من وإلى نفس الطرف', 'error');
        return false;
    }
    
    var flowKey = formData.fromType + '_to_' + formData.toType;
    var flow = TRANSFER_FLOW_MAP[flowKey];
    
    if (!flow) {
        showToast('❌ هذا النوع من التحويل غير مسموح', 'error');
        return false;
    }
    
    if ((formData.fromType === 'client' || formData.fromType === 'investor') && isEmpty(formData.clientId || formData.investorId)) {
        showToast('❌ يجب اختيار الطرف المصدر', 'error');
        return false;
    }
    
    if ((formData.toType === 'client' || formData.toType === 'investor') && isEmpty(formData.clientId || formData.investorId)) {
        showToast(' يجب اختيار الطرف المستلم', 'error');
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
    
    return true;
}


// ============================================================
// 8. SAVE TRANSFER
// ============================================================

async function saveTransfer() {
    if (!canEdit()) {
        showToast(' لا توجد صلاحية', 'error');
        return;
    }
    
    var formData = collectTransferFormData();
    
    var isValid = await validateTransferForm(formData);
    if (!isValid) {
        return;
    }
    
    var flowKey = formData.fromType + '_to_' + formData.toType;
    var flow = TRANSFER_FLOW_MAP[flowKey];
    
    var data = {
        type: flow.transfer_type,
        purpose: flow.purpose_options[0],
        operation_id: formData.operationId || null,
        client_id: formData.clientId || null,
        investor_id: formData.investorId || null,
        amount: parseFloat(formData.amount),
        transfer_date: formData.transferDate,
        notes: formData.notes || null,
        party_type: flow.party_type,
        transaction_category: flow.transaction_category
    };
    
    showLoading();
    
    try {
        if (formData.id) {
            var oldResult = await runQuery(
                function() {
                    return APP.supabase.from('transfers').select('*').eq('id', formData.id).single();
                },
                { context: 'saveTransfer-getOld', throwError: true }
            );
            
            await runQuery(
                function() {
                    return APP.supabase.from('transfers').update(data).eq('id', formData.id);
                },
                { context: 'saveTransfer-update', throwError: true }
            );
            
            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB(
                    'تعديل تحويل', 'transfer', formData.id,
                    JSON.stringify(oldResult.data), JSON.stringify(data),
                    'From: ' + formData.fromType + ' → To: ' + formData.toType + ', Amount: ' + data.amount, 'update'
                );
            }
            
            debug('✅ تم تحديث التحويل', 'success');
            showToast('تم تحديث التحويل', 'success');
            
        } else {
            var result = await runQuery(
                function() {
                    return APP.supabase.from('transfers').insert(data).select();
                },
                { context: 'saveTransfer-insert', throwError: true }
            );
            
            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB(
                        'إضافة تحويل', 'transfer', result.data[0].id,
                        null, JSON.stringify(data),
                        'From: ' + formData.fromType + ' → To: ' + formData.toType + ', Amount: ' + data.amount + ', Ref: ' + (result.data[0].reference_number || ''),
                        'create'
                    );
                }
                
                debug('✅ تم إضافة التحويل', 'success');
                showToast('تم إضافة التحويل', 'success');
            }
        }
        
        closeModal('transferModal');
        clearTransfersListCache();
        loadTransfers();
        
    } catch (err) {
        debug('❌ خطأ في saveTransfer: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ التحويل'), 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 9. DELETE TRANSFER
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
    
    if (WORKFLOW_TRANSFER_PURPOSES.indexOf(transfer.purpose) !== -1) {
        var warningMessage = '⚠️ تحذير:\n\n' +
            'هذا التحويل مرتبط بسير العمل:\n' +
            '• الغرض: ' + (PURPOSE_TEXT_AR[transfer.purpose] || transfer.purpose) + '\n' +
            '• المبلغ: ' + formatMoney(transfer.amount) + '\n\n' +
            'حذف هذا التحويل قد يؤثر على:\n' +
            '• أرصدة العملاء/الممولين\n' +
            '• حسابات العمليات\n' +
            '• التقارير المالية\n\n' +
            'هل أنت متأكد من الحذف؟';
        
        if (!confirmAction(warningMessage)) {
            return;
        }
    } else {
        if (!confirmDelete('هذا التحويل')) {
            return;
        }
    }
    
    showLoading();
    
    try {
        var oldResult = await runQuery(
            function() {
                return APP.supabase.from('transfers').select('*').eq('id', transferId).single();
            },
            { context: 'deleteTransfer-getOld', throwError: true }
        );
        
        await runQuery(
            function() {
                return APP.supabase.from('transfers').delete().eq('id', transferId);
            },
            { context: 'deleteTransfer-delete', throwError: true }
        );
        
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                'حذف تحويل', 'transfer', transferId,
                JSON.stringify(oldResult.data), null,
                'Amount: ' + (oldResult.data ? oldResult.data.amount : ''), 'delete'
            );
        }
        
        debug('✅ تم حذف التحويل', 'success');
        showToast('تم حذف التحويل', 'success');
        
        clearTransfersListCache();
        loadTransfers();
        
    } catch (err) {
        debug('❌ خطأ في deleteTransfer: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حذف التحويل'), 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 10. CACHE MANAGEMENT
// ============================================================

function clearTransfersReferenceCache() {
    TRANSFERS_STATE.referenceCache.clients = null;
    TRANSFERS_STATE.referenceCache.investors = null;
    TRANSFERS_STATE.referenceCache.operations = null;
    debug('🗑️ تم مسح Reference Cache للتحويلات', 'info');
}

function clearTransfersListCache() {
    TRANSFERS_STATE.listCache.records = null;
    TRANSFERS_STATE.listCache.lastLoad = null;
    debug('🗑️ تم مسح List Cache للتحويلات', 'info');
}

function clearAllTransfersCache() {
    clearTransfersReferenceCache();
    clearTransfersListCache();
    debug('🗑️ تم مسح كل Cache للتحويلات', 'info');
}


// ============================================================
// 11. SEARCH & FILTER
// ============================================================

function searchTransfers(searchTerm) {
    TRANSFERS_STATE.search = searchTerm;
    loadTransfers();
}

function filterTransfers(filterValue) {
    TRANSFERS_STATE.filter = filterValue;
    loadTransfers();
}


// ============================================================
// END OF TRANSFERS.JS
// ============================================================
