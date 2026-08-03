// ============================================================
// نظام إدارة التمويل - Operations Module
// Version: 5.0.0 (Complete Rewrite - Full Workflow Support)
// Last Updated: 2026-08-03
// ============================================================

var OPERATIONS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: { clients: null, investors: null },
    currentOperationId: null
};

// ============================================================
// 1. INITIALIZATION
// ============================================================

function initOperations() {
    debug('⚙️ بدء تهيئة operations.js', 'info');
    registerScreenLoader('operations', loadOperations);
    debug('✅ operations.js جاهز', 'success');
}

// ============================================================
// 2. LOAD OPERATIONS
// ============================================================

async function loadOperations() {
    debug('⚙️ بدأ loadOperations', 'info');
    if (!isSupabaseReady()) return;
    
    showLoading();
    
    try {
        var results = await Promise.all([
            runQuery(function() {
                var query = APP.supabase.from('operations')
                    .select('id, name, type, client_id, amount, investor_display_amount, status, start_date, end_date, final_profit, is_locked, is_archived, created_at')
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
        
        clients.forEach(function(c) { 
            clientsById[c.id] = c; 
        });

        ops.forEach(function(op) {
            op.client = clientsById[op.client_id] || null;
        });

        OPERATIONS_STATE.records = ops;
        renderOperationsList();
        
        debug('✅ تم تحميل ' + ops.length + ' عملية', 'success');
        
    } catch (err) {
        debug('❌ خطأ في loadOperations: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل العمليات'), 'error');
    } finally {
        hideLoading();
    }
}

async function loadClientsForOps() {
    if (OPERATIONS_STATE.referenceCache.clients) return OPERATIONS_STATE.referenceCache.clients;
    
    var result = await runQuery(function() {
        return APP.supabase.from('clients')
            .select('id, name, is_archived')
            .eq('is_archived', false)
            .order('name');
    }, { context: 'loadClientsForOps', throwError: true });
    
    OPERATIONS_STATE.referenceCache.clients = result.data || [];
    return OPERATIONS_STATE.referenceCache.clients;
}

async function loadInvestorsForOps() {
    if (OPERATIONS_STATE.referenceCache.investors) return OPERATIONS_STATE.referenceCache.investors;
    
    var result = await runQuery(function() {
        return APP.supabase.from('investors')
            .select('id, name, is_archived')
            .eq('is_archived', false)
            .order('name');
    }, { context: 'loadInvestorsForOps', throwError: true });
    
    OPERATIONS_STATE.referenceCache.investors = result.data || [];
    return OPERATIONS_STATE.referenceCache.investors;
}

// ============================================================
// 3. RENDER OPERATIONS LIST
// ============================================================

function renderOperationsList() {
    var container = document.getElementById('operationsTable');
    if (!container) return;

    if (OPERATIONS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد عمليات</div>';
        return;
    }

    var html = '<table><thead><tr><th>الاسم</th><th>العميل</th><th>النوع</th><th>المبلغ</th><th>الحالة</th><th>تاريخ النهاية</th><th>الإجراءات</th></tr></thead><tbody>';

    OPERATIONS_STATE.records.forEach(function(op) {
        var statusClass = 'badge-' + op.status;
        var statusText = getStatusText(op.status);
        var clientName = op.client ? escapeHtml(op.client.name) : '-';

        html += '<tr>';
        html += '<td><a href="#" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.name) + '</a></td>';
        html += '<td>' + clientName + '</td>';
        html += '<td>' + getOperationTypeText(op.type) + '</td>';
        html += '<td>' + formatMoney(op.amount) + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>';
        html += '<td>' + formatDate(op.end_date) + '</td>';
        html += '<td class="actions-cell">';
        
        if (canEdit()) {
            html += '<button class="btn btn-secondary btn-sm" data-action="editOperation" data-param="' + op.id + '">تعديل</button>';
            if (!op.is_locked && op.status !== 'completed') {
                html += '<button class="btn btn-warning btn-sm" data-action="archiveOperation" data-param="' + op.id + '">أرشفة</button>';
            }
        }
        
        html += '</td></tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ============================================================
// 4. OPERATION MODAL (ADD/EDIT)
// ============================================================

async function openOperationModal(operationId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var titleEl = document.getElementById('operationModalTitle');
    var idEl = document.getElementById('operationId');
    if (!titleEl || !idEl) return;

    await loadClientsForOps();

    var clientSelect = document.getElementById('opClient');
    if (clientSelect) {
        var options = '<option value="">-- اختر العميل --</option>';
        OPERATIONS_STATE.referenceCache.clients.forEach(function(c) {
            options += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        });
        clientSelect.innerHTML = options;
    }

    ['opName', 'opAmount', 'opInvestorDisplayAmount', 'opExpectedProfit', 'opFinalProfit',
     'opProfitApprovalDate', 'opGoogleDriveUrl', 'opCompanyProfitValue', 'opStartDate',
     'opDurationDays', 'opEndDate', 'opNotes'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });

    if (document.getElementById('opType')) document.getElementById('opType').value = 'financing';
    if (document.getElementById('opCompanyProfitType')) document.getElementById('opCompanyProfitType').value = '';
    if (document.getElementById('opStatus')) document.getElementById('opStatus').value = 'draft';

    if (operationId) {
        try {
            var result = await runQuery(function() {
                return APP.supabase.from('operations').select('*').eq('id', operationId).single();
            }, { context: 'openOperationModal', throwError: true });

            var op = result.data;
            if (!op) {
                showToast('❌ العملية غير موجودة', 'error');
                return;
            }

            titleEl.textContent = 'تعديل عملية';
            idEl.value = op.id;

            if (document.getElementById('opName')) document.getElementById('opName').value = op.name || '';
            if (document.getElementById('opType')) document.getElementById('opType').value = op.type || 'financing';
            if (document.getElementById('opClient')) document.getElementById('opClient').value = op.client_id || '';
            if (document.getElementById('opAmount')) document.getElementById('opAmount').value = op.amount || '';
            if (document.getElementById('opInvestorDisplayAmount')) document.getElementById('opInvestorDisplayAmount').value = op.investor_display_amount || '';
            if (document.getElementById('opExpectedProfit')) document.getElementById('opExpectedProfit').value = op.expected_profit || '';
            if (document.getElementById('opFinalProfit')) document.getElementById('opFinalProfit').value = op.final_profit || '';
            if (document.getElementById('opProfitApprovalDate')) document.getElementById('opProfitApprovalDate').value = formatDateForInput(op.profit_approval_date);
            if (document.getElementById('opGoogleDriveUrl')) document.getElementById('opGoogleDriveUrl').value = op.google_drive_url || '';
            if (document.getElementById('opCompanyProfitType')) document.getElementById('opCompanyProfitType').value = op.company_profit_type || '';
            if (document.getElementById('opCompanyProfitValue')) document.getElementById('opCompanyProfitValue').value = op.company_profit_value || '';
            if (document.getElementById('opStartDate')) document.getElementById('opStartDate').value = formatDateForInput(op.start_date);
            if (document.getElementById('opDurationDays')) document.getElementById('opDurationDays').value = op.duration_days || '';
            if (document.getElementById('opEndDate')) document.getElementById('opEndDate').value = formatDateForInput(op.end_date);
            if (document.getElementById('opStatus')) document.getElementById('opStatus').value = op.status || 'draft';
            if (document.getElementById('opNotes')) document.getElementById('opNotes').value = op.notes || '';

        } catch (err) {
            showToast(handleSupabaseError(err, 'جلب بيانات العملية'), 'error');
            return;
        }
    } else {
        titleEl.textContent = 'إضافة عملية';
        idEl.value = '';
        if (document.getElementById('opStartDate')) document.getElementById('opStartDate').value = getTodayDate();
    }

    openModal('operationModal');
}

function editOperation(operationId) {
    openOperationModal(operationId);
}

async function saveOperation(form, event) {
    if (event) event.preventDefault();
    
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var id = document.getElementById('operationId').value;
    var data = {
        name: document.getElementById('opName').value.trim(),
        type: document.getElementById('opType').value,
        client_id: document.getElementById('opClient').value || null,
        amount: parseFloat(document.getElementById('opAmount').value) || 0,
        investor_display_amount: document.getElementById('opInvestorDisplayAmount').value ? parseFloat(document.getElementById('opInvestorDisplayAmount').value) : null,
        expected_profit: parseFloat(document.getElementById('opExpectedProfit').value) || 0,
        final_profit: parseFloat(document.getElementById('opFinalProfit').value) || 0,
        profit_approval_date: document.getElementById('opProfitApprovalDate').value || null,
        google_drive_url: document.getElementById('opGoogleDriveUrl').value || null,
        company_profit_type: document.getElementById('opCompanyProfitType').value || null,
        company_profit_value: parseFloat(document.getElementById('opCompanyProfitValue').value) || 0,
        start_date: document.getElementById('opStartDate').value,
        duration_days: parseInt(document.getElementById('opDurationDays').value) || 0,
        end_date: document.getElementById('opEndDate').value || null,
        status: document.getElementById('opStatus').value,
        notes: document.getElementById('opNotes').value.trim()
    };

    if (!data.name || !data.client_id || !data.amount || !data.start_date) {
        showToast('❌ يرجى ملء جميع الحقول المطلوبة', 'error');
        return;
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
                await window.logActivityToDB('تعديل عملية', 'operation', id, JSON.stringify(oldResult.data), JSON.stringify(data), 'Name: ' + data.name, 'update');
            }

            showToast('تم تحديث العملية', 'success');
        } else {
            var result = await runQuery(function() {
                return APP.supabase.from('operations').insert(data).select();
            }, { context: 'saveOperation-insert', throwError: true });

            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    await window.logActivityToDB('إضافة عملية', 'operation', result.data[0].id, null, JSON.stringify(data), 'Name: ' + data.name, 'create');
                }

                showToast('تم إضافة العملية', 'success');
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
// 5. OPERATION DETAILS
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
        if (!op) {
            showToast('❌ العملية غير موجودة', 'error');
            return;
        }

        // جلب اسم العميل
        var clientName = '-';
        if (op.client_id) {
            var clientResult = await runQuery(function() {
                return APP.supabase.from('clients').select('name').eq('id', op.client_id).single();
            }, { context: 'openOperationDetails-client', throwError: false });
            
            if (clientResult.data) clientName = clientResult.data.name;
        }

        var summaryGrid = document.getElementById('opSummaryGrid');
        if (summaryGrid) {
            summaryGrid.innerHTML =
                '<div class="summary-item"><label>الاسم</label><div class="val">' + escapeHtml(op.name) + '</div></div>' +
                '<div class="summary-item"><label>العميل</label><div class="val">' + escapeHtml(clientName) + '</div></div>' +
                '<div class="summary-item"><label>المبلغ</label><div class="val blue">' + formatMoney(op.amount) + '</div></div>' +
                (op.investor_display_amount ? '<div class="summary-item"><label>الظاهر للممول</label><div class="val">' + formatMoney(op.investor_display_amount) + '</div></div>' : '') +
                '<div class="summary-item"><label>الربح النهائي</label><div class="val green profit-field">' + formatMoney(op.final_profit) + '</div></div>' +
                '<div class="summary-item"><label>الحالة</label><div class="val">' + getStatusText(op.status) + '</div></div>' +
                '<div class="summary-item"><label>تاريخ النهاية</label><div class="val">' + formatDate(op.end_date) + '</div></div>';
        }

        // عرض أزرار Workflow حسب الحالة
        var workflowActions = document.getElementById('workflowActions');
        if (workflowActions) {
            var isLocked = op.is_locked || op.status === 'completed' || op.status === 'cancelled';
            workflowActions.style.display = canEdit() && !isLocked ? 'flex' : 'none';
            
            var unlockBtn = document.getElementById('unlockBtn');
            if (unlockBtn) unlockBtn.style.display = (isLocked && canEdit()) ? 'inline-flex' : 'none';
        }

        await loadOpInvestorsTab(operationId);
        await loadOpTransfersTab(operationId);
        await loadOpTimelineTab(operationId);

        var titleEl = document.getElementById('opDetailsTitle');
        if (titleEl) titleEl.textContent = 'تفاصيل: ' + op.name;

        openModal('operationDetailsModal');
        
    } catch (err) {
        debug('❌ خطأ في openOperationDetails: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'فتح تفاصيل العملية'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 6. ADD INVESTOR TO OPERATION
// ============================================================

async function openAddInvestorToOp() {
    if (!OPERATIONS_STATE.currentOperationId || !canEdit()) {
        showToast('❌ لا توجد صلاحية أو عملية محددة', 'error');
        return;
    }

    await loadInvestorsForOps();

    var selectEl = document.getElementById('newOpInvestorId');
    if (selectEl) {
        var options = '<option value="">-- اختر الممول --</option>';
        OPERATIONS_STATE.referenceCache.investors.forEach(function(inv) {
            options += '<option value="' + inv.id + '">' + escapeHtml(inv.name) + '</option>';
        });
        selectEl.innerHTML = options;
    }

    if (document.getElementById('newOpInvestorContribution')) document.getElementById('newOpInvestorContribution').value = '';
    if (document.getElementById('newOpInvestorProfit')) document.getElementById('newOpInvestorProfit').value = '';

    var warningEl = document.getElementById('opInvestorValidationWarning');
    if (warningEl) warningEl.innerHTML = '';

    openModal('addInvestorToOpModal');
}

async function saveOpInvestor(form, event) {
    if (event) event.preventDefault();
    
    if (!OPERATIONS_STATE.currentOperationId || !canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var investorId = document.getElementById('newOpInvestorId').value;
    var contribution = parseFloat(document.getElementById('newOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('newOpInvestorProfit').value) || 0;

    if (!investorId) {
        showToast('❌ يرجى اختيار الممول', 'error');
        return;
    }

    if (contribution <= 0) {
        showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error');
        return;
    }

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
                await window.logActivityToDB('إضافة ممول لعملية', 'operation_investor', result.data[0].id, null, JSON.stringify(data), 'Operation: ' + OPERATIONS_STATE.currentOperationId, 'create');
            }

            showToast('تم إضافة الممول للعملية', 'success');
        }

        closeModal('addInvestorToOpModal');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);
        
    } catch (err) {
        debug('❌ خطأ في saveOpInvestor: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'إضافة الممول'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 7. DELETE INVESTOR FROM OPERATION
// ============================================================

async function deleteOpInvestor(opInvestorId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

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
            await window.logActivityToDB('حذف ممول من عملية', 'operation_investor', opInvestorId, JSON.stringify(oldResult.data), null, 'Operation: ' + OPERATIONS_STATE.currentOperationId, 'delete');
        }

        showToast('تم حذف الممول من العملية', 'success');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);
        
    } catch (err) {
        showToast(handleSupabaseError(err, 'حذف الممول'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 8. LOAD OPERATION TABS
// ============================================================

async function loadOpInvestorsTab(operationId) {
    var container = document.getElementById('opInvestorsList');
    if (!container) return;

    var result = await runQuery(function() {
        return APP.supabase.from('operation_investors')
            .select('id, investor_id, contribution, profit, investors(name)')
            .eq('operation_id', operationId);
    }, { context: 'loadOpInvestorsTab', throwError: false });

    var investors = result.data || [];

    if (investors.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد ممولين مرتبطين</div>';
        return;
    }

    var html = '<table style="width:100%"><thead><tr><th>الممول</th><th>المساهمة</th><th>الربح</th><th>الإجراءات</th></tr></thead><tbody>';

    investors.forEach(function(oi) {
        html += '<tr><td>' + escapeHtml(oi.investors?.name || '-') + '</td><td>' + formatMoney(oi.contribution) + '</td><td class="profit-field">' + formatMoney(oi.profit) + '</td><td class="actions-cell">';
        
        if (canEdit()) {
            html += '<button class="btn btn-danger btn-sm" data-action="deleteOpInvestor" data-param="' + oi.id + '">حذف</button>';
        }
        
        html += '</td></tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

async function loadOpTransfersTab(operationId) {
    var container = document.getElementById('opTransfersList');
    if (!container) return;

    var result = await runQuery(function() {
        return APP.supabase.from('transfers')
            .select('*')
            .eq('operation_id', operationId)
            .order('transfer_date', { ascending: false });
    }, { context: 'loadOpTransfersTab', throwError: false });

    var transfers = result.data || [];

    if (transfers.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد تحويلات مرتبطة</div>';
        return;
    }

    var html = '<table style="width:100%"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>الغرض</th></tr></thead><tbody>';

    transfers.forEach(function(t) {
        html += '<tr><td>' + formatDate(t.transfer_date) + '</td><td>' + t.type + '</td><td>' + formatMoney(t.amount) + '</td><td>' + (PURPOSE_TEXT_AR[t.purpose] || t.purpose) + '</td></tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

async function loadOpTimelineTab(operationId) {
    var container = document.getElementById('opTimelineList');
    if (!container) return;

    var result = await runQuery(function() {
        return APP.supabase.from('activity_logs')
            .select('*')
            .eq('entity_id', operationId)
            .eq('entity_type', 'operation')
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
        html += '<div class="timeline-item"><div class="timeline-time">' + formatDateTime(log.created_at) + '</div><div class="timeline-user">' + escapeHtml(log.user_email || 'System') + '</div><div class="timeline-content"><strong>' + escapeHtml(log.action_type) + '</strong><p>' + escapeHtml(log.details || '') + '</p></div></div>';
    });

    html += '</div>';
    container.innerHTML = html;
}

// ============================================================
// 9. WORKFLOW ACTIONS
// ============================================================

async function workflowAction(action) {
    if (!OPERATIONS_STATE.currentOperationId || !canEdit()) return;

    var opId = OPERATIONS_STATE.currentOperationId;
    var confirmMsg = '';
    var newStatus = null;

    switch (action) {
        case 'activate': 
            confirmMsg = 'هل تريد تفعيل هذه العملية؟';
            newStatus = 'active';
            break;
        case 'complete': 
            confirmMsg = 'هل تريد إنهاء هذه العملية؟ سيتم قفلها.';
            newStatus = 'completed';
            break;
        case 'unlock': 
            confirmMsg = 'هل تريد فتح قفل العملية للتعديل؟';
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
    }

    if (confirmMsg && !confirmAction(confirmMsg)) return;

    showLoading();

    try {
        if (newStatus) {
            await runQuery(function() {
                return APP.supabase.from('operations')
                    .update({ 
                        status: newStatus, 
                        is_locked: newStatus === 'completed' 
                    })
                    .eq('id', opId);
            }, { context: 'workflowAction', throwError: true });
            
        } else if (action === 'unlock') {
            await runQuery(function() {
                return APP.supabase.from('operations')
                    .update({ is_locked: false })
                    .eq('id', opId);
            }, { context: 'workflowAction-unlock', throwError: true });
        }

        if (typeof window.logActivityToDB === 'function') {
            await window.logActivityToDB('Workflow: ' + action, 'operation', opId, null, null, 'Action: ' + action, 'workflow');
        }

        showToast('تم تنفيذ الإجراء بنجاح', 'success');
        openOperationDetails(opId);
        
    } catch (err) {
        showToast(handleSupabaseError(err, 'تنفيذ الإجراء'), 'error');
    } finally {
        hideLoading();
    }
}

function openWorkflowTransfer(purpose) {
    showToast('فتح تحويل Workflow: ' + purpose + ' (يتطلب تكامل مع Transfers)', 'info');
}

// ============================================================
// 10. ARCHIVE OPERATION
// ============================================================

async function archiveOperation(operationId) {
    if (!canEdit() || !confirmArchive('هذه العملية')) return;

    showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations')
                .update({ is_archived: true })
                .eq('id', operationId);
        }, { context: 'archiveOperation', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            await window.logActivityToDB('أرشفة عملية', 'operation', operationId, null, null, 'Archived', 'archive');
        }

        showToast('تم أرشفة العملية', 'success');
        loadOperations();
        
    } catch (err) {
        showToast(handleSupabaseError(err, 'أرشفة العملية'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 11. SEARCH & FILTER
// ============================================================

function searchOperations(term) {
    OPERATIONS_STATE.search = term;
    loadOperations();
}

function filterOperations(status) {
    OPERATIONS_STATE.filter = status;
    loadOperations();
}
