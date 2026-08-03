// ============================================================
// نظام إدارة التمويل - Transfers Module (Parties Ledger)
// Version: 3.2.0 (Fixed Logic Bug)
// Last Updated: 2026-08-03
// ============================================================

var TRANSFERS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null, operations: null },
    listCache: { lastLoad: null, records: null }
};

var TRANSFER_FLOW_MAP = Object.freeze({
    'company_to_client': { party_type: 'client', transaction_category: 'client_deposit_in', transfer_type: 'company_to_client', purpose_options: ['client_funding', 'additional_funding', 'settlement', 'other'], label: 'تمويل عميل' },
    'client_to_company': { party_type: 'client', transaction_category: 'client_use_out', transfer_type: 'client_to_company', purpose_options: ['client_repayment', 'settlement', 'other'], label: 'سداد من عميل' },
    'company_to_investor': { party_type: 'investor', transaction_category: 'investor_return_out', transfer_type: 'company_to_investor', purpose_options: ['capital_return', 'profit_distribution', 'settlement', 'other'], label: 'تحويل لممول' },
    'investor_to_company': { party_type: 'investor', transaction_category: 'investor_capital_in', transfer_type: 'company_to_investor', purpose_options: ['client_funding', 'settlement', 'other'], label: 'إيداع من ممول' }
});

var WORKFLOW_TRANSFER_PURPOSES = Object.freeze(['client_repayment', 'capital_return', 'profit_distribution']);
var PURPOSE_TEXT_AR = Object.freeze({ client_funding: 'تمويل', client_repayment: 'سداد', capital_return: 'إرجاع رأس مال', profit_distribution: 'توزيع أرباح', settlement: 'تسوية', additional_funding: 'تمويل إضافي', other: 'أخرى' });

function initTransfers() {
    debug('💸 بدء تهيئة transfers.js', 'info');
    registerScreenLoader('transfers', loadTransfers);
    debug('✅ transfers.js جاهز', 'success');
}

async function loadTransfers() {
    debug('💸 بدأ loadTransfers', 'info');
    if (!isSupabaseReady()) return;
    showLoading();
    try {
        var results = await Promise.all([
            runQuery(function() {
                var query = APP.supabase.from('transfers').select('id, reference_number, type, purpose, operation_id, client_id, investor_id, amount, transfer_date, notes, party_type, transaction_category, is_archived, created_at').order('transfer_date', { ascending: false });
                if (TRANSFERS_STATE.filter) query = query.eq('party_type', TRANSFERS_STATE.filter);
                if (TRANSFERS_STATE.search) {
                    var searchTerm = '%' + TRANSFERS_STATE.search + '%';
                    query = query.or('reference_number.ilike.' + searchTerm + ',notes.ilike.' + searchTerm);
                }
                return query;
            }, { context: 'loadTransfers-trans', throwError: true }),
            loadClientsForTransfers(), loadInvestorsForTransfers(), loadOperationsForTransfers()
        ]);
        
        var transfers = results[0].data || [];
        var clients = results[1] || [];
        var investors = results[2] || [];
        var operations = results[3] || [];
        var indexes = buildTransfersIndexes(clients, investors, operations);
        
        transfers.forEach(function(t) {
            if (t.client_id && indexes.clientsById[t.client_id]) t.client = indexes.clientsById[t.client_id];
            else if (t.operation_id && indexes.operationsById[t.operation_id]) {
                var op = indexes.operationsById[t.operation_id];
                t.client = op.client_id ? indexes.clientsById[op.client_id] : null;
            } else t.client = null;
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
    } finally { hideLoading(); }
}

async function loadClientsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.clients) return TRANSFERS_STATE.referenceCache.clients;
    try {
        var result = await runQuery(function() { return APP.supabase.from('clients').select('id, name, is_archived').order('name'); }, { context: 'loadClientsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.clients = result.data || [];
        return TRANSFERS_STATE.referenceCache.clients;
    } catch (err) { return []; }
}

async function loadInvestorsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.investors) return TRANSFERS_STATE.referenceCache.investors;
    try {
        var result = await runQuery(function() { return APP.supabase.from('investors').select('id, name, is_archived').order('name'); }, { context: 'loadInvestorsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.investors = result.data || [];
        return TRANSFERS_STATE.referenceCache.investors;
    } catch (err) { return []; }
}

async function loadOperationsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.operations) return TRANSFERS_STATE.referenceCache.operations;
    try {
        var result = await runQuery(function() { return APP.supabase.from('operations').select('id, name, client_id, amount, status, is_locked, is_archived').order('name'); }, { context: 'loadOperationsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.operations = result.data || [];
        return TRANSFERS_STATE.referenceCache.operations;
    } catch (err) { return []; }
}

function buildTransfersIndexes(clients, investors, operations) {
    var clientsById = {}, investorsById = {}, operationsById = {};
    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });
    operations.forEach(function(op) { operationsById[op.id] = op; });
    return { clientsById: clientsById, investorsById: investorsById, operationsById: operationsById };
}

function renderTransfersList() {
    var container = document.getElementById('transfersTable');
    if (!container) return;
    if (TRANSFERS_STATE.records.length === 0) { container.innerHTML = '<div class="empty-state">لا توجد تحويلات</div>'; return; }
    
    var html = '<table><thead><tr><th>الرقم</th><th>التاريخ</th><th>من</th><th>إلى</th><th>الغرض</th><th>المبلغ</th><th>ملاحظات</th>';
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead><tbody>';
    
    TRANSFERS_STATE.records.forEach(function(t) {
        var fromText = '', toText = '';
        if (t.type === 'company_to_client') { fromText = 'الشركة'; toText = t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : '-'; } 
        else if (t.type === 'client_to_company') { fromText = t.client ? '<a href="#" data-action="openClientFile" data-param="' + t.client.id + '">' + escapeHtml(t.client.name) + '</a>' : '-'; toText = 'الشركة'; } 
        else if (t.type === 'company_to_investor') { fromText = 'الشركة'; toText = t.investor ? '<a href="#" data-action="openInvestorFile" data-param="' + t.investor.id + '">' + escapeHtml(t.investor.name) + '</a>' : '-'; }
        
        html += '<tr><td><strong>' + escapeHtml(t.reference_number || '-') + '</strong></td><td>' + formatDate(t.transfer_date) + '</td><td>' + fromText + '</td><td>' + toText + '</td><td>' + (PURPOSE_TEXT_AR[t.purpose] || t.purpose || '-') + '</td><td>' + formatMoney(t.amount) + '</td><td>' + escapeHtml(truncateText(t.notes, 30)) + '</td>';
        if (canEdit()) html += '<td class="actions-cell"><button class="btn btn-secondary btn-sm" data-action="editTransfer" data-param="' + t.id + '">تعديل</button><button class="btn btn-danger btn-sm" data-action="deleteTransfer" data-param="' + t.id + '">حذف</button></td>';
        html += '</tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function openTransferModal(transferId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var titleEl = document.getElementById('transferModalTitle');
    if (!titleEl) return;
    
    await Promise.all([loadClientsForTransfers(), loadInvestorsForTransfers(), loadOperationsForTransfers()]);
    
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    var opEl = document.getElementById('transferOperation');
    
    if (fromTypeEl) fromTypeEl.innerHTML = '<option value="">-- اختر المصدر --</option><option value="company">الشركة</option><option value="client">عميل</option><option value="investor">ممول</option>';
    if (toTypeEl) toTypeEl.innerHTML = '<option value="">-- اختر المستلم --</option><option value="company">الشركة</option><option value="client">عميل</option><option value="investor">ممول</option>';
    
    if (opEl && TRANSFERS_STATE.referenceCache.operations) {
        var options = '<option value="">-- بدون عملية --</option>';
        TRANSFERS_STATE.referenceCache.operations.forEach(function(op) { if (!op.is_archived) options += '<option value="' + op.id + '">' + escapeHtml(op.name) + '</option>'; });
        opEl.innerHTML = options;
    }
    
    resetTransferForm();
    
    if (transferId) {
        try {
            var result = await runQuery(function() { return APP.supabase.from('transfers').select('*').eq('id', transferId).single(); }, { context: 'openTransferModal', throwError: true });
            if (result.data) populateTransferForm(result.data, 'تعديل تحويل');
        } catch (err) { showToast(handleSupabaseError(err, 'فتح بيانات التحويل'), 'error'); return; }
    } else {
        titleEl.textContent = 'إضافة تحويل';
    }
    
    var warningEl = document.getElementById('transferValidationWarning');
    if (warningEl) warningEl.innerHTML = '';
    openModal('transferModal');
}

function editTransfer(transferId) { openTransferModal(transferId); }

// ✅ هنا تم إصلاح الخطأ الجذري: التحقق من أن النوع ليس "company" قبل محاولة جلب البيانات
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

    if (fromEntityRow) fromEntityRow.style.display = 'none';
    if (toEntityRow) toEntityRow.style.display = 'none';
    if (fromEntitySelect) fromEntitySelect.value = '';
    if (toEntitySelect) toEntitySelect.value = '';

    // فقط إذا كان الاختيار عميل أو ممول، نقوم بجلب القائمة
    if ((fromType === 'client' || fromType === 'investor') && fromEntityRow && fromEntitySelect) {
        var fromData = populateEntitySelect(fromType);
        if (fromData) { // حماية من undefined
            if (fromEntityLabel) fromEntityLabel.textContent = fromData.label;
            fromEntitySelect.innerHTML = fromData.options;
            fromEntityRow.style.display = 'block';
        }
    }

    if ((toType === 'client' || toType === 'investor') && toEntityRow && toEntitySelect) {
        var toData = populateEntitySelect(toType);
        if (toData) { // حماية من undefined
            if (toEntityLabel) toEntityLabel.textContent = toData.label;
            toEntitySelect.innerHTML = toData.options;
            toEntityRow.style.display = 'block';
        }
    }

    updateTransferSummary(fromType, toType);
    
    var fromPartyEl = document.getElementById('transferFromParty');
    var toPartyEl = document.getElementById('transferToParty');
    if (fromPartyEl) fromPartyEl.value = fromType;
    if (toPartyEl) toPartyEl.value = toType;
}

function populateEntitySelect(type) {
    var entities = [];
    var label = '';
    if (type === 'client') { entities = TRANSFERS_STATE.referenceCache.clients || []; label = 'اختر العميل *'; } 
    else if (type === 'investor') { entities = TRANSFERS_STATE.referenceCache.investors || []; label = 'اختر الممول *'; }
    else { return null; } // إرجاع null للشركة لمنع الخطأ

    var options = '<option value="">-- اختر --</option>';
    entities.forEach(function(e) {
        if (!e.is_archived) options += '<option value="' + e.id + '">' + escapeHtml(e.name) + '</option>';
    });
    return { options: options, label: label };
}

function updateTransferSummary(fromType, toType) {
    var summaryEl = document.getElementById('transferSummary');
    var summaryFrom = document.getElementById('summaryFrom');
    var summaryTo = document.getElementById('summaryTo');
    var summaryCategory = document.getElementById('summaryCategory');
    
    if (!fromType || !toType || !summaryEl) { if (summaryEl) summaryEl.style.display = 'none'; return; }
    
    var flowKey = fromType + '_to_' + toType;
    var flow = TRANSFER_FLOW_MAP[flowKey];
    if (!flow) { summaryEl.style.display = 'none'; return; }
    
    var fromText = fromType === 'company' ? 'الشركة' : (fromType === 'client' ? 'عميل' : 'ممول');
    var toText = toType === 'company' ? 'الشركة' : (toType === 'client' ? 'عميل' : 'ممول');
    
    if (summaryFrom) summaryFrom.textContent = fromText;
    if (summaryTo) summaryTo.textContent = toText;
    if (summaryCategory) summaryCategory.textContent = flow.label;
    
    summaryEl.style.display = 'block';
    var categoryEl = document.getElementById('transferTransactionCategory');
    if (categoryEl) categoryEl.value = flow.transaction_category;
}

function populateTransferForm(transfer, title) {
    var titleEl = document.getElementById('transferModalTitle');
    if (titleEl) titleEl.textContent = title;
    
    var fromType = 'company', toType = 'company';
    if (transfer.type === 'company_to_client') { fromType = 'company'; toType = 'client'; } 
    else if (transfer.type === 'client_to_company') { fromType = 'client'; toType = 'company'; } 
    else if (transfer.type === 'company_to_investor') { fromType = 'company'; toType = 'investor'; }
    
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    if (fromTypeEl) fromTypeEl.value = fromType;
    if (toTypeEl) toTypeEl.value = toType;
    
    updateTransferFields();
    
    if (transfer.client_id) {
        if (fromType === 'client') { var el = document.getElementById('transferFromEntity'); if (el) el.value = transfer.client_id; } 
        else if (toType === 'client') { var el = document.getElementById('transferToEntity'); if (el) el.value = transfer.client_id; }
    }
    if (transfer.investor_id) {
        if (fromType === 'investor') { var el = document.getElementById('transferFromEntity'); if (el) el.value = transfer.investor_id; } 
        else if (toType === 'investor') { var el = document.getElementById('transferToEntity'); if (el) el.value = transfer.investor_id; }
    }
    
    var amountEl = document.getElementById('transferAmount'); if (amountEl) amountEl.value = transfer.amount || '';
    var opEl = document.getElementById('transferOperation'); if (opEl) opEl.value = transfer.operation_id || '';
    var dateEl = document.getElementById('transferDate'); if (dateEl) dateEl.value = formatDateForInput(transfer.transfer_date);
    var notesEl = document.getElementById('transferNotes'); if (notesEl) notesEl.value = transfer.notes || '';
}

function resetTransferForm() {
    var ids = ['transferId', 'transferFromType', 'transferToType', 'transferFromEntity', 'transferToEntity', 'transferAmount', 'transferOperation', 'transferNotes', 'transferTransactionCategory'];
    ids.forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var dateEl = document.getElementById('transferDate'); if (dateEl) dateEl.value = getTodayDate();
    
    var fromEntityRow = document.getElementById('transferFromEntityRow'); if (fromEntityRow) fromEntityRow.style.display = 'none';
    var toEntityRow = document.getElementById('transferToEntityRow'); if (toEntityRow) toEntityRow.style.display = 'none';
    var summary = document.getElementById('transferSummary'); if (summary) summary.style.display = 'none';
}

function collectTransferFormData() {
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');
    var fromEntityEl = document.getElementById('transferFromEntity');
    var toEntityEl = document.getElementById('transferToEntity');
    
    var fromType = fromTypeEl ? fromTypeEl.value : '';
    var toType = toTypeEl ? toTypeEl.value : '';
    var fromEntity = fromEntityEl ? fromEntityEl.value : '';
    var toEntity = toEntityEl ? toEntityEl.value : '';
    
    var clientId = null, investorId = null;
    if (fromType === 'client') clientId = fromEntity;
    else if (toType === 'client') clientId = toEntity;
    else if (fromType === 'investor') investorId = fromEntity;
    else if (toType === 'investor') investorId = toEntity;
    
    return {
        id: document.getElementById('transferId') ? document.getElementById('transferId').value : '',
        fromType: fromType, toType: toType, clientId: clientId, investorId: investorId,
        operationId: document.getElementById('transferOperation') ? document.getElementById('transferOperation').value : '',
        amount: document.getElementById('transferAmount') ? document.getElementById('transferAmount').value : '',
        transferDate: document.getElementById('transferDate') ? document.getElementById('transferDate').value : '',
        notes: document.getElementById('transferNotes') ? document.getElementById('transferNotes').value.trim() : '',
        transactionCategory: document.getElementById('transferTransactionCategory') ? document.getElementById('transferTransactionCategory').value : ''
    };
}

async function validateTransferForm(formData) {
    if (isEmpty(formData.fromType) || isEmpty(formData.toType)) { showToast('❌ مصدر ووجهة الأموال مطلوبان', 'error'); return false; }
    if (formData.fromType === formData.toType) { showToast('❌ لا يمكن التحويل من وإلى نفس الطرف', 'error'); return false; }
    
    var flow = TRANSFER_FLOW_MAP[formData.fromType + '_to_' + formData.toType];
    if (!flow) { showToast('❌ هذا النوع من التحويل غير مسموح', 'error'); return false; }
    
    if ((formData.fromType === 'client' || formData.fromType === 'investor') && !formData.clientId && !formData.investorId) { showToast('❌ يجب اختيار الطرف المصدر', 'error'); return false; }
    if ((formData.toType === 'client' || formData.toType === 'investor') && !formData.clientId && !formData.investorId) { showToast('❌ يجب اختيار الطرف المستلم', 'error'); return false; }
    if (!isPositiveNumber(formData.amount)) { showToast('❌ المبلغ يجب أن يكون أكبر من صفر', 'error'); return false; }
    if (isEmpty(formData.transferDate)) { showToast('❌ التاريخ مطلوب', 'error'); return false; }
    return true;
}

async function saveTransfer() {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var formData = collectTransferFormData();
    if (!(await validateTransferForm(formData))) return;
    
    var flow = TRANSFER_FLOW_MAP[formData.fromType + '_to_' + formData.toType];
    var data = {
        type: flow.transfer_type, purpose: flow.purpose_options[0], operation_id: formData.operationId || null,
        client_id: formData.clientId || null, investor_id: formData.investorId || null,
        amount: parseFloat(formData.amount), transfer_date: formData.transferDate, notes: formData.notes || null,
        party_type: flow.party_type, transaction_category: flow.transaction_category
    };
    
    showLoading();
    try {
        if (formData.id) {
            var oldResult = await runQuery(function() { return APP.supabase.from('transfers').select('*').eq('id', formData.id).single(); }, { context: 'saveTransfer-getOld', throwError: true });
            await runQuery(function() { return APP.supabase.from('transfers').update(data).eq('id', formData.id); }, { context: 'saveTransfer-update', throwError: true });
            if (typeof window.logActivityToDB === 'function') window.logActivityToDB('تعديل تحويل', 'transfer', formData.id, JSON.stringify(oldResult.data), JSON.stringify(data), 'From: ' + formData.fromType + ' → To: ' + formData.toType, 'update');
            showToast('تم تحديث التحويل', 'success');
        } else {
            var result = await runQuery(function() { return APP.supabase.from('transfers').insert(data).select(); }, { context: 'saveTransfer-insert', throwError: true });
            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') window.logActivityToDB('إضافة تحويل', 'transfer', result.data[0].id, null, JSON.stringify(data), 'From: ' + formData.fromType + ' → To: ' + formData.toType, 'create');
                showToast('تم إضافة التحويل', 'success');
            }
        }
        closeModal('transferModal');
        clearTransfersListCache();
        loadTransfers();
    } catch (err) {
        debug('❌ خطأ في saveTransfer: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ التحويل'), 'error');
    } finally { hideLoading(); }
}

async function deleteTransfer(transferId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    var transfer = TRANSFERS_STATE.records.find(function(t) { return t.id === transferId; });
    if (!transfer) { showToast('❌ التحويل غير موجود', 'error'); return; }
    
    if (WORKFLOW_TRANSFER_PURPOSES.indexOf(transfer.purpose) !== -1) {
        if (!confirmAction('⚠️ تحذير: هذا التحويل مرتبط بسير العمل وحذفه قد يؤثر على الأرصدة. هل أنت متأكد؟')) return;
    } else {
        if (!confirmDelete('هذا التحويل')) return;
    }
    
    showLoading();
    try {
        var oldResult = await runQuery(function() { return APP.supabase.from('transfers').select('*').eq('id', transferId).single(); }, { context: 'deleteTransfer-getOld', throwError: true });
        await runQuery(function() { return APP.supabase.from('transfers').delete().eq('id', transferId); }, { context: 'deleteTransfer-delete', throwError: true });
        if (typeof window.logActivityToDB === 'function') window.logActivityToDB('حذف تحويل', 'transfer', transferId, JSON.stringify(oldResult.data), null, 'Amount: ' + (oldResult.data ? oldResult.data.amount : ''), 'delete');
        showToast('تم حذف التحويل', 'success');
        clearTransfersListCache();
        loadTransfers();
    } catch (err) {
        showToast(handleSupabaseError(err, 'حذف التحويل'), 'error');
    } finally { hideLoading(); }
}

function clearTransfersReferenceCache() { TRANSFERS_STATE.referenceCache.clients = null; TRANSFERS_STATE.referenceCache.investors = null; TRANSFERS_STATE.referenceCache.operations = null; }
function clearTransfersListCache() { TRANSFERS_STATE.listCache.records = null; TRANSFERS_STATE.listCache.lastLoad = null; }
function searchTransfers(searchTerm) { TRANSFERS_STATE.search = searchTerm; loadTransfers(); }
function filterTransfers(filterValue) { TRANSFERS_STATE.filter = filterValue; loadTransfers(); }
