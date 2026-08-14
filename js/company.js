// ============================================================
// نظام إدارة التمويل - Company Screen (مركز رؤية الشركة)
// Version: 1.0.0
// READ/RENDER ONLY - لا INSERT/UPDATE/DELETE
// يعتمد 100% على Financial Core (calculations.js v2.4.0)
// ============================================================

var COMPANY_STATE = {
    data: null,
    view: 'main',           // main | cash | clients | investorCapital | investorProfit | profit
    profitPeriod: 'all',    // all | thisMonth | lastMonth | custom
    from: null,
    to: null
};

// ============================================================
// 1. INIT + INJECTION (بدون لمس index.html)
// ============================================================

function initCompany() {
    debug('🏢 بدء تهيئة company.js', 'info');
    _injectShell();
    registerScreenLoader('company', loadCompany);
    _hookPermissions();
    _applyCompanyNav();
    debug('✅ company.js جاهز', 'success');
}

function _injectShell() {
    if (document.getElementById('company')) return;

    // زر التنقل
    var nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) {
        var firstBtn = document.querySelector('.nav-btn');
        if (firstBtn) nav = firstBtn.parentNode;
    }
    if (nav) {
        var btn = document.createElement('button');
        btn.className = 'nav-btn';
        btn.setAttribute('data-action', 'showScreen');
        btn.setAttribute('data-screen', 'company');
        btn.id = 'companyNavBtn';
        btn.innerHTML = '🏢 الشركة';
        nav.appendChild(btn);
    }

    // حاوية الشاشة
    var dash = document.getElementById('dashboard');
    var parent = dash ? dash.parentNode : (document.querySelector('.content') || document.body);
    var screen = document.createElement('div');
    screen.id = 'company';
    screen.className = 'screen';
    screen.innerHTML = '<div id="companyContent" class="co-wrap"></div>';
    parent.appendChild(screen);
}

function _hookPermissions() {
    if (typeof window.applyPermissions === 'function') {
        var orig = window.applyPermissions;
        window.applyPermissions = function() {
            var r = orig.apply(this, arguments);
            setTimeout(_applyCompanyNav, 0);
            return r;
        };
    }
}

function _applyCompanyNav() {
    var btn = document.getElementById('companyNavBtn');
    if (!btn) return;
    var allowed = (typeof isAdmin === 'function' && isAdmin()) || (typeof isViewer === 'function' && isViewer());
    btn.style.display = allowed ? '' : 'none';
}

// ============================================================
// 2. LOAD DATA (مرة واحدة + indexes)
// ============================================================

async function loadCompany() {
    debug('🏢 بدأ loadCompany', 'info');
    if (!isSupabaseReady()) return;
    showLoading();
    try {
        var opsR = await runQuery(function() { return APP.supabase.from('operations').select('id, reference_number, name, status, amount, client_id, start_date, end_date, expected_profit, final_profit, profit_approval_date, company_profit_type, company_profit_value, is_archived'); }, { context: 'company-ops', throwError: true });
        var opInvR = await runQuery(function() { return APP.supabase.from('operation_investors').select('id, operation_id, investor_id, contribution, profit'); }, { context: 'company-opinv', throwError: true });
        var transR = await runQuery(function() { return APP.supabase.from('transfers').select('id, reference_number, type, purpose, operation_id, client_id, investor_id, amount, transfer_date, notes'); }, { context: 'company-trans', throwError: true });
        var invR = await runQuery(function() { return APP.supabase.from('investors').select('id, name, is_archived'); }, { context: 'company-inv', throwError: true });
        var cliR = await runQuery(function() { return APP.supabase.from('clients').select('id, name, is_archived'); }, { context: 'company-cli', throwError: true });

        var indexes = buildDashboardIndexes(opsR.data || [], opInvR.data || [], transR.data || [], invR.data || [], cliR.data || []);
        COMPANY_STATE.data = { operations: opsR.data || [], operationInvestors: opInvR.data || [], transfers: transR.data || [], investors: invR.data || [], clients: cliR.data || [], indexes: indexes };
        renderCompany();
    } catch (e) {
        debug('❌ خطأ في loadCompany: ' + e.message, 'error');
        var c = document.getElementById('companyContent');
        if (c) c.innerHTML = '<div class="error-box">حدث خطأ في تحميل بيانات الشركة</div>';
    } finally { hideLoading(); }
}

// ============================================================
// 3. NAVIGATION (Drill-down)
// ============================================================

function companyBack() { COMPANY_STATE.view = 'main'; renderCompany(); }
function companyShowCash() { COMPANY_STATE.view = 'cash'; renderCompany(); }
function companyShowClients() { COMPANY_STATE.view = 'clients'; renderCompany(); }
function companyShowInvestorCapital() { COMPANY_STATE.view = 'investorCapital'; renderCompany(); }
function companyShowInvestorProfit() { COMPANY_STATE.view = 'investorProfit'; renderCompany(); }
function companyShowProfit() { COMPANY_STATE.view = 'profit'; renderCompany(); }

function companySetPeriod(p) {
    COMPANY_STATE.profitPeriod = p;
    renderCompany();
}
function companyApplyCustomPeriod() {
    var f = document.getElementById('coFrom');
    var t = document.getElementById('coTo');
    COMPANY_STATE.from = f ? f.value : null;
    COMPANY_STATE.to = t ? t.value : null;
    COMPANY_STATE.profitPeriod = 'custom';
    renderCompany();
}

// ============================================================
// 4. PERIOD HELPERS
// ============================================================

function _getPeriodRange() {
    var now = new Date();
    var p = COMPANY_STATE.profitPeriod;
    if (p === 'thisMonth') {
        var f = new Date(now.getFullYear(), now.getMonth(), 1);
        var t = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: _iso(f), to: _iso(t), label: 'هذا الشهر' };
    }
    if (p === 'lastMonth') {
        var f2 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        var t2 = new Date(now.getFullYear(), now.getMonth(), 0);
        return { from: _iso(f2), to: _iso(t2), label: 'الشهر السابق' };
    }
    if (p === 'custom') {
        return { from: COMPANY_STATE.from, to: COMPANY_STATE.to, label: 'فترة مخصصة' };
    }
    return { from: null, to: null, label: 'كل الفترة' };
}
function _iso(d) { return d.toISOString().split('T')[0]; }
function _inRange(dateStr, from, to) {
    if (!dateStr) return false;
    var d = String(dateStr).slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
}

// ============================================================
// 5. RENDER
// ============================================================

function renderCompany() {
    var c = document.getElementById('companyContent');
    if (!c || !COMPANY_STATE.data) return;
    var v = COMPANY_STATE.view;
    if (v === 'cash') c.innerHTML = _renderCash();
    else if (v === 'clients') c.innerHTML = _renderClients();
    else if (v === 'investorCapital') c.innerHTML = _renderInvestorCapital();
    else if (v === 'investorProfit') c.innerHTML = _renderInvestorProfit();
    else if (v === 'profit') c.innerHTML = _renderProfit();
    else c.innerHTML = _renderMain();
}

function _backBtn() {
    return '<button class="co-back" data-action="companyBack">← رجوع للشركة</button>';
}

// ---------- MAIN ----------
function _renderMain() {
    var d = COMPANY_STATE.data;
    var s = calculateCompanySummary(d);
    var h = '<div class="co-header"><h2>🏢 مركز الشركة المالي</h2></div>';
    h += '<div class="co-grid">';

    h += _card('💰 فلوس الشركة', formatMoney(s.companyCashBalance), [
        ['إجمالي الداخل', formatMoney(s.cashIn)],
        ['إجمالي الخارج', formatMoney(s.cashOut)]
    ], 'companyShowCash', 'blue');

    h += _card('👥 أموال لدى العملاء', formatMoney(s.clientOutstandingCash), [
        ['تم تمويله', formatMoney(s.totalClientFunded)],
        ['تم سداده', formatMoney(s.totalClientRepaid)]
    ], 'companyShowClients', 'orange');

    h += _card('👤 مستحقات رأس مال الممولين', formatMoney(s.outstandingInvestorCapital), [
        ['دخل من الممولين', formatMoney(s.totalInvestorFunded)],
        ['تم إرجاعه', formatMoney(s.totalInvestorCapitalReturned)]
    ], 'companyShowInvestorCapital', 'green');

    h += _card('💸 أرباح مستحقة للممولين', formatMoney(s.outstandingInvestorProfit), [
        ['إجمالي أرباحهم', formatMoney(s.totalInvestorProfitEntitlement)],
        ['تم دفعه', formatMoney(s.totalInvestorProfitDistributed)]
    ], 'companyShowInvestorProfit', 'red');

    h += _card('📈 أرباح الشركة', formatMoney(s.totalCompanyApprovedProfit), [
        ['المتوقع', formatMoney(s.totalCompanyExpectedProfit)],
        ['المحقق نقديًا', formatMoney(s.totalCompanyRealizedProfit)]
    ], 'companyShowProfit', 'purple');

    h += '</div>'; // grid

    // Operations section
    h += '<div class="co-section"><h3>🗂 العمليات (' + s.totalOperations + ')</h3>';
    h += '<div class="co-chips">';
    h += '<span class="co-chip blue">نشطة ' + s.activeOperations + '</span>';
    h += '<span class="co-chip green">مكتملة ' + s.completedOperations + '</span>';
    h += '<span class="co-chip">مسودات ' + s.draftOperations + '</span>';
    h += '<span class="co-chip orange">قيمة النشطة ' + formatMoney(s.activeOperationsValue) + '</span>';
    h += '</div>';
    h += _renderOperationsList();
    h += '</div>';

    return h;
}

function _card(title, big, rows, action, color) {
    var h = '<div class="co-card co-' + (color || '') + '" data-action="' + action + '">';
    h += '<div class="co-card-title">' + title + '</div>';
    h += '<div class="co-card-big">' + big + '</div>';
    rows.forEach(function(r) {
        h += '<div class="co-card-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>';
    });
    h += '<div class="co-card-hint">اضغط للتفاصيل ←</div>';
    h += '</div>';
    return h;
}

function _renderOperationsList() {
    var d = COMPANY_STATE.data;
    var h = '<div class="co-list">';
    d.operations.forEach(function(op) {
        var os = getOperationCompanySummary(op.id, d);
        var client = op.client_id ? d.indexes.clientsById[op.client_id] : null;
        h += '<div class="co-item" data-action="openOperationDetails" data-param="' + op.id + '">';
        h += '<div class="co-item-main"><strong>' + escapeHtml(op.name) + '</strong><span class="co-item-sub">' + escapeHtml(op.reference_number || '') + ' · ' + escapeHtml(client ? client.name : '-') + '</span></div>';
        h += '<div class="co-item-nums">';
        h += '<span>مستلم ' + formatMoney(os.investorFunded) + '</span>';
        h += '<span>لدى العميل ' + formatMoney(os.clientOutstandingCash) + '</span>';
        h += '<span class="green">ربح معتمد ' + formatMoney(os.companyApprovedProfit) + '</span>';
        h += '</div></div>';
    });
    h += '</div>';
    return h;
}

// ---------- CASH DETAILS ----------
function _renderCash() {
    var d = COMPANY_STATE.data;
    var b = getCompanyBalance(d);
    var h = _backBtn();
    h += '<div class="co-header"><h2>💰 تفاصيل نقد الشركة</h2></div>';
    h += '<div class="co-detail-eq">الرصيد الحالي = الداخل − الخارج = <strong>' + formatMoney(b.companyCashBalance) + '</strong></div>';
    h += '<div class="co-grid">';
    h += '<div class="co-card co-green"><div class="co-card-title">داخل للشركة</div><div class="co-card-big">' + formatMoney(b.cashIn) + '</div>' +
          '<div class="co-card-row"><span>من الممولين</span><strong>' + formatMoney(b.cashReceivedFromInvestors) + '</strong></div>' +
          '<div class="co-card-row"><span>من العملاء</span><strong>' + formatMoney(b.cashCollectedFromClients) + '</strong></div></div>';
    h += '<div class="co-card co-red"><div class="co-card-title">خارج من الشركة</div><div class="co-card-big">' + formatMoney(b.cashOut) + '</div>' +
          '<div class="co-card-row"><span>للعملاء</span><strong>' + formatMoney(b.cashPaidToClients) + '</strong></div>' +
          '<div class="co-card-row"><span>رأس مال مُرجع</span><strong>' + formatMoney(b.cashReturnedToInvestors) + '</strong></div>' +
          '<div class="co-card-row"><span>أرباح مدفوعة</span><strong>' + formatMoney(b.cashProfitPaidToInvestors) + '</strong></div></div>';
    h += '</div>';

    // Group by party (actual transfers)
    h += '<div class="co-section"><h3>حسب الأطراف</h3>';
    h += _cashByParty();
    h += '</div>';
    return h;
}

function _cashByParty() {
    var d = COMPANY_STATE.data;
    var byInvestor = {}, byClient = {};
    d.transfers.forEach(function(t) {
        var a = parseFloat(t.amount || 0);
        var side = _companyFlowSide(t);
        if (side === 'in_investor' && t.investor_id) {
            if (!byInvestor[t.investor_id]) byInvestor[t.investor_id] = { received: 0, returned: 0, profit: 0 };
            byInvestor[t.investor_id].received += a;
        } else if (side === 'out_investor' && t.investor_id) {
            if (!byInvestor[t.investor_id]) byInvestor[t.investor_id] = { received: 0, returned: 0, profit: 0 };
            if (t.purpose === 'profit_distribution') byInvestor[t.investor_id].profit += a;
            else byInvestor[t.investor_id].returned += a;
        } else if (side === 'out_client' && t.client_id) {
            if (!byClient[t.client_id]) byClient[t.client_id] = { paid: 0, collected: 0 };
            byClient[t.client_id].paid += a;
        } else if (side === 'in_client' && t.client_id) {
            if (!byClient[t.client_id]) byClient[t.client_id] = { paid: 0, collected: 0 };
            byClient[t.client_id].collected += a;
        }
    });

    var h = '<div class="co-list">';
    Object.keys(byInvestor).forEach(function(id) {
        var inv = d.indexes.investorsById[id];
        var v = byInvestor[id];
        h += '<div class="co-item" data-action="openInvestorFile" data-param="' + id + '"><div class="co-item-main"><strong>💼 ' + escapeHtml(inv ? inv.name : 'ممول') + '</strong></div>' +
             '<div class="co-item-nums"><span>مستلم ' + formatMoney(v.received) + '</span><span>مُرجع ' + formatMoney(v.returned) + '</span><span class="red">أرباح ' + formatMoney(v.profit) + '</span></div></div>';
    });
    Object.keys(byClient).forEach(function(id) {
        var cli = d.indexes.clientsById[id];
        var v = byClient[id];
        h += '<div class="co-item" data-action="openClientFile" data-param="' + id + '"><div class="co-item-main"><strong>👤 ' + escapeHtml(cli ? cli.name : 'عميل') + '</strong></div>' +
             '<div class="co-item-nums"><span>مدفوع له ' + formatMoney(v.paid) + '</span><span class="green">محصل ' + formatMoney(v.collected) + '</span></div></div>';
    });
    h += '</div>';
    return h;
}

// ---------- CLIENTS ----------
function _renderClients() {
    var d = COMPANY_STATE.data;
    var h = _backBtn() + '<div class="co-header"><h2>👥 أموال لدى العملاء</h2></div><div class="co-list">';
    d.clients.forEach(function(cli) {
        if (cli.is_archived) return;
        var s = calculateClientSummary(cli.id, d);
        if (s.totalOperations === 0) return;
        h += '<div class="co-item" data-action="openClientFile" data-param="' + cli.id + '"><div class="co-item-main"><strong>' + escapeHtml(cli.name) + '</strong><span class="co-item-sub">' + s.totalOperations + ' عملية</span></div>' +
             '<div class="co-item-nums"><span>ممول ' + formatMoney(s.totalFunded) + '</span><span>سدد ' + formatMoney(s.totalRepaid) + '</span><span class="orange">مستحق ' + formatMoney(s.totalFunded - s.totalRepaid) + '</span></div></div>';
    });
    h += '</div>';
    return h;
}

// ---------- INVESTOR CAPITAL ----------
function _renderInvestorCapital() {
    var d = COMPANY_STATE.data;
    var h = _backBtn() + '<div class="co-header"><h2>👤 رأس مال الممولين</h2></div><div class="co-list">';
    d.investors.forEach(function(inv) {
        if (inv.is_archived) return;
        var s = calculateInvestorSummary(inv.id, d);
        if (s.totalOperations === 0) return;
        h += '<div class="co-item" data-action="openInvestorFile" data-param="' + inv.id + '"><div class="co-item-main"><strong>' + escapeHtml(inv.name) + '</strong><span class="co-item-sub">' + s.totalOperations + ' عملية</span></div>' +
             '<div class="co-item-nums"><span>ممول ' + formatMoney(s.fundedCapital) + '</span><span>مُرجع ' + formatMoney(s.capitalReturned) + '</span><span class="green">متبقي ' + formatMoney(s.capitalPending) + '</span></div></div>';
    });
    h += '</div>';
    return h;
}

// ---------- INVESTOR PROFIT ----------
function _renderInvestorProfit() {
    var d = COMPANY_STATE.data;
    var h = _backBtn() + '<div class="co-header"><h2>💸 أرباح الممولين</h2></div><div class="co-list">';
    d.investors.forEach(function(inv) {
        if (inv.is_archived) return;
        var s = calculateInvestorSummary(inv.id, d);
        if (s.totalOperations === 0) return;
        h += '<div class="co-item" data-action="openInvestorFile" data-param="' + inv.id + '"><div class="co-item-main"><strong>' + escapeHtml(inv.name) + '</strong></div>' +
             '<div class="co-item-nums"><span>إجمالي ' + formatMoney(s.totalProfit) + '</span><span>مدفوع ' + formatMoney(s.profitPaid) + '</span><span class="red">مستحق ' + formatMoney(s.outstandingProfit) + '</span></div></div>';
    });
    h += '</div>';
    return h;
}

// ---------- COMPANY PROFIT (مع فلتر زمني) ----------
function _renderProfit() {
    var d = COMPANY_STATE.data;
    var range = _getPeriodRange();
    var h = _backBtn() + '<div class="co-header"><h2>📈 أرباح الشركة</h2></div>';

    // Filter controls
    h += '<div class="co-filter">';
    h += '<button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'all' ? 'active' : '') + '" data-action="companySetPeriod" data-param="all">كل الفترة</button>';
    h += '<button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'thisMonth' ? 'active' : '') + '" data-action="companySetPeriod" data-param="thisMonth">هذا الشهر</button>';
    h += '<button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'lastMonth' ? 'active' : '') + '" data-action="companySetPeriod" data-param="lastMonth">الشهر السابق</button>';
    h += '<button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'custom' ? 'active' : '') + '" data-action="companySetPeriod" data-param="custom">مخصص</button>';
    h += '</div>';
    if (COMPANY_STATE.profitPeriod === 'custom') {
        h += '<div class="co-dates"><input type="date" id="coFrom" value="' + (COMPANY_STATE.from || '') + '"><input type="date" id="coTo" value="' + (COMPANY_STATE.to || '') + '"><button class="co-fbtn active" data-action="companyApplyCustomPeriod">تطبيق</button></div>';
    }
    h += '<div class="co-period-label">الفترة: ' + range.label + (range.from ? ' (' + range.from + ' → ' + range.to + ')' : '') + '</div>';

    // Aggregate per operation within period
    var expSum = 0, appSum = 0;
    var rows = '';
    d.operations.forEach(function(op) {
        var p = getOperationProfits(op.id, d);
        var os = getOperationCompanySummary(op.id, d);
        var inApp = _inRange(op.profit_approval_date, range.from, range.to);
        var inExp = _inRange(op.end_date, range.from, range.to);
        if (!inApp && !inExp && range.from) return;
        if (inApp) appSum += p.companyApproved;
        if (inExp) expSum += p.companyExpected;
        var client = op.client_id ? d.indexes.clientsById[op.client_id] : null;
        rows += '<div class="co-item" data-action="openOperationDetails" data-param="' + op.id + '"><div class="co-item-main"><strong>' + escapeHtml(op.name) + '</strong>' +
                '<span class="co-item-sub">' + escapeHtml(op.reference_number || '') + ' · ' + escapeHtml(client ? client.name : '-') +
                ' · اعتماد: ' + (op.profit_approval_date ? formatDate(op.profit_approval_date) : '—') + '</span></div>' +
                '<div class="co-item-nums"><span>متوقع ' + formatMoney(os.companyExpectedProfit) + '</span><span class="green">معتمد ' + formatMoney(os.companyApprovedProfit) + '</span><span class="blue">محقق ' + formatMoney(os.companyRealizedProfit) + '</span></div></div>';
    });

    // Period cash flow (realized within period) from actual transfers
    var inPeriodTransfers = d.transfers.filter(function(t) { return _inRange(t.transfer_date, range.from, range.to); });
    var periodBalance = getCompanyBalance({ transfers: inPeriodTransfers });

    h += '<div class="co-grid">';
    h += '<div class="co-card co-purple"><div class="co-card-title">الربح المعتمد للفترة</div><div class="co-card-big">' + formatMoney(appSum) + '</div><div class="co-card-row"><span>أساس التاريخ</span><strong>تاريخ اعتماد الربح</strong></div></div>';
    h += '<div class="co-card"><div class="co-card-title">الربح المتوقع للفترة</div><div class="co-card-big">' + formatMoney(expSum) + '</div><div class="co-card-row"><span>أساس التاريخ</span><strong>تاريخ نهاية العملية</strong></div></div>';
    h += '<div class="co-card co-blue"><div class="co-card-title">صافي تدفق نقدي للفترة</div><div class="co-card-big">' + formatMoney(periodBalance.companyCashBalance) + '</div><div class="co-card-row"><span>المحقق تراكميًا</span><strong>' + formatMoney(calculateCompanySummary(d).totalCompanyRealizedProfit) + '</strong></div></div>';
    h += '</div>';

    h += '<div class="co-section"><h3>العمليات المساهمة</h3><div class="co-list">' + rows + '</div></div>';
    return h;
}

// ============================================================
// END OF COMPANY.JS
// ============================================================
