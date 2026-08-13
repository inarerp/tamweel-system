// ============================================================
// نظام إدارة التمويل - Operations Module (Operation Control Center)
// Version: 10.1.1
// Last Updated: 2026-08-05
// ============================================================
// الفلسفة: كل إجراءات العملية تتم من داخل صفحتها،
//          والنظام ينشئ التحويلات تلقائياً في الخلفية.
//          شاشة التحويلات = سجل محاسبي فقط.
// ============================================================

var OPERATIONS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null },
    currentOperationId: null,
    currentOperation: null,
    currentCalcData: null,
    currentFunding: null,
    currentProfits: null,
    currentFinancials: null,
    _lastInvestors: null,
    _lastNames: null
};

function initOperations() {
    debug('⚙️ بدء تهيئة operations.js (v10.1.1)', 'info');
    if (typeof registerScreenLoader === 'function') registerScreenLoader('operations', loadOperations);
    debug('✅ operations.js v10.1.1 جاهز', 'success');
}

// ============================================================
// 1. LOAD LIST
// ============================================================

async function loadOperations() {
    if (!isSupabaseReady()) return;
    showLoading();
    try {
        var results = await Promise.all([
            runQuery(function() {
                var q = APP.supabase.from('operations')
                    .select('id, name, type, client_id, amount, expected_profit, final_profit, status, start_date, end_date, is_locked, is_archived, created_at')
                    .order('created_at', { ascending: false });
                if (OPERATIONS_STATE.filter) q = q.eq('status', OPERATIONS_STATE.filter);
                if (OPERATIONS_STATE.search) q = q.or('name.ilike.%' + OPERATIONS_STATE.search + '%');
                return q;
            }, { context: 'loadOperations', throwError: true }),
            loadClientsForOps()
        ]);
        
        var ops = results[0].data || [];
        var byId = {};
        (results[1] || []).forEach(function(c) { byId[c.id] = c; });
        ops.forEach(function(op) { op.client = byId[op.client_id] || null; });
        
        OPERATIONS_STATE.records = ops;
        renderOperationsList();
    } catch (err) {
        showToast(handleSupabaseError(err, 'تحميل العمليات'), 'error');
    } finally {
        hideLoading();
    }
}

async function loadClientsForOps() {
    if (OPERATIONS_STATE.referenceCache.clients) return OPERATIONS_STATE.referenceCache.clients;
    try {
        var r = await runQuery(function() {
            return APP.supabase.from('clients').select('id, name, is_archived').eq('is_archived', false).order('name');
        }, { context: 'loadClientsForOps', throwError: true });
        OPERATIONS_STATE.referenceCache.clients = r.data || [];
        return OPERATIONS_STATE.referenceCache.clients;
    } catch (e) {
        return [];
    }
}

async function loadInvestorsForOps() {
    if (OPERATIONS_STATE.referenceCache.investors) return OPERATIONS_STATE.referenceCache.investors;
    try {
        var r = await runQuery(function() {
            return APP.supabase.from('investors').select('id, name, is_archived').eq('is_archived', false).order('name');
        }, { context: 'loadInvestorsForOps', throwError: true });
        OPERATIONS_STATE.referenceCache.investors = r.data || [];
        return OPERATIONS_STATE.referenceCache.investors;
    } catch (e) {
        return [];
    }
}

function renderOperationsList() {
    var container = document.getElementById('operationsTable');
    if (!container) return;
    if (!OPERATIONS_STATE.records.length) {
        container.innerHTML = '<div class="empty-state">لا توجد عمليات</div>';
        return;
    }
    
    var html = '<table><thead><tr><th>الاسم</th><th>العميل</th><th>المبلغ</th><th>الربح المتوقع</th><th>الحالة</th><th>تاريخ النهاية</th><th>الإجراءات</th></tr></thead><tbody>';
    
    OPERATIONS_STATE.records.forEach(function(op) {
        var locked = op.is_locked || op.status === 'completed' || op.status === 'cancelled';
        html += '<tr>';
        html += '<td><a href="#" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.name) + '</a></td>';
        html += '<td>' + (op.client ? escapeHtml(op.client.name) : '-') + '</td>';
        html += '<td>' + formatMoney(op.amount) + '</td>';
        html += '<td class="profit-field">' + formatMoney(op.expected_profit || 0) + '</td>';
        html += '<td><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span></td>';
        html += '<td>' + formatDate(op.end_date) + '</td>';
        html += '<td class="actions-cell">';
        if (canEdit()) {
            html += '<button class="btn btn-secondary btn-sm" data-action="editOperation" data-param="' + op.id + '">✏️</button> ';
            if (!locked) html += '<button class="btn btn-warning btn-sm" data-action="archiveOperation" data-param="' + op.id + '">📦</button>';
        }
        html += '</td></tr>';
    });
    
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ============================================================
// 2. ADD / EDIT OPERATION
// ============================================================

async function openOperationModal(operationId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    
    var titleEl = document.getElementById('operationModalTitle');
    var idEl = document.getElementById('operationId');
    if (!titleEl || !idEl) return;
    
    await loadClientsForOps();
    
    var cs = document.getElementById('opClient');
    if (cs) {
        var o = '<option value="">-- اختر العميل --</option>';
        (OPERATIONS_STATE.referenceCache.clients || []).forEach(function(c) {
            o += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        });
        cs.innerHTML = o;
    }
    
    ['opName','opAmount','opInvestorDisplayAmount','opExpectedProfit','opFinalProfit','opProfitApprovalDate','opGoogleDriveUrl','opCompanyProfitValue','opStartDate','opDurationDays','opEndDate','opNotes'].forEach(function(id){
        _setVal(id,'');
    });
    _setVal('opType','financing');
    _setVal('opCompanyProfitType','');
    _setVal('opStatus','draft');
    
    if (operationId) {
        try {
            var r = await runQuery(function(){
                return APP.supabase.from('operations').select('*').eq('id', operationId).single();
            }, { context:'openOperationModal', throwError:true });
            
            var op = r.data;
            if (!op) { showToast('❌ العملية غير موجودة','error'); return; }
            
            titleEl.textContent = 'تعديل عملية';
            idEl.value = op.id;
            
            _setVal('opName',op.name);
            _setVal('opType',op.type);
            _setVal('opClient',op.client_id);
            _setVal('opAmount',op.amount);
            _setVal('opInvestorDisplayAmount',op.investor_display_amount);
            _setVal('opExpectedProfit',op.expected_profit);
            _setVal('opFinalProfit',op.final_profit);
            _setVal('opProfitApprovalDate',formatDateForInput(op.profit_approval_date));
            _setVal('opGoogleDriveUrl',op.google_drive_url);
            _setVal('opCompanyProfitType',op.company_profit_type);
            _setVal('opCompanyProfitValue',op.company_profit_value);
            _setVal('opStartDate',formatDateForInput(op.start_date));
            _setVal('opDurationDays',op.duration_days);
            _setVal('opEndDate',formatDateForInput(op.end_date));
            _setVal('opStatus',op.status);
            _setVal('opNotes',op.notes);
        } catch (e) {
            showToast(handleSupabaseError(e,'جلب بيانات العملية'),'error');
            return;
        }
    } else {
        titleEl.textContent = 'إضافة عملية';
        idEl.value = '';
        _setVal('opStartDate', getTodayDate());
    }
    
    openModal('operationModal');
}

function editOperation(id) {
    if (!id) id = OPERATIONS_STATE.currentOperationId;
    if (!id) { showToast('❌ لا توجد عملية محددة','error'); return; }
    closeModal('operationDetailsModal');
    openOperationModal(id);
}

async function saveOperation(form, event) {
    if (event) event.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    
    var id = _getVal('operationId');
    
    var data = {
        name: _getVal('opName').trim(),
        type: _getVal('opType'),
        client_id: _getVal('opClient') || null,
        amount: parseFloat(_getVal('opAmount')) || 0,
        investor_display_amount: _getVal('opInvestorDisplayAmount') ? parseFloat(_getVal('opInvestorDisplayAmount')) : null,
        expected_profit: parseFloat(_getVal('opExpectedProfit')) || 0,
        final_profit: parseFloat(_getVal('opFinalProfit')) || 0,
        profit_approval_date: _getVal('opProfitApprovalDate') || null,
        google_drive_url: _getVal('opGoogleDriveUrl') || null,
        company_profit_type: _getVal('opCompanyProfitType') || null,
        company_profit_value: parseFloat(_getVal('opCompanyProfitValue')) || 0,
        start_date: _getVal('opStartDate'),
        duration_days: parseInt(_getVal('opDurationDays')) || 0,
        end_date: _getVal('opEndDate') || null,
        notes: _getVal('opNotes').trim()
    };
    
    if (!data.name) { showToast('❌ اسم العملية مطلوب','error'); return; }
    if (!data.client_id) { showToast('❌ اختر العميل','error'); return; }
    if (!data.amount || data.amount <= 0) { showToast('❌ المبلغ غير صحيح','error'); return; }
    if (!data.start_date) { showToast('❌ تاريخ البداية مطلوب','error'); return; }
    if (!data.end_date && data.start_date && data.duration_days > 0) {
        data.end_date = formatDateForInput(addDays(data.start_date, data.duration_days));
    }
    
    showLoading();
    try {
        if (id) {
            var old = await runQuery(function(){
                return APP.supabase.from('operations').select('*').eq('id', id).single();
            }, { context:'saveOp-old', throwError:true });
            
            await runQuery(function(){
                return APP.supabase.from('operations').update(data).eq('id', id);
            }, { context:'saveOp-upd', throwError:true });
            
            _log('تعديل عملية','operation', id, JSON.stringify(old.data), JSON.stringify(data), 'update');
            showToast('✅ تم تحديث العملية','success');
        } else {
            data.status = 'draft';
            var r = await runQuery(function(){
                return APP.supabase.from('operations').insert(data).select();
            }, { context:'saveOp-ins', throwError:true });
            
            if (r.data && r.data[0]) {
                _log('إضافة عملية','operation', r.data[0].id, null, JSON.stringify(data), 'create');
                showToast('✅ تم إضافة العملية','success');
            }
        }
        
        closeModal('operationModal');
        loadOperations();
    } catch (e) {
        showToast(handleSupabaseError(e,'حفظ العملية'),'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 3. CALC DATA BUILDER + COMPATIBILITY ADAPTER
// ============================================================

async function _buildCalcData(opId) {
    var results = await Promise.all([
        runQuery(function(){
            return APP.supabase.from('operations').select('*').eq('id', opId).single();
        }, { context:'calc-op', throwError:true }),
        runQuery(function(){
            return APP.supabase.from('operation_investors').select('id, investor_id, contribution, profit').eq('operation_id', opId);
        }, { context:'calc-opinv', throwError:false }),
        runQuery(function(){
            return APP.supabase.from('transfers').select('id, type, purpose, operation_id, client_id, investor_id, amount, transfer_date').eq('operation_id', opId);
        }, { context:'calc-trans', throwError:false })
    ]);
    
    var op = results[0].data || null;
    var opInv = results[1].data || [];
    var ts = results[2].data || [];
    
    var indexes = {
        operationsById: {},
        opInvestorsByOperation: {},
        transfersByOperation: {}
    };
    
    if (op) indexes.operationsById[op.id] = op;
    indexes.opInvestorsByOperation[opId] = opInv;
    indexes.transfersByOperation[opId] = ts;
    
    return {
        __opId: opId,
        operations: op ? [op] : [],
        operationInvestors: opInv,
        transfers: ts,
        indexes: indexes
    };
}

async function getOperationFinancials(opId) {
    var data = (OPERATIONS_STATE.currentCalcData && OPERATIONS_STATE.currentCalcData.__opId === opId)
        ? OPERATIONS_STATE.currentCalcData
        : await _buildCalcData(opId);
    
    var f = getOperationFunding(opId, data);
    var p = getOperationProfits(opId, data);
    
    var investors = {};
    f.perInvestor.forEach(function(pi) {
        investors[pi.investorId] = {
            funded: pi.funded,
            returned: pi.returned,
            profitPaid: pi.profitPaid
        };
    });
    
    return {
        totalFunded: f.funded,
        totalReturned: p.capitalReturned,
        totalProfitPaid: p.investorDistributed,
        clientPaid: f.clientRepayment,
        investors: investors
    };
}

// ============================================================
// 4. OPERATION DETAILS = CONTROL CENTER
// ============================================================

async function openOperationDetails(operationId) {
    if (!operationId) return;
    
    OPERATIONS_STATE.currentOperationId = operationId;
    showLoading();
    
    try {
        var calcData = await _buildCalcData(operationId);
        OPERATIONS_STATE.currentCalcData = calcData;
        
        var op = calcData.operations[0] || null;
        if (!op) { showToast('❌ العملية غير موجودة','error'); return; }
        
        OPERATIONS_STATE.currentOperation = op;
        
        var funding = getOperationFunding(operationId, calcData);
        var profits = getOperationProfits(operationId, calcData);
        
        OPERATIONS_STATE.currentFunding = funding;
        OPERATIONS_STATE.currentProfits = profits;
        OPERATIONS_STATE.currentFinancials = await getOperationFinancials(operationId);
        
        var editBtns = document.querySelectorAll('[data-action="editOperation"]');
        editBtns.forEach(function(b){ b.setAttribute('data-param', operationId); });
        
        var clientName = '-';
        if (op.client_id) {
            var cr = await runQuery(function(){
                return APP.supabase.from('clients').select('name').eq('id', op.client_id).single();
            }, { context:'opClient', throwError:false });
            if (cr.data) clientName = cr.data.name;
        }
        
        _renderSummary(op, clientName);
        _renderCoverage(op, getCoverage(operationId, calcData));
        _renderWorkflow(op, funding);
        _renderInvestorsTab(op, funding);
        
        await loadOpTransfersTab(operationId);
        await loadOpTimelineTab(operationId);
        
        var t = document.getElementById('opDetailsTitle');
        if (t) t.textContent = 'تفاصيل: ' + op.name;
        
        openModal('operationDetailsModal');
    } catch (e) {
        showToast(handleSupabaseError(e,'فتح تفاصيل العملية'),'error');
    } finally {
        hideLoading();
    }
}

function _renderSummary(op, clientName) {
    var g = document.getElementById('opSummaryGrid');
    if (!g) return;
    
    var html = '';
    html += '<div class="summary-item"><label>العميل</label><div class="val">' + escapeHtml(clientName) + '</div></div>';
    html += '<div class="summary-item"><label>قيمة العملية</label><div class="val blue">' + formatMoney(op.amount) + '</div></div>';
    html += '<div class="summary-item"><label>الربح المتوقع</label><div class="val orange">' + formatMoney(op.expected_profit || 0) + '</div></div>';
    html += '<div class="summary-item"><label>الربح النهائي</label><div class="val green">' + formatMoney(op.final_profit || 0) + '</div></div>';
    html += '<div class="summary-item"><label>الحالة</label><div class="val"><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span></div></div>';
    html += '<div class="summary-item"><label>تاريخ النهاية</label><div class="val">' + formatDate(op.end_date) + '</div></div>';
    
    if (op.is_locked) {
        html += '<div class="summary-item"><label>القفل</label><div class="val red">🔒 مقفلة</div></div>';
    }
    
    g.innerHTML = html;
}

function _renderCoverage(op, coverage) {
    var el = document.getElementById('opCoverageCard');
    if (!el) {
        var grid = document.getElementById('opSummaryGrid');
        if (!grid) return;
        el = document.createElement('div');
        el.id = 'opCoverageCard';
        grid.parentNode.insertBefore(el, grid.nextSibling);
    }
    
    var pct = Math.round(coverage.fundedCoverage);
    var ready = coverage.funded >= coverage.required && coverage.required > 0;
    
    var html = '<div style="background:#f8fafc;border-radius:10px;padding:16px;margin:12px 0;">';
    html += '<div style="display:flex;justify-content:space-between;margin-bottom:8px;"><strong>تغطية العملية</strong><span style="font-weight:700;color:' + (ready ? '#10b981' : '#f59e0b') + ';">' + pct + '%</span></div>';
    html += '<div style="background:#e2e8f0;border-radius:10px;height:18px;overflow:hidden;"><div style="background:' + (ready ? '#10b981' : '#667eea') + ';height:100%;width:' + Math.min(100, pct) + '%;transition:width .5s;"></div></div>';
    html += '<div style="display:flex;justify-content:space-between;margin-top:8px;font-size:.85rem;color:#64748b;flex-wrap:wrap;gap:6px;">';
    html += '<span>متعهد به: ' + formatMoney(coverage.committed) + '</span>';
    html += '<span>مستلم فعلياً: ' + formatMoney(coverage.funded) + '</span>';
    html += '<span>المطلوب: ' + formatMoney(coverage.required) + '</span>';
    html += '<span>متبقي تمويل الممولين: ' + formatMoney(coverage.remainingFunding) + '</span>';
    html += '</div>';
    
    if (ready) {
        html += '<div style="margin-top:10px;padding:8px 12px;background:#d1fae5;color:#065f46;border-radius:6px;font-size:.85rem;">✓ التمويل مكتمل - العملية جاهزة للتفعيل</div>';
    } else {
        html += '<div style="margin-top:10px;padding:8px 12px;background:#fef3c7;color:#92400e;border-radius:6px;font-size:.85rem;">⚠ لا يمكن التفعيل قبل استلام كامل قيمة العملية</div>';
    }
    
    html += '</div>';
    el.innerHTML = html;
}

function _renderWorkflow(op, funding) {
    var w = document.getElementById('workflowActions');
    if (!w) return;
    
    if (!canEdit()) {
        w.style.display = 'none';
        return;
    }
    
    w.style.display = 'flex';
    var ready = funding.funded >= funding.required && funding.required > 0;
    
    var html = '';
    
    if (op.status === 'draft') {
        html += '<button class="btn btn-primary" data-action="opActivate" ' + (ready ? '' : 'disabled style="opacity:.5;cursor:not-allowed;"') + '>🚀 تفعيل العملية</button>';
        html += '<button class="btn btn-success" data-action="opApproveProfit">📊 اعتماد الأرباح</button>';
    } else if (op.status === 'active' && !op.is_locked) {
        html += '<button class="btn btn-info" data-action="opFundClient">💵 تمويل العميل</button>';
        html += '<button class="btn btn-info" data-action="opClientPayment">💰 دفعة من العميل</button>';
        html += '<button class="btn btn-success" data-action="opDistributeProfit">📊 توزيع الأرباح</button>';
        html += '<button class="btn btn-warning" data-action="opReturnCapital">🔄 إرجاع رأس مال</button>';
        html += '<button class="btn btn-primary" data-action="opComplete">✅ إنهاء</button>';
    }
    
    if (op.is_locked || op.status === 'completed') {
        html += '<button class="btn btn-secondary" data-action="opUnlock">🔓 فتح القفل</button>';
    }
    
    w.innerHTML = html;
}

function _renderInvestorsTab(op, funding) {
    var c = document.getElementById('opInvestorsList');
    if (!c) return;
    
    if (!funding.perInvestor.length) {
        c.innerHTML = '<div class="empty-state">لا يوجد ممولين - أضف ممولاً أولاً</div>';
        return;
    }
    
    var names = {};
    (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(i){ names[i.id] = i.name; });
    
    var html = '<table><thead><tr><th>الممول</th><th>المتعهد</th><th>المستلم</th><th>المتبقي للاستلام</th><th>المتبقي للإرجاع</th><th>الربح</th><th>الربح المتبقي</th><th>الحالة</th>';
    if (canEdit()) html += '<th>إجراءات</th>';
    html += '</tr></thead><tbody>';
    
    funding.perInvestor.forEach(function(pi) {
        html += '<tr>';
        html += '<td>' + escapeHtml(names[pi.investorId] || '-') + '</td>';
        html += '<td>' + formatMoney(pi.committed) + '</td>';
        html += '<td class="profit-field">' + formatMoney(pi.funded) + '</td>';
        html += '<td>' + formatMoney(pi.remaining) + '</td>';
        html += '<td>' + formatMoney(pi.remainingCapital) + '</td>';
        html += '<td>' + formatMoney(pi.profit) + '</td>';
        html += '<td>' + formatMoney(pi.remainingProfit) + '</td>';
        html += '<td>' + (pi.remaining <= 0 ? '<span style="color:#10b981;font-weight:600;">✅ مستلم</span>' : '<span style="color:#f59e0b;font-weight:600;">⚠ غير مستلم</span>') + '</td>';
        
        if (canEdit()) {
            html += '<td class="actions-cell">';
            if (pi.remaining > 0) {
                html += '<button class="btn btn-success btn-sm" data-action="opReceiveContribution" data-param="' + pi.investorId + '">💸 استلام</button> ';
            }
            html += '<button class="btn btn-secondary btn-sm" data-action="openEditOpInvestor" data-param="' + pi.opInvestorId + '">✏️</button> ';
            html += '<button class="btn btn-danger btn-sm" data-action="deleteOpInvestor" data-param="' + pi.opInvestorId + '">🗑️</button>';
            html += '</td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    c.innerHTML = html;
}

// ============================================================
// 5. INVESTORS MANAGEMENT
// ============================================================

async function openAddInvestorToOp() {
    if (!OPERATIONS_STATE.currentOperationId) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    
    var op = OPERATIONS_STATE.currentOperation;
    if (op && (op.is_locked || op.status === 'completed' || op.status === 'cancelled')) {
        showToast('❌ العملية مقفلة أو منتهية','error');
        return;
    }
    
    await loadInvestorsForOps();
    
    var s = document.getElementById('newOpInvestorId');
    if (s) {
        var o = '<option value="">-- اختر الممول --</option>';
        (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(i){
            o += '<option value="' + i.id + '">' + escapeHtml(i.name) + '</option>';
        });
        s.innerHTML = o;
    }
    
    _setVal('newOpInvestorContribution','');
    _setVal('newOpInvestorProfit','');
    
    openModal('addInvestorToOpModal');
}

async function saveOpInvestor(form, event) {
    if (event) event.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    
    var opId = OPERATIONS_STATE.currentOperationId;
    var op = OPERATIONS_STATE.currentOperation;
    
    if (op && (op.is_locked || op.status === 'completed' || op.status === 'cancelled')) {
        showToast('❌ العملية مقفلة أو منتهية','error');
        return;
    }
    
    var investorId = _getVal('newOpInvestorId');
    var contribution = parseFloat(_getVal('newOpInvestorContribution')) || 0;
    var profit = parseFloat(_getVal('newOpInvestorProfit')) || 0;
    
    if (!investorId) { showToast('❌ اختر الممول','error'); return; }
    if (contribution <= 0) { showToast('❌ المساهمة غير صحيحة','error'); return; }
    
    showLoading();
    try {
        var r = await runQuery(function(){
            return APP.supabase.from('operation_investors').insert({
                operation_id: opId,
                investor_id: investorId,
                contribution: contribution,
                profit: profit
            }).select();
        }, { context:'saveOpInvestor', throwError:true });
        
        _log('إضافة ممول لعملية','operation_investor', r.data[0].id, null, JSON.stringify({ investor_id: investorId, contribution: contribution }), 'create');
        
        closeModal('addInvestorToOpModal');
        showToast('✅ تم إضافة الممول','success');
        
        _openDynamicModal('استلام المساهمة',
            '<p style="margin-bottom:12px;">هل تم <strong>استلام</strong> مبلغ <strong>' + formatMoney(contribution) + '</strong> من الممول بالفعل؟</p>' +
            '<div style="display:flex;gap:10px;">' +
            '<button type="button" class="btn btn-success btn-block" data-action="opReceiveContribution" data-param="' + investorId + '">💸 نعم، سجل الاستلام</button>' +
            '<button type="button" class="btn btn-secondary btn-block" data-action="closeModal" data-modal="opDynamicModal">لاحقاً</button>' +
            '</div>',
            null, null);
        
        await openOperationDetails(opId);
    } catch (e) {
        showToast(handleSupabaseError(e,'إضافة الممول'),'error');
    } finally {
        hideLoading();
    }
}

async function openEditOpInvestor(recId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    if (!recId) { showToast('❌ السجل غير محدد','error'); return; }
    
    var op = OPERATIONS_STATE.currentOperation;
    if (op && (op.is_locked || op.status === 'completed' || op.status === 'cancelled')) {
        showToast('❌ العملية مقفلة أو منتهية','error');
        return;
    }
    
    try {
        var r = await runQuery(function(){
            return APP.supabase.from('operation_investors').select('*').eq('id', recId).single();
        }, { context:'editOpInvestor-get', throwError:true });
        
        var rec = r.data;
        if (!rec) { showToast('❌ السجل غير موجود','error'); return; }
        
        _setVal('editOpInvestorId', rec.id);
        _setVal('editOpInvestorContribution', rec.contribution);
        _setVal('editOpInvestorProfit', rec.profit);
        
        openModal('editOpInvestorModal');
    } catch (e) {
        showToast(handleSupabaseError(e,'فتح تعديل المساهمة'),'error');
    }
}

async function updateOpInvestor(form, event) {
    if (event) event.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    
    var recId = _getVal('editOpInvestorId');
    var contribution = parseFloat(_getVal('editOpInvestorContribution')) || 0;
    var profit = parseFloat(_getVal('editOpInvestorProfit')) || 0;
    
    if (!recId) { showToast('❌ السجل غير محدد','error'); return; }
    if (contribution <= 0) { showToast('❌ المساهمة يجب أن تكون أكبر من صفر','error'); return; }
    
    var op = OPERATIONS_STATE.currentOperation;
    if (op && (op.is_locked || op.status === 'completed' || op.status === 'cancelled')) {
        showToast('❌ العملية مقفلة أو منتهية','error');
        return;
    }
    
    var f = OPERATIONS_STATE.currentFunding;
    var pi = null;
    f.perInvestor.forEach(function(x){ if (x.opInvestorId === recId) pi = x; });
    
    if (pi && contribution < pi.funded - 0.01) {
        showToast('❌ لا يمكن خفض التعهد تحت المستلم فعلياً (' + formatMoney(pi.funded) + ')','error');
        return;
    }
    
    showLoading();
    try {
        var old = await runQuery(function(){
            return APP.supabase.from('operation_investors').select('*').eq('id', recId).single();
        }, { context:'updateOpInvestor-old', throwError:true });
        
        await runQuery(function(){
            return APP.supabase.from('operation_investors').update({
                contribution: contribution,
                profit: profit
            }).eq('id', recId);
        }, { context:'updateOpInvestor-upd', throwError:true });
        
        _log('تعديل مساهمة ممول','operation_investor', recId, JSON.stringify(old.data), JSON.stringify({ contribution: contribution, profit: profit }), 'update');
        
        closeModal('editOpInvestorModal');
        showToast('✅ تم تحديث المساهمة','success');
        
        await openOperationDetails(OPERATIONS_STATE.currentOperationId);
    } catch (e) {
        showToast(handleSupabaseError(e,'تحديث المساهمة'),'error');
    } finally {
        hideLoading();
    }
}

async function deleteOpInvestor(recId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    
    var op = OPERATIONS_STATE.currentOperation;
    if (op && (op.is_locked || op.status === 'completed' || op.status === 'cancelled')) {
        showToast('❌ العملية مقفلة أو منتهية','error');
        return;
    }
    
    if (!confirmDelete('هذا الممول من العملية')) return;
    
    showLoading();
    try {
        await runQuery(function(){
            return APP.supabase.from('operation_investors').delete().eq('id', recId);
        }, { context:'delOpInvestor', throwError:true });
        
        _log('حذف ممول من عملية','operation_investor', recId, null, null, 'delete');
        showToast('✅ تم الحذف','success');
        
        await openOperationDetails(OPERATIONS_STATE.currentOperationId);
    } catch (e) {
        showToast(handleSupabaseError(e,'حذف الممول'),'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 6. RECEIVE CONTRIBUTION (Investor → Company)
// ============================================================

async function opReceiveContribution(investorId) {
    var opId = OPERATIONS_STATE.currentOperationId;
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!opId || !op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة - لا يمكن تنفيذ عمليات مالية','error'); return; }
    if (op.status !== 'draft' && op.status !== 'active') { showToast('❌ حالة العملية لا تسمح بالاستلام','error'); return; }
    
    var f = OPERATIONS_STATE.currentFunding;
    var pi = null;
    f.perInvestor.forEach(function(x){ if (x.investorId === investorId) pi = x; });
    
    if (!pi) { showToast('❌ الممول غير مرتبط بالعملية','error'); return; }
    if (pi.remaining <= 0) { showToast('✅ المساهمة مستلمة بالكامل بالفعل','success'); return; }
    
    var names = {};
    (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(i){ names[i.id] = i.name; });
    
    if (!confirmAction('💸 تسجيل استلام ' + formatMoney(pi.remaining) + ' من ' + (names[investorId] || 'الممول') + '؟\nسيتم إنشاء تحويل (ممول ← شركة) مرتبط بالعملية تلقائياً.')) return;
    
    showLoading();
    try {
        await _createTransfer({
            type: 'investor_to_company',
            purpose: 'capital_funding',
            operation_id: opId,
            investor_id: investorId,
            client_id: null,
            amount: pi.remaining,
            transfer_date: getTodayDate(),
            notes: 'استلام مساهمة في عملية: ' + op.name
        }, 'استلام مساهمة ممول');
        
        closeModal('opDynamicModal');
        showToast('✅ تم تسجيل الاستلام وإنشاء التحويل','success');
        
        await openOperationDetails(opId);
    } catch (e) {
        showToast(handleSupabaseError(e,'تسجيل الاستلام'),'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 7. WORKFLOW ACTIONS
// ============================================================

async function opActivate() {
    var opId = OPERATIONS_STATE.currentOperationId;
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة','error'); return; }
    if (op.status !== 'draft') { showToast('❌ العملية ليست مسودة','error'); return; }
    
    var f = OPERATIONS_STATE.currentFunding;
    if (f.funded < f.required) {
        showToast('❌ لا يمكن التفعيل: التمويل المستلم ' + formatMoney(f.funded) + ' من ' + formatMoney(f.required) + '. استلم باقي المساهمات أولاً.','error');
        return;
    }
    
    if (!confirmAction('🚀 تفعيل العملية؟ ستظهر نشطة للعميل وللممولين.')) return;
    
    showLoading();
    try {
        await runQuery(function(){
            return APP.supabase.from('operations').update({ status: 'active' }).eq('id', opId);
        }, { context:'opActivate', throwError:true });
        
        _log('تفعيل عملية','operation', opId, null, '{"status":"active"}', 'workflow');
        showToast('✅ تم تفعيل العملية','success');
        
        await openOperationDetails(opId);
    } catch (e) {
        showToast(handleSupabaseError(e,'التفعيل'),'error');
    } finally {
        hideLoading();
    }
}

function opFundClient() {
    var opId = OPERATIONS_STATE.currentOperationId;
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!opId || !op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة - لا يمكن تنفيذ عمليات مالية','error'); return; }
    if (op.status !== 'active') { showToast('❌ العملية غير نشطة - فعّلها أولاً','error'); return; }
    if (!op.client_id) { showToast('❌ لا يوجد عميل مرتبط بالعملية','error'); return; }
    
    var f = OPERATIONS_STATE.currentFunding;
    if (f.remainingClientFunding <= 0) { showToast('✅ العميل مموّل بالكامل بالفعل','success'); return; }
    
    var body = '<p style="margin-bottom:10px;">المتبقي لتمويل العميل: <strong>' + formatMoney(f.remainingClientFunding) + '</strong></p>' +
        '<div class="form-group"><label>مبلغ التمويل *</label><input type="number" id="opFundAmount" step="0.01" min="0.01" value="' + f.remainingClientFunding + '" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>' +
        '<div class="form-group"><label>التاريخ</label><input type="date" id="opFundDate" value="' + getTodayDate() + '" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>';
    
    _openDynamicModal('💵 تمويل العميل', body, 'submitOpAction', 'تحويل التمويل');
    document.getElementById('opDynamicActionType').value = 'client_funding';
}

function opClientPayment() {
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة - لا يمكن تنفيذ عمليات مالية','error'); return; }
    if (op.status !== 'active') { showToast('❌ العملية غير نشطة','error'); return; }
    
    var p = OPERATIONS_STATE.currentProfits;
    
    var body = '<p style="margin-bottom:10px;">إجمالي المستحق من العميل: <strong>' + formatMoney(p.clientDueTotal) + '</strong><br>المسدد حتى الآن: <strong>' + formatMoney(p.clientRepayment) + '</strong><br>المتبقي: <strong>' + formatMoney(p.clientOutstanding) + '</strong></p>' +
        '<div class="form-group"><label>مبلغ الدفعة *</label><input type="number" id="opPayAmount" step="0.01" min="0.01" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>' +
        '<div class="form-group"><label>التاريخ</label><input type="date" id="opPayDate" value="' + getTodayDate() + '" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>';
    
    _openDynamicModal('💰 تسجيل دفعة من العميل', body, 'submitOpAction', 'تسجيل الدفعة');
    document.getElementById('opDynamicActionType').value = 'client_repayment';
}

function opApproveProfit() {
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة','error'); return; }
    
    var body = '<div class="form-group"><label>الربح النهائي المعتمد *</label><input type="number" id="opFinalProfitInput" value="' + (op.final_profit || '') + '" step="0.01" min="0" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>' +
        '<div class="form-group"><label>تاريخ الاعتماد</label><input type="date" id="opApproveDate" value="' + getTodayDate() + '" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>';
    
    _openDynamicModal('📊 اعتماد الأرباح', body, 'submitOpAction', 'اعتماد');
    document.getElementById('opDynamicActionType').value = 'approve_profit';
}

function opDistributeProfit() {
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة','error'); return; }
    if (op.status !== 'active') { showToast('❌ العملية غير نشطة','error'); return; }
    
    if (!op.final_profit || !op.profit_approval_date) {
        showToast('❌ لا يمكن توزيع الأرباح قبل اعتماد الربح النهائي','error');
        return;
    }
    
    var f = OPERATIONS_STATE.currentFunding;
    var names = {};
    (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(i){ names[i.id] = i.name; });
    
    var rows = '';
    var any = false;
    
    f.perInvestor.forEach(function(pi) {
        if (pi.profit > 0) any = true;
        rows += '<div class="form-group"><label>' + escapeHtml(names[pi.investorId] || 'ممول') + ' (متبقي ' + formatMoney(pi.remainingProfit) + ')</label><input type="number" name="pd_' + pi.investorId + '" value="' + (pi.remainingProfit > 0 ? pi.remainingProfit : '') + '" step="0.01" min="0" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>';
    });
    
    if (!any) rows = '<p>لا توجد أرباح محددة للممولين. اعتمد الأرباح أولاً من تعديل العملية.</p>';
    
    _openDynamicModal('📊 توزيع الأرباح', rows, 'submitOpAction', 'توزيع');
    document.getElementById('opDynamicActionType').value = 'profit_distribution';
}

function opReturnCapital() {
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.is_locked) { showToast('❌ العملية مقفلة','error'); return; }
    if (op.status !== 'active') { showToast('❌ العملية غير نشطة','error'); return; }
    
    var f = OPERATIONS_STATE.currentFunding;
    var names = {};
    (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(i){ names[i.id] = i.name; });
    
    var rows = '';
    
    f.perInvestor.forEach(function(pi) {
        rows += '<div class="form-group"><label>' + escapeHtml(names[pi.investorId] || 'ممول') + ' (متبقي ' + formatMoney(pi.remainingCapital) + ')</label><input type="number" name="cr_' + pi.investorId + '" value="' + (pi.remainingCapital > 0 ? pi.remainingCapital : '') + '" step="0.01" min="0" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;"></div>';
    });
    
    _openDynamicModal('🔄 إرجاع رأس المال', rows, 'submitOpAction', 'إرجاع');
    document.getElementById('opDynamicActionType').value = 'capital_return';
}

async function opComplete() {
    var opId = OPERATIONS_STATE.currentOperationId;
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    if (op.status !== 'active') { showToast('❌ العملية غير نشطة','error'); return; }
    
    var f = OPERATIONS_STATE.currentFunding;
    var msg = '✅ إنهاء العملية وقفلها؟';
    
    var returned = 0;
    f.perInvestor.forEach(function(pi){ returned += pi.returned; });
    
    if (returned < f.funded) {
        msg += '\n⚠ تنبيه: لم يتم إرجاع كامل رأس المال بعد (المُرجع ' + formatMoney(returned) + ' من ' + formatMoney(f.funded) + ').';
    }
    
    if (!confirmAction(msg)) return;
    
    showLoading();
    try {
        await runQuery(function(){
            return APP.supabase.from('operations').update({ status: 'completed', is_locked: true }).eq('id', opId);
        }, { context:'opComplete', throwError:true });
        
        _log('إنهاء عملية','operation', opId, null, '{"status":"completed"}', 'workflow');
        showToast('✅ تم إنهاء العملية وقفلها','success');
        
        await openOperationDetails(opId);
    } catch (e) {
        showToast(handleSupabaseError(e,'الإنهاء'),'error');
    } finally {
        hideLoading();
    }
}

async function opUnlock() {
    if (!confirmAction('🔓 فتح قفل العملية للتعديل؟')) return;
    
    showLoading();
    try {
        await runQuery(function(){
            return APP.supabase.from('operations').update({ is_locked: false }).eq('id', OPERATIONS_STATE.currentOperationId);
        }, { context:'opUnlock', throwError:true });
        
        _log('فتح قفل عملية','operation', OPERATIONS_STATE.currentOperationId, null, '{"is_locked":false}', 'workflow');
        showToast('✅ تم فتح القفل','success');
        
        await openOperationDetails(OPERATIONS_STATE.currentOperationId);
    } catch (e) {
        showToast(handleSupabaseError(e,'فتح القفل'),'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 8. SUBMIT FINANCIAL ACTIONS
// ============================================================

async function submitOpAction(form, event) {
    if (event) event.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    
    var opId = OPERATIONS_STATE.currentOperationId;
    var op = OPERATIONS_STATE.currentOperation;
    
    if (!op) { showToast('❌ افتح العملية أولاً','error'); return; }
    
    var f = OPERATIONS_STATE.currentFunding;
    var p = OPERATIONS_STATE.currentProfits;
    var actionType = _getVal('opDynamicActionType');
    
    showLoading();
    try {
        if (actionType === 'client_funding') {
            if (op.is_locked || op.status !== 'active') { showToast('❌ العملية غير نشطة أو مقفلة','error'); hideLoading(); return; }
            
            var famt = parseFloat(_getVal('opFundAmount')) || 0;
            if (famt <= 0) { showToast('❌ المبلغ غير صحيح','error'); hideLoading(); return; }
            if (famt > f.remainingClientFunding + 0.01) { showToast('❌ المبلغ يتجاوز المتبقي لتمويل العميل (' + formatMoney(f.remainingClientFunding) + ')','error'); hideLoading(); return; }
            
            await _createTransfer({
                type: 'company_to_client',
                purpose: 'client_funding',
                operation_id: opId,
                client_id: op.client_id,
                investor_id: null,
                amount: famt,
                transfer_date: _getVal('opFundDate') || getTodayDate(),
                notes: 'تمويل العميل - ' + op.name
            }, 'تمويل العميل');
            
            showToast('✅ تم تمويل العميل وإنشاء التحويل','success');
        }
        else if (actionType === 'client_repayment') {
            if (op.is_locked || op.status !== 'active') { showToast('❌ العملية غير نشطة أو مقفلة','error'); hideLoading(); return; }
            
            var amt = parseFloat(_getVal('opPayAmount')) || 0;
            if (amt <= 0) { showToast('❌ المبلغ غير صحيح','error'); hideLoading(); return; }
            if (amt > p.clientOutstanding + 0.01) { showToast('❌ المبلغ أكبر من المستحق المتبقي على العميل (' + formatMoney(p.clientOutstanding) + ')','error'); hideLoading(); return; }
            
            await _createTransfer({
                type: 'client_to_company',
                purpose: 'client_repayment',
                operation_id: opId,
                client_id: op.client_id,
                investor_id: null,
                amount: amt,
                transfer_date: _getVal('opPayDate') || getTodayDate(),
                notes: 'دفعة من العميل - ' + op.name
            }, 'دفعة من العميل');
            
            showToast('✅ تم تسجيل الدفعة وإنشاء التحويل','success');
        }
        else if (actionType === 'approve_profit') {
            if (op.is_locked) { showToast('❌ العملية مقفلة','error'); hideLoading(); return; }
            
            var fp = parseFloat(_getVal('opFinalProfitInput')) || 0;
            
            await runQuery(function(){
                return APP.supabase.from('operations').update({
                    final_profit: fp,
                    profit_approval_date: _getVal('opApproveDate') || getTodayDate()
                }).eq('id', opId);
            }, { context:'approveProfit', throwError:true });
            
            _log('اعتماد الأرباح','operation', opId, null, JSON.stringify({ final_profit: fp }), 'workflow');
            showToast('✅ تم اعتماد الأرباح','success');
        }
        else if (actionType === 'profit_distribution' || actionType === 'capital_return') {
            if (op.is_locked || op.status !== 'active') { showToast('❌ العملية غير نشطة أو مقفلة','error'); hideLoading(); return; }
            
            if (actionType === 'profit_distribution') {
                if (!op.final_profit || !op.profit_approval_date) {
                    showToast('❌ لا يمكن توزيع الأرباح قبل اعتماد الربح النهائي','error');
                    hideLoading();
                    return;
                }
            }
            
            var purpose = actionType === 'profit_distribution' ? 'profit_distribution' : 'capital_return';
            var count = 0;
            
            var inputs = form.querySelectorAll('input[name^="pd_"], input[name^="cr_"]');
            for (var i = 0; i < inputs.length; i++) {
                var val = parseFloat(inputs[i].value) || 0;
                if (val <= 0) continue;
                
                var invId = inputs[i].name.substring(3);
                var pi = null;
                f.perInvestor.forEach(function(x){ if (x.investorId === invId) pi = x; });
                
                var cap = (purpose === 'profit_distribution') ? (pi ? pi.remainingProfit : 0) : (pi ? pi.remainingCapital : 0);
                
                if (val > cap + 0.01) {
                    showToast('❌ المبلغ يتجاوز المتبقي للممول (' + formatMoney(cap) + ')','error');
                    hideLoading();
                    return;
                }
                
                await _createTransfer({
                    type: 'company_to_investor',
                    purpose: purpose,
                    operation_id: opId,
                    investor_id: invId,
                    client_id: null,
                    amount: val,
                    transfer_date: getTodayDate(),
                    notes: (purpose === 'profit_distribution' ? 'توزيع أرباح - ' : 'إرجاع رأس مال - ') + op.name
                }, purpose === 'profit_distribution' ? 'توزيع أرباح' : 'إرجاع رأس مال');
                
                count++;
            }
            
            if (count === 0) { showToast('⚠ لم يتم إدخال أي مبالغ','warning'); hideLoading(); return; }
            
            showToast('✅ تم إنشاء ' + count + ' تحويل','success');
        }
        
        closeModal('opDynamicModal');
        await openOperationDetails(opId);
    } catch (e) {
        showToast(handleSupabaseError(e,'تنفيذ الإجراء'),'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 9. CREATE TRANSFER + LOG
// ============================================================

async function _createTransfer(data, logName) {
    if (typeof TRANSFER_FLOW_MAP !== 'undefined' && TRANSFER_FLOW_MAP[data.type]) {
        data.party_type = TRANSFER_FLOW_MAP[data.type].party_type;
        data.transaction_category = TRANSFER_FLOW_MAP[data.type].transaction_category;
    }
    
    var r = await runQuery(function(){
        return APP.supabase.from('transfers').insert(data).select();
    }, { context:'createTransfer', throwError:true });
    
    if (r.data && r.data[0]) {
        _log(logName, 'transfer', r.data[0].id, null, JSON.stringify(data), 'create');
    }
    
    return r;
}

function _log(action, entityType, entityId, oldV, newV, actionType) {
    if (typeof window.logActivityToDB === 'function') {
        window.logActivityToDB(action, entityType, entityId, oldV, newV, action, actionType);
    }
}

// ============================================================
// 10. DYNAMIC MODAL HELPER
// ============================================================

function _openDynamicModal(title, bodyHtml, submitHandler, submitLabel) {
    var old = document.getElementById('opDynamicModal');
    if (old) old.remove();
    
    var div = document.createElement('div');
    div.id = 'opDynamicModal';
    div.className = 'modal active';
    
    var inner = '<div class="modal-content"><div class="modal-header"><h2>' + title + '</h2><button class="close-btn" data-action="closeModal" data-modal="opDynamicModal">×</button></div>';
    
    if (submitHandler) {
        inner += '<form data-submit="' + submitHandler + '"><input type="hidden" id="opDynamicActionType" value="">' + bodyHtml + '<button type="submit" class="btn btn-primary btn-block">' + (submitLabel || 'حفظ') + '</button></form>';
    } else {
        inner += '<div style="padding:16px;">' + bodyHtml + '</div>';
    }
    
    inner += '</div>';
    div.innerHTML = inner;
    document.body.appendChild(div);
}

// ============================================================
// 11. TABS + REFRESH
// ============================================================

async function loadOpTransfersTab(opId) {
    var c = document.getElementById('opTransfersList');
    if (!c) return;
    
    var r = await runQuery(function(){
        return APP.supabase.from('transfers').select('*').eq('operation_id', opId).order('transfer_date', { ascending:false });
    }, { context:'opTransfers', throwError:false });
    
    var ts = r.data || [];
    
    if (!ts.length) {
        c.innerHTML = '<div class="empty-state">لا توجد تحويلات مرتبطة</div>';
        return;
    }
    
    var html = '<table><thead><tr><th>التاريخ</th><th>من</th><th>إلى</th><th>الغرض</th><th>المبلغ</th></tr></thead><tbody>';
    
    ts.forEach(function(t) {
        html += '<tr><td>' + formatDate(t.transfer_date) + '</td><td>' + _partyText(t, true) + '</td><td>' + _partyText(t, false) + '</td><td>' + ((typeof getPurposeText === 'function') ? getPurposeText(t.purpose) : (PURPOSE_TEXT_AR[t.purpose] || t.purpose)) + '</td><td>' + formatMoney(t.amount) + '</td></tr>';
    });
    
    html += '</tbody></table>';
    c.innerHTML = html;
}

async function loadOpInvestorsTab(operationId) {
    var opId = operationId || OPERATIONS_STATE.currentOperationId;
    if (!opId) return;
    
    var calcData = await _buildCalcData(opId);
    OPERATIONS_STATE.currentCalcData = calcData;
    OPERATIONS_STATE.currentOperation = calcData.operations[0] || OPERATIONS_STATE.currentOperation;
    
    OPERATIONS_STATE.currentFunding = getOperationFunding(opId, calcData);
    OPERATIONS_STATE.currentProfits = getOperationProfits(opId, calcData);
    
    _renderInvestorsTab(OPERATIONS_STATE.currentOperation, OPERATIONS_STATE.currentFunding);
}

function openAddTransferToOp(operationId) {
    var opId = operationId || OPERATIONS_STATE.currentOperationId;
    if (!opId) { showToast('❌ افتح العملية أولاً','error'); return; }
    
    if (typeof openTransferModal === 'function') {
        openTransferModal(null, { operationId: opId });
    }
}

function _partyText(t, from) {
    var type = t.type;
    
    if (from) {
        if (type === 'company_to_client' || type === 'company_to_investor') return '🏢 الشركة';
        if (type === 'client_to_company' || type === 'client_to_investor') return '👤 عميل';
        if (type === 'investor_to_company' || type === 'investor_to_client') return '💼 ممول';
    } else {
        if (type === 'client_to_company' || type === 'investor_to_company') return '🏢 الشركة';
        if (type === 'company_to_client' || type === 'investor_to_client') return '👤 عميل';
        if (type === 'company_to_investor' || type === 'client_to_investor') return '💼 ممول';
    }
    
    return '-';
}

async function loadOpTimelineTab(opId) {
    var c = document.getElementById('opTimelineList');
    if (!c) return;
    
    var r = await runQuery(function(){
        return APP.supabase.from('activity_logs').select('*').eq('entity_id', opId).order('created_at', { ascending:false }).limit(50);
    }, { context:'opTimeline', throwError:false });
    
    var logs = r.data || [];
    
    if (!logs.length) {
        c.innerHTML = '<div class="empty-state">لا يوجد سجل</div>';
        return;
    }
    
    var html = '<div class="timeline">';
    
    logs.forEach(function(l) {
        html += '<div class="timeline-item"><div class="timeline-time">' + formatDateTime(l.created_at) + '</div><div class="timeline-user">' + escapeHtml(l.user_email || 'System') + '</div><div class="timeline-content"><strong>' + escapeHtml(l.action_type || l.action || '-') + '</strong>' + (l.details ? '<p>' + escapeHtml(l.details) + '</p>' : '') + '</div></div>';
    });
    
    html += '</div>';
    c.innerHTML = html;
}

// ============================================================
// 12. MISC
// ============================================================

async function archiveOperation(id) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية','error'); return; }
    if (!confirmArchive('هذه العملية')) return;
    
    showLoading();
    try {
        await runQuery(function(){
            return APP.supabase.from('operations').update({ is_archived: true }).eq('id', id);
        }, { context:'archiveOp', throwError:true });
        
        _log('أرشفة عملية','operation', id, null, null, 'archive');
        showToast('✅ تم الأرشفة','success');
        
        loadOperations();
    } catch (e) {
        showToast(handleSupabaseError(e,'الأرشفة'),'error');
    } finally {
        hideLoading();
    }
}

function searchOperations(t) {
    OPERATIONS_STATE.search = t || '';
    loadOperations();
}

function filterOperations(s) {
    OPERATIONS_STATE.filter = s || '';
    loadOperations();
}

function _getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function _setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = (v !== null && v !== undefined) ? v : '';
}

// ============================================================
// END OF OPERATIONS.JS (v10.1.1)
// ============================================================
