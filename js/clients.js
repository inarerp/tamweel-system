// ============================================================
// نظام إدارة التمويل - Clients Module
// Version: 2.0.2
// v2.0.2: Option A — كشف العميل يعرض التسويات المباشرة (investor_to_client /
//         client_to_investor) سواء المرتبطة بعملية أو standalone، مع عمود
//         "الطرف الآخر" (اسم الممول)، بدون التأثير على أي معادلة مالية.
// ============================================================
var CLIENTS_STATE = {
search: '',
filter: '',
records: [],
currentFileId: null
};
function initClients() {
debug('👥 بدء تهيئة clients.js', 'info');
registerScreenLoader('clients', loadClients);
debug('✅ clients.js جاهز', 'success');
}
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
     if (CLIENTS_STATE.filter === 'active') {
         query = query.eq('is_archived', false);
     } else if (CLIENTS_STATE.filter === 'archived') {
         query = query.eq('is_archived', true);
     }
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
async function openClientFile(clientId) {
debug('📂 فتح ملف العميل: ' + clientId, 'info');
if (!isSupabaseReady()) return;
CLIENTS_STATE.currentFileId = clientId;
showLoading();
try {
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
.select('id, reference_number, name, type, status, amount, client_id, final_profit, profit_approval_date, start_date, end_date, created_at, is_locked')
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
  } else {
      var invOnly = await runQuery(
          function() { return APP.supabase.from('investors').select('id, name'); },
          { context: 'openClientFile-inv-only', throwError: true }
      );
      investors = invOnly.data || [];
  }
  // ✅ v2.0.2: تحميل التسويات المباشرة standalone (operation_id=null) لهذا العميل
  var standaloneResult = await runQuery(
      function() {
          return APP.supabase
              .from('transfers')
              .select('id, reference_number, type, purpose, operation_id, investor_id, amount, transfer_date, notes, created_at')
              .eq('client_id', clientId)
              .is('operation_id', null)
              .in('type', ['investor_to_client', 'client_to_investor']);
      },
      { context: 'openClientFile-standalone', throwError: true }
  );
  var standaloneTransfers = standaloneResult.data || [];
  // دمج بدون تكرار (dedupe بالـ id)
  var seen = {};
  transfers.forEach(function(t) { seen[t.id] = true; });
  standaloneTransfers.forEach(function(t) { if (!seen[t.id]) { transfers.push(t); seen[t.id] = true; } });
  var indexes = buildClientsFileIndexes(operations, transfers, operationInvestors, investors);
  var data = {
      operations: operations,
      transfers: transfers,
      operationInvestors: operationInvestors,
      investors: investors,
      indexes: indexes
  };
  var summary = calculateClientSummary(clientId, data);
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
  renderClientFile(client, summary, data);
} catch (err) {
debug('❌ خطأ في openClientFile: ' + err.message, 'error');
showToast(handleSupabaseError(err, 'فتح ملف العميل'), 'error');
} finally {
hideLoading();
}
}
function buildClientsFileIndexes(operations, transfers, operationInvestors, investors) {
var transfersByOperation = {};
var opInvestorsByOperation = {};
var investorsById = {};
var clientOperations = {};
operations.forEach(function(op) {
if (!clientOperations[op.client_id]) {
clientOperations[op.client_id] = [];
}
clientOperations[op.client_id].push(op);
});
transfers.forEach(function(t) {
if (t.operation_id) {
if (!transfersByOperation[t.operation_id]) {
transfersByOperation[t.operation_id] = [];
}
transfersByOperation[t.operation_id].push(t);
}
});
operationInvestors.forEach(function(oi) {
if (!opInvestorsByOperation[oi.operation_id]) {
opInvestorsByOperation[oi.operation_id] = [];
}
opInvestorsByOperation[oi.operation_id].push(oi);
});
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
html += '<h2 class="client-file-name">' + escapeHtml(client.name) + '</h2>';
html += '<div class="client-header-info">';
html += '<span>' + escapeHtml(client.reference_number || '-') + '</span>';
if (client.phone) html += '<span class="info-separator">|</span>📞 ' + escapeHtml(client.phone);
if (client.email) html += '<span class="info-separator">|</span>📧 ' + escapeHtml(client.email);
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
function renderSummaryItem(label, value, colorClass) {
return '<div class="summary-item">' +
'<label>' + escapeHtml(label) + '</label>' +
'<div class="val ' + (colorClass || '') + '">' + value + '</div>' +
'</div>';
}
function renderClientTabs() {
var html = '<div class="tabs">';
html += '<button class="tab active" data-action="switchClientTab" data-tab="operations">العمليات</button>';
html += '<button class="tab" data-action="switchClientTab" data-tab="statement">كشف الحساب</button>';
html += '</div>';
return html;
}
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
html += '<th>قيمة العملية</th>';
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
// ✅ v2.0.2: الكشف يبني من data.transfers المدموجة (عمليات + standalone settlements)
function buildClientStatement(clientId, data) {
var clientTransfers = data.transfers || [];
if (clientTransfers.length === 0) {
return [];
}
var ops = data.indexes.clientOperations[clientId] || [];
var opsById = {};
ops.forEach(function(op) { opsById[op.id] = op; });
(data.operations || []).forEach(function(op) { if (!opsById[op.id]) opsById[op.id] = op; });
var indexes = {
operationsById: opsById,
investorsById: data.indexes.investorsById || {}
};
return buildStatement(clientTransfers, indexes, 'client');
}
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
 html += '<td>' + escapeHtml(item.investor || '-') + '</td>';
 html += '<td class="amount-debit">' + amountDebit + '</td>';
 html += '<td class="amount-credit">' + amountCredit + '</td>';
 html += '<td class="balance-' + balanceClass + '">' + formatMoney(item.runningBalance) + '</td>';
 html += '<td>' + escapeHtml(truncateText(item.notes, 30)) + '</td>';
 html += '</tr>';
});
html += '</tbody></table></div>';
return html;
}
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
var id = document.getElementById('clientId').value;
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
         showToast('تم تحديث
