// ============================================================
// نظام إدارة التمويل - Operations Module
// Version: 1.1.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - initOperations() - تسجيل الدالة في Registry
// - loadOperations() - تحميل قائمة العمليات
// - openOperationDetails() - فتح تفاصيل العملية (Modal)
// - refreshOperationDetails() - تحديث البيانات دون إعادة تحميل كامل
// - openOperationModal() - Modal إضافة/تعديل
// - saveOperation() - حفظ العملية
// - workflowAction() - تفعيل/إنهاء/فتح قفل
// - openWorkflowTransfer() - سداد/أرباح/إرجاع
// - openAddInvestorToOp() - إضافة ممول للعملية
// - saveOpInvestor() - حفظ مساهمة الممول
// - updateOpInvestor() - تعديل مساهمة الممول
// - confirmDeleteOpInvestor() - حذف مساهمة الممول
// - openAddTransferToOp() - إضافة تحويل للعملية
// - Render (قائمة + تفاصيل + Tabs)
// - Timeline Lazy Loading (عند فتح التبويب فقط)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
// - auth.js (canEdit, canViewProfits, isAdmin, etc.)
// - calculations.js (calculateOperationSummary, buildStatement)
// - activity.js (window.logActivityToDB)
// - app.js (showScreen, switchTab)
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
    currentOperationId: null,
    currentOperationData: null,
    activeTab: 'investors',
    timelineLoaded: false,  // Lazy Loading للـ Timeline
    clientsCache: null      // Cache للعملاء
};


// ============================================================
// 2. INITIALIZATION
// ============================================================

function initOperations() {
    debug('⚙️ بدء تهيئة operations.js', 'info');
    registerScreenLoader('operations', loadOperations);
    debug('✅ operations.js جاهز', 'success');
}


// ============================================================
// 3. MAIN LOADER (قائمة العمليات)
// ============================================================

async function loadOperations() {
    debug('⚙️ بدأ loadOperations', 'info');
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    showLoading();
    
    try {
        var query = APP.supabase
            .from('operations')
            .select('id, name, type, status, amount, reference_number, start_date, end_date, is_locked, is_archived, created_at')
            .order('created_at', { ascending: false });
        
        // تطبيق الفلتر
        if (OPERATIONS_STATE.filter) {
            query = query.eq('status', OPERATIONS_STATE.filter);
        }
        
        // تطبيق البحث
        if (OPERATIONS_STATE.search) {
            var searchTerm = '%' + OPERATIONS_STATE.search + '%';
            query = query.or(
                'name.ilike.' + searchTerm + 
                ',reference_number.ilike.' + searchTerm
            );
        }
        
        var result = await runQuery(
            function() { return query; },
            { context: 'loadOperations', throwError: true }
        );
        
        OPERATIONS_STATE.records = result.data || [];
        
        debug('✅ تم تحميل ' + OPERATIONS_STATE.records.length + ' عملية', 'success');
        
        renderOperationsList();
        
    } catch (err) {
        debug('❌ خطأ في loadOperations: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل العمليات'), 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 4. RENDER OPERATIONS LIST
// ============================================================

function renderOperationsList() {
    var container = document.getElementById('operationsTable');
    if (!container) {
        debug('⚠️ operationsTable غير موجود', 'warning');
        return;
    }
    
    if (OPERATIONS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا توجد عمليات</div>';
        return;
    }
    
    var html = '<table>';
    html += '<thead><tr>';
    html += '<th>الرقم</th>';
    html += '<th>الاسم</th>';
    html += '<th>النوع</th>';
    html += '<th>القيمة</th>';
    html += '<th>البداية</th>';
    html += '<th>النهاية</th>';
    html += '<th>الحالة</th>';
    html += '<th>القفل</th>';
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    OPERATIONS_STATE.records.forEach(function(op) {
        var statusBadge = '<span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span>';
        var lockIcon = op.is_locked ? '🔒' : '🔓';
        
        html += '<tr>';
        html += '<td><strong><a href="#" class="operation-link" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.reference_number || '-') + '</a></strong></td>';
        html += '<td>' + escapeHtml(op.name) + '</td>';
        html += '<td>' + getOperationTypeText(op.type) + '</td>';
        html += '<td>' + formatMoney(op.amount) + '</td>';
        html += '<td>' + formatDate(op.start_date) + '</td>';
        html += '<td>' + formatDate(op.end_date) + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '<td>' + lockIcon + '</td>';
        
        if (canEdit()) {
            html += '<td class="actions-cell">';
            html += '<button class="btn btn-secondary btn-sm" data-action="openOperationDetails" data-param="' + op.id + '">تفاصيل</button>';
            if (!op.is_locked && op.status !== STATUS.COMPLETED) {
                html += '<button class="btn btn-info btn-sm" data-action="editOperation" data-param="' + op.id + '">تعديل</button>';
            }
            html += '</td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    container.innerHTML = html;
}


// ============================================================
// 5. OPERATION DETAILS (Modal)
// ============================================================

/**
 * فتح تفاصيل العملية
 * يُستدعى من data-action="openOperationDetails"
 */
async function openOperationDetails(operationId) {
    debug('📂 فتح تفاصيل العملية: ' + operationId, 'info');
    
    if (!isSupabaseReady()) return;
    
    OPERATIONS_STATE.currentOperationId = operationId;
    OPERATIONS_STATE.activeTab = 'investors';
    OPERATIONS_STATE.timelineLoaded = false;  // Lazy Loading
    
    showLoading();
    
    try {
        // تحميل البيانات بالتوازي
        var results = await Promise.all([
            runQuery(
                function() {
                    return APP.supabase
                        .from('operations')
                        .select('*')
                        .eq('id', operationId)
                        .single();
                },
                { context: 'openOperationDetails-op', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('operation_investors')
                        .select('id, operation_id, investor_id, contribution, profit')
                        .eq('operation_id', operationId);
                },
                { context: 'openOperationDetails-opInv', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('transfers')
                        .select('id, reference_number, type, purpose, operation_id, investor_id, amount, transfer_date, notes, created_at')
                        .eq('operation_id', operationId)
                        .order('transfer_date', { ascending: false });  // ✅ ترتيب في Query
                },
                { context: 'openOperationDetails-trans', throwError: true }
            ),
            loadClientsForCache(),  // ✅ استخدام Cache
            runQuery(
                function() {
                    return APP.supabase
                        .from('investors')
                        .select('id, name');
                },
                { context: 'openOperationDetails-inv', throwError: true }
            )
        ]);
        
        var operation = results[0].data;
        var opInvestors = results[1].data || [];
        var transfers = results[2].data || [];
        var clients = results[3] || [];
        var investors = results[4].data || [];
        
        if (!operation) {
            showToast('العملية غير موجودة', 'error');
            return;
        }
        
        // بناء Indexes
        var indexes = buildOperationsDetailsIndexes(opInvestors, transfers, investors, clients);
        
        var data = {
            operation: operation,
            opInvestors: opInvestors,
            transfers: transfers,
            investors: investors,
            clients: clients,
            indexes: indexes
        };
        
        // حساب الملخص
        var summary = calculateOperationSummary(operationId, data);
        
        // حفظ في State
        OPERATIONS_STATE.currentOperationData = data;
        
        // تغيير الشاشة إذا لزم الأمر
        if (APP.currentScreen !== 'operations') {
            showScreen('operations');
        }
        
        // عرض التفاصيل
        renderOperationDetails(operation, summary, data);
        
        // فتح الـ Modal
        openModal('operationDetailsModal');
        
    } catch (err) {
        debug('❌ خطأ في openOperationDetails: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'فتح تفاصيل العملية'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * ✅ تحسين 3: تحديث البيانات دون إعادة تحميل كامل
 * يُستدعى بعد كل تعديل لتجنب إعادة تحميل كل البيانات
 */
async function refreshOperationDetails() {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    debug('🔄 تحديث تفاصيل العملية...', 'info');
    
    try {
        // تحميل البيانات المحدثة فقط
        var results = await Promise.all([
            runQuery(
                function() {
                    return APP.supabase
                        .from('operations')
                        .select('*')
                        .eq('id', operationId)
                        .single();
                },
                { context: 'refreshOperationDetails-op', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('operation_investors')
                        .select('id, operation_id, investor_id, contribution, profit')
                        .eq('operation_id', operationId);
                },
                { context: 'refreshOperationDetails-opInv', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('transfers')
                        .select('id, reference_number, type, purpose, operation_id, investor_id, amount, transfer_date, notes, created_at')
                        .eq('operation_id', operationId)
                        .order('transfer_date', { ascending: false });
                },
                { context: 'refreshOperationDetails-trans', throwError: true }
            )
        ]);
        
        var operation = results[0].data;
        var opInvestors = results[1].data || [];
        var transfers = results[2].data || [];
        
        if (!operation) return;
        
        // استخدام البيانات القديمة للعملاء والممولين (لم تتغير)
        var oldData = OPERATIONS_STATE.currentOperationData;
        var clients = oldData ? oldData.clients : [];
        var investors = oldData ? oldData.investors : [];
        
        // بناء Indexes
        var indexes = buildOperationsDetailsIndexes(opInvestors, transfers, investors, clients);
        
        var data = {
            operation: operation,
            opInvestors: opInvestors,
            transfers: transfers,
            investors: investors,
            clients: clients,
            indexes: indexes
        };
        
        var summary = calculateOperationSummary(operationId, data);
        
        // تحديث State
        OPERATIONS_STATE.currentOperationData = data;
        
        // إعادة عرض الأجزاء المتأثرة فقط
        document.getElementById('opDetailsTitle').textContent = 
            (operation.reference_number || '') + ' - ' + operation.name;
        
        document.getElementById('opSummaryGrid').innerHTML = renderOperationSummaryCard(operation, summary, data);
        renderWorkflowActions(operation);
        document.getElementById('opInvestorsList').innerHTML = renderOpInvestorsTab(data);
        document.getElementById('opTransfersList').innerHTML = renderOpTransfersTab(data);
        
        // إذا كان Timeline مفتوحاً، إعادة تحميله
        if (OPERATIONS_STATE.activeTab === 'timeline') {
            OPERATIONS_STATE.timelineLoaded = false;
            renderOpTimelineTab(operationId);
        }
        
        debug('✅ تم تحديث التفاصيل', 'success');
        
    } catch (err) {
        debug('❌ خطأ في refreshOperationDetails: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحديث التفاصيل'), 'error');
    }
}

/**
 * ✅ تحسين 5: تحميل العملاء مع Cache
 */
async function loadClientsForCache() {
    // إذا كان الـ Cache موجوداً، استخدامه
    if (OPERATIONS_STATE.clientsCache) {
        return OPERATIONS_STATE.clientsCache;
    }
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('clients')
                    .select('id, name')
                    .order('name');
            },
            { context: 'loadClientsForCache', throwError: true }
        );
        
        OPERATIONS_STATE.clientsCache = result.data || [];
        return OPERATIONS_STATE.clientsCache;
        
    } catch (err) {
        debug('❌ خطأ في loadClientsForCache: ' + err.message, 'error');
        return [];
    }
}

/**
 * مسح Cache العملاء (يُستدعى عند إضافة/تعديل/حذف عميل)
 */
function clearClientsCache() {
    OPERATIONS_STATE.clientsCache = null;
    debug('🗑️ تم مسح Cache العملاء', 'info');
}

/**
 * بناء Indexes لتفاصيل العملية
 */
function buildOperationsDetailsIndexes(opInvestors, transfers, investors, clients) {
    var investorsById = {};
    var clientsById = {};
    var opInvestorsByInvestor = {};
    var transfersByInvestor = {};
    var transfersByPurpose = {};
    
    opInvestors.forEach(function(oi) {
        if (!opInvestorsByInvestor[oi.investor_id]) {
            opInvestorsByInvestor[oi.investor_id] = [];
        }
        opInvestorsByInvestor[oi.investor_id].push(oi);
    });
    
    transfers.forEach(function(t) {
        if (t.investor_id) {
            if (!transfersByInvestor[t.investor_id]) {
                transfersByInvestor[t.investor_id] = [];
            }
            transfersByInvestor[t.investor_id].push(t);
        }
        
        if (!transfersByPurpose[t.purpose]) {
            transfersByPurpose[t.purpose] = [];
        }
        transfersByPurpose[t.purpose].push(t);
    });
    
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });
    clients.forEach(function(c) { clientsById[c.id] = c; });
    
    return {
        investorsById: investorsById,
        clientsById: clientsById,
        opInvestorsByInvestor: opInvestorsByInvestor,
        transfersByInvestor: transfersByInvestor,
        transfersByPurpose: transfersByPurpose
    };
}


// ============================================================
// 6. RENDER OPERATION DETAILS (مقسّم إلى دوال صغيرة)
// ============================================================

function renderOperationDetails(operation, summary, data) {
    // Header
    document.getElementById('opDetailsTitle').textContent = 
        (operation.reference_number || '') + ' - ' + operation.name;
    
    // Summary - ✅ تمرير data كـ parameter
    document.getElementById('opSummaryGrid').innerHTML = renderOperationSummaryCard(operation, summary, data);
    
    // Workflow Actions
    renderWorkflowActions(operation);
    
    // Tabs Content
    document.getElementById('opInvestorsList').innerHTML = renderOpInvestorsTab(data);
    document.getElementById('opTransfersList').innerHTML = renderOpTransfersTab(data);
    
    // ✅ Lazy Loading للـ Timeline - لا يتم تحميله إلا عند فتح التبويب
    document.getElementById('opTimelineList').innerHTML = '<div class="empty-state">اضغط على تبويب "السجل" لتحميله</div>';
    
    // Reset active tab
    switchOperationTab('investors');
}

/**
 * بطاقة الملخص المالي للعملية
 * ✅ تحسين 2: تمرير data كـ parameter بدلاً من APP.currentOperationData
 */
function renderOperationSummaryCard(operation, summary, data) {
    var html = '';
    
    var clientName = '-';
    if (operation.client_id && data && data.indexes.clientsById) {
        var client = data.indexes.clientsById[operation.client_id];
        if (client) {
            clientName = '<a href="#" data-action="openClientFile" data-param="' + operation.client_id + '">' + escapeHtml(client.name) + '</a>';
        }
    }
    
    html += renderOpSummaryItem('العميل', clientName, '', true);
    html += renderOpSummaryItem('النوع', getOperationTypeText(operation.type), '');
    html += renderOpSummaryItem('قيمة التمويل', formatMoney(operation.amount), 'blue');
    html += renderOpSummaryItem('عدد الممولين', summary.investorCount, '');
    html += renderOpSummaryItem('إجمالي المساهمات', formatMoney(summary.totalInvested), '');
    html += renderOpSummaryItem('رأس المال المُرجع', formatMoney(summary.capitalReturned), 'green');
    html += renderOpSummaryItem('السداد من العميل', formatMoney(summary.clientRepaid), 'green');
    
    if (canViewProfits()) {
        html += renderOpSummaryItem('الربح النهائي', formatMoney(operation.final_profit), 'blue');
        html += renderOpSummaryItem('ربح الشركة', formatMoney(summary.companyProfit), 'orange');
        html += renderOpSummaryItem('أرباح الممولين', formatMoney(summary.totalInvestorProfit), '');
        html += renderOpSummaryItem('الأرباح الموزعة', formatMoney(summary.distributedProfit), 'green');
        html += renderOpSummaryItem('الأرباح المتبقية', formatMoney(summary.remainingProfit), summary.remainingProfit > 0 ? 'orange' : 'green');
    }
    
    html += renderOpSummaryItem('تاريخ البداية', formatDate(operation.start_date), '');
    html += renderOpSummaryItem('تاريخ النهاية', formatDate(operation.end_date), '');
    html += renderOpSummaryItem('الحالة', '<span class="badge badge-' + operation.status + '">' + getStatusText(operation.status) + '</span>', '', true);
    html += renderOpSummaryItem('القفل', operation.is_locked ? '🔒 مقفلة' : '🔓 مفتوحة', '');
    
    if (operation.profit_approval_date) {
        html += renderOpSummaryItem('تاريخ اعتماد الربح', formatDate(operation.profit_approval_date), 'green');
    }
    
    if (operation.reference_no) {
        html += renderOpSummaryItem('رقم مرجعي', escapeHtml(operation.reference_no), '');
    }
    
    if (operation.google_drive_url) {
        html += '<div class="summary-item">';
        html += '<label>المستندات</label>';
        html += '<div class="val"><a href="' + escapeHtml(operation.google_drive_url) + '" target="_blank">📁 فتح</a></div>';
        html += '</div>';
    }
    
    return html;
}

/**
 * عنصر ملخص العملية
 */
function renderOpSummaryItem(label, value, colorClass, allowHtml) {
    var displayValue = allowHtml ? value : escapeHtml(value);
    return '<div class="summary-item">' +
           '<label>' + escapeHtml(label) + '</label>' +
           '<div class="val ' + (colorClass || '') + '">' + displayValue + '</div>' +
           '</div>';
}


// ============================================================
// 7. WORKFLOW ACTIONS
// ============================================================

/**
 * ✅ تحسين 7: Helper لإظهار/إخفاء الأزرار
 */
function toggleActionButton(button, visible) {
    if (!button) return;
    button.style.display = visible ? 'inline-flex' : 'none';
}

/**
 * عرض أزرار Workflow حسب حالة العملية
 */
function renderWorkflowActions(operation) {
    var container = document.getElementById('workflowActions');
    if (!container) return;
    
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
    var unlockBtn = document.getElementById('unlockBtn');
    
    // إخفاء الكل أولاً
    toggleActionButton(activateBtn, false);
    toggleActionButton(repaymentBtn, false);
    toggleActionButton(profitBtn, false);
    toggleActionButton(returnBtn, false);
    toggleActionButton(completeBtn, false);
    toggleActionButton(unlockBtn, false);
    
    // إظهار حسب الحالة
    if (operation.status === STATUS.DRAFT) {
        toggleActionButton(activateBtn, true);
    }
    
    if (operation.status === STATUS.ACTIVE) {
        toggleActionButton(repaymentBtn, true);
        toggleActionButton(profitBtn, canViewProfits());
        toggleActionButton(returnBtn, true);
        toggleActionButton(completeBtn, true);
    }
    
    if (operation.is_locked) {
        toggleActionButton(unlockBtn, true);
    }
}


// ============================================================
// 8. TABS CONTENT
// ============================================================

/**
 * تبويب الممولين
 */
function renderOpInvestorsTab(data) {
    var opInvestors = data.opInvestors || [];
    
    if (opInvestors.length === 0) {
        return '<div class="empty-state">لا يوجد ممولين في هذه العملية</div>';
    }
    
    var html = '<table>';
    html += '<thead><tr>';
    html += '<th>الممول</th>';
    html += '<th>المساهمة</th>';
    html += '<th class="profit-field">الربح</th>';
    html += '<th>إرجاع رأس مال</th>';
    html += '<th>أرباح مصروفة</th>';
    html += '<th class="profit-field">المتبقي</th>';
    if (canEdit() && !data.operation.is_locked) html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    opInvestors.forEach(function(oi) {
        var inv = data.indexes.investorsById[oi.investor_id];
        var invName = inv ? inv.name : '-';
        var invLink = inv ? '<a href="#" data-action="openInvestorFile" data-param="' + inv.id + '">' + escapeHtml(invName) + '</a>' : '-';
        
        // حساب الإرجاع والأرباح المصروفة
        var invTransfers = data.indexes.transfersByInvestor[oi.investor_id] || [];
        var capitalReturned = invTransfers.filter(function(t) {
            return t.purpose === 'capital_return' && t.operation_id === data.operation.id;
        }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0);
        
        var profitDistributed = invTransfers.filter(function(t) {
            return t.purpose === 'profit_distribution' && t.operation_id === data.operation.id;
        }).reduce(function(s, t) { return s + parseFloat(t.amount || 0); }, 0);
        
        var remaining = (parseFloat(oi.contribution || 0) + parseFloat(oi.profit || 0)) - capitalReturned - profitDistributed;
        
        html += '<tr>';
        html += '<td>' + invLink + '</td>';
        html += '<td>' + formatMoney(oi.contribution) + '</td>';
        html += '<td class="profit-field">' + (canViewProfits() ? formatMoney(oi.profit) : '<span class="hidden-profit">****</span>') + '</td>';
        html += '<td>' + formatMoney(capitalReturned) + '</td>';
        html += '<td>' + formatMoney(profitDistributed) + '</td>';
        html += '<td class="profit-field">' + (canViewProfits() ? formatMoney(remaining) : '<span class="hidden-profit">****</span>') + '</td>';
        
        if (canEdit() && !data.operation.is_locked) {
            html += '<td class="actions-cell">';
            html += '<button class="btn btn-secondary btn-sm" data-action="editOpInvestor" data-param="' + oi.id + '">تعديل</button>';
            html += '<button class="btn btn-danger btn-sm" data-action="deleteOpInvestor" data-param="' + oi.id + '">حذف</button>';
            html += '</td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    return html;
}

/**
 * تبويب التحويلات
 * ✅ تحسين 6: التحويلات مرتبة من Query، لا حاجة للـ sort
 */
function renderOpTransfersTab(data) {
    var transfers = data.transfers || [];
    
    if (transfers.length === 0) {
        return '<div class="empty-state">لا توجد تحويلات</div>';
    }
    
    var html = '<table>';
    html += '<thead><tr>';
    html += '<th>الرقم</th>';
    html += '<th>التاريخ</th>';
    html += '<th>النوع</th>';
    html += '<th>الغرض</th>';
    html += '<th>الممول</th>';
    html += '<th>المبلغ</th>';
    html += '<th>ملاحظات</th>';
    if (canEdit() && !data.operation.is_locked) html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    transfers.forEach(function(t) {
        var invName = '-';
        if (t.investor_id && data.indexes.investorsById[t.investor_id]) {
            var inv = data.indexes.investorsById[t.investor_id];
            invName = '<a href="#" data-action="openInvestorFile" data-param="' + inv.id + '">' + escapeHtml(inv.name) + '</a>';
        }
        
        html += '<tr>';
        html += '<td>' + escapeHtml(t.reference_number || '-') + '</td>';
        html += '<td>' + formatDate(t.transfer_date) + '</td>';
        html += '<td>' + getTransferTypeText(t.type) + '</td>';
        html += '<td>' + getPurposeText(t.purpose) + '</td>';
        html += '<td>' + invName + '</td>';
        html += '<td>' + formatMoney(t.amount) + '</td>';
        html += '<td>' + escapeHtml(truncateText(t.notes, 30)) + '</td>';
        
        if (canEdit() && !data.operation.is_locked) {
            html += '<td class="actions-cell">';
            html += '<button class="btn btn-danger btn-sm" data-action="deleteTransfer" data-param="' + t.id + '">حذف</button>';
            html += '</td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    return html;
}

/**
 * ✅ تحسين 1 + 10: تبويب السجل (Timeline) - Lazy Loading
 * الدالة ليست async في الاستدعاء، بل تقوم بتعديل container مباشرة
 */
async function renderOpTimelineTab(operationId) {
    var container = document.getElementById('opTimelineList');
    if (!container) return;
    
    // إذا تم تحميله مسبقاً، لا نعيد التحميل
    if (OPERATIONS_STATE.timelineLoaded) {
        return;
    }
    
    container.innerHTML = '<div class="empty-state">جاري تحميل السجل...</div>';
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('activity_logs')
                    .select('reference_number, created_at, user_email, action, details')
                    .eq('entity_type', 'operation')
                    .eq('entity_id', operationId)
                    .order('created_at', { ascending: false })
                    .limit(50);
            },
            { context: 'renderOpTimelineTab', throwError: true }
        );
        
        var logs = result.data || [];
        
        if (logs.length === 0) {
            container.innerHTML = '<div class="empty-state">لا توجد سجلات</div>';
            OPERATIONS_STATE.timelineLoaded = true;
            return;
        }
        
        var html = '<div class="timeline">';
        
        logs.forEach(function(log) {
            html += '<div class="timeline-item">';
            html += '<div class="timeline-time">' + formatDateTime(log.created_at) + '</div>';
            html += '<div class="timeline-user">' + escapeHtml(log.user_email) + '</div>';
            html += '<div class="timeline-content">';
            html += '<strong>' + escapeHtml(log.action) + '</strong>';
            if (log.details) {
                html += '<p>' + escapeHtml(log.details) + '</p>';
            }
            html += '</div>';
            html += '</div>';
        });
        
        html += '</div>';
        
        container.innerHTML = html;
        OPERATIONS_STATE.timelineLoaded = true;
        
    } catch (err) {
        debug('❌ خطأ في renderOpTimelineTab: ' + err.message, 'error');
        container.innerHTML = '<div class="error-box">فشل تحميل السجل</div>';
    }
}


// ============================================================
// 9. WORKFLOW ACTIONS
// ============================================================

/**
 * تنفيذ إجراء Workflow
 * @param {string} action - activate/complete/unlock
 */
async function workflowAction(action) {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    var operation = OPERATIONS_STATE.currentOperationData ? OPERATIONS_STATE.currentOperationData.operation : null;
    if (!operation) return;
    
    // تأكيد حسب الإجراء
    if (action === 'activate') {
        if (!confirmActivate(operation.name)) return;
    } else if (action === 'complete') {
        if (!confirmComplete(operation.name)) return;
    } else if (action === 'unlock') {
        if (!confirmUnlock(operation.name)) return;
    }
    
    showLoading();
    
    try {
        var updateData = {};
        var logAction = '';
        var logActionType = '';
        
        if (action === 'activate') {
            updateData = { status: STATUS.ACTIVE };
            logAction = 'تفعيل عملية';
            logActionType = 'activate';
        } else if (action === 'complete') {
            updateData = { 
                status: STATUS.COMPLETED,
                is_locked: true
            };
            logAction = 'إنهاء عملية';
            logActionType = 'update';
        } else if (action === 'unlock') {
            updateData = { is_locked: false };
            logAction = 'فتح قفل عملية';
            logActionType = 'unlock';
        }
        
        await runQuery(
            function() {
                return APP.supabase
                    .from('operations')
                    .update(updateData)
                    .eq('id', operationId);
            },
            { context: 'workflowAction-' + action, throwError: true }
        );
        
        // تسجيل في Activity Log
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                logAction,
                'operation',
                operationId,
                JSON.stringify({ status: operation.status, is_locked: operation.is_locked }),
                JSON.stringify(updateData),
                'Name: ' + operation.name + ', Ref: ' + (operation.reference_number || ''),
                logActionType
            );
        }
        
        debug('✅ تم تنفيذ ' + action, 'success');
        showToast('تم تنفيذ الإجراء', 'success');
        
        closeModal('operationDetailsModal');
        
        // ✅ استخدام refresh بدلاً من إعادة تحميل كامل
        await refreshOperationDetails();
        openModal('operationDetailsModal');
        
        // تحديث القائمة أيضاً
        loadOperations();
        
    } catch (err) {
        debug('❌ خطأ في workflowAction: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تنفيذ الإجراء'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * فتح Modal تحويل Workflow (سداد/أرباح/إرجاع)
 */
function openWorkflowTransfer(purpose) {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    var operation = OPERATIONS_STATE.currentOperationData ? OPERATIONS_STATE.currentOperationData.operation : null;
    if (!operation) return;
    
    // فتح Modal التحويل مع تعبئة الحقول
    var typeEl = document.getElementById('transferType');
    var purposeEl = document.getElementById('transferPurpose');
    var operationEl = document.getElementById('transferOperation');
    var dateEl = document.getElementById('transferDate');
    
    if (purpose === 'client_repayment') {
        if (typeEl) typeEl.value = 'client_to_company';
        if (purposeEl) purposeEl.value = 'client_repayment';
    } else if (purpose === 'profit_distribution') {
        if (typeEl) typeEl.value = 'company_to_investor';
        if (purposeEl) purposeEl.value = 'profit_distribution';
    } else if (purpose === 'capital_return') {
        if (typeEl) typeEl.value = 'company_to_investor';
        if (purposeEl) purposeEl.value = 'capital_return';
    }
    
    // تعبئة العملية
    if (operationEl) {
        operationEl.value = operationId;
    }
    
    // تاريخ اليوم
    if (dateEl) dateEl.value = getTodayDate();
    
    // فتح الـ Modal
    openModal('transferModal');
    
    // استدعاء toggleInvestorSelect إذا كانت الدالة متاحة
    if (typeof toggleInvestorSelect === 'function') {
        toggleInvestorSelect();
    }
}


// ============================================================
// 10. OPERATION MODAL (إضافة/تعديل)
// ============================================================

/**
 * فتح Modal إضافة/تعديل عملية
 */
async function openOperationModal(operationId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var titleEl = document.getElementById('operationModalTitle');
    var idEl = document.getElementById('operationId');
    
    if (!titleEl || !idEl) {
        debug('⚠️ عناصر Modal غير موجودة', 'warning');
        return;
    }
    
    // ✅ استخدام Cache للعملاء
    await loadClientsForOperationSelect();
    
    if (operationId) {
        // تعديل
        try {
            var result = await runQuery(
                function() {
                    return APP.supabase
                        .from('operations')
                        .select('*')
                        .eq('id', operationId)
                        .single();
                },
                { context: 'openOperationModal', throwError: true }
            );
            
            var op = result.data;
            if (!op) {
                showToast('العملية غير موجودة', 'error');
                return;
            }
            
            populateOperationForm(op, 'تعديل عملية');
            
        } catch (err) {
            debug('❌ خطأ في openOperationModal: ' + err.message, 'error');
            showToast(handleSupabaseError(err, 'فتح بيانات العملية'), 'error');
            return;
        }
    } else {
        // إضافة - تفريغ النموذج
        resetOperationForm();
    }
    
    openModal('operationModal');
}

/**
 * ✅ تحسين 8: تعبئة نموذج العملية
 */
function populateOperationForm(op, title) {
    document.getElementById('operationModalTitle').textContent = title;
    document.getElementById('operationId').value = op.id;
    document.getElementById('opName').value = op.name || '';
    document.getElementById('opType').value = op.type || 'financing';
    document.getElementById('opClient').value = op.client_id || '';
    document.getElementById('opAmount').value = op.amount || '';
    document.getElementById('opExpectedProfit').value = op.expected_profit || '';
    document.getElementById('opFinalProfit').value = op.final_profit || '';
    document.getElementById('opProfitApprovalDate').value = formatDateForInput(op.profit_approval_date);
    document.getElementById('opGoogleDriveUrl').value = op.google_drive_url || '';
    document.getElementById('opCompanyProfitType').value = op.company_profit_type || '';
    document.getElementById('opCompanyProfitValue').value = op.company_profit_value || '';
    document.getElementById('opStartDate').value = formatDateForInput(op.start_date);
    document.getElementById('opDurationDays').value = op.duration_days || '';
    document.getElementById('opEndDate').value = formatDateForInput(op.end_date);
    document.getElementById('opStatus').value = op.status || 'draft';
    document.getElementById('opNotes').value = op.notes || '';
}

/**
 * ✅ تحسين 8: تفريغ نموذج العملية
 */
function resetOperationForm() {
    document.getElementById('operationModalTitle').textContent = 'إضافة عملية';
    document.getElementById('operationId').value = '';
    document.getElementById('opName').value = '';
    document.getElementById('opType').value = 'financing';
    document.getElementById('opClient').value = '';
    document.getElementById('opAmount').value = '';
    document.getElementById('opExpectedProfit').value = '';
    document.getElementById('opFinalProfit').value = '';
    document.getElementById('opProfitApprovalDate').value = '';
    document.getElementById('opGoogleDriveUrl').value = '';
    document.getElementById('opCompanyProfitType').value = '';
    document.getElementById('opCompanyProfitValue').value = '';
    document.getElementById('opStartDate').value = getTodayDate();
    document.getElementById('opDurationDays').value = '';
    document.getElementById('opEndDate').value = '';
    document.getElementById('opStatus').value = 'draft';
    document.getElementById('opNotes').value = '';
}

/**
 * ✅ تحسين 8: جمع بيانات النموذج
 */
function collectOperationFormData() {
    return {
        id: document.getElementById('operationId').value,
        name: document.getElementById('opName').value.trim(),
        type: document.getElementById('opType').value,
        clientId: document.getElementById('opClient').value,
        amount: document.getElementById('opAmount').value,
        expectedProfit: document.getElementById('opExpectedProfit').value,
        finalProfit: document.getElementById('opFinalProfit').value,
        profitApprovalDate: document.getElementById('opProfitApprovalDate').value,
        googleDriveUrl: document.getElementById('opGoogleDriveUrl').value.trim(),
        companyProfitType: document.getElementById('opCompanyProfitType').value,
        companyProfitValue: document.getElementById('opCompanyProfitValue').value,
        startDate: document.getElementById('opStartDate').value,
        durationDays: document.getElementById('opDurationDays').value,
        endDate: document.getElementById('opEndDate').value,
        status: document.getElementById('opStatus').value,
        notes: document.getElementById('opNotes').value.trim()
    };
}

/**
 * ✅ تحسين 8: التحقق من صحة النموذج
 */
function validateOperationForm(formData) {
    if (isEmpty(formData.name)) {
        showToast('❌ اسم العملية مطلوب', 'error');
        return false;
    }
    
    if (isEmpty(formData.clientId)) {
        showToast('❌ العميل مطلوب', 'error');
        return false;
    }
    
    if (!isPositiveNumber(formData.amount)) {
        showToast('❌ قيمة التمويل يجب أن تكون أكبر من صفر', 'error');
        return false;
    }
    
    if (isEmpty(formData.startDate)) {
        showToast('❌ تاريخ البداية مطلوب', 'error');
        return false;
    }
    
    return true;
}

/**
 * تحميل قائمة العملاء للـ Select (مع Cache)
 */
async function loadClientsForOperationSelect() {
    var selectEl = document.getElementById('opClient');
    if (!selectEl) return;
    
    try {
        var clients = await loadClientsForCache();
        
        var options = '<option value="">-- اختر العميل --</option>';
        clients.forEach(function(c) {
            if (!c.is_archived) {
                options += '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>';
            }
        });
        
        selectEl.innerHTML = options;
        
    } catch (err) {
        debug('❌ خطأ في loadClientsForOperationSelect: ' + err.message, 'error');
    }
}

/**
 * ✅ تحسين 8: حفظ العملية (مقسّم إلى دوال صغيرة)
 */
async function saveOperation() {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    // جمع البيانات
    var formData = collectOperationFormData();
    
    // التحقق
    if (!validateOperationForm(formData)) {
        return;
    }
    
    // بناء البيانات للحفظ
    var data = {
        name: formData.name,
        type: formData.type,
        client_id: formData.clientId,
        amount: parseFloat(formData.amount),
        expected_profit: formData.expectedProfit ? parseFloat(formData.expectedProfit) : 0,
        final_profit: formData.finalProfit ? parseFloat(formData.finalProfit) : 0,
        profit_approval_date: formData.profitApprovalDate || null,
        google_drive_url: formData.googleDriveUrl || null,
        company_profit_type: formData.companyProfitType || null,
        company_profit_value: formData.companyProfitValue ? parseFloat(formData.companyProfitValue) : 0,
        start_date: formData.startDate,
        duration_days: formData.durationDays ? parseInt(formData.durationDays) : 0,
        end_date: formData.endDate || null,
        status: formData.status,
        notes: formData.notes || null
    };
    
    showLoading();
    
    try {
        if (formData.id) {
            // تعديل
            var oldResult = await runQuery(
                function() {
                    return APP.supabase.from('operations').select('*').eq('id', formData.id).single();
                },
                { context: 'saveOperation-getOld', throwError: true }
            );
            
            await runQuery(
                function() {
                    return APP.supabase.from('operations').update(data).eq('id', formData.id);
                },
                { context: 'saveOperation-update', throwError: true }
            );
            
            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB(
                    'تعديل عملية', 'operation', formData.id,
                    JSON.stringify(oldResult.data), JSON.stringify(data),
                    'Name: ' + data.name, 'update'
                );
            }
            
            debug('✅ تم تحديث العملية', 'success');
            showToast('تم تحديث العملية', 'success');
            
        } else {
            // إضافة
            var result = await runQuery(
                function() {
                    return APP.supabase.from('operations').insert(data).select();
                },
                { context: 'saveOperation-insert', throwError: true }
            );
            
            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB(
                        'إضافة عملية', 'operation', result.data[0].id,
                        null, JSON.stringify(data),
                        'Name: ' + data.name + ', Ref: ' + (result.data[0].reference_number || ''),
                        'create'
                    );
                }
                
                debug('✅ تم إضافة العملية', 'success');
                showToast('تم إضافة العملية', 'success');
            }
        }
        
        closeModal('operationModal');
        loadOperations();
        
    } catch (err) {
        debug('❌ خطأ في saveOperation: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ العملية'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * تعديل عملية (من القائمة)
 */
function editOperation(operationId) {
    openOperationModal(operationId);
}


// ============================================================
// 11. OPERATION INVESTORS (إضافة/تعديل/حذف)
// ============================================================

/**
 * فتح Modal إضافة ممول للعملية
 */
async function openAddInvestorToOp() {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    // تحميل قائمة الممولين
    var selectEl = document.getElementById('newOpInvestorId');
    if (!selectEl) return;
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase
                    .from('investors')
                    .select('id, name')
                    .eq('is_archived', false)
                    .order('name');
            },
            { context: 'openAddInvestorToOp', throwError: true }
        );
        
        var investors = result.data || [];
        
        var options = '<option value="">-- اختر الممول --</option>';
        investors.forEach(function(inv) {
            options += '<option value="' + inv.id + '">' + escapeHtml(inv.name) + '</option>';
        });
        
        selectEl.innerHTML = options;
        
        // تفريغ الحقول
        document.getElementById('newOpInvestorContribution').value = '';
        document.getElementById('newOpInvestorProfit').value = '';
        
        // إخفاء التحذير
        var warningEl = document.getElementById('opInvestorValidationWarning');
        if (warningEl) warningEl.innerHTML = '';
        
        openModal('addInvestorToOpModal');
        
    } catch (err) {
        debug('❌ خطأ في openAddInvestorToOp: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'فتح Modal الممول'), 'error');
    }
}

/**
 * حفظ مساهمة ممول في عملية
 */
async function saveOpInvestor() {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    var investorId = document.getElementById('newOpInvestorId').value;
    var contribution = document.getElementById('newOpInvestorContribution').value;
    var profit = document.getElementById('newOpInvestorProfit').value;
    
    if (isEmpty(investorId)) {
        showToast('❌ الممول مطلوب', 'error');
        return;
    }
    
    if (!isPositiveNumber(contribution)) {
        showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error');
        return;
    }
    
    if (!isNonNegativeNumber(profit)) {
        showToast('❌ الربح يجب أن يكون رقم صحيح', 'error');
        return;
    }
    
    // ✅ تحسين 4: التحقق من الإجمالي وليس المساهمة الفردية
    var validationError = validateTotalContributions(operationId, parseFloat(contribution), parseFloat(profit), null);
    if (validationError) {
        showToast('❌ ' + validationError, 'error');
        return;
    }
    
    var data = {
        operation_id: operationId,
        investor_id: investorId,
        contribution: parseFloat(contribution),
        profit: parseFloat(profit)
    };
    
    showLoading();
    
    try {
        var result = await runQuery(
            function() {
                return APP.supabase.from('operation_investors').insert(data).select();
            },
            { context: 'saveOpInvestor', throwError: true }
        );
        
        if (result.data && result.data[0]) {
            if (typeof window.logActivityToDB === 'function') {
                var inv = OPERATIONS_STATE.currentOperationData.indexes.investorsById[investorId];
                window.logActivityToDB(
                    'إضافة ممول لعملية', 'operation_investor', operationId,
                    null, JSON.stringify(data),
                    'Investor: ' + (inv ? inv.name : investorId) + ', Contribution: ' + contribution,
                    'create'
                );
            }
            
            debug('✅ تم إضافة الممول', 'success');
            showToast('تم إضافة الممول', 'success');
            
            closeModal('addInvestorToOpModal');
            
            // ✅ استخدام refresh بدلاً من إعادة تحميل كامل
            await refreshOperationDetails();
        }
        
    } catch (err) {
        debug('❌ خطأ في saveOpInvestor: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'إضافة الممول'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * ✅ تحسين 4: التحقق من إجمالي المساهمات والأرباح
 * @param {string} operationId - معرّف العملية
 * @param {number} newContribution - المساهمة الجديدة
 * @param {number} newProfit - الربح الجديد
 * @param {string|null} excludeId - استثناء مساهمة معينة (للتعديل)
 * @returns {string|null} - رسالة الخطأ أو null إذا صحيح
 */
function validateTotalContributions(operationId, newContribution, newProfit, excludeId) {
    var data = OPERATIONS_STATE.currentOperationData;
    if (!data || !data.operation) return null;
    
    var operation = data.operation;
    var opInvestors = data.opInvestors || [];
    
    // حساب إجمالي المساهمات الحالية (باستثناء المساهمة الحالية إذا كان تعديل)
    var totalExistingContribution = opInvestors
        .filter(function(oi) { return oi.id !== excludeId; })
        .reduce(function(s, oi) { return s + parseFloat(oi.contribution || 0); }, 0);
    
    var totalExistingProfit = opInvestors
        .filter(function(oi) { return oi.id !== excludeId; })
        .reduce(function(s, oi) { return s + parseFloat(oi.profit || 0); }, 0);
    
    // حساب الإجمالي بعد الإضافة/التعديل
    var totalContribution = totalExistingContribution + newContribution;
    var totalProfit = totalExistingProfit + newProfit;
    
    // التحقق من المساهمات
    if (totalContribution > operation.amount + 0.01) {
        return 'إجمالي المساهمات (' + formatMoney(totalContribution) + ') يتجاوز قيمة العملية (' + formatMoney(operation.amount) + ')';
    }
    
    // التحقق من الأرباح
    if (operation.final_profit && totalProfit > operation.final_profit + 0.01) {
        return 'إجمالي الأرباح (' + formatMoney(totalProfit) + ') يتجاوز الربح النهائي (' + formatMoney(operation.final_profit) + ')';
    }
    
    return null;
}

/**
 * فتح Modal تعديل ممول عملية
 */
function editOpInvestor(opInvestorId) {
    var data = OPERATIONS_STATE.currentOperationData;
    if (!data) return;
    
    var oi = data.opInvestors.find(function(o) { return o.id === opInvestorId; });
    if (!oi) return;
    
    document.getElementById('editOpInvestorId').value = oi.id;
    document.getElementById('editOpInvestorContribution').value = oi.contribution;
    document.getElementById('editOpInvestorProfit').value = oi.profit;
    
    var warningEl = document.getElementById('editOpInvestorValidationWarning');
    if (warningEl) warningEl.innerHTML = '';
    
    openModal('editOpInvestorModal');
}

/**
 * تحديث مساهمة ممول
 */
async function updateOpInvestor() {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    var opInvestorId = document.getElementById('editOpInvestorId').value;
    var contribution = document.getElementById('editOpInvestorContribution').value;
    var profit = document.getElementById('editOpInvestorProfit').value;
    
    if (!isPositiveNumber(contribution)) {
        showToast('❌ المساهمة يجب أن تكون أكبر من صفر', 'error');
        return;
    }
    
    if (!isNonNegativeNumber(profit)) {
        showToast('❌ الربح يجب أن يكون رقم صحيح', 'error');
        return;
    }
    
    // ✅ تحسين 4: التحقق من الإجمالي مع استثناء المساهمة الحالية
    var validationError = validateTotalContributions(
        operationId, 
        parseFloat(contribution), 
        parseFloat(profit), 
        opInvestorId  // استثناء المساهمة الحالية
    );
    if (validationError) {
        showToast('❌ ' + validationError, 'error');
        return;
    }
    
    var data = {
        contribution: parseFloat(contribution),
        profit: parseFloat(profit)
    };
    
    showLoading();
    
    try {
        var oldResult = await runQuery(
            function() {
                return APP.supabase.from('operation_investors').select('*').eq('id', opInvestorId).single();
            },
            { context: 'updateOpInvestor-getOld', throwError: true }
        );
        
        await runQuery(
            function() {
                return APP.supabase.from('operation_investors').update(data).eq('id', opInvestorId);
            },
            { context: 'updateOpInvestor-update', throwError: true }
        );
        
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                'تعديل ممول عملية', 'operation_investor', operationId,
                JSON.stringify(oldResult.data), JSON.stringify(data),
                'Contribution: ' + contribution + ', Profit: ' + profit,
                'update'
            );
        }
        
        debug('✅ تم تحديث الممول', 'success');
        showToast('تم تحديث الممول', 'success');
        
        closeModal('editOpInvestorModal');
        
        // ✅ استخدام refresh بدلاً من إعادة تحميل كامل
        await refreshOperationDetails();
        
    } catch (err) {
        debug('❌ خطأ في updateOpInvestor: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحديث الممول'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * حذف مساهمة ممول
 */
async function confirmDeleteOpInvestor(opInvestorId) {
    var operationId = OPERATIONS_STATE.currentOperationId;
    if (!operationId) return;
    
    var data = OPERATIONS_STATE.currentOperationData;
    if (!data) return;
    
    var oi = data.opInvestors.find(function(o) { return o.id === opInvestorId; });
    if (!oi) return;
    
    var inv = data.indexes.investorsById[oi.investor_id];
    var invName = inv ? inv.name : 'الممول';
    
    if (!confirmDelete(invName + ' من العملية')) {
        return;
    }
    
    showLoading();
    
    try {
        await runQuery(
            function() {
                return APP.supabase.from('operation_investors').delete().eq('id', opInvestorId);
            },
            { context: 'confirmDeleteOpInvestor', throwError: true }
        );
        
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                'حذف ممول من عملية', 'operation_investor', operationId,
                JSON.stringify(oi), null,
                'Investor: ' + invName, 'delete'
            );
        }
        
        debug('✅ تم حذف الممول', 'success');
        showToast('تم حذف الممول', 'success');
        
        // ✅ استخدام refresh بدلاً من إعادة تحميل كامل
        await refreshOperationDetails();
        
    } catch (err) {
        debug('❌ خطأ في confirmDeleteOpInvestor: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حذف الممول'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * فتح Modal إضافة تحويل للعملية
 */
function openAddTransferToOp() {
    openWorkflowTransfer('other');
}


// ============================================================
// 12. VALIDATION HELPERS
// ============================================================

/**
 * التحقق من مدخلات إضافة ممول
 * ✅ تحسين 4: التحقق من الإجمالي وليس المساهمة الفردية
 */
function validateOpInvestorInputs() {
    var contribution = parseFloat(document.getElementById('newOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('newOpInvestorProfit').value) || 0;
    var warningEl = document.getElementById('opInvestorValidationWarning');
    
    if (!warningEl) return;
    
    var operationId = OPERATIONS_STATE.currentOperationId;
    var validationError = validateTotalContributions(operationId, contribution, profit, null);
    
    if (validationError) {
        warningEl.innerHTML = '<div class="warning-box">⚠️ ' + validationError + '</div>';
    } else {
        warningEl.innerHTML = '';
    }
}

/**
 * التحقق من مدخلات تعديل ممول
 * ✅ تحسين 4: التحقق من الإجمالي مع استثناء المساهمة الحالية
 */
function validateEditOpInvestorInputs() {
    var opInvestorId = document.getElementById('editOpInvestorId').value;
    var contribution = parseFloat(document.getElementById('editOpInvestorContribution').value) || 0;
    var profit = parseFloat(document.getElementById('editOpInvestorProfit').value) || 0;
    var warningEl = document.getElementById('editOpInvestorValidationWarning');
    
    if (!warningEl) return;
    
    var operationId = OPERATIONS_STATE.currentOperationId;
    var validationError = validateTotalContributions(operationId, contribution, profit, opInvestorId);
    
    if (validationError) {
        warningEl.innerHTML = '<div class="warning-box">⚠️ ' + validationError + '</div>';
    } else {
        warningEl.innerHTML = '';
    }
}


// ============================================================
// 13. SEARCH & FILTER
// ============================================================

function searchOperations(searchTerm) {
    OPERATIONS_STATE.search = searchTerm;
    loadOperations();
}

function filterOperations(filterValue) {
    OPERATIONS_STATE.filter = filterValue;
    loadOperations();
}


// ============================================================
// 14. NAVIGATION HELPERS
// ============================================================

/**
 * تبديل تبويبات تفاصيل العملية
 * ✅ Lazy Loading للـ Timeline
 */
function switchOperationTab(tabName, btn) {
    OPERATIONS_STATE.activeTab = tabName;
    
    // استخدام switchTab من app.js
    switchTab(tabName, btn);
    
    // ✅ Lazy Loading للـ Timeline - تحميل عند فتح التبويب فقط
    if (tabName === 'timeline' && !OPERATIONS_STATE.timelineLoaded) {
        renderOpTimelineTab(OPERATIONS_STATE.currentOperationId);
    }
    
    debug('📑 تبديل تبويب العملية: ' + tabName, 'info');
}


// ============================================================
// END OF OPERATIONS.JS
// ============================================================
