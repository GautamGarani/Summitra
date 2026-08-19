const supabaseUrl = 'https://gigpodszdjckhvpzmuuh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpZ3BvZHN6ZGpja2h2cHptdXVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MTU2NzcsImV4cCI6MjA5MzI5MTY3N30.UjO4Fyw5nq9zpZim_9UFNEpHi-oceTWsQSLHGrkH6_c';

window._supabase = supabase.createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
    }
});

const AUTH_CACHE_KEYS = [
    'currentUser',
    'currentUserId',
    'isLoggedIn',
    'currentDisplayName',
    'currentUserAge',
    'currentUserEmail',
    'currentUserAnalyticsPreference'
];

window.summitraAuthReady = Promise.resolve(null);

function clearAuthCache() {
    AUTH_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
}

async function hydrateAuthCache(session) {
    const user = session.user;
    localStorage.setItem('currentUserId', user.id);
    localStorage.setItem('currentUserEmail', user.email || '');
    localStorage.setItem('isLoggedIn', 'true');

    const { data, error } = await _supabase
        .from('profiles')
        .select('id, username, display_name, age, analytics_preference, email')
        .eq('id', user.id)
        .single();

    if (data && !error) {
        localStorage.setItem('currentUser', data.username);
        localStorage.setItem('currentDisplayName', data.display_name);
        localStorage.setItem('currentUserAge', data.age);
        localStorage.setItem('currentUserEmail', data.email || user.email || '');
        localStorage.setItem('currentUserAnalyticsPreference', data.analytics_preference);
        return data;
    }

    const fallbackName = user.user_metadata?.username || user.email || 'Guest';
    localStorage.setItem('currentUser', fallbackName);
    localStorage.setItem('currentDisplayName', user.user_metadata?.display_name || fallbackName);
    return null;
}

async function bootstrapSession({ require = false, redirectIfPresent = false } = {}) {
    const { data: { session } } = await _supabase.auth.getSession();

    if (redirectIfPresent && session) {
        window.location.replace('dashboard.html');
        return session;
    }

    if (require && !session) {
        clearAuthCache();
        window.location.replace('login.html');
        return null;
    }

    if (session) {
        await hydrateAuthCache(session);
    } else {
        clearAuthCache();
    }

    return session;
}

function requireAuth() {
    window.summitraAuthReady = bootstrapSession({ require: true });
    return window.summitraAuthReady;
}

function redirectIfAuthenticated() {
    window.summitraAuthReady = bootstrapSession({ redirectIfPresent: true });
    return window.summitraAuthReady;
}

function filterSessionsForCurrentUser(allSessions) {
    const userId = localStorage.getItem('currentUserId');
    const owner = localStorage.getItem('currentUser');
    return (allSessions || []).filter((session) => {
        if (userId && session.user_id === userId) return true;
        if (owner && session.owner === owner) return true;
        return false;
    });
}

async function attemptLogin() {
    const emailEl = document.getElementById('email') || document.getElementById('username');
    const passEl = document.getElementById('password');
    const email = (emailEl?.value || '').trim();
    const password = passEl?.value || '';

    if (!email || !password) {
        alert('Enter your email and password.');
        return;
    }

    const { data, error } = await _supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
        alert(error?.message || 'INVALID CREDENTIALS');
        return;
    }

    await hydrateAuthCache(data.session);
    window.location.href = 'dashboard.html';
}

async function logout() {
    await _supabase.auth.signOut();
    clearAuthCache();
    localStorage.removeItem('errorLogs');
    window.location.href = 'login.html';
}

function toggleDropdown() {
    const menu = document.getElementById('profile-dropdown');
    if (menu) menu.classList.toggle('active');
}

function applyHeaderFromCache() {
    const userEmail = localStorage.getItem('currentUserEmail') || localStorage.getItem('currentUser') || 'Guest';
    const displayName = localStorage.getItem('currentDisplayName') || (userEmail.includes('@') ? userEmail.split('@')[0] : userEmail);
    const displayUser = document.getElementById('display-user');
    const userDetail = document.getElementById('user-detail');

    if (displayUser) displayUser.textContent = displayName;
    if (userDetail) userDetail.textContent = userEmail;
}

async function syncProfileData() {
    if (!window.location.pathname.includes('profile.html')) return;

    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) return;

    try {
        const { data, error } = await _supabase
            .from('profiles')
            .select('id, username, display_name, age, analytics_preference, email')
            .eq('id', session.user.id)
            .single();

        if (data && !error) {
            const fieldMap = {
                'prof-display-name': data.display_name,
                'prof-display-email': data.email,
                'prof-display-username': data.username,
                'prof-display-age': data.age,
                'prof-display-analytics_preference': data.analytics_preference,
                'prof-uuid': data.id
            };

            for (const [id, value] of Object.entries(fieldMap)) {
                const el = document.getElementById(id);
                if (el) el.textContent = value;
            }

            const headerDisplay = document.getElementById('display-user');
            if (headerDisplay) headerDisplay.textContent = data.display_name;
            localStorage.setItem('currentDisplayName', data.display_name);
            localStorage.setItem('currentUser', data.username);
            localStorage.setItem('currentUserEmail', data.email || session.user.email || '');
        }
    } catch (err) {
        console.error('Critical Sync Failure:', err.message);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    await window.summitraAuthReady;
    applyHeaderFromCache();
    syncProfileData();

    window.addEventListener('click', (e) => {
        const container = document.querySelector('.profile-container');
        const menu = document.getElementById('profile-dropdown');
        if (container && menu && menu.classList.contains('active')) {
            if (!container.contains(e.target)) menu.classList.remove('active');
        }
    });
});

function showSystemModal(title, message, mode, callback = null) {
    const overlay = document.getElementById('statusModalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const iconEl = document.getElementById('modalIconContainer');
    const actionBtn = document.getElementById('modalActionButton');
    const modalContent = overlay ? overlay.querySelector('.card') : null;

    if (!overlay || !titleEl || !msgEl || !iconEl || !actionBtn) {
        alert(`${title}: ${message}`);
        if (callback) callback();
        return;
    }

    if (mode === 'success') {
        modalContent.style.borderTopColor = 'var(--success)';
        iconEl.textContent = '✓';
        iconEl.style.color = 'var(--success)';
    } else {
        modalContent.style.borderTopColor = 'var(--danger)';
        iconEl.textContent = '✕';
        iconEl.style.color = 'var(--danger)';
    }

    titleEl.textContent = title;
    msgEl.textContent = message;
    overlay.style.display = 'flex';

    actionBtn.onclick = function () {
        overlay.style.display = 'none';
        if (callback && typeof callback === 'function') {
            callback();
        }
    };
}

async function attemptSignUp(event) {
    if (event) event.preventDefault();

    const emailField = (document.getElementById('userEmailSignUp').value || '').trim();
    const username = document.getElementById('usernameSignUp').value + '@summitra';
    const password = document.getElementById('passwordSignUp').value;
    const passwordConfirm = document.getElementById('passwordConfirmSignUp').value;
    const displayName = document.getElementById('displayNameSignUp').value;
    const age = parseInt(document.getElementById('ageSignUp').value, 10) || 0;
    const analyticsPreference = document.getElementById('analyticsPreferenceSignUp').value;
    const confirmDesc = document.getElementById('confirmPasswordDesc');

    if (password.length < 8) {
        showSystemModal(
            'Password Too Short',
            'Use at least 8 characters.',
            'error'
        );
        return;
    }

    if (password !== passwordConfirm) {
        if (confirmDesc) {
            confirmDesc.textContent = 'CRITICAL ERROR: Passwords do not match.';
            confirmDesc.style.color = 'var(--danger)';
        }
        showSystemModal(
            'Password Mismatch',
            'The passwords entered do not match. Please verify your credentials.',
            'error'
        );
        return;
    }

    if (confirmDesc) {
        confirmDesc.textContent = 'Passwords match successfully.';
        confirmDesc.style.color = 'var(--success)';
    }

    try {
        const { data, error } = await _supabase.auth.signUp({
            email: emailField,
            password,
            options: {
                data: {
                    username,
                    display_name: displayName,
                    age: String(age),
                    analytics_preference: analyticsPreference
                }
            }
        });

        if (error) throw error;

        if (data.session) {
            await hydrateAuthCache(data.session);
            showSystemModal(
                'Account Created!',
                'Your profile setup is complete. Click acknowledge to enter Summitra.',
                'success',
                () => {
                    window.location.href = 'dashboard.html';
                }
            );
            return;
        }

        showSystemModal(
            'Account Created!',
            'Check your email to confirm the account, then log in.',
            'success',
            () => {
                window.location.href = 'login.html';
            }
        );
    } catch (dbError) {
        console.error('Cloud Sync Failure:', dbError.message);
        showSystemModal(
            'Registration failed',
            dbError.message || 'Choose another username, or register with another email.',
            'error'
        );
    }
}
