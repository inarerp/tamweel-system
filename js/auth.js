// ============================================================
// نظام إدارة التمويل - Auth Module
// Version: 2.2.0
// Last Updated: 2026-08-02
// ============================================================
//
// المسؤوليات:
// - Login / Logout
// - Session Management
// - User Profile Loading
// - Permissions Logic
// - applyPermissions()
// - showApp()
// - clearUserState()
// - initAuth() (يُستدعى من app.js)
//
// يعتمد على:
// - core.js (APP, runQuery, debug, Constants, etc.)
//
// لا يعتمد على:
// - activity.js (مستقل تماماً - يستخدم window.logActivityToDB
//                فقط إذا كانت موجودة، بدون Wrapper)
//
// ملاحظة: لا يحتوي على DOMContentLoaded (app.js هو Bootstrap)
// ============================================================


// ============================================================
// 1. USER STATE MANAGEMENT
// ============================================================

/**
 * تنظيف حالة المستخدم بالكامل
 * يُستدعى عند:
 * - تسجيل الخروج
 * - SIGNED_OUT event
 * - فشل تحميل profile
 * - انتهاء الجلسة
 */
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

/**
 * تسجيل الدخول
 * يُستدعى من data-action="handleLoginClick"
 * ✅ يستخدم signInWithPassword مباشرة بدون runQuery
 */
async function handleLoginClick() {
    debug('🔐 بدء تسجيل الدخول', 'info');
    
    var emailEl = document.getElementById('loginEmail');
    var passEl = document.getElementById('loginPassword');
    var errorMsg = document.getElementById('errorMsg');
    
    if (!emailEl || !passEl) {
        debug('❌ عناصر تسجيل الدخول غير موجودة', 'error');
        return;
    }
    
    var email = emailEl.value.trim();
    var password = passEl.value;
    
    if (isEmpty(email) || isEmpty(password)) {
        debug('⚠️ بيانات ناقصة', 'warning');
        if (errorMsg) {
            errorMsg.textContent = '⚠️ يرجى إدخال البريد الإلكتروني وكلمة المرور';
            errorMsg.style.display = 'block';
        }
        return;
    }
    
    if (!isEmail(email)) {
        debug('⚠️ صيغة بريد غير صحيحة: ' + email, 'warning');
        if (errorMsg) {
            errorMsg.textContent = '⚠️ صيغة البريد الإلكتروني غير صحيحة';
            errorMsg.style.display = 'block';
        }
        return;
    }
    
    if (!isSupabaseReady()) {
        debug(' Supabase غير جاهز', 'error');
        if (errorMsg) {
            errorMsg.textContent = ' خطأ في الاتصال بقاعدة البيانات';
            errorMsg.style.display = 'block';
        }
        return;
    }
    
    if (errorMsg) errorMsg.style.display = 'none';
    setButtonLoading('loginBtn', true);
    
    try {
        debug('🔵 استدعاء signInWithPassword مباشرة...', 'info');
        
        // ✅ استخدام signInWithPassword مباشرة بدون runQuery
        var result = await APP.supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        debug('🔵 نتيجة signInWithPassword:', 'info');
        debug('  - error: ' + (result.error ? result.error.message : 'null'), 'info');
        debug('  - user: ' + (result.data && result.data.user ? 'موجود' : 'غير موجود'), 'info');
        
        if (result.error) {
            debug('❌ خطأ من Supabase: ' + result.error.message, 'error');
            
            if (errorMsg) {
                errorMsg.textContent = '❌ ' + result.error.message;
                errorMsg.style.display = 'block';
            }
            
            setButtonLoading('loginBtn', false);
            return;
        }
        
        if (!result.data || !result.data.user) {
            debug('❌ لا يوجد user في النتيجة', 'error');
            
            if (errorMsg) {
                errorMsg.textContent = '❌ فشل تسجيل الدخول';
                errorMsg.style.display = 'block';
            }
            
            setButtonLoading('loginBtn', false);
            return;
        }
        
        debug('✅ تم تسجيل الدخول بنجاح - User ID: ' + result.data.user.id, 'success');
        
        APP.currentUser = result.data.user;
        
        // تسجيل في Activity Log (إذا كانت الدالة متاحة)
        if (typeof window.logActivityToDB === 'function') {
            window.logActivityToDB(
                'تسجيل دخول',
                'auth',
                APP.currentUser.id,
                null,
                null,
                'User: ' + APP.currentUser.email,
                'login'
            );
        }
        
        debug('🔵 بدء loadUserProfile...', 'info');
        
        // تحميل بيانات المستخدم والصلاحيات
        var profileLoaded = await loadUserProfile();
        
        debug('🔵 profileLoaded: ' + profileLoaded, 'info');
        
        if (profileLoaded) {
            debug('✅ إظهار التطبيق', 'success');
            showApp();
        } else {
            debug('❌ فشل تحميل الملف الشخصي', 'error');
            clearUserState();
            
            if (errorMsg) {
                errorMsg.textContent = '❌ هذا الحساب غير مفعّل، يرجى التواصل مع مدير النظام.';
                errorMsg.style.display = 'block';
            }
            
            setButtonLoading('loginBtn', false);
            
            // تسجيل خروج بعد 3 ثواني
            setTimeout(function() {
                doLogout();
            }, 3000);
        }
        
    } catch (err) {
        debug('❌ Exception في handleLoginClick: ' + err.message, 'error');
        if (err.stack) {
            debug('  - stack: ' + err.stack.substring(0, 200), 'error');
        }
        
        if (errorMsg) {
            errorMsg.textContent = '❌ ' + err.message;
            errorMsg.style.display = 'block';
        }
        
        setButtonLoading('loginBtn', false);
    }
}

/**
 * تسجيل الخروج
 * يُستدعى من data-action="doLogout"
 * ✅ يستخدم signOut مباشرة بدون runQuery
 */
async function doLogout() {
    debug(' جاري تسجيل الخروج...', 'info');
    
    // تسجيل في Activity Log قبل تسجيل الخروج (إذا كانت الدالة متاحة)
    if (APP.currentUser && typeof window.logActivityToDB === 'function') {
        window.logActivityToDB(
            'تسجيل خروج',
            'auth',
            APP.currentUser.id,
            null,
            null,
            'User: ' + APP.currentUser.email,
            'logout'
        );
    }
    
    // تنظيف حالة المستخدم
    clearUserState();
    
    if (APP.supabase) {
        try {
            // ✅ استخدام signOut مباشرة بدون runQuery
            var result = await APP.supabase.auth.signOut();
            
            if (result.error) {
                debug('⚠️ خطأ في signOut: ' + result.error.message, 'warning');
            } else {
                debug('✅ تم تسجيل الخروج', 'success');
            }
        } catch (err) {
            debug('⚠️ Exception في signOut: ' + err.message, 'warning');
        }
    }
    
    location.reload();
}


// ============================================================
// 3. SESSION MANAGEMENT
// ============================================================

/**
 * التحقق من الجلسة الحالية عند تحميل الصفحة
 * يُستدعى من app.js
 * ✅ يستخدم getSession مباشرة بدون runQuery
 */
async function checkSession() {
    debug('🔍 جاري التحقق من الجلسة...', 'info');
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return;
    }
    
    try {
        // ✅ استخدام getSession مباشرة بدون runQuery
        var result = await APP.supabase.auth.getSession();
        
        var session = result.data ? result.data.session : null;
        
        debug(' Session: ' + (session ? 'موجود' : 'غير موجود'), session ? 'success' : 'info');
        
        if (session) {
            APP.currentUser = session.user;
            
            debug('🔵 بدء loadUserProfile من session...', 'info');
            
            // تحميل بيانات المستخدم والصلاحيات
            var profileLoaded = await loadUserProfile();
            
            debug('🔵 profileLoaded من session: ' + profileLoaded, 'info');
            
            if (profileLoaded) {
                showApp();
            } else {
                // المستخدم مسجل لكن ليس له ملف شخصي
                debug('⚠️ المستخدم ليس له ملف شخصي - تسجيل خروج', 'warning');
                clearUserState();
                doLogout();
            }
        } else {
            // لا توجد جلسة - المستخدم في شاشة تسجيل الدخول
            debug('ℹ️ لا توجد جلسة - شاشة تسجيل الدخول', 'info');
        }
        
    } catch (err) {
        debug('❌ خطأ في getSession: ' + err.message, 'error');
    }
}

/**
 * الاستماع لأحداث Auth (تغيير الجلسة)
 * يُستدعى من initAuth()
 */
function registerAuthListener() {
    if (!isSupabaseReady()) return;
    
    APP.supabase.auth.onAuthStateChange(function(event, session) {
        debug('🔔 Auth Event: ' + event, 'info');
        
        if (event === 'SIGNED_OUT') {
            clearUserState();
            debug('🧹 تم تنظيف الحالة بسبب SIGNED_OUT', 'info');
        }
        
        if (event === 'TOKEN_REFRESHED') {
            debug('🔄 تم تحديث Token', 'info');
        }
        
        if (event === 'USER_UPDATED') {
            debug('👤 تم تحديث بيانات المستخدم', 'info');
        }
    });
}


// ============================================================
// 4. USER PROFILE LOADING
// ============================================================

/**
 * تحميل بيانات المستخدم من user_profiles
 * @returns {Promise<boolean>} - true إذا نجح، false إذا فشل
 */
async function loadUserProfile() {
    debug('👤 جاري تحميل الملف الشخصي...', 'info');
    
    if (!APP.currentUser) {
        debug('❌ لا يوجد مستخدم حالي', 'error');
        return false;
    }
    
    if (!isSupabaseReady()) {
        debug('❌ Supabase غير جاهز', 'error');
        return false;
    }
    
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
        
        if (result.error) {
            debug('❌ خطأ من Supabase: ' + result.error.message, 'error');
            return false;
        }
        
        var profile = result.data;
        
        // التحقق من وجود سجل
        if (!profile) {
            debug('❌ لا يوجد سجل في user_profiles للمستخدم: ' + APP.currentUser.email, 'error');
            return false;
        }
        
        // التحقق من حالة التفعيل
        if (profile.is_active === false) {
            debug('❌ الحساب معطّل: ' + APP.currentUser.email, 'error');
            return false;
        }
        
        // تعيين الصلاحيات
        APP.userRole = profile.role || USER_ROLES.VIEWER;
        APP.userPermission = profile.permission || PERMISSIONS.VIEWER;
        APP.currentEntityId = profile.entity_id;
        
        debug('✅ Role: ' + APP.userRole + ', Permission: ' + APP.userPermission, 'success');
        
        if (APP.currentEntityId) {
            debug(' Entity ID: ' + APP.currentEntityId, 'info');
        }
        
        return true;
        
    } catch (err) {
        debug('❌ Exception في loadUserProfile: ' + err.message, 'error');
        if (err.stack) {
            debug('  - stack: ' + err.stack.substring(0, 200), 'error');
        }
        return false;
    }
}


// ============================================================
// 5. PERMISSIONS LOGIC
// ============================================================

/**
 * هل يمكن للمستخدم التعديل؟
 */
function canEdit() {
    return APP.userPermission === PERMISSIONS.ADMIN;
}

/**
 * هل يمكن للمستخدم رؤية الأرباح؟
 */
function canViewProfits() {
    return APP.userPermission !== PERMISSIONS.VIEWER;
}

/**
 * هل المستخدم مدير؟
 */
function isAdmin() {
    return APP.userPermission === PERMISSIONS.ADMIN;
}

/**
 * هل المستخدم مراقب؟
 */
function isViewer() {
    return APP.userPermission === PERMISSIONS.VIEWER;
}

/**
 * هل المستخدم عميل؟
 */
function isClient() {
    return APP.userRole === USER_ROLES.CLIENT;
}

/**
 * هل المستخدم ممول؟
 */
function isInvestor() {
    return APP.userRole === USER_ROLES.INVESTOR;
}

/**
 * هل المستخدم مسجل دخول؟
 */
function isLoggedIn() {
    return APP.currentUser !== null;
}

/**
 * هل المستخدم لديه حساب شخصي مرتبط؟
 */
function hasPersonalAccount() {
    return (isClient() || isInvestor()) && APP.currentEntityId !== null;
}


// ============================================================
// 6. APPLY PERMISSIONS (UI)
// ============================================================

/**
 * تطبيق الصلاحيات على الواجهة
 * يُستدعى بعد تسجيل الدخول
 */
function applyPermissions() {
    debug('🔐 تطبيق الصلاحيات: Role=' + APP.userRole + ', Permission=' + APP.userPermission, 'info');
    
    // 1. إخفاء أزرار الإدارة عن غير Admin
    if (!canEdit()) {
        var adminElements = document.querySelectorAll('.admin-only');
        for (var i = 0; i < adminElements.length; i++) {
            adminElements[i].style.display = 'none';
        }
        debug('🔒 إخفاء أزرار الإدارة', 'info');
    }
    
    // 2. إخفاء الأرباح عن Viewer/Client/Investor
    if (!canViewProfits()) {
        hideProfits();
        debug('🔒 إخفاء الأرباح', 'info');
    }
    
    // 3. التحكم في شريط التنقل حسب الصلاحية
    applyNavigationPermissions();
    
    // 4. تحديث معلومات المستخدم في الهيدر
    updateUserInfo();
}

/**
 * إخفاء جميع حقول الأرباح
 */
function hideProfits() {
    var elements = document.querySelectorAll('.profit-field');
    for (var i = 0; i < elements.length; i++) {
        elements[i].style.display = 'none';
    }
    
    var profitValues = document.querySelectorAll('.profit-value');
    for (var i = 0; i < profitValues.length; i++) {
        profitValues[i].innerHTML = '<span class="hidden-profit">****</span>';
    }
}

/**
 * تطبيق صلاحيات التنقل
 */
function applyNavigationPermissions() {
    var navClients = document.querySelector('.nav-clients');
    var navInvestors = document.querySelector('.nav-investors');
    var navOperations = document.querySelector('.nav-operations');
    var navTransfers = document.querySelector('.nav-transfers');
    var navMyAccount = document.querySelector('.nav-myaccount');
    var navActivity = document.querySelector('.nav-activity');
    
    // Admin بدون حساب شخصي: يرى كل شيء عدا "حسابي"
    if (isAdmin() && !hasPersonalAccount()) {
        if (navActivity) navActivity.style.display = 'inline-block';
        if (navMyAccount) navMyAccount.style.display = 'none';
        return;
    }
    
    // Admin مع حساب شخصي: يرى كل شيء + "حسابي"
    if (isAdmin() && hasPersonalAccount()) {
        if (navActivity) navActivity.style.display = 'inline-block';
        if (navMyAccount) navMyAccount.style.display = 'inline-block';
        return;
    }
    
    // Viewer: يرى الشاشات لكن بدون تعديل
    if (isViewer()) {
        if (navClients) navClients.style.display = 'inline-block';
        if (navInvestors) navInvestors.style.display = 'inline-block';
        if (navOperations) navOperations.style.display = 'inline-block';
        if (navTransfers) navTransfers.style.display = 'inline-block';
        if (navActivity) navActivity.style.display = 'inline-block';
        if (navMyAccount && hasPersonalAccount()) {
            navMyAccount.style.display = 'inline-block';
        }
        return;
    }
    
    // Client: يرى فقط "حسابي"
    if (isClient()) {
        if (navClients) navClients.style.display = 'none';
        if (navInvestors) navInvestors.style.display = 'none';
        if (navOperations) navOperations.style.display = 'none';
        if (navTransfers) navTransfers.style.display = 'none';
        if (navActivity) navActivity.style.display = 'none';
        if (navMyAccount) navMyAccount.style.display = 'inline-block';
        return;
    }
    
    // Investor: يرى "الممولين" و"حسابي"
    if (isInvestor()) {
        if (navClients) navClients.style.display = 'none';
        if (navInvestors) navInvestors.style.display = 'inline-block';
        if (navOperations) navOperations.style.display = 'none';
        if (navTransfers) navTransfers.style.display = 'none';
        if (navActivity) navActivity.style.display = 'none';
        if (navMyAccount) navMyAccount.style.display = 'inline-block';
        return;
    }
}

/**
 * تحديث معلومات المستخدم في الهيدر
 */
function updateUserInfo() {
    var userEmailEl = document.getElementById('userEmail');
    var userRoleEl = document.getElementById('userRole');
    var userPermEl = document.getElementById('userPermission');
    
    if (userEmailEl && APP.currentUser) {
        userEmailEl.textContent = APP.currentUser.email;
    }
    
    if (userRoleEl) {
        userRoleEl.textContent = getUserRoleText(APP.userRole);
        userRoleEl.className = 'badge badge-' + APP.userRole;
    }
    
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

/**
 * إظهار التطبيق بعد تسجيل الدخول
 * يُستدعى بعد نجاح loadUserProfile
 */
function showApp() {
    debug('🎨 إظهار التطبيق...', 'info');
    
    var loginScreen = document.getElementById('loginScreen');
    var appContainer = document.getElementById('appContainer');
    
    if (loginScreen) loginScreen.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
    
    // تطبيق الصلاحيات
    applyPermissions();
    
    // تحميل Dashboard (إذا كانت الدالة متاحة)
    if (typeof loadDashboard === 'function') {
        loadDashboard();
    } else {
        debug('⚠️ loadDashboard غير متاح', 'warning');
    }
    
    debug('✅ التطبيق جاهز', 'success');
}


// ============================================================
// 8. INITIALIZATION (يُستدعى من app.js)
// ============================================================

/**
 * تهيئة وحدة Auth
 * يُستدعى من app.js عند DOMContentLoaded
 */
function initAuth() {
    debug('🔐 بدء تهيئة auth.js', 'info');
    registerAuthListener();
    debug('✅ auth.js جاهز', 'success');
}


// ============================================================
// END OF AUTH.JS
// ============================================================
