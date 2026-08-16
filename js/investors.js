// ============================================================
// نظام إدارة التمويل - Investors Module
// Version: 1.2.2
// v1.2.2: Option A — كشف الممول يعرض التسويات المباشرة مع عمود "الطرف الآخر"
//         (اسم العميل) عبر clientsById، بدون أي تغيير في المعادلات المالية.
// ============================================================
var INVESTORS_STATE = {
search: '',
filter: '',
records: [],
currentFileId: null
};
function initInvestors() {
debug('💼 بدء تهيئة investors.js', 'info');
registerScreenLoader('investors', loadInvestors);
debug('✅ investors.js جاهز', 'success');
}
async function loadInvestors() {
debug('💼 بدأ loadInvestors', 'info');
if (!isSupabaseReady()) {
     debug('❌ Supabase غير جاهز', 'error');
     return;
 }
 showLoading();
 try {
     var query = APP.supabase
         .from('investors')
         .select('id, name, phone, email, reference_number, is_archived, created_at')
         .order('created_at', { ascending: false });
     if (INVESTORS_STATE.filter === 'active') {
         query = query.eq('is_archived', false);
     } else if (INVESTORS_STATE.filter === 'archived') {
         query = query.eq('is_archived', true);
     }
     if (INVESTORS_STATE.search) {
         var searchTerm = '%' + INVESTORS_STATE.search + '%';
         query = query.or(
             'name.ilike.' + searchTerm +
             ',reference_number.ilike.' + searchTerm +
             ',phone.ilike.' + searchTerm
         );
     }
     var result = await runQuery(
         function() { return query; },
         { context: 'loadInvestors', throwError: true }
     );
     var investors = result.data || [];
     var dataResults = await Promise.all([
         runQuery(
             function() {
                 return APP.supabase
                     .from('operation_investors')
                     .select('id, operation_id, investor_id, contribution, profit');
             },
             { context: 'loadInvestors-opInv', throwError: true }
         ),
         runQuery(
             function() {
                 return APP.supabase
                     .from('transfers')
                     .select('id, investor_id, purpose, amount');
             },
             { context: 'loadInvestors-trans', throwError: true }
         ),
         runQuery(
             function() {
                 return APP.supabase
                     .from('operations')
                     .select('id, status');
             },
             { context: 'loadInvestors-ops', throwError: true }
         )
     ]);
     var opInv = dataResults[0].data || [];
     var transfers = dataResults[1].data || [];
     var operations = dataResults[2].data || [];
     var indexes = buildInvestorsListIndexes(opInv, transfers, operations);
     var data = {
         operationInvestors: opInv,
         transfers: transfers,
         operations: operations,
         indexes: indexes
     };
     investors.forEach(function(inv) {
         inv.summary = calculateInvestorSummary(inv.id, data);
     });
     INVESTORS_STATE.records = investors;
     debug('✅ تم تحميل ' + INVESTORS_STATE.records.length + ' ممول', 'success');
     renderInvestorsList();
 } catch (err) {
     debug('❌ خطأ في loadInvestors: ' + err.message, 'error');
     showToast(handleSupabaseError(err, 'تحميل الممولين'), 'error');
 } finally {
     hideLoading();
 }
}
function buildInvestorsListIndexes(opInv, transfers, operations) {
var opInvestorsByInvestor = {};
var transfersByInvestor = {};
var operationsById = {};
opInv.forEach(function(oi) {
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
});
operations.forEach(function(op) {
operationsById[op.id] = op;
});
return {
opInvestorsByInvestor: opInvestorsByInvestor,
transfersByInvestor: transfersByInvestor,
operationsById: operationsById
};
}
function renderInvestorsList() {
var container = document.getElementById('investorsTable');
if (!container) {
     debug('⚠️ investorsTable غير موجود', 'warning');
     return;
 }
 if (INVESTORS_STATE.records.length === 0) {
     container.innerHTML = '<div class="empty-state">لا يوجد ممولين</div>';
     return;
 }
 var html = '<table>';
 html += '<thead><tr>';
 html += '<th>الرقم</th>';
 html += '<th>الاسم</th>';
 html += '<th>الهاتف</th>';
 html += '<th>رأس المال الكلي</th>';
 html += '<th>المستثمر</th>';
 html += '<th>المتاح</th>';
 html += '<th class="profit-field">أرباح مستحقة</th>';
 html += '<th>الحالة</th>';
 if (canEdit()) html += '<th>الإجراءات</th>';
 html += '</tr></thead>';
 html += '<tbody>';
 INVESTORS_STATE.records.forEach(function(inv) {
     var summary = inv.summary || {};
     var statusBadge = inv.is_archived
         ? '<span class="badge badge-inactive">أرشيف</span>'
         : '<span class="badge badge-active">نشط</span>';
     var outstandingProfitDisplay = canViewProfits()
         ? formatMoney(summary.outstandingProfit || 0)
         : '<span class="hidden-profit">****</span>';
     html += '<tr>';
     html += '<td><strong>' + escapeHtml(inv.reference_number || '-') + '</strong></td>';
     html += '<td><a href="#" class="investor-link" data-action="openInvestorFile" data-param="' + inv.id + '">' + escapeHtml(inv.name) + '</a></td>';
     html += '<td>' + escapeHtml(inv.phone || '-') + '</td>';
     html += '<td>' + formatMoney(summary.totalCapital || 0) + '</td>';
     html += '<td>' + formatMoney(summary.workingCapital || 0) + '</td>';
     html += '<td>' + formatMoney(summary.capitalPending || 0) + '</td>';
     html += '<td class="profit-field">' + outstandingProfitDisplay + '</td>';
     html += '<td>' + statusBadge + '</td>';
     if (canEdit()) {
         html += '<td class="actions-cell">';
         if (!inv.is_archived) {
             html += '<button class="btn btn-secondary btn-sm" data-action="editInvestor" data-param="' + inv.id + '">تعديل</button>';
             html += '<button class="btn btn-warning btn-sm" data-action="archiveInvestor" data-param="' + inv.id + '">أرشفة</button>';
         } else {
             html += '<button class="btn btn-info btn-sm" data-action="unarchiveInvestor" data-param="' + inv.id + '">إلغاء أرشفة</button>';
         }
         html += '</td>';
     }
     html += '</tr>';
 });
 html += '</tbody></table>';
 container.innerHTML = html;
}
async function openInvestorFile(investorId) {
debug('📂 فتح ملف الممول: ' + investorId, 'info');
if (!isSupabaseReady()) return;
INVESTORS_STATE.currentFileId = investorId;
showLoading();
try {
var results = await Promise.all([
runQuery(
function() {
return APP.supabase
.from('investors')
.select('*')
.eq('id', investorId)
.single();
},
{ context: 'openInvestorFile-investor', throwError: true }
),
runQuery(
function() {
return APP.supabase
.from('operation_investors')
.select('id, operation_id, contribution, profit')
.eq('investor_id', investorId);
},
{ context: 'openInvestorFile-opInv', throwError: true }
),
runQuery(
function() {
return APP.supabase
.from('transfers')
.select('id, reference_number, type, purpose, operation_id, investor_id, amount, transfer_date, notes, created_at')
.eq('investor_id', investorId);
},
{ context: 'openInvestorFile-trans', throwError: true }
),
runQuery(
function() {
return APP.supabase
.from('investors')
.select('id, name');
},
{ context: 'openInvestorFile-inv', throwError: true }
),
// ✅ v1.2.2: تحميل العملاء لحل اسم الطرف الآخر في التسويات
runQuery(
function() {
return APP.supabase
.from('clients')
.select('id, name');
},
{ context: 'openInvestorFile-clients', throwError: true }
)
]);
 var investor = results[0].data;
  var myContribs = results[1].data || [];
  var myTransfers = results[2].data || [];
  var investors = results[3].data || [];
  var clients = results[4].data || [];
  if (!investor) {
      showToast('الممول غير موجود', 'error');
      return;
  }
  var opsIds = myContribs.map(function(c) { return c.operation_id; });
  var operations = [];
  var operationInvestors = [];
  if (opsIds.length > 0) {
      var opsResults = await Promise.all([
          runQuery(
              function() {
                  return APP.supabase
                      .from('operations')
                      .select('id, name, type, status, amount, final_profit, start_date, end_date, is_locked, investor_display_amount, reference_number')
                      .in('id', opsIds);
              },
              { context: 'openInvestorFile-ops', throwError: true }
          ),
          runQuery(
              function() {
                  return APP.supabase
                      .from('operation_investors')
                      .select('id, operation_id, investor_id, contribution, profit')
                      .in('operation_id', opsIds);
              },
              { context: 'openInvestorFile-allOpInv', throwError: true }
          )
      ]);
      operations = opsResults[0].data || [];
      operationInvestors = opsResults[1].data || [];
  }
  var indexes = buildInvestorsFileIndexes(operations, operationInvestors, investors, myTransfers, clients);
  var data = {
      operations: operations,
      transfers: myTransfers,
      operationInvestors: operationInvestors,
      investors: investors,
      clients: clients,
      myContribs: myContribs,
      indexes: indexes
  };
  var summary = calculateInvestorSummary(investorId, data);
  var series = buildInvestorSeries(myContribs, operations);
  if (APP.currentScreen !== 'investors') {
      showScreen('investors');
  } else {
      var screens = document.querySelectorAll('.screen');
      for (var i = 0; i < screens.length; i++) {
          screens[i].classList.remove('active');
      }
      var investorsScreen = document.getElementById('investors');
      if (investorsScreen) investorsScreen.classList.add('active');
  }
  renderInvestorFile(investor, summary, data, series);
} catch (err) {
debug('❌ خطأ في openInvestorFile: ' + err.message, 'error');
showToast(handleSupabaseError(err, 'فتح ملف الممول'), 'error');
} finally {
hideLoading();
}
}
// ✅ v1.2.2: إضافة clientsById
function buildInvestorsFileIndexes(operations, operationInvestors, investors, transfers, clients) {
var operationsById = {};
var opInvestorsByOperation = {};
var opInvestorsByInvestor = {};
var investorsById = {};
var transfersByInvestor = {};
var clientsById = {};
operations.forEach(function(op) {
operationsById[op.id] = op;
});
operationInvestors.forEach(function(oi) {
if (!opInvestorsByOperation[oi.operation_id]) {
opInvestorsByOperation[oi.operation_id] = [];
}
opInvestorsByOperation[oi.operation_id].push(oi);
if (!opInvestorsByInvestor[oi.investor_id]) {
opInvestorsByInvestor[oi.investor_id] = [];
}
opInvestorsByInvestor[oi.investor_id].push(oi);
});
investors.forEach(function(inv) {
investorsById[inv.id] = inv;
});
(clients || []).forEach(function(c) {
clientsById[c.id] = c;
});
if (transfers && transfers.length > 0) {
transfers.forEach(function(t) {
if (t.investor_id) {
if (!transfersByInvestor[t.investor_id]) {
transfersByInvestor[t.investor_id] = [];
}
transfersByInvestor[t.investor_id].push(t);
}
});
}
return {
operationsById: operationsById,
opInvestorsByOperation: opInvestorsByOperation,
opInvestorsByInvestor: opInvestorsByInvestor,
investorsById: investorsById,
transfersByInvestor: transfersByInvestor,
clientsById: clientsById
};
}
function buildInvestorSeries(myContribs, operations) {
if (!myContribs || myContribs.length === 0) {
return [];
}
var operationsById = {};
operations.forEach(function(op) {
operationsById[op.id] = op;
});
var seriesMap = {};
myContribs.forEach(function(c) {
var op = operationsById[c.operation_id];
if (!op) return;
  var seriesName = op.name.replace(/\s*-\s*دورة\s*\d+$/, '').trim();
  if (!seriesMap[seriesName]) {
      seriesMap[seriesName] = {
          name: seriesName,
          operations: [],
          totalContribution: 0,
          totalProfit: 0,
          participatedCount: 0
      };
  }
  seriesMap[seriesName].operations.push({
      id: op.id,
      name: op.name,
      status: op.status,
      contribution: parseFloat(c.contribution || 0),
      profit: parseFloat(c.profit || 0)
  });
  seriesMap[seriesName].totalContribution += parseFloat(c.contribution || 0);
  seriesMap[seriesName].totalProfit += parseFloat(c.profit || 0);
  seriesMap[seriesName].participatedCount++;
});
var series = Object.keys(seriesMap).map(function(name) {
return seriesMap[name];
}).filter(function(s) {
return s.operations.length > 1;
});
series.sort(function(a, b) {
return b.operations.length - a.operations.length;
});
return series;
}
function renderInvestorFile(investor, summary, data, series) {
var container = document.getElementById('investorsTable');
if (!container) return;
var html = '';
html += renderInvestorHeader(investor);
html += renderInvestorSummaryCard(summary);
if (series && series.length > 0) {
    html += renderInvestorSeries(series);
}
html += renderInvestorTabs();
html += '<div id="investorTabOperations" class="tab-content active">';
html += renderInvestorOperations(data);
html += '</div>';
html += '<div id="investorTabStatement" class="tab-content">';
html += renderInvestorStatement(data);
html += '</div>';
container.innerHTML = html;
}
function renderInvestorHeader(investor) {
var html = '<div class="investor-file-header">';
html += '<div class="investor-header-actions">';
html += '<button class="btn btn-secondary" data-action="backToInvestorsList">← رجوع للقائمة</button>';
if (canEdit() && !investor.is_archived) {
html += '<div class="investor-header-buttons">';
html += '<button class="btn btn-secondary" data-action="editInvestor" data-param="' + investor.id + '">✏️ تعديل</button>';
html += '<button class="btn btn-warning" data-action="archiveInvestor" data-param="' + investor.id + '">📁 أرشفة</button>';
html += '</div>';
}
html += '</div>';
html += '<h2 class="investor-header-name">' + escapeHtml(investor.name) + '</h2>';
html += '<div class="investor-header-info">';
html += '<span>' + escapeHtml(investor.reference_number || '-') + '</span>';
if (investor.phone) html += '<span class="info-separator">|</span>📞 ' + escapeHtml(investor.phone);
if (investor.email) html += '<span class="info-separator">|</span>📧 ' + escapeHtml(investor.email);
html += '</div>';
if (investor.address) {
html += '<div class="investor-header-info">📍 ' + escapeHtml(investor.address) + '</div>';
}
if (investor.notes) {
html += '<div class="investor-header-info investor-header-notes">📝 ' + escapeHtml(investor.notes) + '</div>';
}
html += '</div>';
return html;
}
function renderInvestorSummaryCard(summary) {
var html = '<div class="investor-summary-card">';
html += '<h3 class="summary-title">📊 الملخص المالي</h3>';
html += '<div class="op-summary-grid">';
html += renderInvestorSummaryItem('رأس المال الكلي', formatMoney(summary.totalCapital), '');
html += renderInvestorSummaryItem('المستثمر حالياً', formatMoney(summary.workingCapital), 'orange');
html += renderInvestorSummaryItem('رأس المال المُرجع', formatMoney(summary.capitalReturned), 'green');
html += renderInvestorSummaryItem('المتاح للإرجاع', formatMoney(summary.capitalPending), 'blue');
html += renderInvestorSummaryItem(
'الأرباح المستحقة',
canViewProfits() ? formatMoney(summary.outstandingProfit) : '<span class="hidden-profit">****</span>',
canViewProfits() ? 'green' : '',
true
);
html += renderInvestorSummaryItem(
'الأرباح المصروفة',
canViewProfits() ? formatMoney(summary.profitPaid) : '<span class="hidden-profit">****</span>',
'',
true
);
html += renderInvestorSummaryItem(
'إجمالي الأرباح',
canViewProfits() ? formatMoney(summary.totalProfit) : '<span class="hidden-profit">****</span>',
canViewProfits() ? 'blue' : '',
true
);
html += renderInvestorSummaryItem('الرصيد الحالي', formatMoney(summary.currentBalance), summary.currentBalance >= 0 ? 'green' : 'red');
html += renderInvestorSummaryItem('عدد العمليات', summary.totalOperations, '');
html += renderInvestorSummaryItem('عمليات نشطة', summary.activeOperations, 'blue');
html += '</div>';
html += '</div>';
return html;
}
function renderInvestorSummaryItem(label, value, colorClass, allowHtml) {
var displayValue = allowHtml ? value : escapeHtml(value);
return '<div class="summary-item">' +
'<label>' + escapeHtml(label) + '</label>' +
'<div class="val ' + (colorClass || '') + '">' + displayValue + '</div>' +
'</div>';
}
function renderInvestorSeries(series) {
var html = '<div class="investor-series-section">';
html += '<h3 class="summary-title">🔁 السلاسل المتكررة</h3>';
series.forEach(function(s) {
html += '<div class="investor-series-card">';
html += '<div class="series-header">';
html += '<strong>' + escapeHtml(s.name) + '</strong>';
html += '<span class="series-badge">' + s.operations.length + ' دورة</span>';
html += '</div>';
  html += '<div class="series-stats">';
  html += '<div class="series-stat">';
  html += '<label>شارك في</label>';
  html += '<div>' + s.participatedCount + ' دورة</div>';
  html += '</div>';
  html += '<div class="series-stat">';
  html += '<label>إجمالي المساهمة</label>';
  html += '<div>' + formatMoney(s.totalContribution) + '</div>';
  html += '</div>';
  html += '<div class="series-stat">';
  html += '<label>إجمالي الأرباح</label>';
  html += '<div class="val green">' + (canViewProfits() ? formatMoney(s.totalProfit) : '<span class="hidden-profit">****</span>') + '</div>';
  html += '</div>';
  html += '</div>';
  html += '<div class="series-operations">';
  s.operations.forEach(function(op) {
      var statusBadge = '<span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span>';
      html += '<div class="series-operation">';
      html += '<a href="#" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.name) + '</a>';
      html += '<span>' + formatMoney(op.contribution) + '</span>';
      html += '<span class="val green">' + (canViewProfits() ? formatMoney(op.profit) : '<span class="hidden-profit">****</span>') + '</span>';
      html += statusBadge;
      html += '</div>';
  });
  html += '</div>';
  html += '</div>';
});
html += '</div>';
return html;
}
function renderInvestorTabs() {
var html = '<div class="tabs">';
html += '<button class="tab active" data-action="switchInvestorTab" data-tab="operations">العمليات</button>';
html += '<button class="tab" data-action="switchInvestorTab" data-tab="statement">كشف الحساب</button>';
html += '</div>';
return html;
}
function renderInvestorOperations(data) {
var myContribs = data.myContribs || [];
if (myContribs.length === 0) {
return '<div class="empty-state">لا توجد عمليات</div>';
}
var html = '<div class="table-scroll"><table>';
html += '<thead><tr>';
html += '<th>الرقم</th>';
html += '<th>الاسم</th>';
html += '<th>النوع</th>';
html += '<th>الحالة</th>';
html += '<th>المساهمة</th>';
html += '<th class="profit-field">الربح</th>';
html += '<th>القيمة المعروضة</th>';
html += '<th>القفل</th>';
html += '</tr></thead>';
html += '<tbody>';
myContribs.forEach(function(c) {
var op = data.indexes.operationsById[c.operation_id];
if (!op) return;
 var statusBadge = '<span class="badge badge-' + op.status + '">' + getStatusText(op.status) + '</span>';
  var lockIcon = op.is_locked ? '🔒' : '🔓';
  var displayAmount = op.investor_display_amount
      ? formatMoney(op.investor_display_amount)
      : formatMoney(op.amount);
  html += '<tr>';
  html += '<td><a href="#" data-action="openOperationDetails" data-param="' + op.id + '">' + escapeHtml(op.reference_number || '-') + '</a></td>';
  html += '<td>' + escapeHtml(op.name) + '</td>';
  html += '<td>' + getOperationTypeText(op.type) + '</td>';
  html += '<td>' + statusBadge + '</td>';
  html += '<td>' + formatMoney(c.contribution) + '</td>';
  html += '<td class="profit-field">' + (canViewProfits() ? formatMoney(c.profit) : '<span class="hidden-profit">****</span>') + '</td>';
  html += '<td>' + displayAmount + '</td>';
  html += '<td>' + lockIcon + '</td>';
  html += '</tr>';
});
html += '</tbody></table></div>';
return html;
}
// ✅ v1.2.2: تمرير clientsById إلى buildStatement
function buildInvestorStatement(data) {
var myTransfers = data.transfers || [];
if (myTransfers.length === 0) {
return [];
}
var opsById = {};
(data.operations || []).forEach(function(op) { opsById[op.id] = op; });
var indexes = {
operationsById: opsById,
investorsById: data.indexes.investorsById || {},
clientsById: data.indexes.clientsById || {}
};
return buildStatement(myTransfers, indexes, 'investor');
}
// ✅ v1.2.2: عمود "الطرف الآخر" (اسم العميل)
function renderInvestorStatement(data) {
var statement = buildInvestorStatement(data);
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
html += '<th>الطرف الآخر</th>';
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
 html += '<td>' + escapeHtml(item.client || '-') + '</td>';
 html += '<td class="amount-debit">' + amountDebit + '</td>';
 html += '<td class="amount-credit">' + amountCredit + '</td>';
 html += '<td class="balance-' + balanceClass + '">' + formatMoney(item.runningBalance) + '</td>';
 html += '<td>' + escapeHtml(truncateText(item.notes, 30)) + '</td>';
 html += '</tr>';
});
html += '</tbody></table></div>';
return html;
}
async function openInvestorModal(investorId) {
if (!canEdit()) {
showToast('❌ لا توجد صلاحية', 'error');
return;
}
var titleEl = document.getElementById('investorModalTitle');
 var idEl = document.getElementById('investorId');
 var nameEl = document.getElementById('investorName');
 var phoneEl = document.getElementById('investorPhone');
 var emailEl = document.getElementById('investorEmail');
 var addressEl = document.getElementById('investorAddress');
 var notesEl = document.getElementById('investorNotes');
 if (!titleEl || !idEl) {
     debug('⚠️ عناصر Modal غير موجودة', 'warning');
     return;
 }
 if (investorId) {
     try {
         var result = await runQuery(
             function() {
                 return APP.supabase
                     .from('investors')
                     .select('*')
                     .eq('id', investorId)
                     .single();
             },
             { context: 'openInvestorModal', throwError: true }
         );
         var inv = result.data;
         if (!inv) {
             showToast('الممول غير موجود', 'error');
             return;
         }
         titleEl.textContent = 'تعديل ممول';
         idEl.value = inv.id;
         nameEl.value = inv.name || '';
         phoneEl.value = inv.phone || '';
         emailEl.value = inv.email || '';
         addressEl.value = inv.address || '';
         notesEl.value = inv.notes || '';
     } catch (err) {
         debug('❌ خطأ في openInvestorModal: ' + err.message, 'error');
         showToast(handleSupabaseError(err, 'فتح بيانات الممول'), 'error');
         return;
     }
 } else {
     titleEl.textContent = 'إضافة ممول';
     idEl.value = '';
     nameEl.value = '';
     phoneEl.value = '';
     emailEl.value = '';
     addressEl.value = '';
     notesEl.value = '';
 }
 openModal('investorModal');
}
async function saveInvestor() {
if (!canEdit()) {
showToast('❌ لا توجد صلاحية', 'error');
return;
}
var id = document.getElementById('investorId').value;
 var name = document.getElementById('investorName').value.trim();
 var phone = document.getElementById('investorPhone').value.trim();
 var email = document.getElementById('investorEmail').value.trim();
 var address = document.getElementById('investorAddress').value.trim();
 var notes = document.getElementById('investorNotes').value.trim();
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
                 return APP.supabase.from('investors').select('*').eq('id', id).single();
             },
             { context: 'saveInvestor-getOld', throwError: true }
         );
         await runQuery(
             function() {
                 return APP.supabase.from('investors').update(data).eq('id', id);
             },
             { context: 'saveInvestor-update', throwError: true }
         );
         if (typeof window.logActivityToDB === 'function') {
             window.logActivityToDB(
                 'تعديل ممول', 'investor', id,
                 JSON.stringify(oldResult.data), JSON.stringify(data),
                 'Name: ' + data.name, 'update'
             );
         }
         debug('✅ تم تحديث الممول', 'success');
         showToast('تم تحديث الممول', 'success');
     } else {
         var result = await runQuery(
             function() {
                 return APP.supabase.from('investors').insert(data).select();
             },
             { context: 'saveInvestor-insert', throwError: true }
         );
         if (result.data && result.data[0]) {
             if (typeof window.logActivityToDB === 'function') {
                 window.logActivityToDB(
                     'إضافة ممول', 'investor', result.data[0].id,
                     null, JSON.stringify(data),
                     'Name: ' + data.name + ', Ref: ' + (result.data[0].reference_number || ''),
                     'create'
                 );
             }
             debug('✅ تم إضافة الممول', 'success');
             showToast('تم إضافة الممول', 'success');
         }
     }
     closeModal('investorModal');
     if (INVESTORS_STATE.currentFileId && id === INVESTORS_STATE.currentFileId) {
         openInvestorFile(id);
     } else {
         loadInvestors();
     }
 } catch (err) {
     debug('❌ خطأ في saveInvestor: ' + err.message, 'error');
     showToast(handleSupabaseError(err, 'حفظ الممول'), 'error');
 } finally {
     hideLoading();
 }
}
async function archiveInvestor(investorId) {
if (!canEdit()) {
showToast('❌ لا توجد صلاحية', 'error');
return;
}
if (!isSupabaseReady()) return;
 showLoading();
 try {
     var results = await Promise.all([
         runQuery(
             function() {
                 return APP.supabase.from('investors').select('name').eq('id', investorId).single();
             },
             { context: 'archiveInvestor-getName', throwError: true }
         ),
         runQuery(
             function() {
                 return APP.supabase
                     .from('operation_investors')
                     .select('id, operation_id')
                     .eq('investor_id', investorId);
             },
             { context: 'archiveInvestor-checkContribs', throwError: true }
         )
     ]);
     var invName = results[0].data ? results[0].data.name : '';
     var contribs = results[1].data || [];
     if (contribs.length > 0) {
         var opsIds = contribs.map(function(c) { return c.operation_id; });
         var opsResult = await runQuery(
             function() {
                 return APP.supabase
                     .from('operations')
                     .select('id, status')
                     .in('id', opsIds)
                     .in('status', [STATUS.DRAFT, STATUS.ACTIVE]);
             },
             { context: 'archiveInvestor-checkOps', throwError: true }
         );
         var activeOps = opsResult.data || [];
         if (activeOps.length > 0) {
             showToast('❌ لا يمكن الأرشفة - الممول لديه مساهمات في ' + activeOps.length + ' عملية نشطة/مسودة', 'error');
             return;
         }
     }
     var data = await loadInvestorsFileData(investorId);
     var summary = calculateInvestorSummary(investorId, data);
     if (summary.capitalPending > 0.01) {
         showToast('❌ لا يمكن الأرشفة - الممول لديه رأس مال لم يُرجع: ' + formatMoney(summary.capitalPending), 'error');
         return;
     }
     if (summary.outstandingProfit > 0.01) {
         showToast('❌ لا يمكن الأرشفة - الممول لديه أرباح مستحقة: ' + formatMoney(summary.outstandingProfit), 'error');
         return;
     }
     if (!confirmArchive(invName)) {
         return;
     }
     await runQuery(
         function() {
             return APP.supabase.from('investors').update({ is_archived: true }).eq('id', investorId);
         },
         { context: 'archiveInvestor-update', throwError: true }
     );
     if (typeof window.logActivityToDB === 'function') {
         window.logActivityToDB(
             'أرشفة ممول', 'investor', investorId,
             'نشط', 'أرشيف', 'Name: ' + invName, 'archive'
         );
     }
     debug('✅ تم أرشفة الممول', 'success');
     showToast('تمت الأرشفة', 'success');
     if (INVESTORS_STATE.currentFileId === investorId) {
         INVESTORS_STATE.currentFileId = null;
     }
     loadInvestors();
 } catch (err) {
     debug('❌ خطأ في archiveInvestor: ' + err.message, 'error');
     showToast(handleSupabaseError(err, 'أرشفة الممول'), 'error');
 } finally {
     hideLoading();
 }
}
async function unarchiveInvestor(investorId) {
if (!canEdit()) {
showToast('❌ لا توجد صلاحية', 'error');
return;
}
if (!isSupabaseReady()) return;
 showLoading();
 try {
     var invResult = await runQuery(
         function() {
             return APP.supabase.from('investors').select('name').eq('id', investorId).single();
         },
         { context: 'unarchiveInvestor-getName', throwError: true }
     );
     var invName = invResult.data ? invResult.data.name : '';
     if (!confirmUnarchive(invName)) {
         return;
     }
     await runQuery(
         function() {
             return APP.supabase.from('investors').update({ is_archived: false }).eq('id', investorId);
         },
         { context: 'unarchiveInvestor-update', throwError: true }
     );
     if (typeof window.logActivityToDB === 'function') {
         window.logActivityToDB(
             'إلغاء أرشفة ممول', 'investor', investorId,
             'أرشيف', 'نشط', 'Name: ' + invName, 'unarchive'
         );
     }
     debug('✅ تم إلغاء الأرشفة', 'success');
     showToast('تم إلغاء الأرشفة', 'success');
     loadInvestors();
 } catch (err) {
     debug('❌ خطأ في unarchiveInvestor: ' + err.message, 'error');
     showToast(handleSupabaseError(err, 'إلغاء الأرشفة'), 'error');
 } finally {
     hideLoading();
 }
}
async function loadInvestorsFileData(investorId) {
var results = await Promise.all([
runQuery(
function() {
return APP.supabase
.from('operation_investors')
.select('id, operation_id, contribution, profit')
.eq('investor_id', investorId);
},
{ context: 'loadInvestorsFileData-opInv', throwError: true }
),
runQuery(
function() {
return APP.supabase
.from('transfers')
.select('id, investor_id, purpose, amount')
.eq('investor_id', investorId);
},
{ context: 'loadInvestorsFileData-trans', throwError: true }
),
runQuery(
function() {
return APP.supabase
.from('operations')
.select('id, status');
},
{ context: 'loadInvestorsFileData-ops', throwError: true }
)
]);
var opInv = results[0].data || [];
var transfers = results[1].data || [];
var operations = results[2].data || [];
var indexes = buildInvestorsListIndexes(opInv, transfers, operations);
return {
operationInvestors: opInv,
transfers: transfers,
operations: operations,
indexes: indexes
};
}
function searchInvestors(searchTerm) {
INVESTORS_STATE.search = searchTerm;
loadInvestors();
}
function filterInvestors(filterValue) {
INVESTORS_STATE.filter = filterValue;
loadInvestors();
}
function backToInvestorsList() {
INVESTORS_STATE.currentFileId = null;
loadInvestors();
}
function switchInvestorTab(tabName, btn) {
var tabs = document.querySelectorAll('#investorsTable .tab');
for (var i = 0; i < tabs.length; i++) {
tabs[i].classList.remove('active');
}
var contents = document.querySelectorAll('#investorsTable .tab-content');
for (var i = 0; i < contents.length; i++) {
    contents[i].classList.remove('active');
}
if (btn) btn.classList.add('active');
var contentId = 'investorTab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
var content = document.getElementById(contentId);
if (content) content.classList.add('active');
debug('📑 تبديل تبويب الممول: ' + tabName, 'info');
}
// ============================================================
// END OF INVESTORS.JS (v1.2.2)
// ============================================================
