// ============================================================
// نظام إدارة التمويل - Dashboard Module
// Version: 2.0.4
// Last Updated: 2026-08-15
// ============================================================
// v2.0.4: توحيد "تنتهي قريبًا" على 5 أيام + myAccount → navigateToEntity
// v2.0.3: تغيير عتبة تنبيه "تستحق قريبًا" إلى 5 أيام (DUE_SOON_DAYS)
// v2.0.2: إضافة bootstrap لتحميل شاشة الشركة (company.js + company.css)
// v2.0.1: استخدام getOperationClientFlows بدل op.amount لرأس المال المستحق
// ============================================================

// عتبة تنبيه "تستحق قريبًا" — عدد الأيام قبل تاريخ الاستحقاق التي يظهر عندها التنبيه
var DUE_SOON_DAYS = 5;

function initDashboard() {
    debug('📊 بدء تهيئة dashboard.js', 'info');
    registerScreenLoader('dashboard', loadDashboard);
    debug('✅ dashboard.js جاهز', 'success');
}

async function loadDashboard() {
    debug('📊 بدأ loadDashboard', 'info');
    if (!isSupabaseReady()) { debug('❌ Supabase غير جاهز', 'error'); return; }
    showLoading();
    try {
        if (isClient()) { await loadDashboardForClient(); }
        else if (isInvestor()) { await loadDashboardForInvestor(); }
        else if (isViewer() && !isAdmin()) { await loadDashboardForViewer(); }
        else { await loadDashboardForAdmin(); }
        debug('✅ loadDashboard اكتمل', 'success');
    } catch (err) {
        debug('❌ خطأ في loadDashboard: ' + err.message, 'error');
    } finally {
        hideLoading();
        setTimeout(function() {
            var overlay = document.getElementById('loadingOverlay');
            if (overlay) { overlay.style.display = 'none'; overlay.style.visibility = 'hidden'; overlay.style.opacity = '0'; }
        }, 2000);
    }
}

async function loadDashboardData() {
    debug('📥 تحميل بيانات Dashboard...', 'info');
    var opsResult = await runQuery(function() {
        return APP.supabase.from('operations').select('id, name, status, amount, client_id, end_date, start_date, final_profit, expected_profit, profit_approval_date, is_archived, company_profit_type, company_profit_value, reference_number');
    }, { context: 'loadDashboardData-ops', throwError: true });
    var opInvResult = await runQuery(function() {
        return APP.supabase.from('operation_investors').select('id, operation_id, investor_id, contribution, profit');
    }, { context: 'loadDashboardData-opInv', throwError: true });
    var transResult = await runQuery(function() {
        return APP.supabase.from('transfers').select('id, type, operation_id, investor_id, client_id, purpose, amount, transfer_date, reference_number, notes');
    }, { context: 'loadDashboardData-trans', throwError: true });
    var invResult = await runQuery(function() {
        return APP.supabase.from('investors').select('id, name, is_archived');
    }, { context: 'loadDashboardData-inv', throwError: true });
    var clientsResult = await runQuery(function() {
        return APP.supabase.from('clients').select('id, name, is_archived');
    }, { context: 'loadDashboardData-clients', throwError: true });

    var operations = opsResult.data || [];
    var operationInvestors = opInvResult.data || [];
    var transfers = transResult.data || [];
    var investors = invResult.data || [];
    var clients = clientsResult.data || [];

    var indexes = buildDashboardIndexes(operations, operationInvestors, transfers, investors, clients);

    return { operations: operations, operationInvestors: operationInvestors, transfers: transfers, investors: investors, clients: clients, indexes: indexes };
}

function buildDashboardIndexes(operations, operationInvestors, transfers, investors, clients) {
    var operationsById = {}, clientsById = {}, investorsById = {};
    var clientOperations = {}, transfersByOperation = {}, transfersByInvestor = {};
    var opInvestorsByOperation = {}, opInvestorsByInvestor = {};

    operations.forEach(function(op) {
        operationsById[op.id] = op;
        if (op.client_id) {
            if (!clientOperations[op.client_id]) clientOperations[op.client_id] = [];
            clientOperations[op.client_id].push(op);
        }
    });

    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(inv) { investorsById[inv.id] = inv; });

    operationInvestors.forEach(function(oi) {
        if (!opInvestorsByOperation[oi.operation_id]) opInvestorsByOperation[oi.operation_id] = [];
        opInvestorsByOperation[oi.operation_id].push(oi);
        if (!opInvestorsByInvestor[oi.investor_id]) opInvestorsByInvestor[oi.investor_id] = [];
        opInvestorsByInvestor[oi.investor_id].push(oi);
    });

    transfers.forEach(function(t) {
        if (t.operation_id) {
            if (!transfersByOperation[t.operation_id]) transfersByOperation[t.operation_id] = [];
            transfersByOperation[t.operation_id].push(t);
        }
        if (t.investor_id) {
            if (!transfersByInvestor[t.investor_id]) transfersByInvestor[t.investor_id] = [];
            transfersByInvestor[t.investor_id].push(t);
        }
    });

    return { operationsById: operationsById, clientsById: clientsById, investorsById: investorsById, clientOperations: clientOperations, transfersByOperation: transfersByOperation, transfersByInvestor: transfersByInvestor, opInvestorsByOperation: opInvestorsByOperation, opInvestorsByInvestor: opInvestorsByInvestor };
}

function renderStatCard(title, value, colorClass, options) {
    options = options || {};
    var clickAttr = '';
    if (options.action === 'showScreen') clickAttr = ' data-action="showScreen" data-screen="' + options.screen + '" style="cursor: pointer;"';
    else if (options.action === 'navigateToEntity') clickAttr = ' data-action="navigateToEntity" data-entity-type="' + options.entityType + '" data-entity-id="' + options.entityId + '" style="cursor: pointer;"';
    var extraClass = options.profitField ? ' profit-field' : '';
    return '<div class="stat-card' + extraClass + '"' + clickAttr + '><h3>' + escapeHtml(title) + '</h3><div class="value ' + (colorClass || '') + '">' + value + '</div></div>';
}

function renderAlert(alert) {
    var clickAttr = '';
    if (alert.action === 'showScreen') clickAttr = ' data-action="showScreen" data-screen="' + alert.screen + '" style="cursor: pointer;"';
    else if (alert.action === 'navigateToEntity') clickAttr = ' data-action="navigateToEntity" data-entity-type="' + alert.entityType + '" data-entity-id="' + alert.entityId + '" style="cursor: pointer;"';
    return '<div class="alert-box ' + (alert.type || 'info') + '"' + clickAttr + '>' + alert.icon + ' ' + escapeHtml(alert.message) + '</div>';
}

function renderActionCard(action) {
    var clickAttr = '';
    if (action.action === 'showScreen') clickAttr = ' data-action="showScreen" data-screen="' + action.screen + '" style="cursor: pointer;"';
    else if (action.action === 'navigateToEntity') clickAttr = ' data-action="navigateToEntity" data-entity-type="' + action.entityType + '" data-entity-id="' + action.entityId + '" style="cursor: pointer;"';
    return '<div class="alert-box ' + (action.type || 'info') + '"' + clickAttr + '>' + action.icon + ' ' + escapeHtml(action.message) + ' <span style="float: left; font-weight: bold;">→</span></div>';
}

function renderWelcome(name, subtitle) {
    return '<div style="background: white; padding: 20px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);"><h2 style="margin-bottom: 10px;">مرحباً، ' + escapeHtml(name) + '</h2><p style="color: #666;">' + escapeHtml(subtitle) + '</p></div>';
}

function renderSection(title, icon, borderColor, content) {
    if (!content || content === '') return '';
    return '<div style="background: white; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-right: 4px solid ' + borderColor + ';"><h3 style="margin-bottom: 12px; color: #333;">' + icon + ' ' + escapeHtml(title) + '</h3>' + content + '</div>';
}

async function loadDashboardForAdmin() {
    debug('👔 تحميل Dashboard للإدارة', 'info');
    var alertsContainer = document.getElementById('dashboardAlerts');
    var statsContainer = document.getElementById('dashboardStats');
    if (!alertsContainer || !statsContainer) { debug('⚠️ حاويات Dashboard غير موجودة', 'warning'); return; }
    var data = await loadDashboardData();
    var html = '';
    html += renderDashboardActions(data);
    html += renderDashboardAlerts(data);
    alertsContainer.innerHTML = html;
    statsContainer.innerHTML = renderDashboardStats(data);
}

async function loadDashboardForViewer() { await loadDashboardForAdmin(); }

async function loadDashboardForClient() {
    debug('👤 تحميل Dashboard للعميل', 'info');
    var alertsContainer = document.getElementById('dashboardAlerts');
    var statsContainer = document.getElementById('dashboardStats');
    if (!alertsContainer || !statsContainer || !APP.currentEntityId) return;
    try {
        var clientResult = await runQuery(function() { return APP.supabase.from('clients').select('id, name, email, phone').eq('id', APP.currentEntityId).single(); }, { context: 'loadDashboardClient', throwError: true });
        var client = clientResult.data;
        var data = await loadDashboardData();
        var summary = calculateClientSummary(APP.currentEntityId, data);
        var alerts = [];
        // ✅ v2.0.4: myAccount → navigateToEntity (client)
        if (summary.balance > 0) alerts.push({ type: 'info', icon: '💵', message: 'لديك رصيد غير مستخدم بقيمة ' + formatMoney(summary.balance), action: 'navigateToEntity', entityType: 'client', entityId: APP.currentEntityId });
        var ops = data.indexes.clientOperations[APP.currentEntityId] || [];
        ops.forEach(function(op) {
            // ✅ v2.0.4: توحيد على DUE_SOON_DAYS (5 أيام)
            if (op.status === STATUS.ACTIVE && op.end_date && isDateWithinDays(op.end_date, DUE_SOON_DAYS)) {
                alerts.push({ type: 'warning', icon: '⏰', message: 'عملية "' + op.name + '" ستنتهي قريباً (' + formatDate(op.end_date) + ')', action: 'navigateToEntity', entityType: 'operation', entityId: op.id });
            }
        });
        var html = renderWelcome(client.name, 'هذه لوحة التحكم الخاصة بك');
        if (alerts.length > 0) { var a = ''; alerts.forEach(function(x) { a += renderAlert(x); }); html += a; }
        alertsContainer.innerHTML = html;
        var s = '';
        s += renderStatCard('إجمالي التمويلات', formatMoney(summary.totalFunded), '');
        s += renderStatCard('إجمالي المدفوع', formatMoney(summary.totalRepaid), 'green');
        s += renderStatCard('الرصيد الحالي', formatMoney(summary.balance), summary.balance >= 0 ? 'green' : 'red');
        s += renderStatCard('عمليات نشطة', summary.activeOperations, 'blue');
        s += renderStatCard('عمليات منتهية', summary.completedOperations, '');
        s += renderStatCard('مسودات', summary.draftOperations, '');
        statsContainer.innerHTML = s;
    } catch (err) {
        debug('❌ خطأ في loadDashboardForClient: ' + err.message, 'error');
        alertsContainer.innerHTML = '<div class="error-box">حدث خطأ في تحميل البيانات</div>';
    }
}

async function loadDashboardForInvestor() {
    debug('💼 تحميل Dashboard للممول', 'info');
    var alertsContainer = document.getElementById('dashboardAlerts');
    var statsContainer = document.getElementById('dashboardStats');
    if (!alertsContainer || !statsContainer || !APP.currentEntityId) return;
    try {
        var invResult = await runQuery(function() { return APP.supabase.from('investors').select('id, name, email, phone').eq('id', APP.currentEntityId).single(); }, { context: 'loadDashboardInvestor', throwError: true });
        var investor = invResult.data;
        var data = await loadDashboardData();
        var summary = calculateInvestorSummary(APP.currentEntityId, data);
        var alerts = [];
        // ✅ v2.0.4: myAccount → navigateToEntity (investor)
        if (summary.outstandingProfit > 0 && canViewProfits()) alerts.push({ type: 'warning', icon: '💰', message: 'لديك أرباح مستحقة بقيمة ' + formatMoney(summary.outstandingProfit), action: 'navigateToEntity', entityType: 'investor', entityId: APP.currentEntityId });
        if (summary.capitalPending > 0) alerts.push({ type: 'info', icon: '', message: 'لديك رأس مال جاهز للإرجاع بقيمة ' + formatMoney(summary.capitalPending), action: 'navigateToEntity', entityType: 'investor', entityId: APP.currentEntityId });
        var html = renderWelcome(investor.name, 'هذه لوحة التحكم الخاصة بك');
        if (alerts.length > 0) { var a = ''; alerts.forEach(function(x) { a += renderAlert(x); }); html += a; }
        alertsContainer.innerHTML = html;
        var s = '';
        s += renderStatCard('رأس المال الكلي', formatMoney(summary.totalCapital), '');
        s += renderStatCard('المستثمر حالياً', formatMoney(summary.workingCapital), 'orange');
        s += renderStatCard('رأس المال المُرجع', formatMoney(summary.capitalReturned), 'green');
        s += renderStatCard('المتاح للإرجاع', formatMoney(summary.capitalPending), 'blue');
        if (canViewProfits()) {
            s += renderStatCard('الأرباح المستحقة', formatMoney(summary.outstandingProfit), 'green', { profitField: true });
            s += renderStatCard('الأرباح المصروفة', formatMoney(summary.profitPaid), '', { profitField: true });
        }
        s += renderStatCard('الرصيد الحالي', formatMoney(summary.currentBalance), summary.currentBalance >= 0 ? 'green' : 'red');
        s += renderStatCard('عمليات نشطة', summary.activeOperations, 'blue');
        s += renderStatCard('إجمالي المشاركات', summary.totalOperations, '');
        statsContainer.innerHTML = s;
    } catch (err) {
        debug('❌ خطأ في loadDashboardForInvestor: ' + err.message, 'error');
        alertsContainer.innerHTML = '<div class="error-box">حدث خطأ في تحميل البيانات</div>';
    }
}

function renderDashboardActions(data) {
    var actions = [];
    var draftOps = data.operations.filter(function(op) { return op.status === STATUS.DRAFT && !op.is_archived; });
    if (draftOps.length > 0) actions.push({ type: 'warning', icon: '📝', message: draftOps.length + ' عملية مسودة في انتظار التفعيل', action: 'showScreen', screen: 'operations' });

    var needsApproval = data.operations.filter(function(op) { return op.status === STATUS.ACTIVE && op.final_profit && op.final_profit > 0 && !op.profit_approval_date; });
    if (needsApproval.length > 0) actions.push({ type: 'warning', icon: '💰', message: needsApproval.length + ' عملية تحتاج اعتماد الربح', action: 'navigateToEntity', entityType: 'operation', entityId: needsApproval[0].id });

    var readyForProfitCount = 0, firstReadyOp = null;
    data.operations.forEach(function(op) {
        if (op.status !== STATUS.ACTIVE && op.status !== STATUS.COMPLETED) return;
        if (!op.profit_approval_date) return;
        var summary = calculateOperationSummary(op.id, data);
        if (summary && summary.remainingProfit > 0) { readyForProfitCount++; if (!firstReadyOp) firstReadyOp = op; }
    });
    if (readyForProfitCount > 0) actions.push({ type: 'info', icon: '📊', message: readyForProfitCount + ' عملية بها أرباح جاهزة للصرف', action: 'navigateToEntity', entityType: 'operation', entityId: firstReadyOp.id });

    var readyForReturnCount = 0, firstReturnOp = null;
    data.operations.forEach(function(op) {
        if (op.status !== STATUS.COMPLETED) return;
        var summary = calculateOperationSummary(op.id, data);
        if (summary && (summary.totalInvested - summary.capitalReturned) > 0) { readyForReturnCount++; if (!firstReturnOp) firstReturnOp = op; }
    });
    if (readyForReturnCount > 0) actions.push({ type: 'info', icon: '🏦', message: readyForReturnCount + ' عملية بها رأس مال جاهز للإرجاع', action: 'navigateToEntity', entityType: 'operation', entityId: firstReturnOp.id });

    var clientsWithBalance = [];
    data.clients.forEach(function(client) {
        if (client.is_archived) return;
        var summary = calculateClientSummary(client.id, data);
        if (summary.balance > 100000) clientsWithBalance.push({ client: client, balance: summary.balance });
    });
    if (clientsWithBalance.length > 0) actions.push({ type: 'info', icon: '💵', message: clientsWithBalance.length + ' عميل لديهم رصيد كبير غير مستخدم', action: 'navigateToEntity', entityType: 'client', entityId: clientsWithBalance[0].client.id });

    if (actions.length === 0) return '<div style="background: #d4edda; color: #155724; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #c3e6cb;">✅ <strong>لا توجد إجراءات مطلوبة حالياً</strong> - كل شيء تحت السيطرة</div>';

    var h = '';
    actions.forEach(function(a) { h += renderActionCard(a); });
    return renderSection('إجراءات مطلوبة', '⚡', '#fd7e14', h);
}

function renderDashboardAlerts(data) {
    var alerts = [];
    var today = new Date().toISOString().split('T')[0];
    // ✅ v2.0.3: عتبة "تستحق قريبًا" = DUE_SOON_DAYS (5 أيام)
    var dueSoonDate = new Date(Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    data.operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE && op.end_date && op.end_date < today) alerts.push({ priority: 1, type: 'danger', icon: '🚨', message: 'عملية "' + op.name + '" متأخرة (كان يجب أن تنتهي ' + formatDate(op.end_date) + ')', action: 'navigateToEntity', entityType: 'operation', entityId: op.id });
    });

    data.operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE && op.end_date && op.end_date >= today && op.end_date <= dueSoonDate) alerts.push({ priority: 2, type: 'warning', icon: '⏰', message: 'عملية "' + op.name + '" ستنتهي قريباً (' + formatDate(op.end_date) + ')', action: 'navigateToEntity', entityType: 'operation', entityId: op.id });
    });

    data.investors.forEach(function(inv) {
        if (inv.is_archived) return;
        var summary = calculateInvestorSummary(inv.id, data);
        if (summary.outstandingProfit > 0) alerts.push({ priority: 3, type: 'warning', icon: '', message: 'الممول "' + inv.name + '" له أرباح مستحقة: ' + formatMoney(summary.outstandingProfit), action: 'navigateToEntity', entityType: 'investor', entityId: inv.id });
    });

    data.clients.forEach(function(client) {
        if (client.is_archived) return;
        var summary = calculateClientSummary(client.id, data);
        if (summary.balance > 0 && summary.balance <= 100000) alerts.push({ priority: 4, type: 'info', icon: '💵', message: 'العميل "' + client.name + '" لديه رصيد: ' + formatMoney(summary.balance), action: 'navigateToEntity', entityType: 'client', entityId: client.id });
    });

    if (alerts.length === 0) return '';
    alerts.sort(function(a, b) { return a.priority - b.priority; });
    var top = alerts.slice(0, 10);
    var h = '';
    top.forEach(function(a) { h += renderAlert(a); });
    if (alerts.length > 10) h += '<button class="btn btn-secondary btn-block" data-action="showScreen" data-screen="activityLog" style="margin-top: 10px;">عرض الكل (' + alerts.length + ') →</button>';
    return renderSection('تنبيهات (' + alerts.length + ')', '🔔', '#17a2b8', h);
}

function renderDashboardStats(data) {
    var today = new Date().toISOString().split('T')[0];
    // ✅ v2.0.4: توحيد على DUE_SOON_DAYS (5 أيام) بدل 30 يومًا
    var dueSoonDate = new Date(Date.now() + DUE_SOON_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    var totalActiveFunding = 0, endingSoon = 0, overdue = 0, completed = 0, draft = 0;
    var totalOutstandingInvestorProfit = 0, totalOutstandingCapital = 0;

    data.operations.forEach(function(op) {
        if (op.status === STATUS.ACTIVE) {
            totalActiveFunding += parseFloat(op.amount || 0);
            if (op.end_date && op.end_date <= dueSoonDate && op.end_date >= today) endingSoon++;
            if (op.end_date && op.end_date < today) overdue++;
            var summary = calculateOperationSummary(op.id, data);
            if (summary) {
                var flows = getOperationClientFlows(op.id, data);
                totalOutstandingCapital += Math.max(0, flows.clientFunded - flows.clientRepaid);
                totalOutstandingInvestorProfit += summary.remainingProfit;
            }
        }
        if (op.status === STATUS.COMPLETED) completed++;
        if (op.status === STATUS.DRAFT) draft++;
    });

    var activeClients = data.clients.filter(function(c) { return !c.is_archived; }).length;
    var activeInvestors = data.investors.filter(function(i) { return !i.is_archived; }).length;

    var html = '';
    html += renderStatCard('التمويل النشط', formatMoney(totalActiveFunding), 'blue', { action: 'showScreen', screen: 'operations' });
    html += renderStatCard('عمليات متأخرة', overdue, 'red', { action: 'showScreen', screen: 'operations' });
    html += renderStatCard('تنتهي قريباً', endingSoon, 'orange', { action: 'showScreen', screen: 'operations' });
    html += renderStatCard('عمليات مكتملة', completed, 'green', { action: 'showScreen', screen: 'operations' });
    html += renderStatCard('مسودات', draft, '', { action: 'showScreen', screen: 'operations' });
    html += renderStatCard('إجمالي العمليات', data.operations.length, '', { action: 'showScreen', screen: 'operations' });
    html += renderStatCard('العملاء', activeClients, '', { action: 'showScreen', screen: 'clients' });
    html += renderStatCard('الممولين', activeInvestors, '', { action: 'showScreen', screen: 'investors' });
    html += renderStatCard('رأس المال المستحق', formatMoney(totalOutstandingCapital), 'orange', { profitField: true });
    html += renderStatCard('أرباح مستحقة للممولين', formatMoney(totalOutstandingInvestorProfit), 'red', { profitField: true });
    return html;
}

// ============================================================
// ✅ v2.0.2 BOOTSTRAP: تحميل شاشة الشركة (CSS + JS) ديناميكيًا
// ============================================================
(function() {
    if (typeof document === 'undefined') return;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/company.css';
    document.head.appendChild(link);
    var s = document.createElement('script');
    s.src = 'js/company.js';
    s.onload = function() { if (typeof window.initCompany === 'function') window.initCompany(); };
    document.body.appendChild(s);
})();
// ============================================================
// END OF DASHBOARD.JS (v2.0.4)
// ============================================================
