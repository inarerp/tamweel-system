// ============================================================
// نظام إدارة التمويل - Transfers Module (Parties Ledger)
// Version: 2.0.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - initTransfers() - تسجيل الدالة في Registry
// - loadTransfers() - تحميل قائمة التحويلات (Parties Ledger)
// - openTransferModal() - Modal إضافة/تعديل تحويل
// - saveTransfer() - حفظ التحويل
// - deleteTransfer() - حذف التحويل (مع حماية Workflow)
// - toggleInvestorSelect() - إظهار/إخفاء حقل الممول
// - Validate قبل الحفظ (قوي + تحذيري)
// - Render (قائمة + Modal)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
// - auth.js (canEdit, canViewProfits, isAdmin, etc.)
// - calculations.js (calculateClientSummary, calculateInvestorSummary, calculateOperationSummary)
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
    
    // ✅ تحسين 8: فصل Cache إلى Reference و List
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
// 2. CONSTANTS - ✅ تحسين 4: خريطة ثابتة بدلاً من if/else
// ============================================================

/**
 * خريطة أنواع التحويلات إلى party_type و transaction_category
 * يسهل إضافة أنواع جديدة مستقبلاً
 */
var TRANSFER_CATEGORY_MAP = Object.freeze({
    company_to_client: {
        party_type: 'client',
        categories: {
            client_funding: 'client_deposit_in',
            client_repayment: 'client_use_out',
            settlement: 'client_adjust',
            additional_funding: 'client_deposit_in',
            other: 'client_adjust'
        }
    },
    client_to_company: {
        party_type: 'client',
        categories: {
            client_repayment: 'client_use_out',
            settlement: 'client_adjust',
            other: 'client_adjust'
        }
    },
    company_to_investor: {
        party_type: 'investor',
        categories: {
            capital_return: 'investor_return_out',
            profit_distribution: 'investor_profit_out',
            settlement: 'investor_return_out',
            other: 'investor_return_out'
        }
    }
});

/**
 * ✅ تحسين 6: أنواع التحويلات المرتبطة بـ Workflow (محمية من الحذف)
 */
var WORKFLOW_TRANSFER_PURPOSES = Object.freeze([
    'client_repayment',
    'capital_return',
    'profit_distribution'
]);


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
        // تحميل التحويلات بالتوازي مع البيانات المرجعية
        var results = await Promise.all([
            runQuery(
                function() {
                    var query = APP.supabase
                        .from('transfers')
                        .select('id, reference_number, type, purpose, operation_id, client_id, investor_id, amount, transfer_date, notes, party_type, transaction_category, is_archived, created_at')
                        .order('transfer_date', { ascending: false });
                    
                    // تطبيق الفلتر
                    if (TRANSFERS_STATE.filter) {
                        query = query.eq('party_type', TRANSFERS_STATE.filter);
                    }
                    
                    // تطبيق البحث
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
        
        // بناء Indexes
        var indexes = buildTransfersIndexes(clients, investors, operations);
        
        // ربط التحويلات بالبيانات المرجعية
        // ✅ تحسين 1: استخدام client_id مباشرة، ثم fallback إلى operation.client_id
        transfers.forEach(function(t) {
            // العميل: أولاً من client_id المباشر، ثم من العملية
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

/**
 * تحميل العملاء (مع Reference Cache)
 */
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

/**
 * تحميل الممولين (مع Reference Cache)
 */
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

/**
 * تحميل العمليات (مع Reference Cache)
 */
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

/**
 * بناء Indexes للتحويلات
 */
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
    html += '<th>النوع</th>';
    html += '<th>الغرض</th>';
    html += '<th>العميل</th>';
    html += '<th>الممول</th>';
    html += '<th>العملية</th>';
    html += '<th>المبلغ</th>';
    html += '<th>ملاحظات</th>';
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    TRANSFERS_STATE.records.forEach(function(t) {
        var clientName = t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : '-';
        var investorName = t.investor ? '<a href="#" data-action="openInvestorFile" data-param="' + t.investor.id + '">' + escapeHtml(t.investor.name) + '</a>' : '-';
        var operationName = t.operation ? '<a href="#" data-action="openOperationDetails" data-param="' + t.operation.id + '">' + escapeHtml(t.operation.name) + '</a>' : '-';
        
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(t.reference_number || '-') + '</strong></td>';
        html += '<td>' + formatDate(t.transfer_date) + '</td>';
        html += '<td>' + getTransferTypeText(t.type) + '</td>';
        html += '<td>' + getPurposeText(t.purpose) + '</td>';
        html += '<td>' + clientName + '</td>';
        html += '<td>' + investorName + '</td>';
        html += '<td>' + operationName + '</td>';
        html += '<td>' + formatMoney(t.amount) + '</td>';
        html += '<td>' + escapeHtml(truncateText(t.notes, 30)) + '</td>';
        
        if (canEdit()) {
            html += '<td class="actions-cell">';
            // ✅ تحسين 5: زر تعديل + زر حذف
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
// 6. TRANSFER MODAL
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
        debug('⚠️ عناصر Modal غير موجودة', 'warning');
        return;
    }
    
    // تحميل البيانات المرجعية
    await Promise.all([
        loadClientsForTransfers(),
        loadInvestorsForTransfers(),
        loadOperationsForTransfers()
    ]);
    
    // تعبئة قوائم الـ Select
    populateTransferSelects();
    
    if (transferId) {
        // تعديل
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
        // إضافة - تفريغ النموذج
        resetTransferForm();
    }
    
    // إخفاء التحذير
    var warningEl = document.getElementById('transferValidationWarning');
    if (warningEl) warningEl.innerHTML = '';
    
    openModal('transferModal');
    
    // استدعاء toggleInvestorSelect
    toggleInvestorSelect();
}

/**
 * تعديل تحويل (من القائمة)
 */
function editTransfer(transferId) {
    openTransferModal(transferId);
}

/**
 * تعبئة قوائم الـ Select
 */
function populateTransferSelects() {
    // قائمة العمليات (فقط غير المؤرشفة)
    var operationEl = document.getElementById('transferOperation');
    if (operationEl && TRANSFERS_STATE.referenceCache.operations) {
        var options = '<option value="">-- اختر العملية (اختياري) --</option>';
        TRANSFERS_STATE.referenceCache.operations.forEach(function(op) {
            if (!op.is_archived) {
                options += '<option value="' + op.id + '">' + escapeHtml(op.name) + '</option>';
            }
        });
        operationEl.innerHTML = options;
    }
    
    // قائمة الممولين (فقط غير المؤرشفين)
    var investorEl = document.getElementById('transferInvestorId');
    if (investorEl && TRANSFERS_STATE.referenceCache.investors) {
        var options = '<option value="">-- اختر الممول --</option>';
        TRANSFERS_STATE.referenceCache.investors.forEach(function(inv) {
            if (!inv.is_archived) {
                options += '<option value="' + inv.id + '">' + escapeHtml(inv.name) + '</option>';
            }
        });
        investorEl.innerHTML = options;
    }
}

/**
 * تعبئة نموذج التحويل
 */
function populateTransferForm(transfer, title) {
    document.getElementById('transferModalTitle').textContent = title;
    document.getElementById('transferId').value = transfer.id;
    document.getElementById('transferType').value = transfer.type || 'company_to_client';
    document.getElementById('transferPurpose').value = transfer.purpose || 'client_funding';
    document.getElementById('transferOperation').value = transfer.operation_id || '';
    document.getElementById('transferInvestorId').value = transfer.investor_id || '';
    document.getElementById('transferAmount').value = transfer.amount || '';
    document.getElementById('transferDate').value = formatDateForInput(transfer.transfer_date);
    document.getElementById('transferNotes').value = transfer.notes || '';
}

/**
 * تفريغ نموذج التحويل
 */
function resetTransferForm() {
    document.getElementById('transferModalTitle').textContent = 'إضافة تحويل';
    document.getElementById('transferId').value = '';
    document.getElementById('transferType').value = 'company_to_client';
    document.getElementById('transferPurpose').value = 'client_funding';
    document.getElementById('transferOperation').value = '';
    document.getElementById('transferInvestorId').value = '';
    document.getElementById('transferAmount').value = '';
    document.getElementById('transferDate').value = getTodayDate();
    document.getElementById('transferNotes').value = '';
}

/**
 * جمع بيانات نموذج التحويل
 */
function collectTransferFormData() {
    return {
        id: document.getElementById('transferId').value,
        type: document.getElementById('transferType').value,
        purpose: document.getElementById('transferPurpose').value,
        operationId: document.getElementById('transferOperation').value,
        investorId: document.getElementById('transferInvestorId').value,
        amount: document.getElementById('transferAmount').value,
        transferDate: document.getElementById('transferDate').value,
        notes: document.getElementById('transferNotes').value.trim()
    };
}


// ============================================================
// 7. VALIDATION - ✅ تحسين 3 + 7
// ============================================================

/**
 * التحقق من صحة نموذج التحويل (Hard Validation - يمنع الحفظ)
 */
async function validateTransferForm(formData) {
    if (isEmpty(formData.type)) {
        showToast('❌ نوع التحويل مطلوب', 'error');
        return false;
    }
    
    if (isEmpty(formData.purpose)) {
        showToast('❌ الغرض مطلوب', 'error');
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
    
    // التحقق من الممول إذا كان التحويل له
    if (formData.type === 'company_to_investor' && isEmpty(formData.investorId)) {
        showToast('❌ الممول مطلوب لهذا النوع من التحويلات', 'error');
        return false;
    }
    
    // ✅ تحسين 3: التحقق من العملية إذا تم اختيارها
    if (formData.operationId) {
        var operations = TRANSFERS_STATE.referenceCache.operations || [];
        var operation = operations.find(function(op) { return op.id === formData.operationId; });
        
        if (!operation) {
            showToast('❌ العملية غير موجودة', 'error');
            return false;
        }
        
        if (operation.is_archived) {
            showToast('❌ لا يمكن التحويل من/إلى عملية مؤرشفة', 'error');
            return false;
        }
        
        if (operation.is_locked && WORKFLOW_TRANSFER_PURPOSES.indexOf(formData.purpose) !== -1) {
            showToast('❌ لا يمكن إضافة تحويل يؤثر على عملية مقفلة', 'error');
            return false;
        }
        
        if (operation.status === STATUS.CANCELLED) {
            showToast('❌ لا يمكن التحويل من/إلى عملية ملغاة', 'error');
            return false;
        }
    }
    
    // ✅ تحسين 3: التحقق من الممول إذا تم اختياره
    if (formData.investorId) {
        var investors = TRANSFERS_STATE.referenceCache.investors || [];
        var investor = investors.find(function(inv) { return inv.id === formData.investorId; });
        
        if (!investor) {
            showToast('❌ الممول غير موجود', 'error');
            return false;
        }
        
        if (investor.is_archived) {
            showToast('❌ لا يمكن التحويل إلى ممول مؤرشف', 'error');
            return false;
        }
    }
    
    // ✅ تحسين 3: التحقق من توافق نوع التحويل مع العملية
    if (formData.operationId && formData.type === 'company_to_investor') {
        // التحويل للممول يجب أن يكون مرتبطاً بعملية
        // (لأن الممول مشارك في عملية معينة)
        // هذا تحقق اختياري - يمكن إزالته إذا كان النظام يسمح بتحويلات عامة
    }
    
    return true;
}

/**
 * ✅ تحسين 7: Validation تحذيري (Warning فقط - لا يمنع الحفظ)
 * يعرض تحذيرات للمستخدم لكن يسمح بالحفظ
 */
async function getTransferWarnings(formData) {
    var warnings = [];
    var amount = parseFloat(formData.amount);
    
    // تحميل البيانات المطلوبة للحسابات
    var data = await loadTransfersCalculationsData(formData);
    
    // ✅ تحسين 7: إذا كان مبلغ التحويل أكبر من قيمة العملية
    if (formData.operationId && data.operation) {
        if (amount > data.operation.amount) {
            warnings.push('⚠️ مبلغ التحويل (' + formatMoney(amount) + ') أكبر من قيمة العملية (' + formatMoney(data.operation.amount) + ')');
        }
    }
    
    // ✅ تحسين 7: إذا كان أكبر من رأس المال المتبقي (للممول)
    if (formData.investorId && data.investorSummary) {
        if (formData.purpose === 'capital_return' && amount > data.investorSummary.capitalPending) {
            warnings.push('⚠️ المبلغ (' + formatMoney(amount) + ') أكبر من رأس المال المتاح للإرجاع (' + formatMoney(data.investorSummary.capitalPending) + ')');
        }
        
        if (formData.purpose === 'profit_distribution' && amount > data.investorSummary.outstandingProfit) {
            warnings.push('⚠️ مبلغ توزيع الأرباح (' + formatMoney(amount) + ') أكبر من الأرباح المستحقة (' + formatMoney(data.investorSummary.outstandingProfit) + ')');
        }
    }
    
    // ✅ تحسين 7: إذا كان السداد أكبر من المتبقي للعميل
    if (formData.operationId && data.operationSummary && formData.purpose === 'client_repayment') {
        var remainingToRepay = data.operation.amount - data.operationSummary.clientRepaid;
        if (amount > remainingToRepay) {
            warnings.push('⚠️ مبلغ السداد (' + formatMoney(amount) + ') أكبر من المتبقي (' + formatMoney(remainingToRepay) + ')');
        }
    }
    
    return warnings;
}

/**
 * تحميل البيانات المطلوبة للحسابات التحذيرية
 */
async function loadTransfersCalculationsData(formData) {
    var data = {
        operation: null,
        operationSummary: null,
        investorSummary: null
    };
    
    try {
        // تحميل العملية
        if (formData.operationId) {
            var opResult = await runQuery(
                function() {
                    return APP.supabase
                        .from('operations')
                        .select('*')
                        .eq('id', formData.operationId)
                        .single();
                },
                { context: 'loadTransfersCalculationsData-op', throwError: false }
            );
            data.operation = opResult.data;
            
            if (data.operation) {
                // تحميل بيانات العملية للحساب
                var relatedResults = await Promise.all([
                    runQuery(
                        function() {
                            return APP.supabase
                                .from('operation_investors')
                                .select('id, operation_id, investor_id, contribution, profit')
                                .eq('operation_id', formData.operationId);
                        },
                        { context: 'loadTransfersCalculationsData-opInv', throwError: false }
                    ),
                    runQuery(
                        function() {
                            return APP.supabase
                                .from('transfers')
                                .select('id, operation_id, investor_id, purpose, amount')
                                .eq('operation_id', formData.operationId);
                        },
                        { context: 'loadTransfersCalculationsData-trans', throwError: false }
                    ),
                    runQuery(
                        function() {
                            return APP.supabase
                                .from('operations')
                                .select('id, status');
                        },
                        { context: 'loadTransfersCalculationsData-ops', throwError: false }
                    )
                ]);
                
                var opInv = relatedResults[0].data || [];
                var transfers = relatedResults[1].data || [];
                var operations = relatedResults[2].data || [];
                
                var indexes = {
                    operationsById: {},
                    transfersByOperation: {},
                    opInvestorsByOperation: {},
                    transfersByInvestor: {},
                    opInvestorsByInvestor: {}
                };
                
                operations.forEach(function(op) { indexes.operationsById[op.id] = op; });
                
                transfers.forEach(function(t) {
                    if (t.operation_id) {
                        if (!indexes.transfersByOperation[t.operation_id]) {
                            indexes.transfersByOperation[t.operation_id] = [];
                        }
                        indexes.transfersByOperation[t.operation_id].push(t);
                    }
                    if (t.investor_id) {
                        if (!indexes.transfersByInvestor[t.investor_id]) {
                            indexes.transfersByInvestor[t.investor_id] = [];
                        }
                        indexes.transfersByInvestor[t.investor_id].push(t);
                    }
                });
                
                opInv.forEach(function(oi) {
                    if (!indexes.opInvestorsByOperation[oi.operation_id]) {
                        indexes.opInvestorsByOperation[oi.operation_id] = [];
                    }
                    indexes.opInvestorsByOperation[oi.operation_id].push(oi);
                    
                    if (!indexes.opInvestorsByInvestor[oi.investor_id]) {
                        indexes.opInvestorsByInvestor[oi.investor_id] = [];
                    }
                    indexes.opInvestorsByInvestor[oi.investor_id].push(oi);
                });
                
                var calcData = {
                    operations: operations,
                    transfers: transfers,
                    operationInvestors: opInv,
                    indexes: indexes
                };
                
                data.operationSummary = calculateOperationSummary(formData.operationId, calcData);
            }
        }
        
        // تحميل ملخص الممول
        if (formData.investorId) {
            var invResults = await Promise.all([
                runQuery(
                    function() {
                        return APP.supabase
                            .from('operation_investors')
                            .select('id, operation_id, investor_id, contribution, profit')
                            .eq('investor_id', formData.investorId);
                    },
                    { context: 'loadTransfersCalculationsData-invOpInv', throwError: false }
                ),
                runQuery(
                    function() {
                        return APP.supabase
                            .from('transfers')
                            .select('id, investor_id, purpose, amount')
                            .eq('investor_id', formData.investorId);
                    },
                    { context: 'loadTransfersCalculationsData-invTrans', throwError: false }
                ),
                runQuery(
                    function() {
                        return APP.supabase
                            .from('operations')
                            .select('id, status');
                    },
                    { context: 'loadTransfersCalculationsData-invOps', throwError: false }
                )
            ]);
            
            var invOpInv = invResults[0].data || [];
            var invTransfers = invResults[1].data || [];
            var invOperations = invResults[2].data || [];
            
            var invIndexes = {
                operationsById: {},
                opInvestorsByInvestor: {},
                transfersByInvestor: {}
            };
            
            invOperations.forEach(function(op) { invIndexes.operationsById[op.id] = op; });
            
            invOpInv.forEach(function(oi) {
                if (!invIndexes.opInvestorsByInvestor[oi.investor_id]) {
                    invIndexes.opInvestorsByInvestor[oi.investor_id] = [];
                }
                invIndexes.opInvestorsByInvestor[oi.investor_id].push(oi);
            });
            
            invTransfers.forEach(function(t) {
                if (t.investor_id) {
                    if (!invIndexes.transfersByInvestor[t.investor_id]) {
                        invIndexes.transfersByInvestor[t.investor_id] = [];
                    }
                    invIndexes.transfersByInvestor[t.investor_id].push(t);
                }
            });
            
            var invCalcData = {
                operations: invOperations,
                transfers: invTransfers,
                operationInvestors: invOpInv,
                indexes: invIndexes
            };
            
            data.investorSummary = calculateInvestorSummary(formData.investorId, invCalcData);
        }
        
    } catch (err) {
        debug('⚠️ خطأ في loadTransfersCalculationsData: ' + err.message, 'warning');
    }
    
    return data;
}


// ============================================================
// 8. TOGGLE INVESTOR SELECT
// ============================================================

/**
 * ✅ إظهار/إخفاء حقل الممول حسب نوع التحويل
 */
function toggleInvestorSelect() {
    var typeEl = document.getElementById('transferType');
    var investorRow = document.getElementById('investorSelectRow');
    
    if (!typeEl || !investorRow) return;
    
    var type = typeEl.value;
    
    if (type === 'company_to_investor') {
        investorRow.style.display = 'flex';
    } else {
        investorRow.style.display = 'none';
        document.getElementById('transferInvestorId').value = '';
    }
}


// ============================================================
// 9. SAVE TRANSFER
// ============================================================

/**
 * حفظ التحويل (إضافة أو تعديل)
 */
async function saveTransfer() {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    // جمع البيانات
    var formData = collectTransferFormData();
    
    // التحقق الصارم
    var isValid = await validateTransferForm(formData);
    if (!isValid) {
        return;
    }
    
    // ✅ تحسين 7: Validation تحذيري
    var warnings = await getTransferWarnings(formData);
    if (warnings.length > 0) {
        var warningMessage = '⚠️ تحذيرات:\n\n' + warnings.join('\n') + '\n\nهل تريد المتابعة؟';
        if (!confirmAction(warningMessage)) {
            return;
        }
    }
    
    // ✅ تحسين 4: استخدام TRANSFER_CATEGORY_MAP بدلاً من if/else
    var categoryConfig = TRANSFER_CATEGORY_MAP[formData.type];
    var partyType = categoryConfig ? categoryConfig.party_type : '';
    var transactionCategory = categoryConfig && categoryConfig.categories 
        ? (categoryConfig.categories[formData.purpose] || '') 
        : '';
    
    // ✅ تحسين 1: تحديد client_id
    var clientId = null;
    if (formData.operationId) {
        var operations = TRANSFERS_STATE.referenceCache.operations || [];
        var operation = operations.find(function(op) { return op.id === formData.operationId; });
        if (operation) {
            clientId = operation.client_id;
        }
    }
    
    var data = {
        type: formData.type,
        purpose: formData.purpose,
        operation_id: formData.operationId || null,
        client_id: clientId,  // ✅ تحسين 1
        investor_id: formData.investorId || null,
        amount: parseFloat(formData.amount),
        transfer_date: formData.transferDate,
        notes: formData.notes || null,
        party_type: partyType,
        transaction_category: transactionCategory
    };
    
    showLoading();
    
    try {
        if (formData.id) {
            // تعديل
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
                    'Amount: ' + data.amount + ', Purpose: ' + data.purpose, 'update'
                );
            }
            
            debug('✅ تم تحديث التحويل', 'success');
            showToast('تم تحديث التحويل', 'success');
            
        } else {
            // إضافة
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
                        'Amount: ' + data.amount + ', Purpose: ' + data.purpose + ', Ref: ' + (result.data[0].reference_number || ''),
                        'create'
                    );
                }
                
                debug('✅ تم إضافة التحويل', 'success');
                showToast('تم إضافة التحويل', 'success');
            }
        }
        
        closeModal('transferModal');
        
        // ✅ تحسين 2 + 8: إعادة تحميل القائمة فقط (بدون مسح Reference Cache)
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
// 10. DELETE TRANSFER - ✅ تحسين 6
// ============================================================

/**
 * حذف تحويل
 * مع حماية التحويلات المرتبطة بـ Workflow
 */
async function deleteTransfer(transferId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    // ✅ تحسين 6: التحقق من التحويل قبل الحذف
    var transfer = TRANSFERS_STATE.records.find(function(t) { return t.id === transferId; });
    
    if (!transfer) {
        showToast('❌ التحويل غير موجود', 'error');
        return;
    }
    
    // ✅ تحسين 6: تحذير خاص للتحويلات المرتبطة بـ Workflow
    if (WORKFLOW_TRANSFER_PURPOSES.indexOf(transfer.purpose) !== -1) {
        var warningMessage = '⚠️ تحذير:\n\n' +
            'هذا التحويل مرتبط بسير العمل:\n' +
            '• الغرض: ' + getPurposeText(transfer.purpose) + '\n' +
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
        // تأكيد عادي
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
                'Amount: ' + (oldResult.data ? oldResult.data.amount : '') + ', Purpose: ' + (oldResult.data ? oldResult.data.purpose : ''), 'delete'
            );
        }
        
        debug('✅ تم حذف التحويل', 'success');
        showToast('تم حذف التحويل', 'success');
        
        // ✅ تحسين 2 + 8: إعادة تحميل القائمة فقط
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
// 11. CACHE MANAGEMENT - ✅ تحسين 8
// ============================================================

/**
 * ✅ تحسين 8: مسح Reference Cache فقط
 * يُستدعى عند تغيير البيانات المرجعية (Clients/Investors/Operations)
 */
function clearTransfersReferenceCache() {
    TRANSFERS_STATE.referenceCache.clients = null;
    TRANSFERS_STATE.referenceCache.investors = null;
    TRANSFERS_STATE.referenceCache.operations = null;
    debug('🗑️ تم مسح Reference Cache للتحويلات', 'info');
}

/**
 * ✅ تحسين 8: مسح List Cache فقط
 * يُستدعى عند تغيير التحويلات نفسها
 */
function clearTransfersListCache() {
    TRANSFERS_STATE.listCache.records = null;
    TRANSFERS_STATE.listCache.lastLoad = null;
    debug('🗑️ تم مسح List Cache للتحويلات', 'info');
}

/**
 * مسح كل الـ Cache (استخدام نادر)
 */
function clearAllTransfersCache() {
    clearTransfersReferenceCache();
    clearTransfersListCache();
    debug('🗑️ تم مسح كل Cache للتحويلات', 'info');
}


// ============================================================
// 12. SEARCH & FILTER
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
