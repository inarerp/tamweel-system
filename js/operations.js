// ============================================================
// نظام إدارة التمويل - Operations Module
// Version: 7.0.0 (Final - Production Ready)
// Last Updated: 2026-08-04
// ============================================================
//
// المسؤوليات:
// - قائمة العمليات (بحث + فلترة)
// - إضافة / تعديل عملية
// - تفاصيل العملية (ملخص + عميل + ممولين + تحويلات + Timeline)
// - Workflow كامل (تفعيل، سداد، أرباح، إرجاع، إنهاء، فتح قفل)
// - إدارة ممولي العملية (إضافة / تعديل / حذف)
// - أرشفة العمليات
//
// يعتمد على:
// - core.js (APP, SCREEN_LOADERS, runQuery, debug, showToast, openModal, closeModal, ...)
// - auth.js (canEdit)
// - app.js (Event Delegation: data-action, data-submit)
//
// ملاحظة: لا يحتوي على DOMContentLoaded (app.js هو Bootstrap)
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

    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }

    showLoading();

    try {
        var results = await Promise.all([
            runQuery(function() {
                var query = APP.supabase.from('operations')
                    .select('id, name, type, client_id, amount, investor_display_amount, expected_profit, final_profit, status, start_date, end_date, is_locked, is_archived, created_at')
                    .order('created_at', { ascending: false });

                if (OPERATIONS_STATE.filter) {
                    query = query.eq('status', OPERATIONS_STATE.filter);
                }

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

// ============================================================
// 4. REFERENCE DATA
// ============================================================

async function loadClientsForOps() {
    if (OPERATIONS_STATE.referenceCache.clients) return OPERATIONS_STATE.referenceCache.clients;

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('clients')
                .select('id, name, phone, email, is_archived')
                .eq('is_archived', false)
                .order('name');
        }, { context: 'loadClientsForOps', throwError: true });

        OPERATIONS_STATE.referenceCache.clients = result.data || [];
        return OPERATIONS_STATE.referenceCache.clients;
    } catch (err) {
        debug('❌ خطأ في loadClientsForOps: ' + err.message, 'error');
        return [];
    }
}

async function loadInvestorsForOps() {
    if (OPERATIONS_STATE.referenceCache.investors) return OPERATIONS_STATE.referenceCache.investors;

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('investors')
                .select('id, name, phone, email, is_archived')
                .eq('is_archived', false)
                .order('name');
        }, { context: 'loadInvestorsForOps', throwError: true });

        OPERATIONS_STATE.referenceCache.investors = result.data || [];
        return OPERATIONS_STATE.referenceCache.investors;
    } catch (err) {
        debug('❌ خطأ في loadInvestorsForOps: ' + err.message, 'error');
        return [];
    }
}

function clearOpsReferenceCache() {
    OPERATIONS_STATE.referenceCache.clients = null;
    OPERATIONS_STATE.referenceCache.investors = null;
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

    var html = '<table><thead><tr>';
    html += '<th>الاسم</th><th>العميل</th><th>النوع</th><th>المبلغ</th><th>الربح المتوقع</th><th>الحالة</th><th>تاريخ النهاية</th><th>الإجراءات</th>';
    html += '</tr></thead><tbody>';

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
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var titleEl = document.getElementById('operationModalTitle');
    var idEl = document.getElementById('operationId');
    if (!titleEl || !idEl) return;

    // تحميل العملاء وملء القائمة
    await loadClientsForOps();

    var clientSelect = document.getElementById('opClient');
    if (clientSelect) {
        var options = '<option value="">-- اختر العميل --</option>';
        (OPERATIONS_STATE.referenceCache.clients || []).forEach(function(c) {
            options += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        });
        clientSelect.innerHTML = options;
    }

    // تفريغ الحقول
    ['opName', 'opAmount', 'opInvestorDisplayAmount', 'opExpectedProfit', 'opFinalProfit',
     'opProfitApprovalDate', 'opGoogleDriveUrl', 'opCompanyProfitValue', 'opStartDate',
     'opDurationDays', 'opEndDate', 'opNotes'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });

    var typeEl = document.getElementById('opType');
    if (typeEl) typeEl.value = 'financing';

    var profitTypeEl = document.getElementById('opCompanyProfitType');
    if (profitTypeEl) profitTypeEl.value = '';

    var statusEl = document.getElementById('opStatus');
    if (statusEl) statusEl.value = 'draft';

    if (operationId) {
        // وضع التعديل
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
        // وضع الإضافة
        titleEl.textContent = 'إضافة عملية';
        idEl.value = '';
        _setVal('opStartDate', getTodayDate());
    }

    openModal('operationModal');
}

// ============================================================
// 7. EDIT OPERATION (يُستدعى من app.js أو من زر التعديل)
// ============================================================

function editOperation(operationId) {
    // إذا لم يتم تمرير ID، استخدم العملية الحالية
    if (!operationId) {
        operationId = OPERATIONS_STATE.currentOperationId;
    }

    if (!operationId) {
        showToast('❌ لا توجد عملية محددة للتعديل', 'error');
        return;
    }

    // إغلاق مودال التفاصيل قبل فتح مودال التعديل
    closeModal('operationDetailsModal');

    debug('✏️ فتح مودال تعديل العملية: ' + operationId, 'info');
    openOperationModal(operationId);
}

// ============================================================
// 8. SAVE OPERATION
// ============================================================

async function saveOperation(form, event) {
    if (event) event.preventDefault();

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

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

    // Validation
    if (!data.name) { showToast('❌ اسم العملية مطلوب', 'error'); return; }
    if (!data.client_id) { showToast('❌ يرجى اختيار العميل', 'error'); return; }
    if (!data.amount || data.amount <= 0) { showToast('❌ المبلغ يجب أن يكون أكبر من صفر', 'error'); return; }
    if (!data.start_date) { showToast('❌ تاريخ البداية مطلوب', 'error'); return; }

    // حساب تاريخ النهاية تلقائياً إذا لم يُدخل
    if (!data.end_date && data.start_date && data.duration_days > 0) {
        var endDate = addDays(data.start_date, data.duration_days);
        data.end_date = formatDateForInput(endDate);
    }

    showLoading();

    try {
        if (id) {
            // تحديث
            var oldResult = await runQuery(function() {
                return APP.supabase.from('operations').select('*').eq('id', id).single();
            }, { context: 'saveOperation-getOld', throwError: true });

            await runQuery(function() {
                return APP.supabase.from('operations').update(data).eq('id', id);
            }, { context: 'saveOperation-update', throwError: true });

            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB('تعديل عملية', 'operation', id,
                    JSON.stringify(oldResult.data), JSON.stringify(data),
                    'Name: ' + data.name, 'update');
            }

            showToast('✅ تم تحديث العملية', 'success');
        } else {
            // إضافة
            var result = await runQuery(function() {
                return APP.supabase.from('operations').insert(data).select();
            }, { context: 'saveOperation-insert', throwError: true });

            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB('إضافة عملية', 'operation', result.data[0].id,
                        null, JSON.stringify(data),
                        'Name: ' + data.name, 'create');
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
        // جلب بيانات العملية
        var opResult = await runQuery(function() {
            return APP.supabase.from('operations').select('*').eq('id', operationId).single();
        }, { context: 'openOperationDetails-op', throwError: true });

        var op = opResult.data;
        if (!op) {
            showToast('❌ العملية غير موجودة', 'error');
            return;
        }

        OPERATIONS_STATE.currentOperation = op;

        // ✅ إصلاح زر "تعديل": إضافة data-param ديناميكياً
        var editBtns = document.querySelectorAll('[data-action="editOperation"]');
        editBtns.forEach(function(btn) {
            btn.setAttribute('data-param', operationId);
        });

        // جلب بيانات العميل
        var clientData = null;
        if (op.client_id) {
            try {
                var clientResult = await runQuery(function() {
                    return APP.supabase.from('clients').select('*').eq('id', op.client_id).single();
                }, { context: 'openOperationDetails-client', throwError: false });
                clientData = clientResult.data;
            } catch (e) {
                debug('⚠️ تعذر جلب بيانات العميل', 'warn');
            }
        }

        // عرض الملخص
        _renderOpSummary(op, clientData);

        // عرض أزرار Workflow
        _renderWorkflowButtons(op);

        // تحميل التبويبات
        await Promise.all([
            loadOpInvestorsTab(operationId),
            loadOpTransfersTab(operationId),
            loadOpTimelineTab(operationId)
        ]);

        // تعيين العنوان
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
// 10. RENDER SUMMARY
// ============================================================

function _renderOpSummary(op, clientData) {
    var grid = document.getElementById('opSummaryGrid');
    if (!grid) return;

    var clientName = clientData ? clientData.name : '-';
    var clientPhone = clientData && clientData.phone ? clientData.phone : '';

    var html = '';

    html += '<div class="summary-item"><label>اسم العملية</label><div class="val">' + escapeHtml(op.name) + '</div></div>';
    html += '<div class="summary-item"><label>العميل</label><div class="val">' + escapeHtml(clientName) + (clientPhone ? ' (' + escapeHtml(clientPhone) + ')' : '') + '</div></div>';
    html += '<div class="summary-item"><label>النوع</label><div class="val">' + getOperationTypeText(op.type) + '</div></div>';
    html += '<div class="summary-item"><label>قيمة التمويل</label><div class="val blue">' + formatMoney(op.amount) + '</div></div>';

    if (op.investor_display_amount) {
        html += '<div class="summary-item"><label>الظاهر للممول</label><div class="val">' + formatMoney(op.investor_display_amount) + '</div></div>';
    }

    // ✅ الربح المتوقع + الربح النهائي
    html += '<div class="summary-item"><label>الربح المتوقع</label><div class="val orange">' + formatMoney(op.expected_profit || 0) + '</div></div>';
    html += '<div class="summary-item"><label>الربح النهائي</label><div class="val green profit-field">' + formatMoney(op.final_profit || 0) + '</div></div>';

    if (op.company_profit_type && op.company_profit_value) {
        var typeText = op.company_profit_type === 'percentage' ? '%' : 'ثابت';
        html += '<div class="summary-item"><label>ربح الشركة</label><div class="val">' + op.company_profit_value + ' ' + typeText + '</div></div>';
    }

    html += '<div class="summary-item"><label>الحالة</label><div class="val"><span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span></div></div>';
    html += '<div class="summary-item"><label>تاريخ البداية</label><div class="val">' + formatDate(op.start_date) + '</div></div>';
    html += '<div class="summary-item"><label>تاريخ النهاية</label><div class="val">' + formatDate(op.end_date) + '</div></div>';

    if (op.duration_days) {
        html += '<div class="summary-item"><label>المدة</label><div class="val">' + op.duration_days + ' يوم</div></div>';
    }

    if (op.is_locked) {
        html += '<div class="summary-item"><label>القفل</label><div class="val red">🔒 مقفلة</div></div>';
    }

    if (op.google_drive_url) {
        html += '<div class="summary-item full-width"><label>Google Drive</label><div class="val"><a href="' + escapeHtml(op.google_drive_url) + '" target="_blank">📁 فتح الرابط</a></div></div>';
    }

    if (op.notes) {
        html += '<div class="summary-item full-width"><label>ملاحظات</label><div class="val">' + escapeHtml(op.notes) + '</div></div>';
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
    var canUserEdit = canEdit();

    debug('🎯 Workflow - Status: ' + op.status + ', Locked: ' + isLocked + ', CanEdit: ' + canUserEdit, 'info');

    if (!canUserEdit) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';

    // ✅ إصلاح: إظهار/إخفاء الأزرار الموجودة في HTML بدلاً من إعادة بنائها
    // هذا يحافظ على الـ data-action الموجودة في index.html

    var activateBtn = container.querySelector('[data-action="activateOperation"]');
    var repaymentBtn = container.querySelector('[data-action="clientRepayment"]');
    var profitBtn = container.querySelector('[data-action="profitDistribution"]');
    var returnBtn = container.querySelector('[data-action="capitalReturn"]');
    var completeBtn = container.querySelector('[data-action="completeOperation"]');
    var unlockBtn = container.querySelector('[data-action="unlockOperation"]');

    // إخفاء الكل أولاً
    [activateBtn, repaymentBtn, profitBtn, returnBtn, completeBtn, unlockBtn].forEach(function(btn) {
        if (btn) btn.style.display = 'none';
    });

    if (isLocked) {
        // مقفلة: إظهار زر فتح القفل فقط
        if (unlockBtn) unlockBtn.style.display = 'inline-flex';
        debug('🔒 العملية مقفلة - إظهار زر فتح القفل فقط', 'info');
    } else if (op.status === 'draft') {
        // مسودة: إظهار زر التفعيل فقط
        if (activateBtn) activateBtn.style.display = 'inline-flex';
        debug('📝 العملية مسودة - إظهار زر التفعيل فقط', 'info');
    } else if (op.status === 'active') {
        // نشطة: إظهار جميع أزرار العمليات
        if (repaymentBtn) repaymentBtn.style.display = 'inline-flex';
        if (profitBtn) profitBtn.style.display = 'inline-flex';
        if (returnBtn) returnBtn.style.display = 'inline-flex';
        if (completeBtn) completeBtn.style.display = 'inline-flex';
        debug('🟢 العملية نشطة - إظهار جميع الأزرار', 'info');
    }
}

// ============================================================
// 12. WORKFLOW ACTIONS
// ============================================================

async function workflowAction(action) {
    var opId = OPERATIONS_STATE.currentOperationId;

    if (!opId) {
        showToast('❌ لا توجد عملية محددة', 'error');
        return;
    }

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var confirmMsg = '';
    var updateData = {};

    switch (action) {
        case 'activate':
            // التحقق من وجود ممولين قبل التفعيل
            try {
                var invCheck = await runQuery(function() {
                    return APP.supabase.from('operation_investors')
                        .select('id')
                        .eq('operation_id', opId);
                }, { context: 'workflowAction-checkInvestors', throwError: false });

                if (!invCheck.data || invCheck.data.length === 0) {
                    showToast('⚠️ يجب إضافة ممول واحد على الأقل قبل التفعيل', 'warning');
                    return;
                }
            } catch (e) {
                debug('⚠️ تعذر التحقق من الممولين', 'warn');
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
            debug('❌ إجراء Workflow غير معروف: ' + action, 'error');
            return;
    }

    if (confirmMsg && !confirmAction(confirmMsg)) return;

    showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations').update(updateData).eq('id', opId);
        }, { context: 'workflowAction', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('Workflow: ' + action, 'operation', opId,
                null, JSON.stringify(updateData),
                'Action: ' + action, 'workflow');
        }

        showToast('✅ تم تنفيذ الإجراء بنجاح', 'success');

        // إعادة فتح التفاصيل لتحديث الواجهة
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
        openTransferModal(null, purpose, OPERATIONS_STATE.currentOperationId);
    } else {
        showToast('ℹ️ يرجى الانتقال لشاشة التحويلات لإجراء: ' + purpose, 'info');
    }
}

// ============================================================
// 13. OPERATION INVESTORS TAB
// ============================================================

async function loadOpInvestorsTab(operationId) {
    var container = document.getElementById('opInvestorsList');
    if (!container) return;

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('id, investor_id, contribution, profit, investors(name, phone)')
                .eq('operation_id', operationId)
                .order('created_at', { ascending: true });
        }, { context: 'loadOpInvestorsTab', throwError: false });

        var investors = result.data || [];

        if (investors.length === 0) {
            container.innerHTML = '<div class="empty-state">لا يوجد ممولين مرتبطين بهذه العملية</div>';
            return;
        }

        var totalContribution = 0;
        var totalProfit = 0;

        var html = '<table><thead><tr>';
        html += '<th>الممول</th><th>المساهمة</th><th>الربح</th><th>الإجمالي</th>';
        if (canEdit()) html += '<th>الإجراءات</th>';
        html += '</tr></thead><tbody>';

        investors.forEach(function(oi) {
            var name = oi.investors ? oi.investors.name : '-';
            var total = (oi.contribution || 0) + (oi.profit || 0);
            totalContribution += oi.contribution || 0;
            totalProfit += oi.profit || 0;

            html += '<tr>';
            html += '<td>' + escapeHtml(name) + '</td>';
            html += '<td>' + formatMoney(oi.contribution) + '</td>';
            html += '<td class="profit-field">' + formatMoney(oi.profit) + '</td>';
            html += '<td>' + formatMoney(total) + '</td>';

            if (canEdit()) {
                html += '<td class="actions-cell">';
                html += '<button class="btn btn-secondary btn-sm" data-action="openEditOpInvestor" data-param="' + oi.id + '">✏️</button> ';
                html += '<button class="btn btn-danger btn-sm" data-action="deleteOpInvestor" data-param="' + oi.id + '">🗑️</button>';
                html += '</td>';
            }

            html += '</tr>';
        });

        html += '</tbody><tfoot><tr>';
        html += '<td><strong>الإجمالي</strong></td>';
        html += '<td><strong>' + formatMoney(totalContribution) + '</strong></td>';
        html += '<td class="profit-field"><strong>' + formatMoney(totalProfit) + '</strong></td>';
        html += '<td><strong>' + formatMoney(totalContribution + totalProfit) + '</strong></td>';
        if (canEdit()) html += '<td></td>';
        html += '</tr></tfoot></table>';

        container.innerHTML = html;

    } catch (err) {
        debug('❌ خطأ في loadOpInvestorsTab: ' + err.message, 'error');
        container.innerHTML = '<div class="empty-state">فشل في تحميل بيانات الممولين</div>';
    }
}

// ============================================================
// 14. ADD INVESTOR TO OPERATION
// ============================================================

async function openAddInvestorToOp() {
    if (!OPERATIONS_STATE.currentOperationId) {
        showToast('❌ يرجى فتح تفاصيل العملية أولاً', 'error');
        return;
    }

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

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

    if (!OPERATIONS_STATE.currentOperationId) {
        showToast('❌ لا توجد عملية محددة', 'error');
        return;
    }

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية للتعديل', 'error');
        return;
    }

    var investorId = _getVal('newOpInvestorId');
    var contribution = parseFloat(_getVal('newOpInvestorContribution')) || 0;
    var profit = parseFloat(_getVal('newOpInvestorProfit')) || 0;

    if (!investorId) { showToast('❌ يرجى اختيار الممول', 'error'); return; }
    if (contribution <= 0) { showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error'); return; }

    // التحقق من عدم التكرار
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
    } catch (e) {
        debug('⚠️ تعذر التحقق من التكرار', 'warn');
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
                window.logActivityToDB('إضافة ممول لعملية', 'operation_investor', result.data[0].id,
                    null, JSON.stringify(data),
                    'Operation: ' + OPERATIONS_STATE.currentOperationId, 'create');
            }
            showToast('✅ تم إضافة الممول للعملية', 'success');
        }

        closeModal('addInvestorToOpModal');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);

    } catch (err) {
        showToast(handleSupabaseError(err, 'إضافة الممول'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 15. EDIT INVESTOR IN OPERATION
// ============================================================

async function openEditOpInvestor(opInvestorId) {
    if (!opInvestorId) return;

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('*, investors(name)')
                .eq('id', opInvestorId)
                .single();
        }, { context: 'openEditOpInvestor', throwError: true });

        var record = result.data;
        if (!record) {
            showToast('❌ السجل غير موجود', 'error');
            return;
        }

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

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

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
            window.logActivityToDB('تعديل مساهمة ممول', 'operation_investor', recordId,
                JSON.stringify(oldResult.data), JSON.stringify(data),
                'Operation: ' + OPERATIONS_STATE.currentOperationId, 'update');
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
// 16. DELETE INVESTOR FROM OPERATION
// ============================================================

async function deleteOpInvestor(opInvestorId) {
    if (!opInvestorId) return;

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
            window.logActivityToDB('حذف ممول من عملية', 'operation_investor', opInvestorId,
                JSON.stringify(oldResult.data), null,
                'Operation: ' + OPERATIONS_STATE.currentOperationId, 'delete');
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
// 17. TRANSFERS TAB
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

        var html = '<table><thead><tr>';
        html += '<th>التاريخ</th><th>النوع</th><th>الغرض</th><th>المبلغ</th><th>ملاحظات</th>';
        html += '</tr></thead><tbody>';

        transfers.forEach(function(t) {
            var purposeText = (typeof PURPOSE_TEXT_AR !== 'undefined' && PURPOSE_TEXT_AR[t.purpose])
                ? PURPOSE_TEXT_AR[t.purpose]
                : (t.purpose || '-');

            html += '<tr>';
            html += '<td>' + formatDate(t.transfer_date) + '</td>';
            html += '<td>' + escapeHtml(t.type || '-') + '</td>';
            html += '<td>' + escapeHtml(purposeText) + '</td>';
            html += '<td>' + formatMoney(t.amount) + '</td>';
            html += '<td>' + escapeHtml(truncateText(t.notes, 30)) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

    } catch (err) {
        debug('❌ خطأ في loadOpTransfersTab: ' + err.message, 'error');
        container.innerHTML = '<div class="empty-state">فشل في تحميل التحويلات</div>';
    }
}

// ============================================================
// 18. TIMELINE TAB
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
            container.innerHTML = '<div class="empty-state">لا يوجد سجل نشاط لهذه العملية</div>';
            return;
        }

        var html = '<div class="timeline">';

        logs.forEach(function(log) {
            var actionText = log.action_type || log.action || '-';
            var details = log.details || '';
            var userEmail = log.user_email || 'System';

            html += '<div class="timeline-item">';
            html += '<div class="timeline-time">' + formatDateTime(log.created_at) + '</div>';
            html += '<div class="timeline-user">' + escapeHtml(userEmail) + '</div>';
            html += '<div class="timeline-content">';
            html += '<strong>' + escapeHtml(actionText) + '</strong>';
            if (details) html += '<p>' + escapeHtml(details) + '</p>';
            html += '</div></div>';
        });

        html += '</div>';
        container.innerHTML = html;

    } catch (err) {
        debug('❌ خطأ في loadOpTimelineTab: ' + err.message, 'error');
        container.innerHTML = '<div class="empty-state">فشل في تحميل سجل النشاط</div>';
    }
}

// ============================================================
// 19. ARCHIVE OPERATION
// ============================================================

async function archiveOperation(operationId) {
    if (!operationId) return;

    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    if (!confirmArchive('هذه العملية')) return;

    showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations')
                .update({ is_archived: true })
                .eq('id', operationId);
        }, { context: 'archiveOperation', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('أرشفة عملية', 'operation', operationId,
                null, null, 'Archived', 'archive');
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
// 20. SEARCH & FILTER
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
// 21. VALIDATION (لأزرار Workflow في app.js)
// ============================================================

function validateOpInvestorInputs() {
    var contribution = parseFloat(_getVal('newOpInvestorContribution')) || 0;
    var warningEl = document.getElementById('opInvestorValidationWarning');
    if (!warningEl) return;

    if (contribution <= 0) {
        warningEl.innerHTML = '<div class="validation-warning">⚠️ المساهمة يجب أن تكون أكبر من صفر</div>';
    } else {
        warningEl.innerHTML = '';
    }
}

function validateEditOpInvestorInputs() {
    var contribution = parseFloat(_getVal('editOpInvestorContribution')) || 0;
    var warningEl = document.getElementById('editOpInvestorValidationWarning');
    if (!warningEl) return;

    if (contribution <= 0) {
        warningEl.innerHTML = '<div class="validation-warning">⚠️ المساهمة يجب أن تكون أكبر من صفر</div>';
    } else {
        warningEl.innerHTML = '';
    }
}

// ============================================================
// 22. PLACEHOLDER FUNCTIONS (للتوافق مع app.js)
// ============================================================

function openAddTransferToOp() {
    debug('🔄 فتح إضافة تحويل للعملية', 'info');
    if (typeof openTransferModal === 'function') {
        closeModal('operationDetailsModal');
        openTransferModal(null, null, OPERATIONS_STATE.currentOperationId);
    } else {
        showToast('ℹ️ يرجى الانتقال لشاشة التحويلات', 'info');
    }
}

// ============================================================
// 23. HELPER FUNCTIONS
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
    if (typeof STATUS_TEXT !== 'undefined' && STATUS_TEXT[status]) {
        return STATUS_TEXT[status];
    }
    var map = { 'draft': 'تحت الإنشاء', 'active': 'نشطة', 'completed': 'انتهت', 'cancelled': 'ألغيت' };
    return map[status] || status || '-';
}

function getOperationTypeText(type) {
    var map = { 'financing': 'تمويل', 'supply': 'توريد' };
    return map[type] || type || '-';
}

// ============================================================
// 24. INITIALIZATION ON LOAD
// ============================================================

// ملاحظة: initOperations() يُستدعى من نفسه عند تحميل الملف
// لأن operations.js يُحمّل قبل app.js
if (typeof document !== 'undefined') {
    initOperations();
}
