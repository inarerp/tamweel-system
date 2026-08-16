// ============================================================
// نظام إدارة التمويل - Auth Module
// Version: 2.3.0 (Username + Password login)
// ============================================================
function clearUserState() {
    APP.currentUser = null; APP.userRole = null; APP.userPermission = null;
    APP.currentEntityId = null; APP.currentOperation = null; APP.currentOperationData = null;
    APP.userName = null;
    debug('🧹 تم تنظيف حالة المستخدم', 'info');
}
function isValidUsername(v) { return /^[a-zA-Z0-9_.-]{3,30}$/.test(v); }

async function handleLoginClick() {
    debug('🔐 بدء تسجيل الدخول', 'info');
    var usernameEl = document.getElementById('loginUsername');
    var passEl = document.getElementById('loginPassword');
    var errorMsg = document.getElementById('errorMsg');
    if (!usernameEl || !passEl) { debug('❌ عناصر تسجيل الدخول غير موجودة', 'error'); return; }
    var username = usernameEl.value.trim();
    var password = passEl.value;
    if (isEmpty(username) || isEmpty(password)) {
        if (errorMsg) { errorMsg.textContent = '⚠️ يرجى إدخال اسم المستخدم وكلمة المرور'; errorMsg.style.display = 'block'; } return;
    }
    if (!isValidUsername(username)) {
        if (errorMsg) { errorMsg.textContent = '⚠️ صيغة اسم المستخدم غير صحيحة'; errorMsg.style.display = 'block'; } return;
    }
    if (!isSupabaseReady()) {
        if (errorMsg) { errorMsg.textContent = '❌ خطأ في الاتصال بقاعدة البيانات'; errorMsg.style.display = 'block'; } return;
    }
    if (errorMsg) errorMsg.style.display = 'none';
    setButtonLoading('loginBtn', true);
    try {
        // 1) username → email التقني/الفعلي عبر RPC (آمن لـ anon)
        var rpc = await APP.supabase.rpc('get_email_by_username', { p_username: username });
        if (rpc.error) { debug('❌ خطأ RPC: ' + rpc.error.message, 'error');
            if (errorMsg) { errorMsg.textContent = '❌ تعذّر التحقق من اسم المستخدم'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false); return; }
        var email = rpc.data;
        if (!email) {
            if (errorMsg) { errorMsg.textContent = '❌ اسم المستخدم أو كلمة المرور غير صحيحة'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false); return;
        }
        // 2) signInWithPassword بالـ email الداخلي (لا يظهر للمستخدم)
        var result = await APP.supabase.auth.signInWithPassword({ email: email, password: password });
        if (result.error) {
            if (errorMsg) { errorMsg.textContent = '❌ اسم المستخدم أو كلمة المرور غير صحيحة'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false); return;
        }
        if (!result.data || !result.data.user) {
            if (errorMsg) { errorMsg.textContent = '❌ فشل تسجيل الدخول'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false); return;
        }
        APP.currentUser = result.data.user;
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('تسجيل دخول', 'auth', APP.currentUser.id, null, null, 'User: ' + username, 'login');
        }
        var profileLoaded = await loadUserProfile();
        if (profileLoaded) { showApp(); }
        else {
            clearUserState();
            if (errorMsg) { errorMsg.textContent = '❌ هذا الحساب غير مفعّل، يرجى التواصل مع مدير النظام.'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false);
            setTimeout(function() { doLogout(); }, 3000);
        }
    } catch (err) {
        debug('❌ Exception في handleLoginClick: ' + err.message, 'error');
        if (errorMsg) { errorMsg.textContent = '❌ ' + err.message; errorMsg.style.display = 'block'; }
        setButtonLoading('loginBtn', false);
    }
}

async function doLogout() {
    if (APP.currentUser && typeof window.logActivityToDB === 'function') {
        window.logActivityToDB('تسجيل خروج', 'auth', APP.currentUser.id, null, null, 'User: ' + (APP.userName || APP.currentUser.email), 'logout');
    }
    clearUserState();
    if (APP.supabase) { try { await APP.supabase.auth.signOut(); } catch (err) {} }
    location.reload();
}

async function checkSession() {
    if (!isSupabaseReady()) return;
    try {
        var result = await APP.supabase.auth.getSession();
        var session = result.data ? result.data.session : null;
        if (session) {
            APP.currentUser = session.user;
            var profileLoaded = await loadUserProfile();
            if (profileLoaded) { showApp(); } else { clearUserState(); doLogout(); }
        }
    } catch (err) { debug('❌ خطأ في getSession: ' + err.message, 'error'); }
}

function registerAuthListener() {
    if (!isSupabaseReady()) return;
    APP.supabase.auth.onAuthStateChange(function(event, session) {
        if (event === 'SIGNED_OUT') clearUserState();
    });
}

async function loadUserProfile() {
    if (!APP.currentUser || !isSupabaseReady()) return false;
    try {
        var result = await APP.supabase.from('user_profiles')
            .select('role, entity_id, permission, is_active, username')
            .eq('id', APP.currentUser.id).maybeSingle();
        if (result.error) return false;
        var profile = result.data;
        if (!profile || profile.is_active === false) return false;
        APP.userRole = profile.role || USER_ROLES.VIEWER;
        APP.userPermission = profile.permission || PERMISSIONS.VIEWER;
        APP.currentEntityId = profile.entity_id;
        APP.userName = profile.username || null;
        return true;
    } catch (err) { return false; }
}

function canEdit() { return APP.userPermission === PERMISSIONS.ADMIN; }
function canViewProfits() { return APP.userPermission !== PERMISSIONS.VIEWER; }
function isAdmin() { return APP.userPermission === PERMISSIONS.ADMIN; }
function isViewer() { return APP.userPermission === PERMISSIONS.VIEWER; }
function isClient() { return APP.userRole === USER_ROLES.CLIENT; }
function isInvestor() { return APP.userRole === USER_ROLES.INVESTOR; }
function isLoggedIn() { return APP.currentUser !== null; }
function hasPersonalAccount() { return (isClient() || isInvestor()) && APP.currentEntityId !== null; }

function applyPermissions() {
    if (!canEdit()) {
        var adminElements = document.querySelectorAll('.admin-only');
        for (var i = 0; i < adminElements.length; i++) adminElements[i].style.display = 'none';
    }
    if (!canViewProfits()) hideProfits();
    applyNavigationPermissions();
    updateUserInfo();
}
function hideProfits() {
    var elements = document.querySelectorAll('.profit-field');
    for (var i = 0; i < elements.length; i++) elements[i].style.display = 'none';
    var profitValues = document.querySelectorAll('.profit-value');
    for (var i = 0; i < profitValues.length; i++) profitValues[i].innerHTML = '<span class="hidden-profit">****</span>';
}
function applyNavigationPermissions() {
    var navClients = document.querySelector('.nav-btn[data-screen="clients"]');
    var navInvestors = document.querySelector('.nav-btn[data-screen="investors"]');
    var navOperations = document.querySelector('.nav-btn[data-screen="operations"]');
    var navTransfers = document.querySelector('.nav-btn[data-screen="transfers"]');
    var navActivity = document.querySelector('.nav-btn[data-screen="activityLog"]');
    function show(el){ if(el) el.style.display='inline-block'; }
    function hide(el){ if(el) el.style.display='none'; }
    if (isAdmin()) { show(navClients); show(navInvestors); show(navOperations); show(navTransfers); show(navActivity); return; }
    if (isViewer()) { show(navClients); show(navInvestors); show(navOperations); show(navTransfers); hide(navActivity); return; }
    if (isClient()) { hide(navClients); hide(navInvestors); hide(navOperations); hide(navTransfers); hide(navActivity); return; }
    if (isInvestor()) { hide(navClients); show(navInvestors); hide(navOperations); hide(navTransfers); hide(navActivity); return; }
}
function updateUserInfo() {
    var userEmailEl = document.getElementById('userEmail');
    var userRoleEl = document.getElementById('userRole');
    var userPermEl = document.getElementById('userPermission');
    if (userEmailEl && APP.currentUser) userEmailEl.textContent = APP.userName || APP.currentUser.email;
    if (userRoleEl) { userRoleEl.textContent = getUserRoleText(APP.userRole); userRoleEl.className = 'badge badge-' + APP.userRole; }
    if (userPermEl) {
        userPermEl.textContent = APP.userPermission === PERMISSIONS.ADMIN ? 'صلاحيات كاملة' : 'مشاهدة فقط';
        userPermEl.className = 'badge badge-' + APP.userPermission;
        userPermEl.style.display = 'inline-block';
    }
}
function showApp() {
    var loginScreen = document.getElementById('loginScreen');
    var appContainer = document.getElementById('appContainer');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    applyPermissions();
    if (typeof loadDashboard === 'function') loadDashboard();
}
function initAuth() {
    registerAuthListener();
    // Enter في حقل اسم المستخدم
    var u = document.getElementById('loginUsername');
    if (u) u.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); if (typeof handleLoginClick === 'function') handleLoginClick(); }
    });
}
// ============================================================
// END OF AUTH.JS (v2.3.0)
// ============================================================
