// ============================================================
// نظام إدارة التمويل - Transfers Module (Parties Ledger)
// Version: 6.2.1
// Last Updated: 2026-08-05
// ============================================================
var TRANSFERS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null, operations: null },
    listCache: { lastLoad: null, records: null }
};

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
        transfer_type: 'investor_to_company',
        purpose_options: ['capital_funding', 'client_funding', 'settlement', 'other'],
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

var PURPOSE_TEXT_AR = Object.freeze({
    client_funding: 'تمويل',
    capital_funding: 'تمويل رأس مال',
    client_repayment: 'سداد',
    capital_return: 'إرجاع رأس مال',
    profit_distribution: 'توزيع أرباح',
    settlement: 'تسوية',
    additional_funding: 'تمويل إضافي',
    other: 'أخرى'
});

if (typeof window !== 'undefined') {
    window.PURPOSE_TEXT_AR = PURPOSE_TEXT_AR;
}

function initTransfers() {
    debug('💸 بدء تهيئة transfers.js (v6.2.1)', 'info');
    if (typeof registerScreenLoader === 'function') {
        registerScreenLoader('transfers', loadTransfers);
    }
    debug('✅ transfers.js v6.2.1 جاهز', 'success');
}

// ============================================================
// 1. LOAD TRANSFERS
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
                    var s = '%' + TRANSFERS_STATE.search + '%';
                    query = query.or('reference_number.ilike.' + s + ',notes.ilike.' + s);
                }
                
                return query;
            }, { context: 'loadTransfers-trans', throwError: true }),
            loadClientsForTransfers(),
            loadInvestorsForTransfers(),
            loadOperationsForTransfers()
        ]);
        
        var transfers = results[0].data || [];
        var indexes = buildTransfersIndexes(results[1] || [], results[2] || [], results[3] || []);
        
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
// 2. REFERENCE DATA
// ============================================================

async function loadClientsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.clients) return TRANSFERS_STATE.referenceCache.clients;
    
    try {
        var r = await runQuery(function() {
            return APP.supabase.from('clients').select('id, name, is_archived').order('name');
        }, { context: 'loadClientsForTransfers', throwError: true });
        
        TRANSFERS_STATE.referenceCache.clients = r.data || [];
        return TRANSFERS_STATE.referenceCache.clients;
    } catch (e) {
        return [];
    }
}

async function loadInvestorsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.investors) return TRANSFERS_STATE.referenceCache.investors;
    
    try {
        var r = await runQuery(function() {
            return APP.supabase.from('investors').select('id, name, is_archived').order('name');
        }, { context: 'loadInvestorsForTransfers', throwError: true });
        
        TRANSFERS_STATE.referenceCache.investors = r.data || [];
        return TRANSFERS_STATE.referenceCache.investors;
    } catch (e) {
        return [];
    }
}

async function loadOperationsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.operations) return TRANSFERS_STATE.referenceCache.operations;
    
    try {
        var r = await runQuery(function() {
            return APP.supabase.from('operations').select('id, name, client_id, amount, status, is_locked, is_archived').order('name');
        }, { context: 'loadOperationsForTransfers', throwError: true });
        
        TRANSFERS_STATE.referenceCache.operations = r.data || [];
        return TRANSFERS_STATE.referenceCache.operations;
    } catch (e) {
        return [];
    }
}

function buildTransfersIndexes(clients, investors, operations) {
    var c = {}, i = {}, o = {};
    
    clients.forEach(function(x) { c[x.id] = x; });
    investors.forEach(function(x) { i[x.id] = x; });
    operations.forEach(function(x) { o[x.id] = x; });
    
    return { clientsById: c, investorsById: i, operationsById: o };
}

// ============================================================
// 3. RENDER LIST
// ============================================================

function renderTransfersList() {
    var container = document.getElementById('transfersTable');
    if (!container) return;
    
    if (TRANSFERS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد تحويلات</div>';
        return;
    }
    
    var html = '<table><thead><tr><th>الرقم</th><th>التاريخ</th><th>من</th><th>إلى</th><th>الغرض</th><th>المبلغ</th><th>العملية</th><th>ملاحظات</th>';
    
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead><tbody>';
    
    TRANSFERS_STATE.records.forEach(function(t) {
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(t.reference_number || '-') + '</strong></td>';
        html += '<td>' + formatDate(t.transfer_date) + '</td>';
        html += '<td>' + _getFromText(t) + '</td>';
        html += '<td>' + _getToText(t) + '</td>';
        html += '<td>' + (PURPOSE_TEXT_AR[t.purpose] || t.purpose || '-') + '</td>';
        html += '<td class="amount-cell">' + formatMoney(t.amount) + '</td>';
        html += '<td>' + (t.operation ? escapeHtml(t.operation.name) : '-') + '</td>';
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
// 4. UNIFIED PARTIES SELECT
// ============================================================

function _buildAllPartiesOptions() {
    var options = '<option value="">-- اختر الحساب --</option>';
    options += '<option value="company:company" data-type="company">🏢 الشركة</option>';
    
    var clients = TRANSFERS_STATE.referenceCache.clients || [];
    if (clients.length > 0) {
        options += '<optgroup label="👤 العملاء">';
        clients.forEach(function(c) {
            if (!c.is_archived) {
                options += '<option value="client:' + c.id + '" data-type="client">👤 ' + escapeHtml(c.name) + '</option>';
            }
        });
        options += '</optgroup>';
    }
    
    var investors = TRANSFERS_STATE.referenceCache.investors || [];
    if (investors.length > 0) {
        options += '<optgroup label="💼 الممولين">';
        investors.forEach(function(inv) {
            if (!inv.is_archived) {
                options += '<option value="investor:' + inv.id + '" data-type="investor">💼 ' + escapeHtml(inv.name) + '</option>';
            }
        });
        options += '</optgroup>';
    }
    
    return options;
}

function _parsePartyValue(value) {
    if (!value) return { type: null, id: null };
    var parts = value.split(':');
    return { type: parts[0], id: parts[1] };
}

function _determineTransferType(fromType, toType) {
    return fromType + '_to_' + toType;
}

// ============================================================
// 5. OPEN MODAL
// ============================================================

async function openTransferModal(transferId, prefill) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    
    var titleEl = document.getElementById('transferModalTitle');
    if (!titleEl) return;
    
    await Promise.all([
        loadClientsForTransfers(),
        loadInvestorsForTransfers(),
        loadOperationsForTransfers()
    ]);
    
    var fromEl = document.getElementById('transferFromType');
    var toEl = document.getElementById('transferToType');
    var opEl = document.getElementById('transferOperation');
    
    var allOptions = _buildAllPartiesOptions();
    if (fromEl) fromEl.innerHTML = allOptions;
    if (toEl) toEl.innerHTML = allOptions;
    
    if (opEl && TRANSFERS_STATE.referenceCache.operations) {
        var options = '<option value="">-- بدون عملية --</option>';
        TRANSFERS_STATE.referenceCache.operations.forEach(function(op) {
            if (!op.is_archived) options += '<option value="' + op.id + '">' + escapeHtml(op.name) + '</option>';
        });
        opEl.innerHTML = options;
    }
    
    resetTransferForm();
    
    if (transferId) {
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
        if (prefill) _applyPrefill(prefill);
    }
    
    var warningEl = document.getElementById('transferValidationWarning');
    if (warningEl) warningEl.innerHTML = '';
    
    openModal('transferModal');
}

function editTransfer(transferId) {
    openTransferModal(transferId);
}

// ============================================================
// 6. DYNAMIC FIELDS UPDATE
// ============================================================

function updateTransferFields() {
    var fromEl = document.getElementById('transferFromType');
    var toEl = document.getElementById('transferToType');
    if (!fromEl || !toEl) return;
    
    var from = _parsePartyValue(fromEl.value);
    var to = _parsePartyValue(toEl.value);
    
    var fromEntityRow = document.getElementById('transferFromEntityRow');
    var toEntityRow = document.getElementById('transferToEntityRow');
    if (fromEntityRow) fromEntityRow.style.display = 'none';
    if (toEntityRow) toEntityRow.style.display = 'none';
    
    if (from.type && to.type) {
        var transferType = _determineTransferType(from.type, to.type);
        var flow = TRANSFER_FLOW_MAP[transferType];
        
        if (flow) {
            _updatePurposeField(from.type, to.type);
            updateTransferSummary(from.type, to.type);
            
            var fromPartyEl = document.getElementById('transferFromParty');
            var toPartyEl = document.getElementById('transferToParty');
            var catEl = document.getElementById('transferTransactionCategory');
            
            if (fromPartyEl) fromPartyEl.value = from.type;
            if (toPartyEl) toPartyEl.value = to.type;
            if (catEl) catEl.value = flow.transaction_category;
        } else {
            var summaryEl = document.getElementById('transferSummary');
            if (summaryEl) summaryEl.style.display = 'none';
            
            var purposeRow = document.getElementById('transferPurposeRow');
            if (purposeRow) purposeRow.style.display = 'none';
        }
    } else {
        var summaryEl = document.getElementById('transferSummary');
        if (summaryEl) summaryEl.style.display = 'none';
        
        var purposeRow = document.getElementById('transferPurposeRow');
        if (purposeRow) purposeRow.style.display = 'none';
    }
}

// ============================================================
// 7. PURPOSE FIELD
// ============================================================

function _updatePurposeField(fromType, toType) {
    var purposeRow = document.getElementById('transferPurposeRow');
    var purposeSelect = document.getElementById('transferPurpose');
    
    if (!purposeRow) {
        var amountLabel = document.querySelector('#transferModal label[for="transferAmount"]');
        if (!amountLabel) return;
        
        var amountGroup = amountLabel.closest('.form-group');
        if (!amountGroup) return;
        
        purposeRow = document.createElement('div');
        purposeRow.className = 'form-group';
        purposeRow.id = 'transferPurposeRow';
        purposeRow.innerHTML = '<label for="transferPurpose" style="display:block;font-weight:500;margin-bottom:6px;">الغرض *</label><select id="transferPurpose" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></select>';
        
        amountGroup.parentNode.insertBefore(purposeRow, amountGroup);
        purposeSelect = document.getElementById('transferPurpose');
    }
    
    if (!purposeSelect) return;
    
    if (!fromType || !toType) {
        purposeRow.style.display = 'none';
        return;
    }
    
    var flow = TRANSFER_FLOW_MAP[fromType + '_to_' + toType];
    if (!flow) {
        purposeRow.style.display = 'none';
        return;
    }
    
    var options = '';
    flow.purpose_options.forEach(function(p) {
        options += '<option value="' + p + '">' + (PURPOSE_TEXT_AR[p] || p) + '</option>';
    });
    
    purposeSelect.innerHTML = options;
    purposeRow.style.display = 'block';
}

function updateTransferSummary(fromType, toType) {
    var summaryEl = document.getElementById('transferSummary');
    if (!summaryEl) return;
    
    if (!fromType || !toType) {
        summaryEl.style.display = 'none';
        return;
    }
    
    var flow = TRANSFER_FLOW_MAP[fromType + '_to_' + toType];
    if (!flow) {
        summaryEl.style.display = 'none';
        return;
    }
    
    var fromText = fromType === 'company' ? '🏢 الشركة' : (fromType === 'client' ? '👤 عميل' : '💼 ممول');
    var toText = toType === 'company' ? '🏢 الشركة' : (toType === 'client' ? '👤 عميل' : '💼 ممول');
    
    var sf = document.getElementById('summaryFrom');
    if (sf) sf.textContent = fromText;
    
    var st = document.getElementById('summaryTo');
    if (st) st.textContent = toText;
    
    var sc = document.getElementById('summaryCategory');
    if (sc) sc.textContent = flow.label;
    
    summaryEl.style.display = 'block';
}

// ============================================================
// 8. POPULATE FORM (EDIT)
// ============================================================

function populateTransferForm(transfer, title) {
    var titleEl = document.getElementById('transferModalTitle');
    if (titleEl) titleEl.textContent = title;
    
    _setTransVal('transferId', transfer.id);
    
    var fromEl = document.getElementById('transferFromType');
    var toEl = document.getElementById('transferToType');
    
    if (fromEl) {
        var fromValue = '';
        switch (transfer.type) {
            case 'company_to_client':
            case 'company_to_investor':
                fromValue = 'company:company';
                break;
            case 'client_to_company':
            case 'client_to_investor':
                fromValue = 'client:' + transfer.client_id;
                break;
            case 'investor_to_company':
            case 'investor_to_client':
                fromValue = 'investor:' + transfer.investor_id;
                break;
        }
        fromEl.value = fromValue;
    }
    
    if (toEl) {
        var toValue = '';
        switch (transfer.type) {
            case 'client_to_company':
            case 'investor_to_company':
                toValue = 'company:company';
                break;
            case 'company_to_client':
            case 'investor_to_client':
                toValue = 'client:' + transfer.client_id;
                break;
            case 'company_to_investor':
            case 'client_to_investor':
                toValue = 'investor:' + transfer.investor_id;
                break;
        }
        toEl.value = toValue;
    }
    
    updateTransferFields();
    
    _setTransVal('transferAmount', transfer.amount);
    _setTransVal('transferOperation', transfer.operation_id);
    _setTransVal('transferDate', formatDateForInput(transfer.transfer_date));
    _setTransVal('transferNotes', transfer.notes);
    
    setTimeout(function() {
        if (transfer.purpose) _setTransVal('transferPurpose', transfer.purpose);
    }, 100);
}

function resetTransferForm() {
    ['transferId', 'transferFromType', 'transferToType', 'transferAmount',
     'transferOperation', 'transferNotes', 'transferTransactionCategory', 'transferPurpose'].forEach(function(id) {
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
// 9. PREFILL
// ============================================================

function _applyPrefill(prefill) {
    debug('📝 تعبئة مسبقة: ' + JSON.stringify(prefill), 'info');
    
    var fromEl = document.getElementById('transferFromType');
    var toEl = document.getElementById('transferToType');
    
    if (prefill.fromType && prefill.fromEntity) {
        if (fromEl) fromEl.value = prefill.fromType + ':' + prefill.fromEntity;
    } else if (prefill.fromType === 'company') {
        if (fromEl) fromEl.value = 'company:company';
    }
    
    if (prefill.toType && prefill.toEntity) {
        if (toEl) toEl.value = prefill.toType + ':' + prefill.toEntity;
    } else if (prefill.toType === 'company') {
        if (toEl) toEl.value = 'company:company';
    }
    
    updateTransferFields();
    
    setTimeout(function() {
        if (prefill.amount) _setTransVal('transferAmount', prefill.amount);
        if (prefill.operationId) _setTransVal('transferOperation', prefill.operationId);
        if (prefill.date) _setTransVal('transferDate', prefill.date);
        if (prefill.purpose) _setTransVal('transferPurpose', prefill.purpose);
    }, 150);
}

// ============================================================
// 10. COLLECT & VALIDATE
// ============================================================

function collectTransferFormData() {
    var fromEl = document.getElementById('transferFromType');
    var toEl = document.getElementById('transferToType');
    
    var from = _parsePartyValue(fromEl ? fromEl.value : '');
    var to = _parsePartyValue(toEl ? toEl.value : '');
    
    var clientId = null, investorId = null;
    
    if (from.type === 'client') clientId = from.id;
    else if (to.type === 'client') clientId = to.id;
    
    if (from.type === 'investor') investorId = from.id;
    else if (to.type === 'investor') investorId = to.id;
    
    var purposeEl = document.getElementById('transferPurpose');
    
    return {
        id: _getTransVal('transferId'),
        fromType: from.type,
        fromId: from.id,
        toType: to.type,
        toId: to.id,
        clientId: clientId,
        investorId: investorId,
        operationId: _getTransVal('transferOperation'),
        amount: _getTransVal('transferAmount'),
        transferDate: _getTransVal('transferDate'),
        notes: _getTransVal('transferNotes').trim(),
        transactionCategory: _getTransVal('transferTransactionCategory'),
        purpose: purposeEl ? purposeEl.value : ''
    };
}

async function validateTransferForm(formData) {
    if (!formData.fromType || !formData.toType) {
        showToast('❌ يجب اختيار من وإلى', 'error');
        return false;
    }
    
    if (formData.fromType === formData.toType && formData.fromId && formData.fromId === formData.toId) {
        showToast('❌ لا يمكن التحويل من الطرف إلى نفسه', 'error');
        return false;
    }
    
    if (formData.fromType === 'company' && formData.toType === 'company') {
        showToast('❌ لا يمكن التحويل من الشركة إلى نفسها', 'error');
        return false;
    }
    
    var flow = TRANSFER_FLOW_MAP[formData.fromType + '_to_' + formData.toType];
    if (!flow) {
        showToast('❌ هذا النوع من التحويل غير مسموح', 'error');
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
// 11. LOCK PROTECTION HELPER
// ============================================================

async function _assertOperationEditable(opId) {
    if (!opId) return true;
    
    var r = await runQuery(function() {
        return APP.supabase.from('operations').select('is_locked, status').eq('id', opId).single();
    }, { context: 'transfer-opLock', throwError: false });
    
    if (!r.data) return true;
    
    return !(r.data.is_locked === true || r.data.status === 'completed' || r.data.status === 'cancelled');
}

// ============================================================
// 12. SAVE TRANSFER
// ============================================================

async function saveTransfer() {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    
    var formData = collectTransferFormData();
    if (!(await validateTransferForm(formData))) return;
    
    var flow = TRANSFER_FLOW_MAP[formData.fromType + '_to_' + formData.toType];
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
            var oldResult = await runQuery(function() {
                return APP.supabase.from('transfers').select('*').eq('id', formData.id).single();
            }, { context: 'saveTransfer-getOld', throwError: true });
            
            var oldOpId = oldResult.data ? oldResult.data.operation_id : null;
            
            if (!(await _assertOperationEditable(oldOpId))) {
                showToast('❌ العملية مقفلة أو منتهية - لا يمكن تعديل التحويل', 'error');
                hideLoading();
                return;
            }
            
            if (formData.operationId && formData.operationId !== oldOpId && !(await _assertOperationEditable(formData.operationId))) {
                showToast('❌ العملية المقصودة مقفلة أو منتهية - لا يمكن نقل التحويل إليها', 'error');
                hideLoading();
                return;
            }
            
            await runQuery(function() {
                return APP.supabase.from('transfers').update(data).eq('id', formData.id);
            }, { context: 'saveTransfer-update', throwError: true });
            
            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB('تعديل تحويل', 'transfer', formData.id, JSON.stringify(oldResult.data), JSON.stringify(data), 'From: ' + formData.fromType + ' → To: ' + formData.toType, 'update');
            }
            
            showToast('✅ تم تحديث التحويل', 'success');
        } else {
            var result = await runQuery(function() {
                return APP.supabase.from('transfers').insert(data).select();
            }, { context: 'saveTransfer-insert', throwError: true });
            
            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB('إضافة تحويل', 'transfer', result.data[0].id, null, JSON.stringify(data), 'From: ' + formData.fromType + ' → To: ' + formData.toType, 'create');
                }
                showToast('✅ تم إضافة التحويل', 'success');
            }
        }
        
        closeModal('transferModal');
        clearTransfersListCache();
        loadTransfers();
        refreshRelatedScreens(data.operation_id);
    } catch (err) {
        debug('❌ خطأ في saveTransfer: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ التحويل'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 13. DELETE TRANSFER
// ============================================================

async function deleteTransfer(transferId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    
    var transfer = TRANSFERS_STATE.records.find(function(t) { return t.id === transferId; });
    if (!transfer) { showToast('❌ التحويل غير موجود', 'error'); return; }
    
    if (transfer.operation_id && !(await _assertOperationEditable(transfer.operation_id))) {
        showToast('❌ العملية مقفلة أو منتهية - لا يمكن حذف التحويل', 'error');
        return;
    }
    
    var warningMsg;
    
    if (WORKFLOW_TRANSFER_PURPOSES.indexOf(transfer.purpose) !== -1) {
        warningMsg = '⚠️ تحذير: هذا التحويل مرتبط بسير العمل وحذفه سيؤثر على الأرصدة وحالة التمويل.\n\nهل أنت متأكد؟';
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
            window.logActivityToDB('حذف تحويل', 'transfer', transferId, JSON.stringify(oldResult.data), null, 'Amount: ' + (oldResult.data ? oldResult.data.amount : ''), 'delete');
        }
        
        showToast('✅ تم حذف التحويل', 'success');
        clearTransfersListCache();
        loadTransfers();
        refreshRelatedScreens(transfer.operation_id);
    } catch (err) {
        showToast(handleSupabaseError(err, 'حذف التحويل'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 14. REFRESH & SEARCH & CACHE
// ============================================================

function refreshRelatedScreens(operationId) {
    if (operationId && typeof loadOpInvestorsTab === 'function') loadOpInvestorsTab(operationId);
    if (typeof loadDashboard === 'function' && APP.currentScreen === 'dashboard') loadDashboard();
    if (typeof loadClients === 'function' && APP.currentScreen === 'clients') loadClients();
    if (typeof loadInvestors === 'function' && APP.currentScreen === 'investors') loadInvestors();
}

function searchTransfers(searchTerm) {
    TRANSFERS_STATE.search = searchTerm || '';
    loadTransfers();
}

function filterTransfers(filterValue) {
    TRANSFERS_STATE.filter = filterValue || '';
    loadTransfers();
}

function clearTransfersReferenceCache() {
    TRANSFERS_STATE.referenceCache.clients = null;
    TRANSFERS_STATE.referenceCache.investors = null;
    TRANSFERS_STATE.referenceCache.operations = null;
}

function clearTransfersListCache() {
    TRANSFERS_STATE.listCache.records = null;
    TRANSFERS_STATE.listCache.lastLoad = null;
}

function _getTransVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function _setTransVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = (value !== null && value !== undefined) ? value : '';
}

// ============================================================
// 15. DISPLAY TEXT HELPERS
// ============================================================

function getTransferTypeText(type) {
    var map = {
        'company_to_client': 'تمويل عميل (شركة ← عميل)',
        'client_to_company': 'سداد من عميل (عميل ← شركة)',
        'company_to_investor': 'تحويل لممول (شركة ← ممول)',
        'investor_to_company': 'إيداع من ممول (ممول ← شركة)',
        'client_to_investor': 'تحويل من عميل لممول',
        'investor_to_client': 'تحويل من ممول لعميل'
    };
    
    return map[type] || type || '-';
}

function getPurposeText(purpose) {
    return PURPOSE_TEXT_AR[purpose] || purpose || '-';
}

if (typeof window !== 'undefined') {
    window.getTransferTypeText = getTransferTypeText;
    window.getPurposeText = getPurposeText;
}

if (typeof document !== 'undefined') {
    initTransfers();
}

// ============================================================
// END OF TRANSFERS.JS (v6.2.1)
// ============================================================
