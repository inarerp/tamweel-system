// ============================================================
// نظام إدارة التمويل - Users Management Module
// Version: 3.1.0 (Entity Association + Username + Create/Password)
// ============================================================
var USERS_STATE = { search:'', records:[], referenceCache:{clients:null,investors:null}, lastSignInCache:null, eventsBound:false, changePasswordUserId:null };

var AVAILABLE_ROLES = Object.freeze([
  { value:'admin', text:'مدير' }, { value:'viewer', text:'مراقب' },
  { value:'client', text:'عميل' }, { value:'investor', text:'ممول' }
]);
var AVAILABLE_PERMISSIONS = Object.freeze([
  { value:'admin', text:'صلاحيات كاملة' }, { value:'viewer', text:'مشاهدة فقط' }
]);
var ROLE_PERMISSION_RULES = Object.freeze({
  admin:{ allowed:['admin'], reason:'الدور Admin يتطلب صلاحية كاملة' },
  viewer:{ allowed:['viewer'], reason:'الدور مراقب يتطلب صلاحية مشاهدة فقط' },
  client:{ allowed:['admin','viewer'], reason:'' },
  investor:{ allowed:['admin','viewer'], reason:'' }
});
var ROLES_REQUIRING_ENTITY = Object.freeze(['client','investor']);
var USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;

function initUsers(){ registerScreenLoader('users', loadUsers); bindUserModalEvents(); }

function bindUserModalEvents(){
  if (USERS_STATE.eventsBound) return;
  var e = document.getElementById('userRoleSelect');
  if (e) e.addEventListener('change', function(){
    populateEntitySelectFor(this.value, document.getElementById('userEntitySelect').value, 'userEntitySelect','userEntityType','userEntityRow','userEntityLabel');
    updatePermissionOptionsFor(this.value, null, 'userPermissionSelect');
  });
  var c = document.getElementById('createUserRoleSelect');
  if (c) c.addEventListener('change', function(){
    populateEntitySelectFor(this.value, '', 'createUserEntitySelect','createUserEntityType','createUserEntityRow','createUserEntityLabel');
    updatePermissionOptionsFor(this.value, null, 'createUserPermissionSelect');
  });
  USERS_STATE.eventsBound = true;
}

// ---------- LOAD ----------
async function loadUsers(){
  if (!isAdmin()) { showToast('❌ لا توجد صلاحية','error'); if (typeof showScreen==='function') showScreen('dashboard'); return; }
  if (!isSupabaseReady()) return;
  showLoading();
  try {
    var results = await Promise.all([
      runQuery(function(){ return APP.supabase.from('user_profiles')
        .select('id, email, username, role, entity_id, permission, is_active, created_at, updated_at')
        .order('created_at',{ascending:false}); },{context:'loadUsers',throwError:true}),
      loadClientsForUsers(), loadInvestorsForUsers(), loadLastSignInData()
    ]);
    var profiles = results[0].data||[], idx = buildUsersIndexes(results[1]||[], results[2]||[]), last = results[3]||{};
    profiles.forEach(function(p){
      p.last_sign_in = last[p.id]||null;
      if (p.role==='client' && p.entity_id){ p.entity=idx.clientsById[p.entity_id]||null; p.entityType='client'; }
      else if (p.role==='investor' && p.entity_id){ p.entity=idx.investorsById[p.entity_id]||null; p.entityType='investor'; }
      else { p.entity=null; p.entityType=null; }
    });
    var filtered = profiles;
    if (USERS_STATE.search){ var t=USERS_STATE.search.toLowerCase();
      filtered = profiles.filter(function(p){ return (p.username&&p.username.toLowerCase().indexOf(t)!==-1)||(p.entity&&p.entity.name&&p.entity.name.toLowerCase().indexOf(t)!==-1)||(p.role&&p.role.indexOf(t)!==-1); }); }
    USERS_STATE.records = filtered; renderUsersList();
  } catch(err){ showToast(handleSupabaseError(err,'تحميل المستخدمين'),'error'); }
  finally { hideLoading(); }
}
async function loadLastSignInData(){
  if (USERS_STATE.lastSignInCache) return USERS_STATE.lastSignInCache;
  try { var r = await runQuery(function(){ return APP.supabase.rpc('get_users_last_sign_in'); },{context:'lastSignIn',throwError:false});
    var m={}; (r.data||[]).forEach(function(x){ m[x.user_id]=x.last_sign_in_at; }); USERS_STATE.lastSignInCache=m; return m;
  } catch(e){ return {}; }
}
async function loadClientsForUsers(){ if (USERS_STATE.referenceCache.clients) return USERS_STATE.referenceCache.clients;
  var r = await runQuery(function(){ return APP.supabase.from('clients').select('id, name, is_archived').eq('is_archived',false).order('name'); },{context:'clientsForUsers',throwError:true});
  USERS_STATE.referenceCache.clients=r.data||[]; return USERS_STATE.referenceCache.clients; }
async function loadInvestorsForUsers(){ if (USERS_STATE.referenceCache.investors) return USERS_STATE.referenceCache.investors;
  var r = await runQuery(function(){ return APP.supabase.from('investors').select('id, name, is_archived').eq('is_archived',false).order('name'); },{context:'investorsForUsers',throwError:true});
  USERS_STATE.referenceCache.investors=r.data||[]; return USERS_STATE.referenceCache.investors; }
function buildUsersIndexes(c,i){ var a={},b={}; c.forEach(function(x){a[x.id]=x;}); i.forEach(function(x){b[x.id]=x;}); return {clientsById:a,investorsById:b}; }

// ---------- RENDER ----------
function renderUsersList(){
  var el = document.getElementById('usersTable'); if (!el) return;
  if (!USERS_STATE.records.length){ el.innerHTML='<div class="empty-state">لا يوجد مستخدمين</div>'; return; }
  var h='<table><thead><tr><th>اسم المستخدم</th><th>الدور</th><th>الصلاحية</th><th>الكيان المرتبط</th><th>الحالة</th><th>آخر دخول</th><th>الإجراءات</th></tr></thead><tbody>';
  USERS_STATE.records.forEach(function(p){
    var isMe = APP.currentUser && APP.currentUser.id===p.id;
    var ent='-'; if (p.entity) ent=escapeHtml(p.entity.name); else if (p.entity_id) ent='<span class="badge badge-inactive">⚠️ كيان محذوف</span>';
    h+='<tr><td><strong>'+escapeHtml(p.username||'-')+'</strong>'+(isMe?' <span class="badge badge-admin">(أنت)</span>':'')+'</td>'
      +'<td><span class="badge badge-'+p.role+'">'+getUserRoleText(p.role)+'</span></td>'
      +'<td><span class="badge badge-'+p.permission+'">'+(p.permission==='admin'?'صلاحيات كاملة':'مشاهدة فقط')+'</span></td>'
      +'<td>'+ent+'</td>'
      +'<td>'+(p.is_active?'<span class="badge badge-active">مفعل</span>':'<span class="badge badge-inactive">معطل</span>')+'</td>'
      +'<td>'+(p.last_sign_in?formatDateTime(p.last_sign_in):'-')+'</td>'
      +'<td class="actions-cell">'
      +'<button class="btn btn-secondary btn-sm" data-action="editUser" data-param="'+p.id+'">تعديل</button>'
      +'<button class="btn btn-info btn-sm" data-action="changeUserPassword" data-param="'+p.id+'">كلمة المرور</button>'
      +(!isMe?'<button class="btn '+(p.is_active?'btn-warning':'btn-success')+' btn-sm" data-action="toggleUserActive" data-param="'+p.id+'">'+(p.is_active?'تعطيل':'تفعيل')+'</button>':'')
      +'</td></tr>';
  });
  h+='</tbody></table>'; el.innerHTML=h;
}

// ---------- PERMISSION / ENTITY HELPERS ----------
function updatePermissionOptionsFor(role, current, selectId){
  var el=document.getElementById(selectId); if(!el) return;
  var rules=ROLE_PERMISSION_RULES[role]; if(!rules) return;
  el.innerHTML = AVAILABLE_PERMISSIONS.filter(function(p){return rules.allowed.indexOf(p.value)!==-1;})
    .map(function(p){return '<option value="'+p.value+'"'+(current===p.value?' selected':'')+'>'+p.text+'</option>';}).join('');
  if(!current||rules.allowed.indexOf(current)===-1) el.value=rules.allowed[0];
}
function populateEntitySelectFor(role, selectedId, selId, typeId, rowId, labelId){
  var sel=document.getElementById(selId), typeEl=document.getElementById(typeId), row=document.getElementById(rowId), lbl=document.getElementById(labelId);
  if(!sel) return;
  if (ROLES_REQUIRING_ENTITY.indexOf(role)===-1){ if(row)row.style.display='none'; sel.innerHTML=''; if(typeEl)typeEl.value=''; return; }
  if(row)row.style.display='block'; if(typeEl)typeEl.value=role;
  if(lbl) lbl.textContent = (role==='client'?'العميل المرتبط *':'الممول المرتبط *');
  var list = role==='client'?(USERS_STATE.referenceCache.clients||[]):(USERS_STATE.referenceCache.investors||[]);
  sel.innerHTML='<option value="">-- اختر --</option>'+list.map(function(e){return '<option value="'+e.id+'"'+(e.id===selectedId?' selected':'')+'>'+escapeHtml(e.name)+'</option>';}).join('');
}

// ---------- EDIT ----------
async function openUserModal(userId){
  if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  await Promise.all([loadClientsForUsers(), loadInvestorsForUsers()]);
  var p=USERS_STATE.records.find(function(x){return x.id===userId;}); if(!p){showToast('❌ غير موجود','error');return;}
  var isMe = APP.currentUser && APP.currentUser.id===p.id;
  document.getElementById('userModalTitle').textContent='تعديل المستخدم';
  document.getElementById('userId').value=p.id;
  document.getElementById('userUsernameInput').value=p.username||'';
  document.getElementById('userRoleSelect').innerHTML = AVAILABLE_ROLES.map(function(r){return '<option value="'+r.value+'"'+(r.value===p.role?' selected':'')+'>'+r.text+'</option>';}).join('');
  updatePermissionOptionsFor(p.role, p.permission, 'userPermissionSelect');
  populateEntitySelectFor(p.role, p.entity_id, 'userEntitySelect','userEntityType','userEntityRow','userEntityLabel');
  var a=document.getElementById('userActiveSelect'); a.value=p.is_active?'true':'false'; a.disabled=isMe;
  openModal('userModal');
}
function collectEditData(){ return { id:document.getElementById('userId').value,
  username:document.getElementById('userUsernameInput').value.trim().toLowerCase(),
  role:document.getElementById('userRoleSelect').value,
  permission:document.getElementById('userPermissionSelect').value,
  entityId:document.getElementById('userEntitySelect').value,
  isActive:document.getElementById('userActiveSelect').value==='true' }; }
function validateProfile(f){
  if(!USERNAME_RE.test(f.username)){showToast('❌ اسم مستخدم غير صالح','error');return false;}
  var r=ROLE_PERMISSION_RULES[f.role]; if(r.allowed.indexOf(f.permission)===-1){showToast('❌ '+r.reason,'error');return false;}
  if(ROLES_REQUIRING_ENTITY.indexOf(f.role)!==-1 && isEmpty(f.entityId)){showToast('❌ يجب ربط المستخدم بكيان','error');return false;}
  if(ROLES_REQUIRING_ENTITY.indexOf(f.role)===-1) f.entityId='';
  return true;
}
async function saveUserProfile(){
  if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  var f=collectEditData(); if(!validateProfile(f)) return;
  showLoading();
  try {
    await runQuery(function(){ return APP.supabase.from('user_profiles').update({
      username:f.username, role:f.role, permission:f.permission, entity_id:f.entityId||null, is_active:f.isActive }).eq('id',f.id); },{context:'saveUserProfile',throwError:true});
    showToast('تم تحديث المستخدم','success'); closeModal('userModal'); loadUsers();
  } catch(err){ showToast(translateProfileError(err),'error'); }
  finally { hideLoading(); }
}
function translateProfileError(err){ var m=err.message||'';
  if(err.code==='23505'||m.indexOf('username')!==-1) return '❌ اسم المستخدم مستخدم بالفعل';
  if(m.indexOf('آخر مدير')!==-1||m.indexOf('يتطلب')!==-1||m.indexOf('مؤرشف')!==-1||m.indexOf('غير موجود')!==-1) return '❌ '+m;
  return '❌ '+handleSupabaseError(err,'حفظ التغييرات'); }

// ---------- CREATE ----------
function openCreateUserModal(){
  if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  document.getElementById('createUsername').value=''; document.getElementById('createPassword').value='';
  document.getElementById('createUserRoleSelect').innerHTML = AVAILABLE_ROLES.map(function(r){return '<option value="'+r.value+'">'+r.text+'</option>';}).join('');
  updatePermissionOptionsFor('admin', null, 'createUserPermissionSelect');
  populateEntitySelectFor('admin','', 'createUserEntitySelect','createUserEntityType','createUserEntityRow','createUserEntityLabel');
  document.getElementById('createUserStatus').value='true';
  openModal('createUserModal');
}
async function saveNewUser(){
  if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  var username=document.getElementById('createUsername').value.trim().toLowerCase();
  var password=document.getElementById('createPassword').value;
  var role=document.getElementById('createUserRoleSelect').value;
  var permission=document.getElementById('createUserPermissionSelect').value;
  var entityId=document.getElementById('createUserEntitySelect').value;
  var isActive=document.getElementById('createUserStatus').value==='true';
  if(!USERNAME_RE.test(username)){showToast('❌ اسم مستخدم غير صالح','error');return;}
  if(password.length<6){showToast('❌ كلمة المرور 6 أحرف على الأقل','error');return;}
  var r=ROLE_PERMISSION_RULES[role]; if(r.allowed.indexOf(permission)===-1){showToast('❌ '+r.reason,'error');return;}
  if(ROLES_REQUIRING_ENTITY.indexOf(role)!==-1 && isEmpty(entityId)){showToast('❌ يجب ربط المستخدم بكيان','error');return;}
  showLoading();
  try {
    var res = await APP.supabase.functions.invoke('admin_user_ops',{body:{action:'create_user',username:username,password:password,role:role,permission:permission,entity_id:entityId||null,is_active:isActive}});
    var d=res.data||{};
    if(res.error||!d.ok){showToast('❌ '+(d.error||'فشل الإنشاء'),'error');}
    else {showToast('تم إنشاء المستخدم','success'); closeModal('createUserModal'); USERS_STATE.lastSignInCache=null; loadUsers();}
  } catch(err){ showToast('❌ '+err.message,'error'); }
  finally { hideLoading(); }
}

// ---------- CHANGE PASSWORD ----------
function changeUserPassword(userId){ if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  USERS_STATE.changePasswordUserId=userId; document.getElementById('newPassword').value=''; document.getElementById('confirmPassword').value='';
  openModal('changePasswordModal'); }
async function savePasswordChange(){ if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  var p1=document.getElementById('newPassword').value, p2=document.getElementById('confirmPassword').value;
  if(p1.length<6){showToast('❌ كلمة المرور 6 أحرف على الأقل','error');return;}
  if(p1!==p2){showToast('❌ غير متطابقتين','error');return;}
  showLoading();
  try { var res=await APP.supabase.functions.invoke('admin_user_ops',{body:{action:'set_password',user_id:USERS_STATE.changePasswordUserId,new_password:p1}});
    var d=res.data||{}; if(res.error||!d.ok) showToast('❌ '+(d.error||'فشل'),'error'); else {showToast('تم تغيير كلمة المرور','success'); closeModal('changePasswordModal');}
  } catch(err){ showToast('❌ '+err.message,'error'); }
  finally { hideLoading(); }
}

// ---------- TOGGLE ----------
async function toggleUserActive(userId){ if(!isAdmin()){showToast('❌ لا توجد صلاحية','error');return;}
  var p=USERS_STATE.records.find(function(x){return x.id===userId;}); if(!p) return;
  if(APP.currentUser&&APP.currentUser.id===p.id){showToast('❌ لا يمكنك تعطيل حسابك','error');return;}
  var ns=!p.is_active; if(!confirmAction((ns?'تفعيل':'تعطيل')+' المستخدم: '+(p.username||'-'))) return;
  showLoading();
  try { await runQuery(function(){ return APP.supabase.from('user_profiles').update({is_active:ns}).eq('id',userId); },{context:'toggleUser',throwError:true});
    showToast('تم '+(ns?'تفعيل':'تعطيل')+' المستخدم','success'); loadUsers();
  } catch(err){ showToast(translateProfileError(err),'error'); }
  finally { hideLoading(); }
}

function searchUsers(t){ USERS_STATE.search=t; loadUsers(); }
function clearUsersReferenceCache(){ USERS_STATE.referenceCache.clients=null; USERS_STATE.referenceCache.investors=null; }
window.clearUsersReferenceCache = clearUsersReferenceCache;
function editUser(id){ openUserModal(id); }
// ============================================================
// INIT — ضمان ربط أحداث الـ Modals
// (app.js يسجّل loadUsers مباشرة ولا يستدعي initUsers،
//  لذلك نربط الأحداث هنا عند تحميل السكربت — مثل reports.js)
// ============================================================
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initUsers(); });
    } else {
        initUsers();
    }
}
// ============================================================
// END OF USERS.JS
// ============================================================
// ============================================================
// END OF USERS.JS (v3.1.0)
// ============================================================
