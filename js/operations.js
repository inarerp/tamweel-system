// ============================================================
// نظام إدارة التمويل - Operations Module
// Version: 6.0.0 (Production Ready - Complete Rewrite)
// Last Updated: 2026-08-03
// 
// التكامل مع:
// - index.html (Modals: operationModal, operationDetailsModal, addInvestorToOpModal, editInvestorToOpModal)
// - app.js (Event Delegation: data-action, data-submit)
// - auth.js (canEdit, isAdmin, getCurrentUser)
// - core.js (showToast, showLoading, hideLoading, openModal, closeModal, debug)
// - activity.js (window.logActivityToDB)
// - transfers.js (PURPOSE_TEXT_AR)
// ============================================================

// ============================================================
// 1. STATE MANAGEMENT
// ============================================================

var OPERATIONS_STATE = {
    search: '',
    filter: '',
    records: [],
    referenceCache: {
        clients: null,
        investors: null
    },
    currentOperationId: null,
    currentOperation: null
};

// ============================================================
// 2. INITIALIZATION
// ============================================================

function initOperations() {
    debug('⚙️ بدء تهيئة operations.js', 'info');
    
    // تسجيل دالة تحميل الشاشة
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
    
    if (typeof isSupabaseReady === 'function' && !isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    if (typeof showLoading === 'function') showLoading();
    
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
        
        // بناء خريطة العملاء
        var clientsById = {};
        clients.forEach(function(c) {
            clientsById[c.id] = c;
        });

        // ربط العملاء بالعمليات
        ops.forEach(function(op) {
            op.client = clientsById[op.client_id] || null;
        });

        OPERATIONS_STATE.records = ops;
        renderOperationsList();
        
        debug('✅ تم تحميل ' + ops.length + ' عملية', 'success');
        
    } catch (err) {
        debug('❌ خطأ في loadOperations: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'تحميل العمليات'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

// ============================================================
// 4. LOAD REFERENCE DATA
// ============================================================

async function loadClientsForOps() {
    if (OPERATIONS_STATE.referenceCache.clients) {
        return OPERATIONS_STATE.referenceCache.clients;
    }
    
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
    if (OPERATIONS_STATE.referenceCache.investors) {
        return OPERATIONS_STATE.referenceCache.investors;
    }
    
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

// ============================================================
// 5. RENDER OPERATIONS LIST
// ============================================================

function renderOperationsList() {
    var container = document.getElementById('operationsTable');
    if (!container) {
        debug('❌ عنصر operationsTable غير موجود', 'error');
        return;
    }

    if (!OPERATIONS_STATE.records || OPERATIONS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>لا توجد عمليات</p></div>';
        return;
    }

    var html = '<table class="data-table"><thead><tr>';
    html += '<th>الاسم</th>';
    html += '<th>العميل</th>';
    html += '<th>النوع</th>';
    html += '<th>المبلغ</th>';
    html += '<th>الربح المتوقع</th>';
    html += '<th>الحالة</th>';
    html += '<th>تاريخ النهاية</th>';
    html += '<th>الإجراءات</th>';
    html += '</tr></thead><tbody>';

    OPERATIONS_STATE.records.forEach(function(op) {
        var statusClass = 'badge-' + (op.status || 'draft');
        var statusText = getStatusText(op.status);
        var clientName = op.client ? escapeHtml(op.client.name) : '-';
        var isLocked = op.is_locked || op.status === 'completed' || op.status === 'cancelled';

        html += '<tr>';
        html += '<td><a href="#" class="op-link" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.name) + '</a></td>';
        html += '<td>' + clientName + '</td>';
        html += '<td>' + getOperationTypeText(op.type) + '</td>';
        html += '<td class="amount-cell">' + formatMoney(op.amount) + '</td>';
        html += '<td class="amount-cell profit-field">' + formatMoney(op.expected_profit || 0) + '</td>';
        html += '<td><span class="badge ' + statusClass + '">' + statusText + '</span></td>';
        html += '<td>' + formatDate(op.end_date) + '</td>';
        html += '<td class="actions-cell">';
        
        if (typeof canEdit === 'function' && canEdit()) {
            html += '<button class="btn btn-secondary btn-sm" data-action="editOperation" data-param="' + op.id + '" title="تعديل">✏️</button> ';
            
            if (!isLocked) {
                html += '<button class="btn btn-warning btn-sm" data-action="archiveOperation" data-param="' + op.id + '" title="أرشفة">📦</button>';
            }
        }
        
        html += '</td></tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

// ============================================================
// 6. OPERATION MODAL (ADD/EDIT)
// ============================================================

async function openOperationModal(operationId) {
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var titleEl = document.getElementById('operationModalTitle');
    var idEl = document.getElementById('operationId');
    
    if (!titleEl || !idEl) {
        debug('❌ عناصر المودال غير موجودة', 'error');
        return;
    }

    // تحميل العملاء
    await loadClientsForOps();

    // ملء قائمة العملاء
    var clientSelect = document.getElementById('opClient');
    if (clientSelect) {
        var options = '<option value="">-- اختر العميل --</option>';
        (OPERATIONS_STATE.referenceCache.clients || []).forEach(function(c) {
            options += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
        });
        clientSelect.innerHTML = options;
    }

    // تفريغ الحقول
    var fieldsToClear = [
        'opName', 'opAmount', 'opInvestorDisplayAmount', 'opExpectedProfit', 
        'opFinalProfit', 'opProfitApprovalDate', 'opGoogleDriveUrl', 
        'opCompanyProfitValue', 'opStartDate', 'opDurationDays', 'opEndDate', 'opNotes'
    ];
    
    fieldsToClear.forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
    });

    // تعيين القيم الافتراضية
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
                if (typeof showToast === 'function') showToast('❌ العملية غير موجودة', 'error');
                return;
            }

            titleEl.textContent = 'تعديل عملية';
            idEl.value = op.id;

            // ملء الحقول
            setElementValue('opName', op.name);
            setElementValue('opType', op.type);
            setElementValue('opClient', op.client_id);
            setElementValue('opAmount', op.amount);
            setElementValue('opInvestorDisplayAmount', op.investor_display_amount);
            setElementValue('opExpectedProfit', op.expected_profit);
            setElementValue('opFinalProfit', op.final_profit);
            setElementValue('opProfitApprovalDate', formatDateForInput(op.profit_approval_date));
            setElementValue('opGoogleDriveUrl', op.google_drive_url);
            setElementValue('opCompanyProfitType', op.company_profit_type);
            setElementValue('opCompanyProfitValue', op.company_profit_value);
            setElementValue('opStartDate', formatDateForInput(op.start_date));
            setElementValue('opDurationDays', op.duration_days);
            setElementValue('opEndDate', formatDateForInput(op.end_date));
            setElementValue('opStatus', op.status);
            setElementValue('opNotes', op.notes);

        } catch (err) {
            debug('❌ خطأ في جلب بيانات العملية: ' + err.message, 'error');
            if (typeof showToast === 'function') {
                showToast(handleSupabaseError(err, 'جلب بيانات العملية'), 'error');
            }
            return;
        }
    } else {
        // وضع الإضافة
        titleEl.textContent = 'إضافة عملية';
        idEl.value = '';
        setElementValue('opStartDate', getTodayDate());
    }

    if (typeof openModal === 'function') openModal('operationModal');
}

function editOperation(operationId) {
    if (!operationId) return;
    openOperationModal(operationId);
}

// ============================================================
// 7. SAVE OPERATION
// ============================================================

async function saveOperation(form, event) {
    if (event) event.preventDefault();
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var id = getElementValue('operationId');
    
    var data = {
        name: getElementValue('opName').trim(),
        type: getElementValue('opType'),
        client_id: getElementValue('opClient') || null,
        amount: parseFloat(getElementValue('opAmount')) || 0,
        investor_display_amount: getElementValue('opInvestorDisplayAmount') ? parseFloat(getElementValue('opInvestorDisplayAmount')) : null,
        expected_profit: parseFloat(getElementValue('opExpectedProfit')) || 0,
        final_profit: parseFloat(getElementValue('opFinalProfit')) || 0,
        profit_approval_date: getElementValue('opProfitApprovalDate') || null,
        google_drive_url: getElementValue('opGoogleDriveUrl') || null,
        company_profit_type: getElementValue('opCompanyProfitType') || null,
        company_profit_value: parseFloat(getElementValue('opCompanyProfitValue')) || 0,
        start_date: getElementValue('opStartDate'),
        duration_days: parseInt(getElementValue('opDurationDays')) || 0,
        end_date: getElementValue('opEndDate') || null,
        status: getElementValue('opStatus'),
        notes: getElementValue('opNotes').trim()
    };

    // Validation
    if (!data.name) {
        if (typeof showToast === 'function') showToast('❌ اسم العملية مطلوب', 'error');
        return;
    }
    
    if (!data.client_id) {
        if (typeof showToast === 'function') showToast('❌ يرجى اختيار العميل', 'error');
        return;
    }
    
    if (!data.amount || data.amount <= 0) {
        if (typeof showToast === 'function') showToast('❌ المبلغ يجب أن يكون أكبر من صفر', 'error');
        return;
    }
    
    if (!data.start_date) {
        if (typeof showToast === 'function') showToast('❌ تاريخ البداية مطلوب', 'error');
        return;
    }

    if (typeof showLoading === 'function') showLoading();

    try {
        if (id) {
            // تحديث
            var oldResult = await runQuery(function() {
                return APP.supabase.from('operations').select('*').eq('id', id).single();
            }, { context: 'saveOperation-getOld', throwError: true });

            await runQuery(function() {
                return APP.supabase.from('operations').update(data).eq('id', id);
            }, { context: 'saveOperation-update', throwError: true });

            // تسجيل النشاط
            if (typeof window.logActivityToDB === 'function') {
                await window.logActivityToDB(
                    'تعديل عملية',
                    'operation',
                    id,
                    JSON.stringify(oldResult.data),
                    JSON.stringify(data),
                    'Name: ' + data.name,
                    'update'
                );
            }

            if (typeof showToast === 'function') showToast('✅ تم تحديث العملية', 'success');
        } else {
            // إضافة
            var result = await runQuery(function() {
                return APP.supabase.from('operations').insert(data).select();
            }, { context: 'saveOperation-insert', throwError: true });

            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    await window.logActivityToDB(
                        'إضافة عملية',
                        'operation',
                        result.data[0].id,
                        null,
                        JSON.stringify(data),
                        'Name: ' + data.name,
                        'create'
                    );
                }

                if (typeof showToast === 'function') showToast('✅ تم إضافة العملية', 'success');
            }
        }

        if (typeof closeModal === 'function') closeModal('operationModal');
        loadOperations();
        
    } catch (err) {
        debug('❌ خطأ في saveOperation: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'حفظ العملية'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

// ============================================================
// 8. OPERATION DETAILS
// ============================================================

async function openOperationDetails(operationId) {
    if (!operationId) {
        debug('❌ operationId فارغ', 'error');
        return;
    }

    OPERATIONS_STATE.currentOperationId = operationId;
    
    if (typeof showLoading === 'function') showLoading();

    try {
        // جلب بيانات العملية
        var opResult = await runQuery(function() {
            return APP.supabase.from('operations').select('*').eq('id', operationId).single();
        }, { context: 'openOperationDetails-op', throwError: true });

        var op = opResult.data;
        if (!op) {
            if (typeof showToast === 'function') showToast('❌ العملية غير موجودة', 'error');
            return;
        }

        OPERATIONS_STATE.currentOperation = op;

        // جلب اسم العميل
        var clientName = '-';
        var clientData = null;
        if (op.client_id) {
            try {
                var clientResult = await runQuery(function() {
                    return APP.supabase.from('clients').select('*').eq('id', op.client_id).single();
                }, { context: 'openOperationDetails-client', throwError: false });
                
                if (clientResult.data) {
                    clientName = clientResult.data.name;
                    clientData = clientResult.data;
                }
            } catch (e) {
                debug('⚠️ تعذر جلب بيانات العميل', 'warn');
            }
        }

        // عرض ملخص العملية
        renderOperationSummary(op, clientName);
        
        // عرض بيانات العميل
        renderClientInfo(clientData);
        
        // عرض أزرار Workflow
        renderWorkflowButtons(op);

        // تحميل التبويبات
        await Promise.all([
            loadOpInvestorsTab(operationId),
            loadOpTransfersTab(operationId),
            loadOpTimelineTab(operationId)
        ]);

        // تعيين العنوان
        var titleEl = document.getElementById('opDetailsTitle');
        if (titleEl) titleEl.textContent = 'تفاصيل: ' + op.name;

        if (typeof openModal === 'function') openModal('operationDetailsModal');
        
    } catch (err) {
        debug('❌ خطأ في openOperationDetails: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'فتح تفاصيل العملية'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

function renderOperationSummary(op, clientName) {
    var summaryGrid = document.getElementById('opSummaryGrid');
    if (!summaryGrid) return;

    var html = '';
    
    html += '<div class="summary-item"><label>الاسم</label><div class="val">' + escapeHtml(op.name) + '</div></div>';
    html += '<div class="summary-item"><label>العميل</label><div class="val">' + escapeHtml(clientName) + '</div></div>';
    html += '<div class="summary-item"><label>النوع</label><div class="val">' + getOperationTypeText(op.type) + '</div></div>';
    html += '<div class="summary-item"><label>المبلغ</label><div class="val blue">' + formatMoney(op.amount) + '</div></div>';
    
    if (op.investor_display_amount) {
        html += '<div class="summary-item"><label>الظاهر للممول</label><div class="val">' + formatMoney(op.investor_display_amount) + '</div></div>';
    }
    
    html += '<div class="summary-item"><label>الربح المتوقع</label><div class="val orange">' + formatMoney(op.expected_profit || 0) + '</div></div>';
    html += '<div class="summary-item"><label>الربح النهائي</label><div class="val green profit-field">' + formatMoney(op.final_profit || 0) + '</div></div>';
    
    if (op.company_profit_type && op.company_profit_value) {
        var profitTypeText = op.company_profit_type === 'percentage' ? '%' : 'ثابت';
        html += '<div class="summary-item"><label>ربح الشركة</label><div class="val">' + op.company_profit_value + ' ' + profitTypeText + '</div></div>';
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
    
    if (op.notes) {
        html += '<div class="summary-item full-width"><label>ملاحظات</label><div class="val">' + escapeHtml(op.notes) + '</div></div>';
    }

    summaryGrid.innerHTML = html;
}

function renderClientInfo(clientData) {
    var clientInfoEl = document.getElementById('opClientInfo');
    if (!clientInfoEl) return;

    if (!clientData) {
        clientInfoEl.innerHTML = '<div class="empty-state">لا توجد بيانات العميل</div>';
        return;
    }

    var html = '<div class="client-info-grid">';
    html += '<div class="info-item"><label>الاسم:</label> <span>' + escapeHtml(clientData.name) + '</span></div>';
    
    if (clientData.phone) {
        html += '<div class="info-item"><label>الهاتف:</label> <span>' + escapeHtml(clientData.phone) + '</span></div>';
    }
    
    if (clientData.email) {
        html += '<div class="info-item"><label>البريد:</label> <span>' + escapeHtml(clientData.email) + '</span></div>';
    }
    
    html += '</div>';
    
    if (typeof canEdit === 'function' && canEdit()) {
        html += '<div class="client-actions" style="margin-top:10px;">';
        html += '<button class="btn btn-secondary btn-sm" data-action="openClientFile" data-param="' + clientData.id + '">📄 فتح ملف العميل</button>';
        html += '</div>';
    }
    
    clientInfoEl.innerHTML = html;
}

function renderWorkflowButtons(op) {
    var workflowActions = document.getElementById('workflowActions');
    if (!workflowActions) return;

    var isLocked = op.is_locked || op.status === 'completed' || op.status === 'cancelled';
    var canUserEdit = typeof canEdit === 'function' && canEdit();
    
    if (!canUserEdit) {
        workflowActions.style.display = 'none';
        return;
    }

    workflowActions.style.display = 'flex';
    
    var html = '';
    
    if (!isLocked) {
        if (op.status === 'draft') {
            html += '<button class="btn btn-primary" data-action="workflowAction" data-param="activate">✅ تفعيل</button>';
        }
        
        if (op.status === 'active') {
            html += '<button class="btn btn-info" data-action="workflowAction" data-param="clientRepayment">💰 سداد</button>';
            html += '<button class="btn btn-success" data-action="workflowAction" data-param="profitDistribution">📊 أرباح</button>';
            html += '<button class="btn btn-warning" data-action="workflowAction" data-param="capitalReturn">🔄 إرجاع</button>';
            html += '<button class="btn btn-danger" data-action="workflowAction" data-param="complete">🏁 إنهاء</button>';
        }
    } else {
        html += '<button class="btn btn-secondary" data-action="workflowAction" data-param="unlock">🔓 فتح القفل</button>';
    }
    
    workflowActions.innerHTML = html;
}

// ============================================================
// 9. OPERATION INVESTORS (ADD/EDIT/DELETE)
// ============================================================

async function openAddInvestorToOp() {
    if (!OPERATIONS_STATE.currentOperationId) {
        if (typeof showToast === 'function') showToast('❌ يرجى فتح تفاصيل العملية أولاً', 'error');
        return;
    }
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    // تحميل الممولين
    await loadInvestorsForOps();

    var selectEl = document.getElementById('newOpInvestorId');
    if (selectEl) {
        var options = '<option value="">-- اختر الممول --</option>';
        (OPERATIONS_STATE.referenceCache.investors || []).forEach(function(inv) {
            options += '<option value="' + inv.id + '">' + escapeHtml(inv.name) + '</option>';
        });
        selectEl.innerHTML = options;
    }

    // تفريغ الحقول
    setElementValue('newOpInvestorContribution', '');
    setElementValue('newOpInvestorProfit', '');

    // إخفاء التحذيرات
    var warningEl = document.getElementById('opInvestorValidationWarning');
    if (warningEl) warningEl.innerHTML = '';

    if (typeof openModal === 'function') openModal('addInvestorToOpModal');
}

async function saveOpInvestor(form, event) {
    if (event) event.preventDefault();
    
    debug('🔍 saveOpInvestor: currentOperationId = ' + OPERATIONS_STATE.currentOperationId, 'info');
    debug('🔍 saveOpInvestor: canEdit() = ' + (typeof canEdit === 'function' ? canEdit() : 'function not found'), 'info');
    
    if (!OPERATIONS_STATE.currentOperationId) {
        if (typeof showToast === 'function') showToast('❌ لا توجد عملية محددة', 'error');
        return;
    }
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية للتعديل', 'error');
        debug('❌ canEdit() returned false', 'error');
        return;
    }

    var investorId = getElementValue('newOpInvestorId');
    var contribution = parseFloat(getElementValue('newOpInvestorContribution')) || 0;
    var profit = parseFloat(getElementValue('newOpInvestorProfit')) || 0;

    // Validation
    if (!investorId) {
        if (typeof showToast === 'function') showToast('❌ يرجى اختيار الممول', 'error');
        return;
    }

    if (contribution <= 0) {
        if (typeof showToast === 'function') showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error');
        return;
    }
    
    // التحقق من عدم تكرار الممول
    try {
        var checkResult = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('id')
                .eq('operation_id', OPERATIONS_STATE.currentOperationId)
                .eq('investor_id', investorId);
        }, { context: 'saveOpInvestor-check', throwError: false });
        
        if (checkResult.data && checkResult.data.length > 0) {
            if (typeof showToast === 'function') showToast('❌ هذا الممول مضاف بالفعل للعملية', 'error');
            return;
        }
    } catch (e) {
        debug('⚠️ تعذر التحقق من تكرار الممول', 'warn');
    }

    if (typeof showLoading === 'function') showLoading();

    try {
        var data = {
            operation_id: OPERATIONS_STATE.currentOperationId,
            investor_id: investorId,
            contribution: contribution,
            profit: profit
        };

        debug('💾 حفظ بيانات الممول: ' + JSON.stringify(data), 'info');

        var result = await runQuery(function() {
            return APP.supabase.from('operation_investors').insert(data).select();
        }, { context: 'saveOpInvestor', throwError: true });

        if (result.data && result.data[0]) {
            if (typeof window.logActivityToDB === 'function') {
                await window.logActivityToDB(
                    'إضافة ممول لعملية',
                    'operation_investor',
                    result.data[0].id,
                    null,
                    JSON.stringify(data),
                    'Operation: ' + OPERATIONS_STATE.currentOperationId,
                    'create'
                );
            }

            if (typeof showToast === 'function') showToast('✅ تم إضافة الممول للعملية', 'success');
        }

        if (typeof closeModal === 'function') closeModal('addInvestorToOpModal');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);
        
    } catch (err) {
        debug('❌ خطأ في saveOpInvestor: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'إضافة الممول'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

async function openEditInvestorToOp(opInvestorId) {
    if (!opInvestorId) return;
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    try {
        var result = await runQuery(function() {
            return APP.supabase.from('operation_investors')
                .select('*, investors(name)')
                .eq('id', opInvestorId)
                .single();
        }, { context: 'openEditInvestorToOp', throwError: true });

        var record = result.data;
        if (!record) {
            if (typeof showToast === 'function') showToast('❌ السجل غير موجود', 'error');
            return;
        }

        // ملء الحقول
        setElementValue('editOpInvestorId', record.id);
        setElementValue('editOpInvestorName', record.investors ? record.investors.name : '-');
        setElementValue('editOpInvestorContribution', record.contribution);
        setElementValue('editOpInvestorProfit', record.profit);

        if (typeof openModal === 'function') openModal('editInvestorToOpModal');
        
    } catch (err) {
        debug('❌ خطأ في openEditInvestorToOp: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'جلب بيانات الممول'), 'error');
        }
    }
}

async function saveEditOpInvestor(form, event) {
    if (event) event.preventDefault();
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var recordId = getElementValue('editOpInvestorId');
    var contribution = parseFloat(getElementValue('editOpInvestorContribution')) || 0;
    var profit = parseFloat(getElementValue('editOpInvestorProfit')) || 0;

    if (!recordId) {
        if (typeof showToast === 'function') showToast('❌ السجل غير موجود', 'error');
        return;
    }

    if (contribution <= 0) {
        if (typeof showToast === 'function') showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error');
        return;
    }

    if (typeof showLoading === 'function') showLoading();

    try {
        var oldResult = await runQuery(function() {
            return APP.supabase.from('operation_investors').select('*').eq('id', recordId).single();
        }, { context: 'saveEditOpInvestor-getOld', throwError: true });

        var data = {
            contribution: contribution,
            profit: profit
        };

        await runQuery(function() {
            return APP.supabase.from('operation_investors').update(data).eq('id', recordId);
        }, { context: 'saveEditOpInvestor-update', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            await window.logActivityToDB(
                'تعديل مساهمة ممول',
                'operation_investor',
                recordId,
                JSON.stringify(oldResult.data),
                JSON.stringify(data),
                'Operation: ' + OPERATIONS_STATE.currentOperationId,
                'update'
            );
        }

        if (typeof showToast === 'function') showToast('✅ تم تحديث مساهمة الممول', 'success');
        
        if (typeof closeModal === 'function') closeModal('editInvestorToOpModal');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);
        
    } catch (err) {
        debug('❌ خطأ في saveEditOpInvestor: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'تحديث مساهمة الممول'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

async function deleteOpInvestor(opInvestorId) {
    if (!opInvestorId) return;
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    if (typeof confirmDelete === 'function' && !confirmDelete('هذا الممول من العملية')) return;
    if (typeof confirmDelete !== 'function' && !confirm('هل أنت متأكد من حذف هذا الممول من العملية؟')) return;

    if (typeof showLoading === 'function') showLoading();

    try {
        var oldResult = await runQuery(function() {
            return APP.supabase.from('operation_investors').select('*').eq('id', opInvestorId).single();
        }, { context: 'deleteOpInvestor-getOld', throwError: true });

        await runQuery(function() {
            return APP.supabase.from('operation_investors').delete().eq('id', opInvestorId);
        }, { context: 'deleteOpInvestor', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            await window.logActivityToDB(
                'حذف ممول من عملية',
                'operation_investor',
                opInvestorId,
                JSON.stringify(oldResult.data),
                null,
                'Operation: ' + OPERATIONS_STATE.currentOperationId,
                'delete'
            );
        }

        if (typeof showToast === 'function') showToast('✅ تم حذف الممول من العملية', 'success');
        await loadOpInvestorsTab(OPERATIONS_STATE.currentOperationId);
        
    } catch (err) {
        debug('❌ خطأ في deleteOpInvestor: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'حذف الممول'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

// ============================================================
// 10. LOAD OPERATION TABS
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
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>لا يوجد ممولين مرتبطين</p></div>';
            return;
        }

        var totalContribution = 0;
        var totalProfit = 0;

        var html = '<table class="data-table"><thead><tr>';
        html += '<th>الممول</th>';
        html += '<th>المساهمة</th>';
        html += '<th>الربح</th>';
        html += '<th>الإجمالي</th>';
        
        if (typeof canEdit === 'function' && canEdit()) {
            html += '<th>الإجراءات</th>';
        }
        
        html += '</tr></thead><tbody>';

        investors.forEach(function(oi) {
            var investorName = oi.investors ? oi.investors.name : '-';
            var total = (oi.contribution || 0) + (oi.profit || 0);
            
            totalContribution += oi.contribution || 0;
            totalProfit += oi.profit || 0;

            html += '<tr>';
            html += '<td>' + escapeHtml(investorName) + '</td>';
            html += '<td class="amount-cell">' + formatMoney(oi.contribution) + '</td>';
            html += '<td class="amount-cell profit-field">' + formatMoney(oi.profit) + '</td>';
            html += '<td class="amount-cell">' + formatMoney(total) + '</td>';
            
            if (typeof canEdit === 'function' && canEdit()) {
                html += '<td class="actions-cell">';
                html += '<button class="btn btn-secondary btn-sm" data-action="openEditInvestorToOp" data-param="' + oi.id + '" title="تعديل">✏️</button> ';
                html += '<button class="btn btn-danger btn-sm" data-action="deleteOpInvestor" data-param="' + oi.id + '" title="حذف">🗑️</button>';
                html += '</td>';
            }
            
            html += '</tr>';
        });

        // صف الإجمالي
        html += '</tbody><tfoot><tr>';
        html += '<td><strong>الإجمالي</strong></td>';
        html += '<td class="amount-cell"><strong>' + formatMoney(totalContribution) + '</strong></td>';
        html += '<td class="amount-cell profit-field"><strong>' + formatMoney(totalProfit) + '</strong></td>';
        html += '<td class="amount-cell"><strong>' + formatMoney(totalContribution + totalProfit) + '</strong></td>';
        
        if (typeof canEdit === 'function' && canEdit()) {
            html += '<td></td>';
        }
        
        html += '</tr></tfoot></table>';

        container.innerHTML = html;
        
    } catch (err) {
        debug('❌ خطأ في loadOpInvestorsTab: ' + err.message, 'error');
        container.innerHTML = '<div class="error-state">فشل في تحميل بيانات الممولين</div>';
    }
}

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
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><p>لا توجد تحويلات مرتبطة</p></div>';
            return;
        }

        var html = '<table class="data-table"><thead><tr>';
        html += '<th>التاريخ</th>';
        html += '<th>النوع</th>';
        html += '<th>الغرض</th>';
        html += '<th>المبلغ</th>';
        html += '</tr></thead><tbody>';

        transfers.forEach(function(t) {
            var purposeText = (typeof PURPOSE_TEXT_AR !== 'undefined' && PURPOSE_TEXT_AR[t.purpose]) 
                ? PURPOSE_TEXT_AR[t.purpose] 
                : (t.purpose || '-');

            html += '<tr>';
            html += '<td>' + formatDate(t.transfer_date) + '</td>';
            html += '<td>' + escapeHtml(t.type || '-') + '</td>';
            html += '<td>' + escapeHtml(purposeText) + '</td>';
            html += '<td class="amount-cell">' + formatMoney(t.amount) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;
        
    } catch (err) {
        debug('❌ خطأ في loadOpTransfersTab: ' + err.message, 'error');
        container.innerHTML = '<div class="error-state">فشل في تحميل التحويلات</div>';
    }
}

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
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>لا يوجد سجل نشاط</p></div>';
            return;
        }

        var html = '<div class="timeline">';

        logs.forEach(function(log) {
            var actionType = log.action_type || log.action || '-';
            var details = log.details || '';
            var userEmail = log.user_email || 'System';

            html += '<div class="timeline-item">';
            html += '<div class="timeline-time">' + formatDateTime(log.created_at) + '</div>';
            html += '<div class="timeline-user">' + escapeHtml(userEmail) + '</div>';
            html += '<div class="timeline-content">';
            html += '<strong>' + escapeHtml(actionType) + '</strong>';
            if (details) {
                html += '<p>' + escapeHtml(details) + '</p>';
            }
            html += '</div>';
            html += '</div>';
        });

        html += '</div>';
        container.innerHTML = html;
        
    } catch (err) {
        debug('❌ خطأ في loadOpTimelineTab: ' + err.message, 'error');
        container.innerHTML = '<div class="error-state">فشل في تحميل سجل النشاط</div>';
    }
}

// ============================================================
// 11. WORKFLOW ACTIONS
// ============================================================

async function workflowAction(action) {
    if (!OPERATIONS_STATE.currentOperationId) {
        if (typeof showToast === 'function') showToast('❌ لا توجد عملية محددة', 'error');
        return;
    }
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var opId = OPERATIONS_STATE.currentOperationId;
    var confirmMsg = '';
    var newStatus = null;
    var updateData = {};

    switch (action) {
        case 'activate':
            confirmMsg = 'هل تريد تفعيل هذه العملية؟ لن تتمكن من تعديل البيانات الأساسية بعد التفعيل.';
            newStatus = 'active';
            updateData = { status: 'active' };
            break;
            
        case 'complete':
            confirmMsg = 'هل تريد إنهاء هذه العملية؟ سيتم قفلها نهائياً.';
            newStatus = 'completed';
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

    if (confirmMsg) {
        var confirmed = false;
        if (typeof confirmAction === 'function') {
            confirmed = confirmAction(confirmMsg);
        } else {
            confirmed = confirm(confirmMsg);
        }
        
        if (!confirmed) return;
    }

    if (typeof showLoading === 'function') showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations').update(updateData).eq('id', opId);
        }, { context: 'workflowAction', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            await window.logActivityToDB(
                'Workflow: ' + action,
                'operation',
                opId,
                null,
                JSON.stringify(updateData),
                'Action: ' + action,
                'workflow'
            );
        }

        if (typeof showToast === 'function') showToast('✅ تم تنفيذ الإجراء بنجاح', 'success');
        
        // إعادة فتح التفاصيل لتحديث الواجهة
        await openOperationDetails(opId);
        
    } catch (err) {
        debug('❌ خطأ في workflowAction: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'تنفيذ الإجراء'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

function openWorkflowTransfer(purpose) {
    debug('🔄 فتح تحويل Workflow: ' + purpose, 'info');
    
    // محاولة فتح مودال التحويلات مع الغرض المحدد
    if (typeof openTransferModal === 'function') {
        openTransferModal(null, purpose, OPERATIONS_STATE.currentOperationId);
    } else {
        if (typeof showToast === 'function') {
            showToast('ℹ️ يرجى الانتقال لشاشة التحويلات لإجراء: ' + purpose, 'info');
        }
    }
}

// ============================================================
// 12. ARCHIVE OPERATION
// ============================================================

async function archiveOperation(operationId) {
    if (!operationId) return;
    
    if (typeof canEdit === 'function' && !canEdit()) {
        if (typeof showToast === 'function') showToast('❌ لا توجد صلاحية', 'error');
        return;
    }

    var confirmed = false;
    if (typeof confirmArchive === 'function') {
        confirmed = confirmArchive('هذه العملية');
    } else {
        confirmed = confirm('هل أنت متأكد من أرشفة هذه العملية؟');
    }
    
    if (!confirmed) return;

    if (typeof showLoading === 'function') showLoading();

    try {
        await runQuery(function() {
            return APP.supabase.from('operations')
                .update({ is_archived: true })
                .eq('id', operationId);
        }, { context: 'archiveOperation', throwError: true });

        if (typeof window.logActivityToDB === 'function') {
            await window.logActivityToDB(
                'أرشفة عملية',
                'operation',
                operationId,
                null,
                null,
                'Archived',
                'archive'
            );
        }

        if (typeof showToast === 'function') showToast('✅ تم أرشفة العملية', 'success');
        loadOperations();
        
    } catch (err) {
        debug('❌ خطأ في archiveOperation: ' + err.message, 'error');
        if (typeof showToast === 'function') {
            showToast(handleSupabaseError(err, 'أرشفة العملية'), 'error');
        }
    } finally {
        if (typeof hideLoading === 'function') hideLoading();
    }
}

// ============================================================
// 13. SEARCH & FILTER
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
// 14. HELPER FUNCTIONS
// ============================================================

function getElementValue(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
}

function setElementValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value !== null && value !== undefined ? value : '';
}

function getStatusText(status) {
    var statusMap = {
        'draft': 'مسودة',
        'active': 'نشطة',
        'completed': 'مكتملة',
        'cancelled': 'ملغاة'
    };
    return statusMap[status] || status || '-';
}

function getOperationTypeText(type) {
    var typeMap = {
        'financing': 'تمويل',
        'supply': 'توريدات'
    };
    return typeMap[type] || type || '-';
}

// ============================================================
// 15. EVENT LISTENERS (للأزرار غير المرتبطة بـ Event Delegation)
// ============================================================

// ملاحظة: معظم الأحداث يتم التعامل معها عبر Event Delegation في app.js
// هذه الدوال متاحة للاستدعاء المباشر إذا لزم الأمر

// ============================================================
// 16. INITIALIZATION ON DOM READY
// ============================================================

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
        if (typeof initOperations === 'function') {
            initOperations();
        }
    });
}
