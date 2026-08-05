// ============================================================
// نظام إدارة التمويل - Clients Module
// Version: 2.0.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - initClients() - تسجيل الدالة في Registry
// - loadClients() - تحميل قائمة العملاء
// - openClientFile() - فتح ملف العميل الشامل
// - openClientModal() - Modal إضافة/تعديل
// - saveClient() - حفظ العميل
// - archiveClient() - أرشفة مع شروط
// - searchClients() - بحث debounced
// - filterClients() - فلتر الحالة
// - Render (قائمة + ملف + ملخص + عمليات + كشف حساب)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
// - auth.js (canEdit, isAdmin, etc.)
// - calculations.js (calculateClientSummary, buildStatement)
// - activity.js (window.logActivityToDB)
//
// ملاحظة: لا يحتوي على DOMContentLoaded (app.js هو Bootstrap)
// ============================================================


// ============================================================
// 1. STATE
// ============================================================

var CLIENTS_STATE = {
    search: '',
    filter: '',
    records: [],
    currentFileId: null
};


// ============================================================
// 2. INITIALIZATION
// ============================================================

function initClients() {
    debug('👥 بدء تهيئة clients.js', 'info');
    registerScreenLoader('clients', loadClients);
    debug('✅ clients.js جاهز', 'success');
}


// ============================================================
// 3. MAIN LOADER
// ============================================================

async function loadClients() {
    debug('👥 بدأ loadClients', 'info');
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    showLoading();
    
    try {
        var query = APP.supabase
            .from('clients')
            .select('id, name, phone, email, reference_number, is_archived, created_at')
            .order('created_at', { ascending: false });
        
        // تطبيق الفلتر
        if (CLIENTS_STATE.filter === 'active') {
            query = query.eq('is_archived', false);
        } else if (CLIENTS_STATE.filter === 'archived') {
            query = query.eq('is_archived', true);
        }
        
        // تطبيق البحث
        if (CLIENTS_STATE.search) {
            var searchTerm = '%' + CLIENTS_STATE.search + '%';
            query = query.or(
                'name.ilike.' + searchTerm + 
                ',reference_number.ilike.' + searchTerm + 
                ',phone.ilike.' + searchTerm
            );
        }
        
        var result = await runQuery(
            function() { return query; },
            { context: 'loadClients', throwError: true }
        );
        
        CLIENTS_STATE.records = result.data || [];
        
        debug('✅ تم تحميل ' + CLIENTS_STATE.records.length + ' عميل', 'success');
        
        renderClientsList();
        
    } catch (err) {
        debug('❌ خطأ في loadClients: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'تحميل العملاء'), 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 4. RENDER CLIENTS LIST
// ============================================================

function renderClientsList() {
    var container = document.getElementById('clientsTable');
    if (!container) {
        debug('⚠️ clientsTable غير موجود', 'warning');
        return;
    }
    
    if (CLIENTS_STATE.records.length === 0) {
        container.innerHTML = '<div class="empty-state">لا يوجد عملاء</div>';
        return;
    }
    
    var html = '<table>';
    html += '<thead><tr>';
    html += '<th>الرقم</th>';
    html += '<th>الاسم</th>';
    html += '<th>الهاتف</th>';
    html += '<th>البريد</th>';
    html += '<th>الحالة</th>';
    if (canEdit()) html += '<th>الإجراءات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    CLIENTS_STATE.records.forEach(function(client) {
        var statusBadge = client.is_archived 
            ? '<span class="badge badge-inactive">أرشيف</span>' 
            : '<span class="badge badge-active">نشط</span>';
        
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(client.reference_number || '-') + '</strong></td>';
        html += '<td><a href="#" class="client-link" data-action="openClientFile" data-param="' + client.id + '">' + escapeHtml(client.name) + '</a></td>';
        html += '<td>' + escapeHtml(client.phone || '-') + '</td>';
        html += '<td>' + escapeHtml(client.email || '-') + '</td>';
        html += '<td>' + statusBadge + '</td>';
        
        if (canEdit()) {
            html += '<td class="actions-cell">';
            if (!client.is_archived) {
                html += '<button class="btn btn-secondary btn-sm" data-action="editClient" data-param="' + client.id + '">تعديل</button>';
                html += '<button class="btn btn-warning btn-sm" data-action="archiveClient" data-param="' + client.id + '">أرشفة</button>';
            } else {
                html += '<button class="btn btn-info btn-sm" data-action="unarchiveClient" data-param="' + client.id + '">إلغاء أرشفة</button>';
            }
            html += '</td>';
        }
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    
    container.innerHTML = html;
}


// ============================================================
// 5. CLIENT FILE (ملف العميل الشامل)
// ============================================================

/**
 * فتح ملف العميل الشامل
 * يُستدعى من data-action="openClientFile"
 */
async function openClientFile(clientId) {
    debug('📂 فتح ملف العميل: ' + clientId, 'info');
    
    if (!isSupabaseReady()) return;
    
    CLIENTS_STATE.currentFileId = clientId;
    
    showLoading();
    
    try {
        // تحميل البيانات بالتوازي (Promise.all)
        var results = await Promise.all([
            runQuery(
                function() {
                    return APP.supabase
                        .from('clients')
                        .select('*')
                        .eq('id', clientId)
                        .single();
                },
                { context: 'openClientFile-client', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('operations')
                        .select('id, name, type, status, amount, final_profit, profit_approval_date, start_date, end_date, created_at, is_locked')
                        .eq('client_id', clientId)
                        .order('created_at', { ascending: false });
                },
                { context: 'openClientFile-ops', throwError: true }
            )
        ]);
        
        var client = results[0].data;
        var operations = results[1].data || [];
        
        if (!client) {
            showToast('العميل غير موجود', 'error');
            return;
        }
        
        // تحميل التحويلات الخاصة بعمليات العميل فقط
        var opsIds = operations.map(function(op) { return op.id; });
        
        var transfers = [];
        var operationInvestors = [];
        var investors = [];
        
        if (opsIds.length > 0) {
            var relatedResults = await Promise.all([
                runQuery(
                    function() {
                        return APP.supabase
                            .from('transfers')
                            .select('id, reference_number, type, purpose, operation_id, investor_id, amount, transfer_date, notes, created_at')
                            .in('operation_id', opsIds);
                    },
                    { context: 'openClientFile-trans', throwError: true }
                ),
                runQuery(
                    function() {
                        return APP.supabase
                            .from('operation_investors')
                            .select('id, operation_id, investor_id, contribution, profit')
                            .in('operation_id', opsIds);
                    },
                    { context: 'openClientFile-opInv', throwError: true }
                ),
                runQuery(
                    function() {
                        return APP.supabase
                            .from('investors')
                            .select('id, name');
                    },
                    { context: 'openClientFile-inv', throwError: true }
                )
            ]);
            
            transfers = relatedResults[0].data || [];
            operationInvestors = relatedResults[1].data || [];
            investors = relatedResults[2].data || [];
        }
        
        // بناء Indexes
        var indexes = buildClientsFileIndexes(operations, transfers, operationInvestors, investors);
        
        var data = {
            operations: operations,
            transfers: transfers,
            operationInvestors: operationInvestors,
            investors: investors,
            indexes: indexes
        };
        
        // حساب الملخص باستخدام الدالة المشتركة
        var summary = calculateClientSummary(clientId, data);
        
        // تغيير الشاشة إذا لزم الأمر (بدون تحميل مكرر)
        if (APP.currentScreen !== 'clients') {
            APP.currentScreen = 'clients';
            var screens = document.querySelectorAll('.screen');
            for (var i = 0; i < screens.length; i++) {
                screens[i].classList.remove('active');
            }
            var clientsScreen = document.getElementById('clients');
            if (clientsScreen) clientsScreen.classList.add('active');
            
            var navBtns = document.querySelectorAll('.nav-btn');
            for (var i = 0; i < navBtns.length; i++) {
                navBtns[i].classList.remove('active');
            }
            var clientsBtn = document.querySelector('.nav-btn[data-screen="clients"]');
            if (clientsBtn) clientsBtn.classList.add('active');
        }
        
        // عرض الملف
        renderClientFile(client, summary, data);
        
    } catch (err) {
        debug('❌ خطأ في openClientFile: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'فتح ملف العميل'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * بناء Indexes لملف العميل
 * Indexes الضرورية فقط (بدون operationsById غير المستخدم)
 */
function buildClientsFileIndexes(operations, transfers, operationInvestors, investors) {
    var transfersByOperation = {};
    var opInvestorsByOperation = {};
    var investorsById = {};
    var clientOperations = {};
    
    // Index العمليات حسب العميل (جميعها تخص نفس العميل)
    operations.forEach(function(op) {
        if (!clientOperations[op.client_id]) {
            clientOperations[op.client_id] = [];
        }
        clientOperations[op.client_id].push(op);
    });
    
    // Index التحويلات حسب العملية
    transfers.forEach(function(t) {
        if (t.operation_id) {
            if (!transfersByOperation[t.operation_id]) {
                transfersByOperation[t.operation_id] = [];
            }
            transfersByOperation[t.operation_id].push(t);
        }
    });
    
    // Index مساهمات الممولين حسب العملية
    operationInvestors.forEach(function(oi) {
        if (!opInvestorsByOperation[oi.operation_id]) {
            opInvestorsByOperation[oi.operation_id] = [];
        }
        opInvestorsByOperation[oi.operation_id].push(oi);
    });
    
    // Index الممولين
    investors.forEach(function(inv) {
        investorsById[inv.id] = inv;
    });
    
    return {
        transfersByOperation: transfersByOperation,
        opInvestorsByOperation: opInvestorsByOperation,
        investorsById: investorsById,
        clientOperations: clientOperations
    };
}


// ============================================================
// 6. RENDER CLIENT FILE (مقسّم إلى دوال صغيرة)
// ============================================================

function renderClientFile(client, summary, data) {
    var container = document.getElementById('clientsTable');
    if (!container) return;
    
    var html = '';
    html += renderClientHeader(client);
    html += renderClientSummaryCard(summary);
    html += renderClientTabs();
    html += '<div id="clientTabOperations" class="tab-content active">';
    html += renderClientOperations(client.id, data);
    html += '</div>';
    html += '<div id="clientTabStatement" class="tab-content">';
    html += renderClientStatement(client.id, data);
    html += '</div>';
    
    container.innerHTML = html;
}

/**
 * Header ملف العميل
 */
function renderClientHeader(client) {
    var html = '<div class="client-file-header">';
    
    html += '<div class="client-header-actions">';
    html += '<button class="btn btn-secondary" data-action="backToClientsList">← رجوع للقائمة</button>';
    if (canEdit() && !client.is_archived) {
        html += '<div class="client-header-buttons">';
        html += '<button class="btn btn-secondary" data-action="editClient" data-param="' + client.id + '">✏️ تعديل</button>';
        html += '<button class="btn btn-warning" data-action="archiveClient" data-param="' + client.id + '">📁 أرشفة</button>';
        html += '</div>';
    }
    html += '</div>';
    
    html += '<h2 class="client-header-name">' + escapeHtml(client.name) + '</h2>';
    
    html += '<div class="client-header-info">';
    html += '<span>' + escapeHtml(client.reference_number || '-') + '</span>';
    if (client.phone) html += ' <span class="info-separator">|</span> 📞 ' + escapeHtml(client.phone);
    if (client.email) html += ' <span class="info-separator">|</span> 📧 ' + escapeHtml(client.email);
    html += '</div>';
    
    if (client.address) {
        html += '<div class="client-header-info">📍 ' + escapeHtml(client.address) + '</div>';
    }
    if (client.notes) {
        html += '<div class="client-header-info client-header-notes">📝 ' + escapeHtml(client.notes) + '</div>';
    }
    
    html += '</div>';
    
    return html;
}

/**
 * بطاقة الملخص المالي
 */
function renderClientSummaryCard(summary) {
    var html = '<div class="client-summary-card">';
    html += '<h3 class="summary-title">📊 الملخص المالي</h3>';
    
    html += '<div class="op-summary-grid">';
    
    html += renderSummaryItem('عدد العمليات', summary.totalOperations, '');
    html += renderSummaryItem('العمليات النشطة', summary.activeOperations, 'blue');
    html += renderSummaryItem('العمليات المنتهية', summary.completedOperations, 'green');
    html += renderSummaryItem('إجمالي التمويلات', formatMoney(summary.totalFunded), '');
    html += renderSummaryItem('إجمالي المدفوع', formatMoney(summary.totalRepaid), 'green');
    html += renderSummaryItem('الرصيد الحالي', formatMoney(summary.balance), summary.balance >= 0 ? 'green' : 'red');
    
    if (canViewProfits()) {
        html += renderSummaryItem('الأرباح المعتمدة', formatMoney(summary.totalApprovedProfit), 'blue');
    }
    
    if (summary.lastOperation) {
        html += '<div class="summary-item">';
        html += '<label>آخر عملية</label>';
        html += '<div class="val"><a href="#" data-action="openOperationDetails" data-param="' + summary.lastOperation.id + '">' + escapeHtml(summary.lastOperation.name) + '</a></div>';
        html += '</div>';
    }
    
    html += '</div>';
    html += '</div>';
    
    return html;
}

/**
 * عنصر ملخص صغير
 */
function renderSummaryItem(label, value, colorClass) {
    return '<div class="summary-item">' +
           '<label>' + escapeHtml(label) + '</label>' +
           '<div class="val ' + (colorClass || '') + '">' + value + '</div>' +
           '</div>';
}

/**
 * تبويبات ملف العميل
 */
function renderClientTabs() {
    var html = '<div class="tabs">';
    html += '<button class="tab active" data-action="switchClientTab" data-tab="operations">العمليات</button>';
    html += '<button class="tab" data-action="switchClientTab" data-tab="statement">كشف الحساب</button>';
    html += '</div>';
    return html;
}

/**
 * جدول العمليات
 */
function renderClientOperations(clientId, data) {
    var ops = data.indexes.clientOperations[clientId] || [];
    
    if (ops.length === 0) {
        return '<div class="empty-state">لا توجد عمليات</div>';
    }
    
    var html = '<div class="table-scroll"><table>';
    html += '<thead><tr>';
    html += '<th>الرقم</th>';
    html += '<th>الاسم</th>';
    html += '<th>النوع</th>';
    html += '<th>البداية</th>';
    html += '<th>النهاية</th>';
    html += '<th>الحالة</th>';
    html += '<th>التمويل</th>';
    html += '<th class="profit-field">الربح</th>';
    html += '<th>القفل</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    ops.forEach(function(op) {
        var statusBadge = '<span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span>';
        var lockIcon = op.is_locked ? '🔒' : '🔓';
        
        html += '<tr>';
        html += '<td><a href="#" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.reference_number || '-') + '</a></td>';
        html += '<td>' + escapeHtml(op.name) + '</td>';
        html += '<td>' + getOperationTypeText(op.type) + '</td>';
        html += '<td>' + formatDate(op.start_date) + '</td>';
        html += '<td>' + formatDate(op.end_date) + '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '<td>' + formatMoney(op.amount) + '</td>';
        html += '<td class="profit-field">' + (canViewProfits() ? formatMoney(op.final_profit) : '<span class="hidden-profit">****</span>') + '</td>';
        html += '<td>' + lockIcon + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table></div>';
    
    return html;
}


// ============================================================
// 7. CLIENT STATEMENT (مفصول build/render)
// ============================================================

/**
 * بناء بيانات كشف الحساب
 * يُستخدم في: renderClientStatement + تصدير PDF/Excel مستقبلاً
 */
function buildClientStatement(clientId, data) {
    var ops = data.indexes.clientOperations[clientId] || [];
    
    if (ops.length === 0) {
        return [];
    }
    
    // جمع تحويلات عمليات العميل
    var clientTransfers = [];
    ops.forEach(function(op) {
        var opTransfers = data.indexes.transfersByOperation[op.id] || [];
        opTransfers.forEach(function(t) {
            clientTransfers.push(t);
        });
    });
    
    if (clientTransfers.length === 0) {
        return [];
    }
    
    // بناء Indexes للعملیات (مطلوب لـ buildStatement)
    var opsById = {};
    ops.forEach(function(op) { opsById[op.id] = op; });
    
    var indexes = {
        operationsById: opsById,
        investorsById: data.indexes.investorsById || {}
    };
    
    // استخدام الدالة المشتركة
    return buildStatement(clientTransfers, indexes, 'client');
}

/**
 * عرض كشف الحساب
 */
function renderClientStatement(clientId, data) {
    var statement = buildClientStatement(clientId, data);
    
    if (statement.length === 0) {
        return '<div class="empty-state">لا توجد حركات مالية</div>';
    }
    
    var html = '<div class="table-scroll"><table>';
    html += '<thead><tr>';
    html += '<th>التاريخ</th>';
    html += '<th>الرقم</th>';
    html += '<th>النوع</th>';
    html += '<th>الغرض</th>';
    html += '<th>العملية</th>';
    html += '<th>مدين (-)</th>';
    html += '<th>دائن (+)</th>';
    html += '<th>الرصيد</th>';
    html += '<th>ملاحظات</th>';
    html += '</tr></thead>';
    html += '<tbody>';
    
    statement.forEach(function(item) {
        var amountDebit = item.isCredit ? '-' : formatMoney(item.amount);
        var amountCredit = item.isCredit ? formatMoney(item.amount) : '-';
        var balanceClass = item.runningBalance >= 0 ? 'green' : 'red';
        
        html += '<tr>';
        html += '<td>' + formatDate(item.date) + '</td>';
        html += '<td>' + escapeHtml(item.reference) + '</td>';
        html += '<td>' + escapeHtml(item.type) + '</td>';
        html += '<td>' + escapeHtml(item.purpose) + '</td>';
        
        if (item.operationId) {
            html += '<td><a href="#" data-action="openOperationDetails" data-param="' + item.operationId + '">' + escapeHtml(item.operation) + '</a></td>';
        } else {
            html += '<td>' + escapeHtml(item.operation) + '</td>';
        }
        
        html += '<td class="amount-debit">' + amountDebit + '</td>';
        html += '<td class="amount-credit">' + amountCredit + '</td>';
        html += '<td class="balance-' + balanceClass + '">' + formatMoney(item.runningBalance) + '</td>';
        html += '<td>' + escapeHtml(truncateText(item.notes, 30)) + '</td>';
        html += '</tr>';
    });
    
    html += '</tbody></table></div>';
    
    return html;
}


// ============================================================
// 8. CLIENT MODAL
// ============================================================

async function openClientModal(clientId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var titleEl = document.getElementById('clientModalTitle');
    var idEl = document.getElementById('clientId');
    var nameEl = document.getElementById('clientName');
    var phoneEl = document.getElementById('clientPhone');
    var emailEl = document.getElementById('clientEmail');
    var addressEl = document.getElementById('clientAddress');
    var notesEl = document.getElementById('clientNotes');
    
    if (!titleEl || !idEl) {
        debug('⚠️ عناصر Modal غير موجودة', 'warning');
        return;
    }
    
    if (clientId) {
        try {
            var result = await runQuery(
                function() {
                    return APP.supabase
                        .from('clients')
                        .select('*')
                        .eq('id', clientId)
                        .single();
                },
                { context: 'openClientModal', throwError: true }
            );
            
            var client = result.data;
            if (!client) {
                showToast('العميل غير موجود', 'error');
                return;
            }
            
            titleEl.textContent = 'تعديل عميل';
            idEl.value = client.id;
            CLIENTS_STATE.editingId = client.id;
            nameEl.value = client.name || '';
            phoneEl.value = client.phone || '';
            emailEl.value = client.email || '';
            addressEl.value = client.address || '';
            notesEl.value = client.notes || '';
            
        } catch (err) {
            debug('❌ خطأ في openClientModal: ' + err.message, 'error');
            showToast(handleSupabaseError(err, 'فتح بيانات العميل'), 'error');
            return;
        }
    } else {
        titleEl.textContent = 'إضافة عميل';
        idEl.value = '';
        CLIENTS_STATE.editingId = null;
        nameEl.value = '';
        phoneEl.value = '';
        emailEl.value = '';
        addressEl.value = '';
        notesEl.value = '';
    }
    
    openModal('clientModal');
}

async function saveClient() {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    var id = document.getElementById('clientId').value || CLIENTS_STATE.editingId || null;
    var name = document.getElementById('clientName').value.trim();
    var phone = document.getElementById('clientPhone').value.trim();
    var email = document.getElementById('clientEmail').value.trim();
    var address = document.getElementById('clientAddress').value.trim();
    var notes = document.getElementById('clientNotes').value.trim();
    
    if (isEmpty(name)) {
        showToast('❌ الاسم مطلوب', 'error');
        return;
    }
    
    if (email && !isEmail(email)) {
        showToast('❌ صيغة البريد غير صحيحة', 'error');
        return;
    }
    
    var data = {
        name: name,
        phone: phone || null,
        email: email || null,
        address: address || null,
        notes: notes || null
    };
    
    showLoading();
    
    try {
        if (id) {
            var oldResult = await runQuery(
                function() {
                    return APP.supabase.from('clients').select('*').eq('id', id).single();
                },
                { context: 'saveClient-getOld', throwError: true }
            );
            
            await runQuery(
                function() {
                    return APP.supabase.from('clients').update(data).eq('id', id);
                },
                { context: 'saveClient-update', throwError: true }
            );
            
            if (typeof window.logActivityToDB === 'function') {
                window.logActivityToDB(
                    'تعديل عميل', 'client', id,
                    JSON.stringify(oldResult.data), JSON.stringify(data),
                    'Name: ' + data.name, 'update'
                );
            }
            
            debug('✅ تم تحديث العميل', 'success');
            showToast('تم تحديث العميل', 'success');
            
        } else {
            var result = await runQuery(
                function() {
                    return APP.supabase.from('clients').insert(data).select();
                },
                { context: 'saveClient-insert', throwError: true }
            );
            
            if (result.data && result.data[0]) {
                if (typeof window.logActivityToDB === 'function') {
                    window.logActivityToDB(
                        'إضافة عميل', 'client', result.data[0].id,
                        null, JSON.stringify(data),
                        'Name: ' + data.name + ', Ref: ' + (result.data[0].reference_number || ''),
                        'create'
                    );
                }
                
                debug('✅ تم إضافة العميل', 'success');
                showToast('تم إضافة العميل', 'success');
            }
        }
        
        closeModal('clientModal');
        
        if (CLIENTS_STATE.currentFileId && id === CLIENTS_STATE.currentFileId) {
            openClientFile(id);
        } else {
            loadClients();
        }
        
    } catch (err) {
        debug('❌ خطأ في saveClient: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'حفظ العميل'), 'error');
    } finally {
        hideLoading();
    }
}


// ============================================================
// 9. ARCHIVE / UNARCHIVE
// ============================================================

async function archiveClient(clientId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    if (!isSupabaseReady()) return;
    
    showLoading();
    
    try {
        // تحميل اسم العميل + التحقق من العمليات بالتوازي
        var results = await Promise.all([
            runQuery(
                function() {
                    return APP.supabase.from('clients').select('name').eq('id', clientId).single();
                },
                { context: 'archiveClient-getName', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('operations')
                        .select('id, status')
                        .eq('client_id', clientId)
                        .in('status', [STATUS.DRAFT, STATUS.ACTIVE]);
                },
                { context: 'archiveClient-checkOps', throwError: true }
            )
        ]);
        
        var clientName = results[0].data ? results[0].data.name : '';
        var activeOps = results[1].data || [];
        
        if (activeOps.length > 0) {
            showToast('❌ لا يمكن الأرشفة - العميل لديه ' + activeOps.length + ' عملية نشطة/مسودة', 'error');
            return;
        }
        
        // التحقق من الرصيد
        var data = await loadClientsFileData(clientId);
        var summary = calculateClientSummary(clientId, data);
        
        if (Math.abs(summary.balance) > 0.01) {
            showToast('❌ لا يمكن الأرشفة - العميل لديه رصيد غير مصفى: ' + formatMoney(summary.balance), 'error');
            return;
        }
        
        if (!confirmArchive(clientName)) {
            return;
        }
        
        await runQuery(
            function() {
                return APP.supabase.from('clients').update({ is_archived: true }).eq('id', clientId);
            },
            { context: 'archiveClient-update', throwError: true }
        );
        
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                'أرشفة عميل', 'client', clientId,
                'نشط', 'أرشيف', 'Name: ' + clientName, 'archive'
            );
        }
        
        debug('✅ تم أرشفة العميل', 'success');
        showToast('تمت الأرشفة', 'success');
        
        if (CLIENTS_STATE.currentFileId === clientId) {
            CLIENTS_STATE.currentFileId = null;
        }
        loadClients();
        
    } catch (err) {
        debug('❌ خطأ في archiveClient: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'أرشفة العميل'), 'error');
    } finally {
        hideLoading();
    }
}

async function unarchiveClient(clientId) {
    if (!canEdit()) {
        showToast('❌ لا توجد صلاحية', 'error');
        return;
    }
    
    if (!isSupabaseReady()) return;
    
    showLoading();
    
    try {
        var clientResult = await runQuery(
            function() {
                return APP.supabase.from('clients').select('name').eq('id', clientId).single();
            },
            { context: 'unarchiveClient-getName', throwError: true }
        );
        
        var clientName = clientResult.data ? clientResult.data.name : '';
        
        if (!confirmUnarchive(clientName)) {
            return;
        }
        
        await runQuery(
            function() {
                return APP.supabase.from('clients').update({ is_archived: false }).eq('id', clientId);
            },
            { context: 'unarchiveClient-update', throwError: true }
        );
        
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                'إلغاء أرشفة عميل', 'client', clientId,
                'أرشيف', 'نشط', 'Name: ' + clientName, 'unarchive'
            );
        }
        
        debug('✅ تم إلغاء الأرشفة', 'success');
        showToast('تم إلغاء الأرشفة', 'success');
        
        loadClients();
        
    } catch (err) {
        debug('❌ خطأ في unarchiveClient: ' + err.message, 'error');
        showToast(handleSupabaseError(err, 'إلغاء الأرشفة'), 'error');
    } finally {
        hideLoading();
    }
}

/**
 * تحميل البيانات المطلوبة لملف العميل (للاستخدام الداخلي)
 */
async function loadClientsFileData(clientId) {
    var opsResult = await runQuery(
        function() {
            return APP.supabase
                .from('operations')
                .select('id, name, type, status, amount, final_profit, profit_approval_date, start_date, end_date, created_at, is_locked')
                .eq('client_id', clientId)
                .order('created_at', { ascending: false });
        },
        { context: 'loadClientsFileData-ops', throwError: true }
    );
    
    var operations = opsResult.data || [];
    var opsIds = operations.map(function(op) { return op.id; });
    
    var transfers = [];
    var operationInvestors = [];
    var investors = [];
    
    if (opsIds.length > 0) {
        var relatedResults = await Promise.all([
            runQuery(
                function() {
                    return APP.supabase
                        .from('transfers')
                        .select('id, reference_number, type, purpose, operation_id, investor_id, amount, transfer_date, notes, created_at')
                        .in('operation_id', opsIds);
                },
                { context: 'loadClientsFileData-trans', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase
                        .from('operation_investors')
                        .select('id, operation_id, investor_id, contribution, profit')
                        .in('operation_id', opsIds);
                },
                { context: 'loadClientsFileData-opInv', throwError: true }
            ),
            runQuery(
                function() {
                    return APP.supabase.from('investors').select('id, name');
                },
                { context: 'loadClientsFileData-inv', throwError: true }
            )
        ]);
        
        transfers = relatedResults[0].data || [];
        operationInvestors = relatedResults[1].data || [];
        investors = relatedResults[2].data || [];
    }
    
    var indexes = buildClientsFileIndexes(operations, transfers, operationInvestors, investors);
    
    return {
        operations: operations,
        transfers: transfers,
        operationInvestors: operationInvestors,
        investors: investors,
        indexes: indexes
    };
}


// ============================================================
// 10. SEARCH & FILTER
// ============================================================

function searchClients(searchTerm) {
    CLIENTS_STATE.search = searchTerm;
    loadClients();
}

function filterClients(filterValue) {
    CLIENTS_STATE.filter = filterValue;
    loadClients();
}


// ============================================================
// 11. NAVIGATION HELPERS
// ============================================================

function backToClientsList() {
    CLIENTS_STATE.currentFileId = null;
    loadClients();
}

function switchClientTab(tabName, btn) {
    var tabs = document.querySelectorAll('#clientsTable .tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.remove('active');
    }
    
    var contents = document.querySelectorAll('#clientsTable .tab-content');
    for (var i = 0; i < contents.length; i++) {
        contents[i].classList.remove('active');
    }
    
    if (btn) btn.classList.add('active');
    
    var contentId = 'clientTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    var content = document.getElementById(contentId);
    if (content) content.classList.add('active');
    
    debug('📑 تبديل تبويب العميل: ' + tabName, 'info');
}

function editClient(clientId) { openClientModal(clientId); }
// ============================================================
// END OF CLIENTS.JS
// ============================================================
