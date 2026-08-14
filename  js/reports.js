// ============================================================
// نظام إدارة التمويل - Reports Module (Read-only)
// Version: 1.0.0
// ============================================================
// شاشة تقارير بسيطة read-only — بديل عملي لتجميع الأرقام يدويًا.
// تقرأ فقط من Financial Core (calculations.js) ولا تعيد أي حساب مالي.
// ============================================================

var REPORTS_STATE = {
    data: null,
    activeTab: 'company',
    period: 'all',
    from: null,
    to: null
};

function initReports() {
    debug('📊 بدء تهيئة reports.js', 'info');
    registerScreenLoader('reports', loadReports);
    debug('✅ reports.js جاهز', 'success');
}

// ============================================================
// 1. DATA LOADING + INDEXES
// ============================================================

async function loadReportsData() {
    var results = await Promise.all([
        runQuery(function() { return APP.supabase.from('operations').select('*'); }, { context: 'reports-ops', throwError: true }),
        runQuery(function() { return APP.supabase.from('operation_investors').select('*'); }, { context: 'reports-opinv', throwError: true }),
        runQuery(function() { return APP.supabase.from('transfers').select('*'); }, { context: 'reports-trans', throwError: true }),
        runQuery(function() { return APP.supabase.from('clients').select('*'); }, { context: 'reports-clients', throwError: true }),
        runQuery(function() { return APP.supabase.from('investors').select('*'); }, { context: 'reports-investors', throwError: true })
    ]);

    var operations = results[0].data || [];
    var operationInvestors = results[1].data || [];
    var transfers = results[2].data || [];
    var clients = results[3].data || [];
    var investors = results[4].data || [];

    var indexes = buildReportsIndexes(operations, operationInvestors, transfers, clients, investors);

    return {
        operations: operations,
        operationInvestors: operationInvestors,
        transfers: transfers,
        clients: clients,
        investors: investors,
        indexes: indexes
    };
}

function buildReportsIndexes(operations, operationInvestors, transfers, clients, investors) {
    var operationsById = {};
    var clientsById = {};
    var investorsById = {};
    var opInvestorsByOperation = {};
    var opInvestorsByInvestor = {};
    var transfersByOperation = {};
    var transfersByInvestor = {};
    var clientOperations = {};

    operations.forEach(function(op) {
        operationsById[op.id] = op;
        if (op.client_id) {
            if (!clientOperations[op.client_id]) clientOperations[op.client_id] = [];
            clientOperations[op.client_id].push(op);
        }
    });

    clients.forEach(function(c) { clientsById[c.id] = c; });
    investors.forEach(function(i) { investorsById[i.id] = i; });

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

    return {
        operationsById: operationsById,
        clientsById: clientsById,
        investorsById: investorsById,
        opInvestorsByOperation: opInvestorsByOperation,
        opInvestorsByInvestor: opInvestorsByInvestor,
        transfersByOperation: transfersByOperation,
        transfersByInvestor: transfersByInvestor,
        clientOperations: clientOperations
    };
}

async function loadReports() {
    debug('📊 بدأ loadReports', 'info');
    if (!isSupabaseReady()) return;
    showLoading();
    try {
        REPORTS_STATE.data = await loadReportsData();
        renderReports();
    } catch (e) {
        debug('❌ خطأ في loadReports: ' + e.message, 'error');
        var container = document.getElementById('reportsContent');
        if (container) container.innerHTML = '<div class="empty-state">تعذّر تحميل بيانات التقارير</div>';
        showToast(handleSupabaseError(e, 'تحميل بيانات التقارير'), 'error');
    } finally {
        hideLoading();
    }
}

// ============================================================
// 2. RENDER (TABS)
// ============================================================

function renderReports() {
    var container = document.getElementById('reportsContent');
    if (!container) return;

    if (!REPORTS_STATE.data) {
        container.innerHTML = '<div class="empty-state">لا توجد بيانات</div>';
        return;
    }

    var tabs = [
        { id: 'company', label: 'ملخص الشركة' },
        { id: 'operations', label: 'ربحية العمليات' },
        { id: 'clients', label: 'أرصدة العملاء' },
        { id: 'investors', label: 'أرصدة الممولين' }
    ];

    var html = '';
    html += '<div class="reports-tabs">';
    tabs.forEach(function(t) {
        var active = REPORTS_STATE.activeTab === t.id ? ' active' : '';
        html += '<button class="reports-tab' + active + '" data-action="reportsSwitchTab" data-param="' + t.id + '">' + t.label + '</button>';
    });
    html += '</div>';

    html += '<div class="reports-body">';
    if (REPORTS_STATE.activeTab === 'company') html += renderCompanySummary();
    else if (REPORTS_STATE.activeTab === 'operations') html += renderOperationsProfit();
    else if (REPORTS_STATE.activeTab === 'clients') html += renderClientsBalances();
    else if (REPORTS_STATE.activeTab === 'investors') html += renderInvestorsBalances();
    html += '</div>';

    container.innerHTML = html;
}

function reportsSwitchTab(tabId) {
    REPORTS_STATE.activeTab = tabId;
    renderReports();
}

// ============================================================
// 3. REPORT 1 — ملخص الشركة
// ============================================================

function renderCompanySummary() {
    var summary = calculateCompanySummary(REPORTS_STATE.data);

    var html = '<div class="reports-cards">';
    html += reportsCard('رصيد الشركة', formatMoney(summary.companyCashBalance), 'blue');
    html += reportsCard('إجمالي تمويل العملاء', formatMoney(summary.totalClientFunded), '');
    html += reportsCard('إجمالي سداد العملاء', formatMoney(summary.totalClientRepaid), 'green');
    html += reportsCard('مستحقات العملاء', formatMoney(summary.clientOutstandingCash), 'orange');
    html += reportsCard('إجمالي تمويل الممولين', formatMoney(summary.totalInvestorFunded), '');
    html += reportsCard('رأس المال المستحق للممولين', formatMoney(summary.outstandingInvestorCapital), 'orange');
    html += reportsCard('أرباح الممولين المستحقة', formatMoney(summary.outstandingInvestorProfit), 'orange');
    html += reportsCard('ربح الشركة', formatMoney(summary.totalCompanyApprovedProfit), 'green');
    html += '</div>';

    return html;
}

function reportsCard(title, value, color) {
    return '<div class="reports-card ' + (color || '') + '">' +
        '<div class="reports-card-title">' + title + '</div>' +
        '<div class="reports-card-value">' + value + '</div>' +
        '</div>';
}

// ============================================================
// 4. REPORT 2 — ربحية العمليات
// ============================================================

function renderOperationsProfit() {
    var data = REPORTS_STATE.data;
    var result = getCompanyProfitForPeriod(data, REPORTS_STATE.from, REPORTS_STATE.to);

    var html = '';

    // فلاتر الفترة
    html += '<div class="reports-filter">';
    html += reportsPeriodButton('all', 'الكل');
    html += reportsPeriodButton('thisMonth', 'هذا الشهر');
    html += reportsPeriodButton('lastMonth', 'الشهر السابق');
    html += reportsPeriodButton('custom', 'مخصص');
    html += '</div>';

    if (REPORTS_STATE.period === 'custom') {
        html += '<div class="reports-filter-custom">';
        html += '<label>من: <input type="date" id="reportsFromDate" value="' + (REPORTS_STATE.from || '') + '"></label>';
        html += '<label>إلى: <input type="date" id="reportsToDate" value="' + (REPORTS_STATE.to || '') + '"></label>';
        html += '<button class="btn btn-primary btn-sm" data-action="reportsApplyCustomPeriod">تطبيق</button>';
        html += '</div>';
    }

    html += '<div class="reports-summary-line">إجمالي ربح الشركة في الفترة: <strong>' + formatMoney(result.totalCompanyApprovedProfit) + '</strong></div>';

    if (!result.operations || !result.operations.length) {
        html += '<div class="empty-state">لا توجد عمليات في هذه الفترة</div>';
        return html;
    }

    html += '<div class="table-responsive"><table class="reports-table"><thead><tr>';
    html += '<th>العملية</th><th>العميل</th><th>قيمة العملية</th><th>ربح العملية</th><th>حصة الشركة</th><th>حصة الممولين</th><th>الحالة</th><th>تاريخ الاعتماد</th>';
    html += '</tr></thead><tbody>';

    result.operations.forEach(function(row) {
        var op = data.indexes.operationsById[row.operationId];
        var profits = getOperationProfits(row.operationId, data);
        var amount = op ? op.amount : 0;
        var status = op ? reportsStatusText(op.status) : '-';
        var investorShare = profits ? profits.investorEntitlement : 0;

        html += '<tr>';
        html += '<td>' + escapeHtml(row.name || '-') + '</td>';
        html += '<td>' + escapeHtml(row.clientName || '-') + '</td>';
        html += '<td>' + formatMoney(amount) + '</td>';
        html += '<td>' + formatMoney(row.totalOperationProfit) + '</td>';
        html += '<td>' + formatMoney(row.companyShare) + '</td>';
        html += '<td>' + formatMoney(investorShare) + '</td>';
        html += '<td>' + status + '</td>';
        html += '<td>' + formatDate(row.profitDate) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

function reportsPeriodButton(period, label) {
    var active = REPORTS_STATE.period === period ? ' active' : '';
    return '<button class="reports-period-btn' + active + '" data-action="reportsSetPeriod" data-param="' + period + '">' + label + '</button>';
}

function reportsSetPeriod(period) {
    var now = new Date();
    if (period === 'all') {
        REPORTS_STATE.from = null;
        REPORTS_STATE.to = null;
    } else if (period === 'thisMonth') {
        REPORTS_STATE.from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        REPORTS_STATE.to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    } else if (period === 'lastMonth') {
        REPORTS_STATE.from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
        REPORTS_STATE.to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
    } else if (period === 'custom') {
        // يُترك للمستخدم تحديد from/to عبر reportsApplyCustomPeriod
    }
    REPORTS_STATE.period = period;
    renderReports();
}

function reportsApplyCustomPeriod() {
    var f = document.getElementById('reportsFromDate');
    var t = document.getElementById('reportsToDate');
    REPORTS_STATE.from = f ? f.value : null;
    REPORTS_STATE.to = t ? t.value : null;
    REPORTS_STATE.period = 'custom';
    renderReports();
}

// ============================================================
// 5. REPORT 3 — أرصدة العملاء
// ============================================================

function renderClientsBalances() {
    var data = REPORTS_STATE.data;
    var clients = (data.clients || []).filter(function(c) { return !c.is_archived; });

    if (!clients.length) return '<div class="empty-state">لا يوجد عملاء</div>';

    var html = '<div class="table-responsive"><table class="reports-table"><thead><tr>';
    html += '<th>العميل</th><th>عدد العمليات</th><th>إجمالي التمويل</th><th>إجمالي السداد</th><th>الرصيد / المستحق</th>';
    html += '</tr></thead><tbody>';

    clients.forEach(function(c) {
        var summary = calculateClientSummary(c.id, data);
        html += '<tr>';
        html += '<td>' + escapeHtml(c.name || '-') + '</td>';
        html += '<td>' + summary.totalOperations + '</td>';
        html += '<td>' + formatMoney(summary.totalFunded) + '</td>';
        html += '<td>' + formatMoney(summary.totalRepaid) + '</td>';
        html += '<td>' + formatMoney(summary.balance) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

// ============================================================
// 6. REPORT 4 — أرصدة الممولين
// ============================================================

function renderInvestorsBalances() {
    var data = REPORTS_STATE.data;
    var investors = (data.investors || []).filter(function(i) { return !i.is_archived; });

    if (!investors.length) return '<div class="empty-state">لا يوجد ممولون</div>';

    var html = '<div class="table-responsive"><table class="reports-table"><thead><tr>';
    html += '<th>الممول</th><th>رأس المال</th><th>الممول المدفوع</th><th>رأس المال المتبقي</th><th>إجمالي الربح</th><th>الربح المدفوع</th><th>الربح المتبقي</th>';
    html += '</tr></thead><tbody>';

    investors.forEach(function(i) {
        var summary = calculateInvestorSummary(i.id, data);
        html += '<tr>';
        html += '<td>' + escapeHtml(i.name || '-') + '</td>';
        html += '<td>' + formatMoney(summary.totalCapital) + '</td>';
        html += '<td>' + formatMoney(summary.fundedCapital) + '</td>';
        html += '<td>' + formatMoney(summary.capitalPending) + '</td>';
        html += '<td>' + formatMoney(summary.totalProfit) + '</td>';
        html += '<td>' + formatMoney(summary.profitPaid) + '</td>';
        html += '<td>' + formatMoney(summary.outstandingProfit) + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
}

// ============================================================
// 7. HELPERS (display/formatting فقط — لا منطق مالي)
// ============================================================

function reportsStatusText(status) {
    var map = { draft: 'مسودة', active: 'نشطة', completed: 'مكتملة', cancelled: 'ملغاة' };
    return map[status] || status || '-';
}

// ============================================================
// INIT
// ============================================================

if (typeof document !== 'undefined') {
    initReports();
}
// ============================================================
// END OF REPORTS.JS (v1.0.0)
// ============================================================
