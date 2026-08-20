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

// ============================================================================
// DELETE ACCOUNT
// ============================================================================

/**
 * Injects (once) and shows the delete-account confirmation modal.
 * The user must type their exact UUID to unlock the final delete button.
 */
async function deleteAccount() {
    // Ensure the user is authenticated before proceeding
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) {
        alert('You are not logged in.');
        return;
    }

    const userId = session.user.id;

    // ---- Inject the modal HTML once ----------------------------------------
    const MODAL_ID = 'deleteAccountModal';
    if (!document.getElementById(MODAL_ID)) {
        const modalHTML = `
        <div id="${MODAL_ID}" style="
            display: none; position: fixed; top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(13,27,42,0.7);
            backdrop-filter: blur(6px);
            z-index: 10001;
            justify-content: center; align-items: center;">

            <div style="
                background: #fff; border-radius: 20px;
                border-top: 4px solid var(--danger);
                padding: 32px; max-width: 440px; width: 90%;
                box-shadow: 0 24px 48px -12px rgba(0,0,0,0.25);
                animation: cardEnter 0.3s cubic-bezier(.2,.8,.2,1);">

                <div style="font-size: 2rem; margin-bottom: 12px; color: var(--danger);">&#9888;</div>

                <h3 style="
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    font-size: 1.3rem; color: #0D1B2A;
                    margin: 0 0 8px;">Delete Your Account</h3>

                <p style="
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    font-size: 0.9rem; color: #415A77;
                    line-height: 1.6; margin: 0 0 20px;">
                    This will permanently delete your account, all sessions, and all associated data. <strong>This action cannot be undone.</strong>
                </p>

                <p style="
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    font-size: 0.85rem; color: #415A77;
                    margin: 0 0 6px;">
                    To confirm, type your account UUID below:
                </p>

                <div style="
                    font-family: 'JetBrains Mono', monospace;
                    font-size: 0.8rem; color: var(--danger);
                    background: #FFF1F2; border-radius: 8px;
                    padding: 10px 14px; margin-bottom: 14px;
                    word-break: break-all; user-select: all;"
                    id="deleteModalUUID"></div>

                <input id="deleteUUIDInput" type="text" placeholder="Paste or type your UUID here"
                    autocomplete="off" spellcheck="false"
                    style="
                        width: 100%; box-sizing: border-box;
                        padding: 12px 14px; border-radius: 10px;
                        border: 1.5px solid var(--border-soft);
                        font-family: 'JetBrains Mono', monospace;
                        font-size: 0.82rem; color: #0D1B2A;
                        outline: none; transition: border-color 0.2s;
                        margin-bottom: 20px;" />

                <div style="display: flex; gap: 12px;">
                    <button id="deleteModalCancelBtn"
                        style="
                            flex: 1; padding: 12px; border-radius: 10px;
                            border: 1.5px solid var(--border-soft);
                            background: transparent; color: #415A77;
                            font-family: 'Plus Jakarta Sans', sans-serif;
                            font-weight: 600; font-size: 0.9rem;
                            cursor: pointer; transition: background 0.2s;">
                        Cancel
                    </button>
                    <button id="deleteModalConfirmBtn" disabled
                        style="
                            flex: 1; padding: 12px; border-radius: 10px;
                            border: none; background: var(--danger);
                            color: #fff; opacity: 0.4;
                            font-family: 'Plus Jakarta Sans', sans-serif;
                            font-weight: 700; font-size: 0.9rem;
                            cursor: not-allowed; transition: opacity 0.2s;">
                        Delete Account
                    </button>
                </div>

                <div id="deleteModalStatus" style="
                    display: none; margin-top: 14px;
                    font-family: 'Plus Jakarta Sans', sans-serif;
                    font-size: 0.85rem; color: var(--danger);
                    text-align: center;"></div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Wire up live UUID validation
        const input = document.getElementById('deleteUUIDInput');
        const confirmBtn = document.getElementById('deleteModalConfirmBtn');

        input.addEventListener('input', () => {
            const matches = input.value.trim() === document.getElementById('deleteModalUUID').textContent.trim();
            confirmBtn.disabled = !matches;
            confirmBtn.style.opacity = matches ? '1' : '0.4';
            confirmBtn.style.cursor = matches ? 'pointer' : 'not-allowed';
        });

        // Cancel button
        document.getElementById('deleteModalCancelBtn').addEventListener('click', () => {
            document.getElementById(MODAL_ID).style.display = 'none';
            input.value = '';
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            confirmBtn.style.cursor = 'not-allowed';
            document.getElementById('deleteModalStatus').style.display = 'none';
        });

        // Close on backdrop click
        document.getElementById(MODAL_ID).addEventListener('click', (e) => {
            if (e.target === document.getElementById(MODAL_ID)) {
                document.getElementById('deleteModalCancelBtn').click();
            }
        });

        // Confirm button — perform the deletion
        confirmBtn.addEventListener('click', async () => {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.4';
            confirmBtn.textContent = 'Deleting…';

            const statusEl = document.getElementById('deleteModalStatus');
            statusEl.style.display = 'block';
            statusEl.style.color = '#415A77';
            statusEl.textContent = 'Communicating with server…';

            try {
                // 1. Call the server-side RPC that deletes sessions, profile, and auth user.
                //    This is the primary path — it runs as a security-definer postgres function
                //    so it can delete from auth.users directly.
                const { error: rpcError } = await _supabase.rpc('delete_own_account');

                if (rpcError) {
                    // RPC failed — surface the real error instead of silently continuing.
                    // The fallback client-side path can only delete sessions + profile rows;
                    // it cannot remove the auth.users record without the RPC.
                    console.error('[deleteAccount] RPC error:', rpcError.message);

                    statusEl.textContent = 'Cleaning up data…';
                    const { error: sessErr } = await _supabase
                        .from('sessions').delete().eq('user_id', session.user.id);
                    const { error: profErr } = await _supabase
                        .from('profiles').delete().eq('id', session.user.id);

                    if (sessErr || profErr) {
                        throw new Error(
                            `Partial cleanup failed. RPC: ${rpcError.message}` +
                            (sessErr ? ` | Sessions: ${sessErr.message}` : '') +
                            (profErr ? ` | Profile: ${profErr.message}` : '')
                        );
                    }
                    // Even if data rows were cleaned, auth user still exists.
                    // Sign out so the session token stops working, then tell the user.
                    await _supabase.auth.signOut();
                    clearAuthCache();
                    localStorage.clear();
                    sessionStorage.clear();
                    throw new Error(
                        `Data cleared, but the auth user record could not be deleted (${rpcError.message}). ` +
                        `Please run the updated SQL migration in Supabase and try again.`
                    );
                }

                // 2. RPC succeeded — sign out to invalidate the JWT immediately.
                await _supabase.auth.signOut();

                // 3. Wipe all local state.
                clearAuthCache();
                localStorage.clear();
                sessionStorage.clear();

                statusEl.style.color = 'var(--success)';
                statusEl.textContent = 'Account deleted. Redirecting…';

                setTimeout(() => {
                    window.location.replace('login.html');
                }, 1200);

            } catch (err) {
                console.error('[deleteAccount] Critical error:', err);
                statusEl.style.color = 'var(--danger)';
                statusEl.textContent = `Error: ${err.message || 'Deletion failed. Please try again.'}`;
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '1';
                confirmBtn.textContent = 'Delete Account';
            }
        });
    }

    // ---- Show the modal with the user's UUID populated ---------------------
    document.getElementById('deleteModalUUID').textContent = userId;
    document.getElementById('deleteUUIDInput').value = '';
    const confirmBtn = document.getElementById('deleteModalConfirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = '0.4';
    confirmBtn.style.cursor = 'not-allowed';
    confirmBtn.textContent = 'Delete Account';
    document.getElementById('deleteModalStatus').style.display = 'none';
    document.getElementById(MODAL_ID).style.display = 'flex';

    // Close any open profile dropdown
    const menu = document.getElementById('profile-dropdown');
    if (menu) menu.classList.remove('active');
}

// ============================================================================
// VERSION CHECKING & AUTO-RELOAD LOGIC
// ============================================================================
const CLIENT_VERSION = "1.0.0";

function checkVersion() {
    fetch(`version.json?t=${Date.now()}`, {
        headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        const serverVersion = data.version;
        if (serverVersion && serverVersion !== CLIENT_VERSION) {
            console.log(`[Version Check] New version available: ${serverVersion} (Current: ${CLIENT_VERSION})`);
            
            // Prevent reload loops in the same session
            const lastReloadFor = sessionStorage.getItem('last_version_reload_attempt');
            if (lastReloadFor === serverVersion) {
                console.warn(`[Version Check] Already attempted reload to version ${serverVersion}. Skipping reload to prevent loop.`);
                return;
            }
            
            sessionStorage.setItem('last_version_reload_attempt', serverVersion);
            window.location.reload();
        }
    })
    .catch(err => {
        console.error("[Version Check] Error checking version:", err);
    });
}

// Check version 2 seconds after page load, and then every 30 seconds
setTimeout(checkVersion, 2000);
setInterval(checkVersion, 30000);
