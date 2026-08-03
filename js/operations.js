// ============================================================
// نظام إدارة التمويل - Operations Module
// Version: 8.0.0 (Final - Funding Workflow)
// Last Updated: 2026-08-04
// ============================================================

// ============================================================
// 1. STATE
// ============================================================

var OPERATIONS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null },
    currentOperationId: null,
    currentOperation: null
};

// ============================================================
// 2. INITIALIZATION
// ============================================================

function initOperations() {
    debug('⚙️ بدء تهيئة operations.js', 'info');
    if (typeof registerScreenLoader === 'function') {
        registerScreenLoader('operations', loadOperations);
    }
    debug('✅ operations.js جاهز', 'success');
}

// ============================================================
// 3. LOAD OPERATIONS LIST
// ============================================================

async function loadOperations() {
    debug('⚙️ بدأ loadOperations', 'info');
    if (!isSupabaseReady()) return;

    showLoading();

    try {
        var results = await Promise.all([
            runQuery(function() {
                var query = APP.supabase.from('operations')
                    .select('id, name, type, client_id, amount, investor_display_amount, expected_profit, final_profit, status, start_date, end_date, is_locked, is_archived, created_at')
                    .order('created_at', { ascending: false });

                if (OPERATIONS_STATE.filter) query = query.eq('status', OPERATIONS_STATE.filter);
                if (OPERATIONS_STATE.search) {
                    var term = '%' + OPERATIONS_STATE.search + '%';
                    query = query.or('name.ilike.' + term);
                }
                return query;
            }, { context: 'loadOperations', throwError: true }),
            loadClientsForOps(),
            loadInvestorsForOps()
        ]);

        var ops = results[0].data || [];
        var clients = results[1] || [];
        var clientsById = {};
        clients.forEach(function(c) { clientsById[c.id] = c; });
        ops.forEach(function(op) { op.client = clientsById[op.client_id] || null; });

        OPERATIONS_STATE.records = ops;
        renderOperationsList();
        debug('✅ تم تحميل ' + ops.length + ' عملية', 'success');

    } catch (err) {
        showToast(handleSupabaseError(err, 'تحميل العمليات'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 4. REFERENCE DATA
// ============================================================

async function loadClientsForOps() {
    if (OPERATIONS_STATE.referenceCache.clients) return OPERATIONS_STATE.referenceCache.clients;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('clients')
                .select('id, name, phone, email, is_archived')
                .eq('is_archived', false).order('name');
        }, { context: 'loadClientsForOps', throwError: true });
        OPERATIONS_STATE.referenceCache.clients = result.data || [];
        return OPERATIONS_STATE.referenceCache.clients;
    } catch (e) { return []; }
}

async function loadInvestorsForOps() {
    if (OPERATIONS_STATE.referenceCache.investors) return OPERATIONS_STATE.referenceCache.investors;
    try {
        var result = await runQuery(function() {
            return APP.supabase.from('investors')
                .select('id, name, phone, email, is_archived')
                .eq('is_archived', false).order('name');
        }, { context: 'loadInvestorsForOps', throwError: true });
        OPERATIONS_STATE.referenceCache.investors = result.data || [];
        return OPERATIONS_STATE.referenceCache.investors;
    } catch (e) { return []; }
}

// ============================================================
// 5. RENDER LIST
// ============================================================

function renderOperationsList() {
    var container = document.getElementById('operationsTable');
    if (!container) return;

    if (!OPERATIONS_STATE.records || OPERATIONS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد عمليات</div>';
        return;
    }

    var html = '<table><thead><tr><th>الاسم</th><th>العميل</th><th>النوع</th><th>المبلغ</th><th>الربح المتوقع</th><th>الحالة</th><th>تاريخ النهاية</th><th>الإجراءات</th></tr></thead><tbody>';

    OPERATIONS_STATE.records.forEach(function(op) {
        var clientName = op.client ? escapeHtml(op.client.name) : '-';
        var isLocked = op.is_locked || op.status === 'completed' || op.status === 'cancelled';

        html += '<tr>';
        html += '<td><a href="#" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.name) + '</a></td>';
        html += '<td>' + clientName + '</td>';
        html += '<td>' + getOperationTypeText(op.type) + '</td>';
        html += '<td>' + formatMoney(op.amount) + '</td>';
        html += '<td class="profit-field">' + formatMoney(op.expected_profit || 0) + '</td>';
        html += '<td><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span></td>';
        html += '<td>' + formatDate(op.end_date) + '</td>';
        html += '<td class="actions-cell">';
        if (canEdit()) {
            html += '<button class="btn btn-secondary btn-sm" data-action="editOperation" data-param="' + op.id + '">✏️ تعديل</button> ';
            if (!isLocked) {
                html += '<button class="btn btn-warning btn-sm" data-action="archiveOperation" data-param="' + op.id + '">📦 أرشفة</button>';
            }
        }
        html += '</td></tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ============================================================
// 6. OPEN MODAL (ADD / EDIT)
// ============================================================

async function openOperationModal(operationId) {
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

    var titleEl = document.getElementById('operationModalTitle');
    var idEl = document.getElementById('operationId');
    if (!titleEl || !idEl) return;

    await loadClientsForOps();

    var clientSelect = document.getElementById('opClient');
    if (clientSelect) {
        var options = '<option value="">-- اختر العميل --</option>';
        (OPERATIONS_STATE.referenceCache.clients || []).forEach(function(c) {
            options += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        });
        clientSelect.innerHTML = options;
    }

    ['opName', 'opAmount', 'opInvestorDisplayAmount', 'opExpectedProfit', 'opFinalProfit',
     'opProfitApprovalDate', 'opGoogleDriveUrl', 'opCompanyProfitValue', 'opStartDate',
     'opDurationDays', 'opEndDate', 'opNotes'].forEach(function(id) {
        _setVal(id, '');
    });

    _setVal('opType', 'financing');
    _setVal('opCompanyProfitType', '');
    _setVal('opStatus', 'draft');

    if (operationId) {
        try {
            var result = await runQuery(function() {
                return APP.supabase.from('operations').select('*').eq('id', operationId).single();
            }, { context: 'openOperationModal', throwError: true });

            var op = result.data;
            if (!op) { showToast('❌ العملية غير موجودة', 'error'); return; }

            titleEl.textContent = 'تعديل عملية';
            idEl.value = op.id;

            _setVal('opName', op.name);
            _setVal('opType', op.type);
            _setVal('opClient', op.client_id);
            _setVal('opAmount', op.amount);
            _setVal('opInvestorDisplayAmount', op.investor_display_amount);
            _setVal('opExpectedProfit', op.expected_profit);
            _setVal('opFinalProfit', op.final_profit);
            _setVal('opProfitApprovalDate', formatDateForInput(op.profit_approval_date));
            _setVal('opGoogleDriveUrl', op.google_drive_url);
            _setVal('opCompanyProfitType', op.company_profit_type);
            _setVal('opCompanyProfitValue', op.company_profit_value);
            _setVal('opStartDate', formatDateForInput(op.start_date));
            _setVal('opDurationDays', op.duration_days);
            _setVal('opEndDate', formatDateForInput(op.end_date));
            _setVal('opStatus', op.status);
            _setVal('opNotes', op.notes);

        } catch (err) {
            showToast(handleSupabaseError(err, 'جلب بيانات العملية'), 'error');
            return;
        }
    } else {
        titleEl.textContent = 'إضافة عملية';
        idEl.value = '';
        _setVal('opStartDate', getTodayDate());
    }

    openModal('operationModal');
}

// ============================================================
// 7. EDIT OPERATION
// ============================================================

function editOperation(operationId) {
    if (!operationId) operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) { showToast('❌ لا توجد عملية محددة', 'error'); return; }

    closeModal('operationDetailsModal');
    openOperationModal(operationId);
}

// ============================================================
// 8. SAVE OPERATION
// ============================================================

async function saveOperation(form, event) {
    if (event) event.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

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
        status: _getVal('opStatus'),
        notes: _getVal('opNotes').trim()
    };

    if (!data.name) { showToast('❌ اسم العملية مطلوب', 'error'); return; }
    if (!data.client_id) { showToast('❌ يرجى اختيار العميل', 'error'); return; }
    if (!data.amount || data.amount <= 0) { showToast('❌ المبلغ يجب أن يكون أكبر من صفر', 'error'); return; }
    if (!data.start_date) { showToast('❌ تاريخ البداية مطلوب', 'error'); return; }

    if (!data.end_date && data.start_date && data.duration_days > 0) {
        var endDate = addDays(data.start_date, data.duration_days);
        data.end_date = formatDateForInput(endDate);
    }

    showLoading();

    try {
        if (id) {
            var oldResult = await runQuery(function() {
                return APP.supabase.from('operations').select('*').eq('id', id).single();
            }, { context: 'saveOperation-getOld', throwError: true });

            await runQuery(function() {
                return APP.supabase.from('operations').update(data).eq('id', id);
            }, { context: 'saveOperation-update', throwError: true });

            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB('تعديل عملية', 'operation', id, JSON.stringify(oldResult.data), JSON.stringify(data), 'Name: ' + data.name, 'update');
            }
            showToast('✅ تم تحديث العملية', 'success');
        } else {
            var result = await runQuery(function() {
                return APP.supabase.from('operations').insert(data).select();
            }, { context: 'saveOperation-insert', throwError: true });

            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB('إضافة عملية', 'operation', result.data[0].id, null, JSON.stringify(data), 'Name: ' + data.name, 'create');
                }
                showToast('✅ تم إضافة العملية', 'success');
            }
        }

        closeModal('operationModal');
        loadOperations();

    } catch (err) {
        showToast(handleSupabaseError(err, 'حفظ العملية'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 9. OPERATION DETAILS
// ============================================================

async function openOperationDetails(operationId) {
    if (!operationId) return;

    OPERATIONS_STATE.currentOperationId = operationId;
    showLoading();

    try {
        var opResult = await runQuery(function() {
            return APP.supabase.from('operations').select('*').eq('id', operationId).single();
        }, { context: 'openOperationDetails-op', throwError: true });

        var op = opResult.data;
        if (!op) { showToast('❌ العملية غير موجودة', 'error'); return; }

        OPERATIONS_STATE.currentOperation = op;

        // ✅ إصلاح زر "تعديل"
        var editBtns = document.querySelectorAll('[data-action="editOperation"]');
        editBtns.forEach(function(btn) { btn.setAttribute('data-param', operationId); });

        var clientData = null;
        if (op.client_id) {
            try {
                var clientResult = await runQuery(function() {
                    return APP.supabase.from('clients').select('*').eq('id', op.client_id).single();
                }, { context: 'openOperationDetails-client', throwError: false });
                clientData = clientResult.data;
            } catch (e) {}
        }

        _renderOpSummary(op, clientData);
        _renderWorkflowButtons(op);

        await Promise.all([
            loadOpInvestorsTab(operationId),
            loadOpTransfersTab(operationId),
            loadOpTimelineTab(operationId)
        ]);

        var titleEl = document.getElementById('opDetailsTitle');
        if (titleEl) titleEl.textContent = 'تفاصيل: ' + op.name;

        openModal('operationDetailsModal');

    } catch (err) {
        showToast(handleSupabaseError(err, 'فتح تفاصيل العملية'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 10. RENDER SUMMARY
// ============================================================

function _renderOpSummary(op, clientData) {
    var grid = document.getElementById('opSummaryGrid');
    if (!grid) return;

    var clientName = clientData ? clientData.name : '-';
    var html = '';

    html += '<div class="summary-item"><label>اسم العملية</label><div class="val">' + escapeHtml(op.name) + '</div></div>';
    html += '<div class="summary-item"><label>العميل</label><div class="val">' + escapeHtml(clientName) + '</div></div>';
    html += '<div class="summary-item"><label>النوع</label><div class="val">' + getOperationTypeText(op.type) + '</div></div>';
    html += '<div class="summary-item"><label>قيمة التمويل</label><div class="val blue">' + formatMoney(op.amount) + '</div></div>';

    if (op.investor_display_amount) {
        html += '<div class="summary-item"><label>الظاهر للممول</label><div class="val">' + formatMoney(op.investor_display_amount) + '</div></div>';
    }

    html += '<div class="summary-item"><label>الربح المتوقع</label><div class="val orange">' + formatMoney(op.expected_profit || 0) + '</div></div>';
    html += '<div class="summary-item"><label>الربح النهائي</label><div class="val green profit-field">' + formatMoney(op.final_profit || 0) + '</div></div>';

    html += '<div class="summary-item"><label>الحالة</label><div class="val"><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span></div></div>';
    html += '<div class="summary-item"><label>تاريخ البداية</label><div class="val">' + formatDate(op.start_date) + '</div></div>';
    html += '<div class="summary-item"><label>تاريخ النهاية</label><div class="val">' + formatDate(op.end_date) + '</div></div>';

    if (op.is_locked) {
        html += '<div class="summary-item"><label>القفل</label><div class="val red">🔒 مقفلة</div></div>';
    }

    grid.innerHTML = html;
}

// ============================================================
// 11. WORKFLOW BUTTONS
// ============================================================

function _renderWorkflowButtons(op) {
    var container = document.getElementById('workflowActions');
    if (!container) return;

    var isLocked = op.is_locked || op.status === 'completed' || op.status === 'cancelled';

    if (!canEdit()) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    var activateBtn = container.querySelector('[data-action="activateOperation"]');
    var repaymentBtn = container.querySelector('[data-action="clientRepayment"]');
    var profitBtn = container.querySelector('[data-action="profitDistribution"]');
    var returnBtn = container.querySelector('[data-action="capitalReturn"]');
    var completeBtn = container.querySelector('[data-action="completeOperation"]');
    var unlockBtn = container.querySelector('[data-action="unlockOperation"]');

    [activateBtn, repaymentBtn, profitBtn, returnBtn, completeBtn, unlockBtn].forEach(function(btn) {
        if (btn) btn.style.display = 'none';
    });

    if (isLocked) {
        if (unlockBtn) unlockBtn.style.display = 'inline-flex';
    } else if (op.status === 'draft') {
        if (activateBtn) activateBtn.style.display = 'inline-flex';
    } else if (op.status === 'active') {
        if (repaymentBtn) repaymentBtn.style.display = 'inline-flex';
        if (profitBtn) profitBtn.style.display = 'inline-flex';
        if (returnBtn) returnBtn.style.display = 'inline-flex';
        if (completeBtn) completeBtn.style.display = 'inline-flex';
    }
}

// ============================================================
// 12. WORKFLOW ACTIONS
// ============================================================

async function workflowAction(action) {
    var opId = OPERATIONS_STATE.currentOperationId;
    if (!opId || !canEdit()) return;

    var confirmMsg = '';
    var updateData = {};

    switch (action) {
        case 'activate':
            // ✅ التحقق من اكتمال التمويل قبل التفعيل
            var fundingStatus = await getOpFundingStatus(opId);
            if (fundingStatus.fundedCount === 0) {
                showToast('⚠️ يجب إضافة ممول واحد على الأقل قبل التفعيل', 'warning');
                return;
            }
            if (fundingStatus.percentage < 100) {
                var proceed = confirmAction('⚠️ التمويل غير مكتمل (' + Math.round(fundingStatus.percentage) + '%).\n\nهل تريد التفعيل على أي حال؟');
                if (!proceed) return;
            }
            confirmMsg = 'هل تريد تفعيل هذه العملية؟';
            updateData = { status: 'active' };
            break;

        case 'complete':
            confirmMsg = 'هل تريد إنهاء هذه العملية؟ سيتم قفلها نهائياً.';
            updateData = { status: 'completed', is_locked: true };
            break;

        case 'unlock':
            confirmMsg = 'هل تريد فتح قفل العملية للتعديل؟';
            updateData = { is_locked: false };
            break;

        case 'clientRepayment':
            openWorkflowTransfer('client_repayment');
            return;

        case 'profitDistribution':
            openWorkflowTransfer('profit_distribution');
            return;

        case 'capitalReturn':
            openWorkflowTransfer('capital_return');
            return;

        default:
            return;
    }

    if (confirmMsg && !confirmAction(confirmMsg)) return;

    showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations').update(updateData).eq('id', opId);
        }, { context: 'workflowAction', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('Workflow: ' + action, 'operation', opId, null, JSON.stringify(updateData), 'Action: ' + action, 'workflow');
        }

        showToast('✅ تم تنفيذ الإجراء بنجاح', 'success');
        await openOperationDetails(opId);

    } catch (err) {
        showToast(handleSupabaseError(err, 'تنفيذ الإجراء'), 'error');
    } finally {
        hideLoading();
    }
}

function openWorkflowTransfer(purpose) {
    debug('🔄 فتح تحويل Workflow: ' + purpose, 'info');
    if (typeof openTransferModal === 'function') {
        closeModal('operationDetailsModal');
        openTransferModal(null, { operationId: OPERATIONS_STATE.currentOperationId });
    } else {
        showToast('ℹ️ يرجى الانتقال لشاشة التحويلات', 'info');
    }
}

// ============================================================
// 13. FUNDING STATUS (مستنتج من التحويلات - بدون is_funded)
// ============================================================

async function getOpFundingStatus(operationId) {
    try {
        // جلب الممولين المرتبطين بالعملية
        var invResult = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('id, investor_id, contribution, profit')
                .eq('operation_id', operationId);
        }, { context: 'getOpFundingStatus-investors', throwError: false });

        var investors = invResult.data || [];

        // جلب التحويلات المرتبطة بالعملية
        var transResult = await runQuery(function() {
            return APP.supabase.from('transfers')
                .select('investor_id, amount, type, purpose')
                .eq('operation_id', operationId);
        }, { context: 'getOpFundingStatus-transfers', throwError: false });

        var transfers = transResult.data || [];

        // تحديد حالة كل ممول
        var totalRequired = 0;
        var totalFunded = 0;
        var fundedCount = 0;

        investors.forEach(function(inv) {
            totalRequired += inv.contribution || 0;

            // ✅ الحالة تُستنتج: هل يوجد تحويل من هذا الممول لهذه العملية؟
            var isFunded = transfers.some(function(t) {
                return t.investor_id === inv.investor_id &&
                       (t.type === 'investor_to_company' || t.purpose === 'client_funding');
            });

            inv.isFunded = isFunded;

            if (isFunded) {
                totalFunded += inv.contribution || 0;
                fundedCount++;
            }
        });

        var percentage = totalRequired > 0 ? (totalFunded / totalRequired) * 100 : 0;

        return {
            investors: investors,
            totalRequired: totalRequired,
            totalFunded: totalFunded,
            totalRemaining: totalRequired - totalFunded,
            percentage: percentage,
            fundedCount: fundedCount,
            totalCount: investors.length,
            isFullyFunded: percentage >= 100
        };

    } catch (err) {
        debug('❌ خطأ في getOpFundingStatus: ' + err.message, 'error');
        return {
            investors: [], totalRequired: 0, totalFunded: 0,
            totalRemaining: 0, percentage: 0, fundedCount: 0,
            totalCount: 0, isFullyFunded: false
        };
    }
}

// ============================================================
// 14. OPERATION INVESTORS TAB (مع حالة التمويل + شريط التقدم)
// ============================================================

async function loadOpInvestorsTab(operationId) {
    var container = document.getElementById('opInvestorsList');
    if (!container) return;

    try {
        // جلب حالة التمويل الكاملة
        var fundingStatus = await getOpFundingStatus(operationId);
        var investors = fundingStatus.investors;

        // جلب أسماء الممولين
        var namesResult = await runQuery(function() {
            return APP.supabase.from('investors')
                .select('id, name')
                .in('id', investors.map(function(i) { return i.investor_id; }));
        }, { context: 'loadOpInvestorsTab-names', throwError: false });

        var namesById = {};
        (namesResult.data || []).forEach(function(inv) {
            namesById[inv.id] = inv.name;
        });

        if (investors.length === 0) {
            container.innerHTML = '<div class="empty-state">لا يوجد ممولين مرتبطين بهذه العملية</div>';
            return;
        }

        var html = '';

        // ✅ شريط تقدم التمويل
        html += '<div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">';
        html += '<div style="display: flex; justify-content: space-between; margin-bottom: 8px;">';
        html += '<span style="font-weight: 600;">تمويل العملية</span>';
        html += '<span style="font-weight: 600; color: ' + (fundingStatus.isFullyFunded ? '#10b981' : '#f59e0b') + ';">' + Math.round(fundingStatus.percentage) + '%</span>';
        html += '</div>';

        // Progress Bar
        html += '<div style="background: #e2e8f0; border-radius: 10px; height: 20px; overflow: hidden;">';
        html += '<div style="background: ' + (fundingStatus.isFullyFunded ? '#10b981' : '#667eea') + '; height: 100%; width: ' + Math.min(fundingStatus.percentage, 100) + '%; transition: width 0.5s;"></div>';
        html += '</div>';

        html += '<div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.875rem; color: #64748b;">';
        html += '<span>المطلوب: ' + formatMoney(fundingStatus.totalRequired) + '</span>';
        html += '<span>تم تمويله: ' + formatMoney(fundingStatus.totalFunded) + '</span>';
        html += '<span>المتبقي: ' + formatMoney(fundingStatus.totalRemaining) + '</span>';
        html += '</div>';

        if (fundingStatus.isFullyFunded) {
            html += '<div style="margin-top: 12px; padding: 8px 12px; background: #d1fae5; color: #065f46; border-radius: 6px; font-size: 0.875rem;">✓ تمويل العملية مكتمل - جاهزة للصرف للعميل</div>';
        }

        html += '</div>';

        // ✅ جدول الممولين مع حالة التمويل
        html += '<table><thead><tr>';
        html += '<th>الممول</th><th>المساهمة</th><th>الربح</th><th>الحالة</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';

        investors.forEach(function(oi) {
            var name = namesById[oi.investor_id] || '-';
            var total = (oi.contribution || 0) + (oi.profit || 0);

            html += '<tr>';
            html += '<td>' + (oi.isFunded ? '✔ ' : '') + escapeHtml(name) + '</td>';
            html += '<td>' + formatMoney(oi.contribution) + '</td>';
            html += '<td class="profit-field">' + formatMoney(oi.profit) + '</td>';

            // ✅ حالة التمويل
            if (oi.isFunded) {
                html += '<td><span style="color: #10b981; font-weight: 600;">✅ تم التمويل</span></td>';
            } else {
                html += '<td><span style="color: #f59e0b; font-weight: 600;">⚠ لم يتم التمويل</span></td>';
            }

            if (canEdit()) {
                html += '<td class="actions-cell">';

                // ✅ زر إنشاء التحويل للممول غير الممول
                if (!oi.isFunded) {
                    html += '<button class="btn btn-success btn-sm" data-action="openFundingTransfer" data-param="' + oi.investor_id + '" data-amount="' + oi.contribution + '">💸 إنشاء التحويل</button> ';
                }

                html += '<button class="btn btn-secondary btn-sm" data-action="openEditOpInvestor" data-param="' + oi.id + '">✏️</button> ';
                html += '<button class="btn btn-danger btn-sm" data-action="deleteOpInvestor" data-param="' + oi.id + '">🗑️</button>';
                html += '</td>';
            }

            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        debug('❌ خطأ في loadOpInvestorsTab: ' + err.message, 'error');
        container.innerHTML = '<div class="empty-state">فشل في تحميل بيانات الممولين</div>';
    }
}

// ============================================================
// 15. ADD INVESTOR TO OPERATION
// ============================================================

async function openAddInvestorToOp() {
    if (!OPERATIONS_STATE.currentOperationId) {
        showToast('❌ يرجى فتح تفاصيل العملية أولاً', 'error');
        return;
    }
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

    await loadInvestorsForOps();

    var selectEl = document.getElementById('newOpInvestorId');
    if (selectEl) {
        var options = '<option value="">-- اختر الممول --</option>';
        (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(inv) {
            options += '<option value="' + inv.id + '">' + escapeHtml(inv.name) + '</option>';
        });
        selectEl.innerHTML = options;
    }

    _setVal('newOpInvestorContribution', '');
    _setVal('newOpInvestorProfit', '');

    var warningEl = document.getElementById('opInvestorValidationWarning');
    if (warningEl) warningEl.innerHTML = '';

    openModal('addInvestorToOpModal');
}

async function saveOpInvestor(form, event) {
    if (event) event.preventDefault();

    if (!OPERATIONS_STATE.currentOperationId) { showToast('❌ لا توجد عملية محددة', 'error'); return; }
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

    var investorId = _getVal('newOpInvestorId');
    var contribution = parseFloat(_getVal('newOpInvestorContribution')) || 0;
    var profit = parseFloat(_getVal('newOpInvestorProfit')) || 0;

    if (!investorId) { showToast('❌ يرجى اختيار الممول', 'error'); return; }
    if (contribution <= 0) { showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error'); return; }

    // التحقق من التكرار
    try {
        var check = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('id')
                .eq('operation_id', OPERATIONS_STATE.currentOperationId)
                .eq('investor_id', investorId);
        }, { context: 'saveOpInvestor-check', throwError: false });

        if (check.data && check.data.length > 0) {
            showToast('❌ هذا الممول مضاف بالفعل للعملية', 'error');
            return;
        }
    } catch (e) {}

    showLoading();

    try {
        var data = {
            operation_id: OPERATIONS_STATE.currentOperationId,
            investor_id: investorId,
            contribution: contribution,
            profit: profit
        };

        var result = await runQuery(function() {
            return APP.supabase.from('operation_investors').insert(data).select();
        }, { context: 'saveOpInvestor', throwError: true });

        if (result.data && result.data[0]) {
            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB('إضافة ممول لعملية', 'operation_investor', result.data[0].id, null, JSON.stringify(data), 'Operation: ' + OPERATIONS_STATE.currentOperationId, 'create');
            }
        }

        closeModal('addInvestorToOpModal');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);

        // ✅ عرض Dialog التمويل
        var investorName = '';
        (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(inv) {
            if (inv.id === investorId) investorName = inv.name;
        });

        showFundingDialog(investorId, investorName, contribution);

    } catch (err) {
        showToast(handleSupabaseError(err, 'إضافة الممول'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 16. FUNDING DIALOG (بعد إضافة ممول)
// ============================================================

function showFundingDialog(investorId, investorName, contribution) {
    // إزالة أي Dialog موجود
    var existing = document.getElementById('fundingDialog');
    if (existing) existing.remove();

    var html = '<div id="fundingDialog" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10000; display: flex; align-items: center; justify-content: center;">';
    html += '<div style="background: white; border-radius: 12px; padding: 24px; max-width: 420px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">';
    html += '<div style="text-align: center; margin-bottom: 20px;">';
    html += '<div style="font-size: 3rem; margin-bottom: 12px;">✅</div>';
    html += '<h3 style="margin: 0 0 8px;">تم إضافة الممول للعملية بنجاح</h3>';
    html += '<p style="color: #64748b; margin: 0;">هل تم استلام المبلغ بالفعل من <strong>' + escapeHtml(investorName) + '</strong>؟</p>';
    html += '<p style="font-size: 1.5rem; font-weight: 700; color: #667eea; margin: 12px 0 0;">' + formatMoney(contribution) + '</p>';
    html += '</div>';
    html += '<div style="display: flex; gap: 12px;">';
    html += '<button id="fundingDialogNow" class="btn btn-success btn-block">💸 إنشاء التحويل الآن</button>';
    html += '<button id="fundingDialogLater" class="btn btn-secondary btn-block">لاحقاً</button>';
    html += '</div>';
    html += '</div></div>';

    document.body.insertAdjacentHTML('beforeend', html);

    // ربط الأحداث
    document.getElementById('fundingDialogNow').onclick = function() {
        document.getElementById('fundingDialog').remove();
        openFundingTransfer(investorId, contribution);
    };

    document.getElementById('fundingDialogLater').onclick = function() {
        document.getElementById('fundingDialog').remove();
        showToast('ℹ️ يمكنك إنشاء التحويل لاحقاً من تبويب الممولين', 'info');
    };
}

// ============================================================
// 17. OPEN FUNDING TRANSFER (معبأ مسبقاً)
// ============================================================

function openFundingTransfer(investorId, contribution) {
    debug('💸 فتح تحويل التمويل - Investor: ' + investorId + ', Amount: ' + contribution, 'info');

    // إغلاق مودال التفاصيل
    closeModal('operationDetailsModal');

    // فتح مودال التحويل معبأً مسبقاً
    if (typeof openTransferModal === 'function') {
        openTransferModal(null, {
            fromType: 'investor',
            fromEntity: investorId,
            toType: 'company',
            amount: contribution,
            operationId: OPERATIONS_STATE.currentOperationId
        });
    } else {
        showToast('❌ دالة openTransferModal غير متاحة', 'error');
    }
}

// ============================================================
// 18. EDIT INVESTOR IN OPERATION
// ============================================================

async function openEditOpInvestor(opInvestorId) {
    if (!opInvestorId) return;
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('*, investors(name)')
                .eq('id', opInvestorId)
                .single();
        }, { context: 'openEditOpInvestor', throwError: true });

        var record = result.data;
        if (!record) { showToast('❌ السجل غير موجود', 'error'); return; }

        _setVal('editOpInvestorId', record.id);
        _setVal('editOpInvestorContribution', record.contribution);
        _setVal('editOpInvestorProfit', record.profit);

        var warningEl = document.getElementById('editOpInvestorValidationWarning');
        if (warningEl) warningEl.innerHTML = '';

        openModal('editOpInvestorModal');

    } catch (err) {
        showToast(handleSupabaseError(err, 'جلب بيانات الممول'), 'error');
    }
}

async function updateOpInvestor(form, event) {
    if (event) event.preventDefault();
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }

    var recordId = _getVal('editOpInvestorId');
    var contribution = parseFloat(_getVal('editOpInvestorContribution')) || 0;
    var profit = parseFloat(_getVal('editOpInvestorProfit')) || 0;

    if (!recordId) { showToast('❌ السجل غير موجود', 'error'); return; }
    if (contribution <= 0) { showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error'); return; }

    showLoading();

    try {
        var oldResult = await runQuery(function() {
            return APP.supabase.from('operation_investors').select('*').eq('id', recordId).single();
        }, { context: 'updateOpInvestor-getOld', throwError: true });

        var data = { contribution: contribution, profit: profit };

        await runQuery(function() {
            return APP.supabase.from('operation_investors').update(data).eq('id', recordId);
        }, { context: 'updateOpInvestor', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('تعديل مساهمة ممول', 'operation_investor', recordId, JSON.stringify(oldResult.data), JSON.stringify(data), 'Operation: ' + OPERATIONS_STATE.currentOperationId, 'update');
        }

        showToast('✅ تم تحديث مساهمة الممول', 'success');
        closeModal('editOpInvestorModal');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);

    } catch (err) {
        showToast(handleSupabaseError(err, 'تحديث مساهمة الممول'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 19. DELETE INVESTOR FROM OPERATION
// ============================================================

async function deleteOpInvestor(opInvestorId) {
    if (!opInvestorId) return;
    if (!canEdit()) { showToast('❌ لا توجد صلاحية', 'error'); return; }
    if (!confirmDelete('هذا الممول من العملية')) return;

    showLoading();

    try {
        var oldResult = await runQuery(function() {
            return APP.supabase.from('operation_investors').select('*').eq('id', opInvestorId).single();
        }, { context: 'deleteOpInvestor-getOld', throwError: true });

        await runQuery(function() {
            return APP.supabase.from('operation_investors').delete().eq('id', opInvestorId);
        }, { context: 'deleteOpInvestor', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('حذف ممول من عملية', 'operation_investor', opInvestorId, JSON.stringify(oldResult.data), null, 'Operation: ' + OPERATIONS_STATE.currentOperationId, 'delete');
        }

        showToast('✅ تم حذف الممول من العملية', 'success');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);

    } catch (err) {
        showToast(handleSupabaseError(err, 'حذف الممول'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 20. TRANSFERS TAB
// ============================================================

async function loadOpTransfersTab(operationId) {
    var container = document.getElementById('opTransfersList');
    if (!container) return;

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('transfers')
                .select('*')
                .eq('operation_id', operationId)
                .order('transfer_date', { ascending: false });
        }, { context: 'loadOpTransfersTab', throwError: false });

        var transfers = result.data || [];

        if (transfers.length === 0) {
            container.innerHTML = '<div class="empty-state">لا توجد تحويلات مرتبطة بهذه العملية</div>';
            return;
        }

        var html = '<table><thead><tr><th>التاريخ</th><th>النوع</th><th>الغرض</th><th>المبلغ</th></tr></thead><tbody>';

        transfers.forEach(function(t) {
            var purposeText = (typeof PURPOSE_TEXT_AR !== 'undefined' && PURPOSE_TEXT_AR[t.purpose]) ? PURPOSE_TEXT_AR[t.purpose] : (t.purpose || '-');
            html += '<tr><td>' + formatDate(t.transfer_date) + '</td><td>' + escapeHtml(t.type || '-') + '</td><td>' + escapeHtml(purposeText) + '</td><td>' + formatMoney(t.amount) + '</td></tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        container.innerHTML = '<div class="empty-state">فشل في تحميل التحويلات</div>';
    }
}

// ============================================================
// 21. TIMELINE TAB
// ============================================================

async function loadOpTimelineTab(operationId) {
    var container = document.getElementById('opTimelineList');
    if (!container) return;

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('activity_logs')
                .select('*')
                .eq('entity_id', operationId)
                .order('created_at', { ascending: false })
                .limit(50);
        }, { context: 'loadOpTimelineTab', throwError: false });

        var logs = result.data || [];

        if (logs.length === 0) {
            container.innerHTML = '<div class="empty-state">لا يوجد سجل نشاط</div>';
            return;
        }

        var html = '<div class="timeline">';
        logs.forEach(function(log) {
            html += '<div class="timeline-item">';
            html += '<div class="timeline-time">' + formatDateTime(log.created_at) + '</div>';
            html += '<div class="timeline-user">' + escapeHtml(log.user_email || 'System') + '</div>';
            html += '<div class="timeline-content"><strong>' + escapeHtml(log.action_type || '-') + '</strong>';
            if (log.details) html += '<p>' + escapeHtml(log.details) + '</p>';
            html += '</div></div>';
        });
        html += '</div>';
        container.innerHTML = html;

    } catch (err) {
        container.innerHTML = '<div class="empty-state">فشل في تحميل سجل النشاط</div>';
    }
}

// ============================================================
// 22. ARCHIVE OPERATION
// ============================================================

async function archiveOperation(operationId) {
    if (!operationId || !canEdit()) return;
    if (!confirmArchive('هذه العملية')) return;

    showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations').update({ is_archived: true }).eq('id', operationId);
        }, { context: 'archiveOperation', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('أرشفة عملية', 'operation', operationId, null, null, 'Archived', 'archive');
        }

        showToast('✅ تم أرشفة العملية', 'success');
        loadOperations();

    } catch (err) {
        showToast(handleSupabaseError(err, 'أرشفة العملية'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 23. SEARCH & FILTER
// ============================================================

function searchOperations(term) {
    OPERATIONS_STATE.search = term || '';
    loadOperations();
}

function filterOperations(status) {
    OPERATIONS_STATE.filter = status || '';
    loadOperations();
}

// ============================================================
// 24. VALIDATION (لـ app.js)
// ============================================================

function validateOpInvestorInputs() {
    var contribution = parseFloat(_getVal('newOpInvestorContribution')) || 0;
    var warningEl = document.getElementById('opInvestorValidationWarning');
    if (!warningEl) return;
    warningEl.innerHTML = contribution <= 0 ? '<div class="validation-warning">⚠️ المساهمة يجب أن تكون أكبر من صفر</div>' : '';
}

function validateEditOpInvestorInputs() {
    var contribution = parseFloat(_getVal('editOpInvestorContribution')) || 0;
    var warningEl = document.getElementById('editOpInvestorValidationWarning');
    if (!warningEl) return;
    warningEl.innerHTML = contribution <= 0 ? '<div class="validation-warning">⚠️ المساهمة يجب أن تكون أكبر من صفر</div>' : '';
}

// ============================================================
// 25. PLACEHOLDER (للتوافق مع app.js)
// ============================================================

function openAddTransferToOp() {
    if (typeof openTransferModal === 'function') {
        closeModal('operationDetailsModal');
        openTransferModal(null, { operationId: OPERATIONS_STATE.currentOperationId });
    }
}

// ============================================================
// 26. HELPERS
// ============================================================

function _getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function _setVal(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = (value !== null && value !== undefined) ? value : '';
}

function getStatusText(status) {
    if (typeof STATUS_TEXT !== 'undefined' && STATUS_TEXT[status]) return STATUS_TEXT[status];
    var map = { 'draft': 'تحت الإنشاء', 'active': 'نشطة', 'completed': 'انتهت', 'cancelled': 'ألغيت' };
    return map[status] || status || '-';
}

function getOperationTypeText(type) {
    var map = { 'financing': 'تمويل', 'supply': 'توريد' };
    return map[type] || type || '-';
}

// ============================================================
// 27. INIT
// ============================================================

if (typeof document !== 'undefined') {
    initOperations();
}
