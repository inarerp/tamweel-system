// ============================================================
// نظام إدارة التمويل - Transfers Module (Parties Ledger)
// Version: 5.1.0 (Fix: Dynamic Entity Rows)
// Last Updated: 2026-08-04
// ============================================================

var TRANSFERS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null, operations: null },
    listCache: { lastLoad: null, records: null }
};

// ============================================================
// 1. TRANSFER FLOW MAP
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

var PURPOSE_TEXT_AR = Object.freeze({
    client_funding: 'تمويل',
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

// ============================================================
// 2. INITIALIZATION
// ============================================================

function initTransfers() {
    debug('💸 بدء تهيئة transfers.js', 'info');
    if (typeof registerScreenLoader === 'function') {
        registerScreenLoader('transfers', loadTransfers);
    }
    debug('✅ transfers.js جاهز', 'success');
}

// ============================================================
// 3. LOAD TRANSFERS
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
// 4. REFERENCE DATA
// ============================================================

async function loadClientsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.clients) return TRANSFERS_STATE.referenceCache.clients;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('clients').select('id, name, is_archived').order('name');
        }, { context: 'loadClientsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.clients = result.data || [];
        return TRANSFERS_STATE.referenceCache.clients;
    } catch (err) { return []; }
}

async function loadInvestorsForTransfers() {
    if (TRANSFERS_STATE.referenceCache.investors) return TRANSFERS_STATE.referenceCache.investors;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('investors').select('id, name, is_archived').order('name');
        }, { context: 'loadInvestorsForTransfers', throwError: true });
        TRANSFERS_STATE.referenceCache.investors = result.data || [];
        return TRANSFERS_STATE.referenceCache.investors;
    } catch (err) { return []; }
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
    } catch (err) { return []; }
}

function buildTransfersIndexes(clients, investors, operations) {
    var clientsById = {}, investorsById = {}, operationsById = {};
    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });
    operations.forEach(function(op) { operationsById[op.id] = op; });
    return { clientsById: clientsById, investorsById: investorsById, operationsById: operationsById };
}

// ============================================================
// 5. RENDER LIST
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
// 6. OPEN MODAL (مع دعم prefill)
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

    if (opEl && TRANSFERS_STATE.referenceCache.operations) {
        var options = '<option value="">-- بدون عملية --</option>';
        TRANSFERS_STATE.referenceCache.operations.forEach(function(op) {
            if (!op.is_archived) options += '<option value="' + op.id + '">' + escapeHtml(op.name) + '</option>';
        });
        opEl.innerHTML = options;
    }

    // ✅ إنشاء حقول الأطراف ديناميكياً إذا لم تكن موجودة
    _ensureEntityRows();

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
// 7. ✅ DYNAMIC ENTITY ROWS (الحل الجذري)
// ============================================================

function _ensureEntityRows() {
    var fromTypeEl = document.getElementById('transferFromType');
    var toTypeEl = document.getElementById('transferToType');

    // إنشاء صف "من" إذا لم يوجد
    if (fromTypeEl && !document.getElementById('transferFromEntityRow')) {
        var fromGroup = fromTypeEl.closest('.form-group');
        if (fromGroup) {
            var fromRow = document.createElement('div');
            fromRow.className = 'form-group';
            fromRow.id = 'transferFromEntityRow';
            fromRow.style.display = 'none';
            fromRow.innerHTML = '<label id="transferFromEntityLabel" style="display:block;font-weight:bold;color:#667eea;margin-bottom:6px;">اختر الطرف *</label>' +
                '<select id="transferFromEntity" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></select>';
            fromGroup.insertAdjacentElement('afterend', fromRow);
            debug('✅ تم إنشاء حقل اختيار الطرف المصدر ديناميكياً', 'success');
        }
    }

    // إنشاء صف "إلى" إذا لم يوجد
    if (toTypeEl && !document.getElementById('transferToEntityRow')) {
        var toGroup = toTypeEl.closest('.form-group');
        if (toGroup) {
            var toRow = document.createElement('div');
            toRow.className = 'form-group';
            toRow.id = 'transferToEntityRow';
            toRow.style.display = 'none';
            toRow.innerHTML = '<label id="transferToEntityLabel" style="display:block;font-weight:bold;color:#667eea;margin-bottom:6px;">اختر الطرف *</label>' +
                '<select id="transferToEntity" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></select>';
            toGroup.insertAdjacentElement('afterend', toRow);
            debug('✅ تم إنشاء حقل اختيار الطرف المستلم ديناميكياً', 'success');
        }
    }
}

function _highlightRow(row) {
    if (!row) return;
    row.style.display = 'block';
    row.style.background = '#eef0ff';
    row.style.padding = '12px';
    row.style.borderRadius = '8px';
    row.style.border = '2px solid #667eea';
    row.style.marginBottom = '12px';
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

    // ✅ التأكد من وجود الحقول ديناميكياً
    _ensureEntityRows();

    var fromEntityRow = document.getElementById('transferFromEntityRow');
    var toEntityRow = document.getElementById('transferToEntityRow');
    var fromEntitySelect = document.getElementById('transferFromEntity');
    var toEntitySelect = document.getElementById('transferToEntity');
    var fromEntityLabel = document.getElementById('transferFromEntityLabel');
    var toEntityLabel = document.getElementById('transferToEntityLabel');

    // إخفاء أولاً
    if (fromEntityRow) fromEntityRow.style.display = 'none';
    if (toEntityRow) toEntityRow.style.display = 'none';
    if (fromEntitySelect) fromEntitySelect.value = '';
    if (toEntitySelect) toEntitySelect.value = '';

    // ✅ إظهار حقل الطرف المصدر
    if (fromType === 'client' || fromType === 'investor') {
        var fromData = populateEntitySelect(fromType);
        if (fromData && fromEntityRow && fromEntitySelect) {
            if (fromEntityLabel) fromEntityLabel.textContent = fromData.label;
            fromEntitySelect.innerHTML = fromData.options;
            _highlightRow(fromEntityRow);
        }
    }

    // ✅ إظهار حقل الطرف المستلم
    if (toType === 'client' || toType === 'investor') {
        var toData = populateEntitySelect(toType);
        if (toData && toEntityRow && toEntitySelect) {
            if (toEntityLabel) toEntityLabel.textContent = toData.label;
            toEntitySelect.innerHTML = toData.options;
            _highlightRow(toEntityRow);
        }
    }

    _updatePurposeField(fromType, toType);
    updateTransferSummary(fromType, toType);

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
        label = '👤 اختر العميل *';
    } else if (type === 'investor') {
        entities = TRANSFERS_STATE.referenceCache.investors || [];
        label = '💼 اختر الممول *';
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

// ============================================================
// 9. PURPOSE FIELD (ديناميكي)
// ============================================================

function _updatePurposeField(fromType, toType) {
    var purposeRow = document.getElementById('transferPurposeRow');

    if (!purposeRow) {
        var amountLabel = document.querySelector('#transferModal label[for="transferAmount"]');
        if (!amountLabel) return;
        var amountGroup = amountLabel.closest('.form-group');
        if (!amountGroup) return;

        purposeRow = document.createElement('div');
        purposeRow.className = 'form-group';
        purposeRow.id = 'transferPurposeRow';
        purposeRow.innerHTML = '<label for="transferPurpose">الغرض *</label><select id="transferPurpose"></select>';
        amountGroup.parentNode.insertBefore(purposeRow, amountGroup);
    }

    var purposeSelect = document.getElementById('transferPurpose');
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
    flow.purpose_options.forEach(function(purpose) {
        options += '<option value="' + purpose + '">' + (PURPOSE_TEXT_AR[purpose] || purpose) + '</option>';
    });

    purposeSelect.innerHTML = options;
    purposeRow.style.display = 'block';
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

    var flow = TRANSFER_FLOW_MAP[fromType + '_to_' + toType];
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
// 10. POPULATE FORM (EDIT)
// ============================================================

function populateTransferForm(transfer, title) {
    var titleEl = document.getElementById('transferModalTitle');
    if (titleEl) titleEl.textContent = title;

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

    setTimeout(function() {
        if (transfer.purpose) _setTransVal('transferPurpose', transfer.purpose);
    }, 100);
}

function resetTransferForm() {
    ['transferId', 'transferFromType', 'transferToType', 'transferFromEntity',
     'transferToEntity', 'transferAmount', 'transferOperation', 'transferNotes',
     'transferTransactionCategory', 'transferPurpose'].forEach(function(id) {
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
// 11. PREFILL
// ============================================================

function _applyPrefill(prefill) {
    debug('📝 تعبئة مسبقة: ' + JSON.stringify(prefill), 'info');

    if (prefill.fromType) _setTransVal('transferFromType', prefill.fromType);
    if (prefill.toType) _setTransVal('transferToType', prefill.toType);

    updateTransferFields();

    setTimeout(function() {
        if (prefill.fromEntity) _setTransVal('transferFromEntity', prefill.fromEntity);
        if (prefill.toEntity) _setTransVal('transferToEntity', prefill.toEntity);
        if (prefill.amount) _setTransVal('transferAmount', prefill.amount);
        if (prefill.operationId) _setTransVal('transferOperation', prefill.operationId);
        if (prefill.date) _setTransVal('transferDate', prefill.date);
        if (prefill.purpose) _setTransVal('transferPurpose', prefill.purpose);

        var fromType = _getTransVal('transferFromType');
        var toType = _getTransVal('transferToType');
        if (fromType && toType) updateTransferSummary(fromType, toType);
    }, 150);
}

// ============================================================
// 12. COLLECT & VALIDATE
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
        purpose: _getTransVal('transferPurpose')
    };
}

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

    if ((formData.fromType === 'client' || formData.fromType === 'investor') && !formData.clientId && !formData.investorId) {
        showToast('❌ يجب اختيار الطرف المصدر (مَن الذي أرسل الأموال؟)', 'error');
        return false;
    }

    if ((formData.toType === 'client' || formData.toType === 'investor') && !formData.clientId && !formData.investorId) {
        showToast('❌ يجب اختيار الطرف المستلم (مَن الذي استلم الأموال؟)', 'error');
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
// 13. SAVE TRANSFER
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
        refreshRelatedScreens(data.operation_id);

    } catch (err) {
        debug('❌ خطأ في saveTransfer: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ التحويل'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 14. DELETE TRANSFER
// ============================================================

async function deleteTransfer(transferId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

    var transfer = TRANSFERS_STATE.records.find(function(t) { return t.id === transferId; });
    if (!transfer) { showToast('❌ التحويل غير موجود', 'error'); return; }

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
            window.logActivityToDB('حذف تحويل', 'transfer', transferId,
                JSON.stringify(oldResult.data), null,
                'Amount: ' + (oldResult.data ? oldResult.data.amount : ''), 'delete');
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
// 15. REFRESH RELATED SCREENS
// ============================================================

function refreshRelatedScreens(operationId) {
    debug('🔄 تحديث الشاشات المرتبطة...', 'info');

    if (operationId && typeof loadOpInvestorsTab === 'function') {
        loadOpInvestorsTab(operationId);
    }

    if (typeof loadDashboard === 'function' && APP.currentScreen === 'dashboard') {
        loadDashboard();
    }

    if (typeof loadClients === 'function' && APP.currentScreen === 'clients') {
        loadClients();
    }

    if (typeof loadInvestors === 'function' && APP.currentScreen === 'investors') {
        loadInvestors();
    }
}

// ============================================================
// 16. SEARCH & FILTER & CACHE
// ============================================================

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

// ============================================================
// 17. HELPERS
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
