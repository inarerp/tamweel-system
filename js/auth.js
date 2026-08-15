// ============================================================
// نظام إدارة التمويل - Auth Module
// Version: 2.3.0
// Last Updated: 2026-08-15
// ============================================================
// v2.3.0: إصلاح applyNavigationPermissions() لاستخدام selectors الفعلية
//         (.nav-btn[data-screen=...]) بدل selectors غير موجودة.
//         ملاحظة: إخفاء الـ Navigation = UX فقط؛ الحماية الحقيقية = RLS.
// ============================================================

// ============================================================
// 1. USER STATE MANAGEMENT
// ============================================================
function clearUserState() {
    APP.currentUser = null;
    APP.userRole = null;
    APP.userPermission = null;
    APP.currentEntityId = null;
    APP.currentOperation = null;
    APP.currentOperationData = null;
    debug('🧹 تم تنظيف حالة المستخدم', 'info');
}

// ============================================================
// 2. AUTHENTICATION
// ============================================================
async function handleLoginClick() {
    debug('🔐 بدء تسجيل الدخول', 'info');
    var emailEl = document.getElementById('loginEmail');
    var passEl = document.getElementById('loginPassword');
    var errorMsg = document.getElementById('errorMsg');
    if (!emailEl || !passEl) { debug('❌ عناصر تسجيل الدخول غير موجودة', 'error'); return; }
    var email = emailEl.value.trim();
    var password = passEl.value;
    if (isEmpty(email) || isEmpty(password)) {
        debug('⚠️ بيانات ناقصة', 'warning');
        if (errorMsg) { errorMsg.textContent = '⚠️ يرجى إدخال البريد الإلكتروني وكلمة المرور'; errorMsg.style.display = 'block'; }
        return;
    }
    if (!isEmail(email)) {
        debug('⚠️ صيغة بريد غير صحيحة: ' + email, 'warning');
        if (errorMsg) { errorMsg.textContent = '⚠️ صيغة البريد الإلكتروني غير صحيحة'; errorMsg.style.display = 'block'; }
        return;
    }
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        if (errorMsg) { errorMsg.textContent = '❌ خطأ في الاتصال بقاعدة البيانات'; errorMsg.style.display = 'block'; }
        return;
    }
    if (errorMsg) errorMsg.style.display = 'none';
    setButtonLoading('loginBtn', true);
    try {
        debug('🔵 استدعاء signInWithPassword مباشرة...', 'info');
        var result = await APP.supabase.auth.signInWithPassword({ email: email, password: password });
        debug('🔵 نتيجة signInWithPassword:', 'info');
        debug('  - error: ' + (result.error ? result.error.message : 'null'), 'info');
        debug('  - user: ' + (result.data && result.data.user ? 'موجود' : 'غير موجود'), 'info');
        if (result.error) {
            debug('❌ خطأ من Supabase: ' + result.error.message, 'error');
            if (errorMsg) { errorMsg.textContent = '❌ ' + result.error.message; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false);
            return;
        }
        if (!result.data || !result.data.user) {
            debug('❌ لا يوجد user في النتيجة', 'error');
            if (errorMsg) { errorMsg.textContent = '❌ فشل تسجيل الدخول'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false);
            return;
        }
        debug('✅ تم تسجيل الدخول بنجاح - User ID: ' + result.data.user.id, 'success');
        APP.currentUser = result.data.user;
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB('تسجيل دخول', 'auth', APP.currentUser.id, null, null, 'User: ' + APP.currentUser.email, 'login');
        }
        debug('🔵 بدء loadUserProfile...', 'info');
        var profileLoaded = await loadUserProfile();
        debug('🔵 profileLoaded: ' + profileLoaded, 'info');
        if (profileLoaded) {
            debug('✅ إظهار التطبيق', 'success');
            showApp();
        } else {
            debug('❌ فشل تحميل الملف الشخصي', 'error');
            clearUserState();
            if (errorMsg) { errorMsg.textContent = '❌ هذا الحساب غير مفعّل، يرجى التواصل مع مدير النظام.'; errorMsg.style.display = 'block'; }
            setButtonLoading('loginBtn', false);
            setTimeout(function() { doLogout(); }, 3000);
        }
    } catch (err) {
        debug('❌ Exception في handleLoginClick: ' + err.message, 'error');
        if (err.stack) debug('  - stack: ' + err.stack.substring(0, 200), 'error');
        if (errorMsg) { errorMsg.textContent = '❌ ' + err.message; errorMsg.style.display = 'block'; }
        setButtonLoading('loginBtn', false);
    }
}

async function doLogout() {
    debug('🚪 جاري تسجيل الخروج...', 'info');
    if (APP.currentUser && typeof window.logActivityToDB === 'function') {
        window.logActivityToDB('تسجيل خروج', 'auth', APP.currentUser.id, null, null, 'User: ' + APP.currentUser.email, 'logout');
    }
    clearUserState();
    if (APP.supabase) {
        try {
            var result = await APP.supabase.auth.signOut();
            if (result.error) debug('⚠️ خطأ في signOut: ' + result.error.message, 'warning');
            else debug('✅ تم تسجيل الخروج', 'success');
        } catch (err) { debug('⚠️ Exception في signOut: ' + err.message, 'warning'); }
    }
    location.reload();
}

// ============================================================
// 3. SESSION MANAGEMENT
// ============================================================
async function checkSession() {
    debug('🔍 جاري التحقق من الجلسة...', 'info');
    if (!isSupabaseReady()) { debug('❌ Supabase غير جاهز', 'error'); return; }
    try {
        var result = await APP.supabase.auth.getSession();
        var session = result.data ? result.data.session : null;
        debug('🔵 Session: ' + (session ? 'موجود' : 'غير موجود'), session ? 'success' : 'info');
        if (session) {
            APP.currentUser = session.user;
            debug('🔵 بدء loadUserProfile من session...', 'info');
            var profileLoaded = await loadUserProfile();
            debug('🔵 profileLoaded من session: ' + profileLoaded, 'info');
            if (profileLoaded) { showApp(); }
            else { debug('⚠️ المستخدم ليس له ملف شخصي - تسجيل خروج', 'warning'); clearUserState(); doLogout(); }
        } else {
            debug('ℹ️ لا توجد جلسة - شاشة تسجيل الدخول', 'info');
        }
    } catch (err) { debug('❌ خطأ في getSession: ' + err.message, 'error'); }
}

function registerAuthListener() {
    if (!isSupabaseReady()) return;
    APP.supabase.auth.onAuthStateChange(function(event, session) {
        debug('🔔 Auth Event: ' + event, 'info');
        if (event === 'SIGNED_OUT') { clearUserState(); debug('🧹 تم تنظيف الحالة بسبب SIGNED_OUT', 'info'); }
        if (event === 'TOKEN_REFRESHED') debug('🔄 تم تحديث Token', 'info');
        if (event === 'USER_UPDATED') debug('👤 تم تحديث بيانات المستخدم', 'info');
    });
}

// ============================================================
// 4. USER PROFILE LOADING
// ============================================================
async function loadUserProfile() {
    debug('👤 جاري تحميل الملف الشخصي...', 'info');
    if (!APP.currentUser) { debug('❌ لا يوجد مستخدم حالي', 'error'); return false; }
    if (!isSupabaseReady()) { debug('❌ Supabase غير جاهز', 'error'); return false; }
    try {
        debug('🔵 استدعاء select من user_profiles...', 'info');
        debug('  - User ID: ' + APP.currentUser.id, 'info');
        var result = await APP.supabase
            .from('user_profiles')
            .select('role, entity_id, permission, is_active')
            .eq('id', APP.currentUser.id)
            .maybeSingle();
        debug('🔵 نتيجة user_profiles:', 'info');
        debug('  - error: ' + (result.error ? result.error.message : 'null'), 'info');
        debug('  - data: ' + (result.data ? 'موجود' : 'غير موجود'), 'info');
        if (result.error) { debug('❌ خطأ من Supabase: ' + result.error.message, 'error'); return false; }
        var profile = result.data;
        if (!profile) { debug('❌ لا يوجد سجل في user_profiles للمستخدم: ' + APP.currentUser.email, 'error'); return false; }
        if (profile.is_active === false) { debug('❌ الحساب معطّل: ' + APP.currentUser.email, 'error'); return false; }
        APP.userRole = profile.role || USER_ROLES.VIEWER;
        APP.userPermission = profile.permission || PERMISSIONS.VIEWER;
        APP.currentEntityId = profile.entity_id;
        debug('✅ Role: ' + APP.userRole + ', Permission: ' + APP.userPermission, 'success');
        if (APP.currentEntityId) debug('🔵 Entity ID: ' + APP.currentEntityId, 'info');
        return true;
    } catch (err) {
        debug('❌ Exception في loadUserProfile: ' + err.message, 'error');
        if (err.stack) debug('  - stack: ' + err.stack.substring(0, 200), 'error');
        return false;
    }
}

// ============================================================
// 5. PERMISSIONS LOGIC
// ============================================================
function canEdit() { return APP.userPermission === PERMISSIONS.ADMIN; }
function canViewProfits() { return APP.userPermission !== PERMISSIONS.VIEWER; }
function isAdmin() { return APP.userPermission === PERMISSIONS.ADMIN; }
function isViewer() { return APP.userPermission === PERMISSIONS.VIEWER; }
function isClient() { return APP.userRole === USER_ROLES.CLIENT; }
function isInvestor() { return APP.userRole === USER_ROLES.INVESTOR; }
function isLoggedIn() { return APP.currentUser !== null; }
function hasPersonalAccount() { return (isClient() || isInvestor()) && APP.currentEntityId !== null; }

// ============================================================
// 6. APPLY PERMISSIONS (UI)
// ============================================================
function applyPermissions() {
    debug('🔐 تطبيق الصلاحيات: Role=' + APP.userRole + ', Permission=' + APP.userPermission, 'info');
    // 1. إخفاء أزرار الإدارة عن غير Admin
    if (!canEdit()) {
        var adminElements = document.querySelectorAll('.admin-only');
        for (var i = 0; i < adminElements.length; i++) adminElements[i].style.display = 'none';
        debug('🔒 إخفاء أزرار الإدارة', 'info');
    }
    // 2. إخفاء الأرباح عن Viewer
    if (!canViewProfits()) { hideProfits(); debug('🔒 إخفاء الأرباح', 'info'); }
    // 3. التحكم في شريط التنقل حسب الصلاحية
    applyNavigationPermissions();
    // 4. تحديث معلومات المستخدم في الهيدر
    updateUserInfo();
}

function hideProfits() {
    var elements = document.querySelectorAll('.profit-field');
    for (var i = 0; i < elements.length; i++) elements[i].style.display = 'none';
    var profitValues = document.querySelectorAll('.profit-value');
    for (var i = 0; i < profitValues.length; i++) profitValues[i].innerHTML = '<span class="hidden-profit">****</span>';
}

// ✅ v2.3.0: selectors مطابقة لـ index.html الفعلي (.nav-btn + data-screen)
// ملاحظة: هذا تحكم UX فقط؛ الحماية الحقيقية للبيانات = Supabase RLS.
function applyNavigationPermissions() {
    var navClients    = document.querySelector('.nav-btn[data-screen="clients"]');
    var navInvestors  = document.querySelector('.nav-btn[data-screen="investors"]');
    var navOperations = document.querySelector('.nav-btn[data-screen="operations"]');
    var navTransfers  = document.querySelector('.nav-btn[data-screen="transfers"]');
    var navReports    = document.querySelector('.nav-btn[data-screen="reports"]');
    var navActivity   = document.querySelector('.nav-btn[data-screen="activityLog"]');
    var navUsers      = document.querySelector('.nav-btn[data-screen="users"]');
    var navMyAccount  = document.querySelector('.nav-btn[data-screen="myAccount"]');

    function show(el) { if (el) el.style.display = 'inline-block'; }
    function hide(el) { if (el) el.style.display = 'none'; }

    // الشاشات الحساسة (reports/users/activityLog) تُخفى لغير Admin دائمًا
    if (!isAdmin()) { hide(navReports); hide(navUsers); hide(navActivity); }

    // Admin: يرى كل شيء (+ حسابي إذا كان لديه حساب شخصي)
    if (isAdmin()) {
        show(navClients); show(navInvestors); show(navOperations); show(navTransfers);
        show(navReports); show(navActivity); show(navUsers);
        if (hasPersonalAccount()) show(navMyAccount); else hide(navMyAccount);
        return;
    }
    // Viewer: يرى الشاشات التشغيلية فقط (بدون reports/users/activityLog)
    if (isViewer()) {
        show(navClients); show(navInvestors); show(navOperations); show(navTransfers);
        hide(navReports); hide(navUsers); hide(navActivity);
        if (hasPersonalAccount()) show(navMyAccount); else hide(navMyAccount);
        return;
    }
    // Client: يرى فقط "حسابي" (والـ dashboard)
    if (isClient()) {
        hide(navClients); hide(navInvestors); hide(navOperations); hide(navTransfers);
        hide(navReports); hide(navUsers); hide(navActivity);
        show(navMyAccount);
        return;
    }
    // Investor: يرى "الممولين" و"حسابي"
    if (isInvestor()) {
        hide(navClients); show(navInvestors); hide(navOperations); hide(navTransfers);
        hide(navReports); hide(navUsers); hide(navActivity);
        show(navMyAccount);
        return;
    }
    // fallback آمن: إخفاء الكل عدا dashboard
    hide(navClients); hide(navInvestors); hide(navOperations); hide(navTransfers);
    hide(navReports); hide(navUsers); hide(navActivity); hide(navMyAccount);
}

function updateUserInfo() {
    var userEmailEl = document.getElementById('userEmail');
    var userRoleEl = document.getElementById('userRole');
    var userPermEl = document.getElementById('userPermission');
    if (userEmailEl && APP.currentUser) userEmailEl.textContent = APP.currentUser.email;
    if (userRoleEl) { userRoleEl.textContent = getUserRoleText(APP.userRole); userRoleEl.className = 'badge badge-' + APP.userRole; }
    if (userPermEl) {
        var permText = APP.userPermission === PERMISSIONS.ADMIN ? 'صلاحيات كاملة' : 'مشاهدة فقط';
        userPermEl.textContent = permText;
        userPermEl.className = 'badge badge-' + APP.userPermission;
        userPermEl.style.display = 'inline-block';
    }
}

// ============================================================
// 7. SHOW APP
// ============================================================
function showApp() {
    debug('🎨 إظهار التطبيق...', 'info');
    var loginScreen = document.getElementById('loginScreen');
    var appContainer = document.getElementById('appContainer');
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    applyPermissions();
    if (typeof loadDashboard === 'function') loadDashboard();
    else debug('⚠️ loadDashboard غير متاح', 'warning');
    debug('✅ التطبيق جاهز', 'success');
    setTimeout(function() {
        var overlay = document.getElementById('loadingOverlay');
        if (overlay) { overlay.style.display = 'none'; overlay.style.visibility = 'hidden'; overlay.style.opacity = '0'; }
        debug('🔒 تم إخفاء Loading (fallback)', 'info');
    }, 3000);
}

// ============================================================
// 8. INITIALIZATION (يُستدعى من app.js)
// ============================================================
function initAuth() {
    debug('🔐 بدء تهيئة auth.js', 'info');
    registerAuthListener();
    debug('✅ auth.js جاهز', 'success');
}
// ============================================================
// END OF AUTH.JS (v2.3.0)
// ============================================================
