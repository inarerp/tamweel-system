// ============================================================
// نظام إدارة التمويل - Company Screen (مركز رؤية الشركة)
// Version: 1.2.0
// READ/RENDER ONLY - كل الحسابات من calculations.js
// v1.2.0: عرض تاريخ الربح حسب نوع العملية (تمويل/توريد) من الـ Core
// ============================================================
var COMPANY_STATE = { data: null, view: 'main', profitPeriod: 'thisMonth', month: '', from: null, to: null };

function initCompany() { _injectShell(); registerScreenLoader('company', loadCompany); _hookPermissions(); _applyCompanyNav(); }
function _injectShell() {
    if (document.getElementById('company')) return;
    var nav = document.querySelector('.nav') || document.querySelector('nav');
    if (!nav) { var b0 = document.querySelector('.nav-btn'); if (b0) nav = b0.parentNode; }
    if (nav) { var btn = document.createElement('button'); btn.className = 'nav-btn'; btn.id = 'companyNavBtn'; btn.setAttribute('data-action', 'showScreen'); btn.setAttribute('data-screen', 'company'); btn.innerHTML = '🏢 الشركة'; nav.appendChild(btn); }
    var dash = document.getElementById('dashboard');
    var parent = dash ? dash.parentNode : (document.querySelector('.content') || document.body);
    var s = document.createElement('div'); s.id = 'company'; s.className = 'screen'; s.innerHTML = '<div id="companyContent" class="co-wrap"></div>'; parent.appendChild(s);
}
function _hookPermissions() { if (typeof window.applyPermissions === 'function') { var o = window.applyPermissions; window.applyPermissions = function() { var r = o.apply(this, arguments); setTimeout(_applyCompanyNav, 0); return r; }; } }
function _applyCompanyNav() { var b = document.getElementById('companyNavBtn'); if (!b) return; var ok = (typeof isAdmin === 'function' && isAdmin()) || (typeof isViewer === 'function' && isViewer()); b.style.display = ok ? '' : 'none'; }

async function loadCompany() {
    if (!isSupabaseReady()) return; showLoading();
    try {
        var opsR = await runQuery(function() { return APP.supabase.from('operations').select('id, reference_number, name, type, status, amount, client_id, start_date, end_date, expected_profit, final_profit, profit_approval_date, company_profit_type, company_profit_value, is_archived, created_at'); }, { context: 'company-ops', throwError: true });
        var opInvR = await runQuery(function() { return APP.supabase.from('operation_investors').select('id, operation_id, investor_id, contribution, profit'); }, { context: 'company-opinv', throwError: true });
        var transR = await runQuery(function() { return APP.supabase.from('transfers').select('id, reference_number, type, purpose, operation_id, client_id, investor_id, amount, transfer_date, notes'); }, { context: 'company-trans', throwError: true });
        var invR = await runQuery(function() { return APP.supabase.from('investors').select('id, name, is_archived'); }, { context: 'company-inv', throwError: true });
        var cliR = await runQuery(function() { return APP.supabase.from('clients').select('id, name, is_archived'); }, { context: 'company-cli', throwError: true });
        var indexes = buildDashboardIndexes(opsR.data || [], opInvR.data || [], transR.data || [], invR.data || [], cliR.data || []);
        COMPANY_STATE.data = { operations: opsR.data || [], operationInvestors: opInvR.data || [], transfers: transR.data || [], investors: invR.data || [], clients: cliR.data || [], indexes: indexes };
        renderCompany();
    } catch (e) { var c = document.getElementById('companyContent'); if (c) c.innerHTML = '<div class="error-box">حدث خطأ في تحميل بيانات الشركة</div>'; }
    finally { hideLoading(); }
}

function companyBack() { COMPANY_STATE.view = 'main'; renderCompany(); }
function companyShowCash() { COMPANY_STATE.view = 'cash'; renderCompany(); }
function companyShowClients() { COMPANY_STATE.view = 'clients'; renderCompany(); }
function companyShowInvestorCapital() { COMPANY_STATE.view = 'investorCapital'; renderCompany(); }
function companyShowInvestorProfit() { COMPANY_STATE.view = 'investorProfit'; renderCompany(); }
function companyShowProfit() { COMPANY_STATE.view = 'profit'; renderCompany(); }
function companySetPeriod(p) { COMPANY_STATE.profitPeriod = p; renderCompany(); }
function companyApplyCustomPeriod() { var f = document.getElementById('coFrom'), t = document.getElementById('coTo'); COMPANY_STATE.from = f ? f.value : null; COMPANY_STATE.to = t ? t.value : null; COMPANY_STATE.profitPeriod = 'custom'; renderCompany(); }
function companyApplyMonth() { var m = document.getElementById('coMonth'); if (m && m.value) { COMPANY_STATE.month = m.value; COMPANY_STATE.profitPeriod = 'month'; renderCompany(); } }

function _getPeriodRange() {
    var now = new Date(); var p = COMPANY_STATE.profitPeriod;
    if (p === 'thisMonth') return { from: _iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: _iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)), label: 'هذا الشهر' };
    if (p === 'lastMonth') return { from: _iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: _iso(new Date(now.getFullYear(), now.getMonth(), 0)), label: 'الشهر السابق' };
    if (p === 'month' && COMPANY_STATE.month) { var pr = COMPANY_STATE.month.split('-'); var y = +pr[0], m = +pr[1]; return { from: _iso(new Date(y, m - 1, 1)), to: _iso(new Date(y, m, 0)), label: 'شهر ' + COMPANY_STATE.month }; }
    if (p === 'custom') return { from: COMPANY_STATE.from, to: COMPANY_STATE.to, label: 'فترة مخصصة' };
    return { from: null, to: null, label: 'كل الفترة' };
}
function _iso(d) { return d.toISOString().split('T')[0]; }
function _clientOutstandingLabel(v) { if (v > 0) return 'مستحق على العميل: ' + formatMoney(v); if (v < 0) return 'رصيد دائن للعميل: ' + formatMoney(Math.abs(v)); return 'تمت التسوية'; }

function renderCompany() {
    var c = document.getElementById('companyContent'); if (!c || !COMPANY_STATE.data) return;
    var v = COMPANY_STATE.view;
    if (v === 'cash') c.innerHTML = _renderCash();
    else if (v === 'clients') c.innerHTML = _renderClients();
    else if (v === 'investorCapital') c.innerHTML = _renderInvestorCapital();
    else if (v === 'investorProfit') c.innerHTML = _renderInvestorProfit();
    else if (v === 'profit') c.innerHTML = _renderProfit();
    else c.innerHTML = _renderMain();
}
function _backBtn() { return '<button class="co-back" data-action="companyBack">← رجوع للشركة</button>'; }

function _renderMain() {
    var d = COMPANY_STATE.data; var s = calculateCompanySummary(d);
    var h = '<div class="co-header"><h2>🏢 مركز الشركة المالي</h2></div><div class="co-grid">';
    h += _card('💰 فلوس الشركة', formatMoney(s.companyCashBalance), [['إجمالي الداخل', formatMoney(s.cashIn)], ['إجمالي الخارج', formatMoney(s.cashOut)]], 'companyShowCash', 'blue');
    h += _card('👥 أموال لدى العملاء', formatMoney(Math.abs(s.clientOutstandingCash)), [['تم تمويله', formatMoney(s.totalClientFunded)], ['تم سداده', formatMoney(s.totalClientRepaid)], [_clientOutstandingLabel(s.clientOutstandingCash), '']], 'companyShowClients', 'orange');
    h += _card('👤 مستحقات رأس مال الممولين', formatMoney(s.outstandingInvestorCapital), [['دخل من الممولين', formatMoney(s.totalInvestorFunded)], ['تم إرجاعه', formatMoney(s.totalInvestorCapitalReturned)]], 'companyShowInvestorCapital', 'green');
    h += _card('💸 أرباح مستحقة للممولين', formatMoney(s.outstandingInvestorProfit), [['إجمالي أرباحهم', formatMoney(s.totalInvestorProfitEntitlement)], ['تم دفعه', formatMoney(s.totalInvestorProfitDistributed)]], 'companyShowInvestorProfit', 'red');
    h += _card('📈 أرباح الشركة', formatMoney(s.totalCompanyApprovedProfit), [['المتوقع', formatMoney(s.totalCompanyExpectedProfit)], ['المعتمد/المتفق عليه', formatMoney(s.totalCompanyApprovedProfit)]], 'companyShowProfit', 'purple');
    h += '</div>';
    h += '<div class="co-section"><h3>🗂 العمليات (' + s.totalOperations + ')</h3><div class="co-chips"><span class="co-chip blue">نشطة ' + s.activeOperations + '</span><span class="co-chip green">مكتملة ' + s.completedOperations + '</span><span class="co-chip">مسودات ' + s.draftOperations + '</span><span class="co-chip orange">قيمة النشطة ' + formatMoney(s.activeOperationsValue) + '</span></div>' + _renderOperationsList() + '</div>';
    return h;
}
function _card(t, big, rows, action, color) {
    var h = '<div class="co-card co-' + (color || '') + '" data-action="' + action + '"><div class="co-card-title">' + t + '</div><div class="co-card-big">' + big + '</div>';
    rows.forEach(function(r) { if (r[0]) h += '<div class="co-card-row"><span>' + r[0] + '</span><strong>' + r[1] + '</strong></div>'; });
    return h + '<div class="co-card-hint">اضغط للتفاصيل ←</div></div>';
}
function _renderOperationsList() {
    var d = COMPANY_STATE.data; var h = '<div class="co-list">';
    d.operations.forEach(function(op) {
        var os = getOperationCompanySummary(op.id, d);
        var cl = op.client_id ? d.indexes.clientsById[op.client_id] : null;
        h += '<div class="co-item" data-action="openOperationDetails" data-param="' + op.id + '"><div class="co-item-main"><strong>' + escapeHtml(op.name) + '</strong><span class="co-item-sub">' + escapeHtml(op.reference_number || '') + ' · ' + escapeHtml(cl ? cl.name : '-') + '</span></div><div class="co-item-nums"><span>مستلم ' + formatMoney(os.investorFunded) + '</span><span>' + _clientOutstandingLabel(os.clientOutstandingCash) + '</span><span class="green">ربح الشركة ' + formatMoney(os.companyApprovedProfit) + '</span></div></div>';
    });
    return h + '</div>';
}
function _renderCash() {
    var d = COMPANY_STATE.data; var b = getCompanyBalance(d);
    var h = _backBtn() + '<div class="co-header"><h2>💰 تفاصيل نقد الشركة</h2></div>';
    h += '<div class="co-detail-eq">الرصيد النقدي = الداخل − الخارج = <strong>' + formatMoney(b.companyCashBalance) + '</strong> (نقد وليس ربحًا)</div><div class="co-grid">';
    h += '<div class="co-card co-green"><div class="co-card-title">داخل للشركة</div><div class="co-card-big">' + formatMoney(b.cashIn) + '</div><div class="co-card-row"><span>من الممولين</span><strong>' + formatMoney(b.cashReceivedFromInvestors) + '</strong></div><div class="co-card-row"><span>من العملاء</span><strong>' + formatMoney(b.cashCollectedFromClients) + '</strong></div></div>';
    h += '<div class="co-card co-red"><div class="co-card-title">خارج من الشركة</div><div class="co-card-big">' + formatMoney(b.cashOut) + '</div><div class="co-card-row"><span>للعملاء</span><strong>' + formatMoney(b.cashPaidToClients) + '</strong></div><div class="co-card-row"><span>رأس مال مُرجع</span><strong>' + formatMoney(b.cashReturnedToInvestors) + '</strong></div><div class="co-card-row"><span>أرباح مدفوعة</span><strong>' + formatMoney(b.cashProfitPaidToInvestors) + '</strong></div></div></div>';
    h += '<div class="co-section"><h3>حسب الأطراف</h3>' + _cashByParty() + '</div>';
    return h;
}
function _cashByParty() {
    var d = COMPANY_STATE.data; var bi = {}, bc = {};
    d.transfers.forEach(function(t) { var a = parseFloat(t.amount || 0); var s = _companyFlowSide(t);
        if (s === 'in_investor' && t.investor_id) (bi[t.investor_id] = bi[t.investor_id] || { received: 0, returned: 0, profit: 0 }).received += a;
        else if (s === 'out_investor' && t.investor_id) { var o = (bi[t.investor_id] = bi[t.investor_id] || { received: 0, returned: 0, profit: 0 }); if (t.purpose === 'profit_distribution') o.profit += a; else o.returned += a; }
        else if (s === 'out_client' && t.client_id) (bc[t.client_id] = bc[t.client_id] || { paid: 0, collected: 0 }).paid += a;
        else if (s === 'in_client' && t.client_id) (bc[t.client_id] = bc[t.client_id] || { paid: 0, collected: 0 }).collected += a; });
    var h = '<div class="co-list">';
    Object.keys(bi).forEach(function(id) { var inv = d.indexes.investorsById[id], v = bi[id]; h += '<div class="co-item" data-action="openInvestorFile" data-param="' + id + '"><div class="co-item-main"><strong>💼 ' + escapeHtml(inv ? inv.name : 'ممول') + '</strong></div><div class="co-item-nums"><span>مستلم ' + formatMoney(v.received) + '</span><span>مُرجع ' + formatMoney(v.returned) + '</span><span class="red">أرباح ' + formatMoney(v.profit) + '</span></div></div>'; });
    Object.keys(bc).forEach(function(id) { var cl = d.indexes.clientsById[id], v = bc[id]; h += '<div class="co-item" data-action="openClientFile" data-param="' + id + '"><div class="co-item-main"><strong>👤 ' + escapeHtml(cl ? cl.name : 'عميل') + '</strong></div><div class="co-item-nums"><span>مدفوع له ' + formatMoney(v.paid) + '</span><span class="green">محصل ' + formatMoney(v.collected) + '</span></div></div>'; });
    return h + '</div>';
}
function _renderClients() {
    var d = COMPANY_STATE.data; var h = _backBtn() + '<div class="co-header"><h2>👥 أموال لدى العملاء</h2></div><div class="co-list">';
    d.clients.forEach(function(cl) { if (cl.is_archived) return; var s = calculateClientSummary(cl.id, d); if (s.totalOperations === 0) return;
        h += '<div class="co-item" data-action="openClientFile" data-param="' + cl.id + '"><div class="co-item-main"><strong>' + escapeHtml(cl.name) + '</strong><span class="co-item-sub">' + s.totalOperations + ' عملية</span></div><div class="co-item-nums"><span>ممول ' + formatMoney(s.totalFunded) + '</span><span>سدد ' + formatMoney(s.totalRepaid) + '</span><span class="orange">' + _clientOutstandingLabel(s.totalFunded - s.totalRepaid) + '</span></div></div>'; });
    return h + '</div>';
}
function _renderInvestorCapital() {
    var d = COMPANY_STATE.data; var h = _backBtn() + '<div class="co-header"><h2>👤 رأس مال الممولين</h2></div><div class="co-list">';
    d.investors.forEach(function(inv) { if (inv.is_archived) return; var s = calculateInvestorSummary(inv.id, d); if (s.totalOperations === 0) return;
        h += '<div class="co-item" data-action="openInvestorFile" data-param="' + inv.id + '"><div class="co-item-main"><strong>' + escapeHtml(inv.name) + '</strong><span class="co-item-sub">' + s.totalOperations + ' عملية</span></div><div class="co-item-nums"><span>ممول ' + formatMoney(s.fundedCapital) + '</span><span>مُرجع ' + formatMoney(s.capitalReturned) + '</span><span class="green">متبقي ' + formatMoney(s.capitalPending) + '</span></div></div>'; });
    return h + '</div>';
}
function _renderInvestorProfit() {
    var d = COMPANY_STATE.data; var h = _backBtn() + '<div class="co-header"><h2>💸 أرباح الممولين</h2></div><div class="co-list">';
    d.investors.forEach(function(inv) { if (inv.is_archived) return; var s = calculateInvestorSummary(inv.id, d); if (s.totalOperations === 0) return;
        h += '<div class="co-item" data-action="openInvestorFile" data-param="' + inv.id + '"><div class="co-item-main"><strong>' + escapeHtml(inv.name) + '</strong></div><div class="co-item-nums"><span>إجمالي ' + formatMoney(s.totalProfit) + '</span><span>مدفوع ' + formatMoney(s.profitPaid) + '</span><span class="red">مستحق ' + formatMoney(s.outstandingProfit) + '</span></div></div>'; });
    return h + '</div>';
}
function _renderProfit() {
    var d = COMPANY_STATE.data; var range = _getPeriodRange();
    var profit = getCompanyProfitForPeriod(d, range.from, range.to);
    var h = _backBtn() + '<div class="co-header"><h2>📈 أرباح الشركة — ' + range.label + '</h2></div>';
    h += '<div class="co-filter"><button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'all' ? 'active' : '') + '" data-action="companySetPeriod" data-param="all">كل الفترة</button><button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'thisMonth' ? 'active' : '') + '" data-action="companySetPeriod" data-param="thisMonth">هذا الشهر</button><button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'lastMonth' ? 'active' : '') + '" data-action="companySetPeriod" data-param="lastMonth">الشهر السابق</button><button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'month' ? 'active' : '') + '" data-action="companySetPeriod" data-param="month">شهر محدد</button><button class="co-fbtn ' + (COMPANY_STATE.profitPeriod === 'custom' ? 'active' : '') + '" data-action="companySetPeriod" data-param="custom">مخصص</button></div>';
    if (COMPANY_STATE.profitPeriod === 'month') h += '<div class="co-dates"><input type="month" id="coMonth" value="' + (COMPANY_STATE.month || '') + '"><button class="co-fbtn active" data-action="companyApplyMonth">تطبيق</button></div>';
    if (COMPANY_STATE.profitPeriod === 'custom') h += '<div class="co-dates"><input type="date" id="coFrom" value="' + (COMPANY_STATE.from || '') + '"><input type="date" id="coTo" value="' + (COMPANY_STATE.to || '') + '"><button class="co-fbtn active" data-action="companyApplyCustomPeriod">تطبيق</button></div>';
    h += '<div class="co-profit-hero"><div class="co-card-title">إجمالي ربح الشركة (' + range.label + ')</div><div class="co-card-big">' + formatMoney(profit.totalCompanyApprovedProfit) + '</div><div class="co-card-row"><span>أساس الاحتساب</span><strong>تمويل: تاريخ العملية · توريد: تاريخ الاعتماد</strong></div></div>';
    h += '<div class="co-note">الربح المتوقع (تراكمي، توقع غير معتمد ولا يدخل في الربح الشهري): <strong>' + formatMoney(profit.allTimeExpectedProfit) + '</strong></div>';
    h += '<div class="co-section"><h3>العمليات في الفترة</h3><div class="co-list">';
    if (profit.operations.length === 0) h += '<div class="empty-state">لا توجد أرباح في هذه الفترة</div>';
    profit.operations.forEach(function(r) {
        h += '<div class="co-item" data-action="openOperationDetails" data-param="' + r.operationId + '"><div class="co-item-main"><strong>' + escapeHtml(r.name) + '</strong><span class="co-item-sub">' + escapeHtml(r.reference) + ' · ' + escapeHtml(r.clientName) + ' · ' + (r.profitDateLabel || 'تاريخ الربح') + ': ' + formatDate(r.profitDate || r.approvalDate) + '</span></div><div class="co-item-nums"><span>إجمالي ربح العملية ' + formatMoney(r.totalOperationProfit) + '</span><span class="green">حصة الشركة ' + formatMoney(r.companyShare) + '</span></div></div>';
    });
    h += '</div></div>';
    var inT = d.transfers.filter(function(t) { var dt = String(t.transfer_date || '').slice(0, 10); return (!range.from || dt >= range.from) && (!range.to || dt <= range.to); });
    var pb = getCompanyBalance({ transfers: inT });
    h += '<div class="co-note">صافي حركة نقدية خلال الفترة (نقد وليس ربحًا): <strong>' + formatMoney(pb.companyCashBalance) + '</strong></div>';
    return h;
}
// ============================================================
// END OF COMPANY.JS (v1.2.0)
// ============================================================
