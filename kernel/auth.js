// --- CONFIGURATION & INITIALIZATION ---
const supabaseUrl = 'https://gigpodszdjckhvpzmuuh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpZ3BvZHN6ZGpja2h2cHptdXVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MTU2NzcsImV4cCI6MjA5MzI5MTY3N30.UjO4Fyw5nq9zpZim_9UFNEpHi-oceTWsQSLHGrkH6_c';
window._supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- AUTHENTICATION 
async function attemptLogin() {
    const userField = document.getElementById("username").value;
    const passField = document.getElementById("password").value;

    const { data, error } = await _supabase
        .from('profiles')
        .select('id, username, password, display_name, email, analytics_preference, age')
        .eq('username', userField)
        .eq('password', passField)
        .single();

    if (data && !error) {
        localStorage.setItem('currentUserId', data.id);
        localStorage.setItem('currentUser', data.username);
        localStorage.setItem('currentDisplayName', data.display_name);
        localStorage.setItem('currentUserAge', data.age);
        localStorage.setItem('currentUserEmail', data.email);
        localStorage.setItem('currentUserAnalyticsPreference', data.analytics_preference);
        localStorage.setItem('isLoggedIn', 'true');
        window.location.href = 'dashboard.html';
    } else {
        alert("INVALID CREDENTIALS");
    }
}

function logout() {
    //localStorage.clear(); //WE CAN CLEAN EVERYTHING ON LOGOUT, not doing it in this version
    //We will only clear out the currentUser, currentUserId, isLoggedIn, currentDisplayName, errorLogs
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentDisplayName');
    localStorage.removeItem('errorLogs');
    window.location.href = "login.html";
}

// --- UI CONTROLLERS ---
function toggleDropdown() {
    const menu = document.getElementById('profile-dropdown');
    if (menu) menu.classList.toggle('active');
}

// --- PAGE-SPECIFIC DATA 
async function syncProfileData() {
    const userId = localStorage.getItem('currentUserId');
    if (!userId || !window.location.pathname.includes('profile.html')) return;

    try {
        const { data, error } = await _supabase
            .from('profiles')
            .select('id, username, display_name, age, analytics_preference, email')
            .eq('id', userId)
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

            // Sync header and cache immediately
            const headerDisplay = document.getElementById('display-user');
            if (headerDisplay) headerDisplay.textContent = data.display_name;
            localStorage.setItem('currentDisplayName', data.display_name);
        }
    } catch (err) {
        console.error("Critical Sync Failure:", err.message);
    }
}


document.addEventListener('DOMContentLoaded', () => {

    const userEmail = localStorage.getItem('currentUser') || 'Guest';
    const displayName = localStorage.getItem('currentDisplayName') || userEmail.split('@')[0];
    const displayUser = document.getElementById('display-user');
    const userDetail = document.getElementById('user-detail');

    if (displayUser) displayUser.textContent = displayName;
    if (userDetail) userDetail.textContent = userEmail;


    window.addEventListener('click', (e) => {
        const container = document.querySelector('.profile-container');
        const menu = document.getElementById('profile-dropdown');
        if (container && menu && menu.classList.contains('active')) {
            if (!container.contains(e.target)) menu.classList.remove('active');
        }
    });

    syncProfileData();
});


async function getLastId() {
    try {
        console.log("Attempting to validate ID");
        const { data, error } = await _supabase
            .from('profiles')
            .select('id')
            .order('id', { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) {
            console.log("No existing records found or error reading database. Defaulting max ID to 0.");
            return 0;
        }

        console.log(`The maximum id is: ${data[0].id}`);
        return data[0].id;
    } catch (dbError) {
        console.error("Cloud error during ID evaluation:", dbError.message);
        return 0;
    }
}


function showSystemModal(title, message, mode, callback = null) {
    const overlay = document.getElementById("statusModalOverlay");
    const titleEl = document.getElementById("modalTitle");
    const msgEl = document.getElementById("modalMessage");
    const iconEl = document.getElementById("modalIconContainer");
    const actionBtn = document.getElementById("modalActionButton");
    const modalContent = overlay ? overlay.querySelector('.card') : null;

    if (!overlay || !titleEl || !msgEl || !iconEl || !actionBtn) {
        alert(`${title}: ${message}`);
        if (callback) callback();
        return;
    }

    if (mode === "success") {
        modalContent.style.borderTopColor = "var(--success)";
        iconEl.textContent = "✓";
        iconEl.style.color = "var(--success)";
    } else {
        modalContent.style.borderTopColor = "var(--danger)";
        iconEl.textContent = "✕";
        iconEl.style.color = "var(--danger)";
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    overlay.style.display = "flex";

    actionBtn.onclick = function () {
        overlay.style.display = "none";
        if (callback && typeof callback === "function") {
            callback();
        }
    };
}


async function attemptSignUp(event) {
    if (event) event.preventDefault();

    // DOM Value Extractions
    const emailField = document.getElementById("userEmailSignUp").value;
    const username = document.getElementById("usernameSignUp").value + "@summitra";
    const password = document.getElementById("passwordSignUp").value;
    const passwordConfirm = document.getElementById("passwordConfirmSignUp").value;
    const displayName = document.getElementById("displayNameSignUp").value;
    const age = parseInt(document.getElementById("ageSignUp").value, 10) || 0;
    const analyticsPreference = document.getElementById("analyticsPreferenceSignUp").value;

    const confirmDesc = document.getElementById("confirmPasswordDesc");

    if (password !== passwordConfirm) {
        console.warn("Authentication Intercepted: Password string disparity discovered.");

        if (confirmDesc) {
            confirmDesc.textContent = "CRITICAL ERROR: Passwords do not match.";
            confirmDesc.style.color = "var(--danger)";
        }

        showSystemModal(
            "Password Mismatch",
            "The passwords entered do not match. Please verify your credentials.",
            "error"
        );
        return;
    } else {
        if (confirmDesc) {
            confirmDesc.textContent = "Passwords match successfully.";
            confirmDesc.style.color = "var(--success)";
        }
    }

    try {
        const maxId = await getLastId();
        console.log("Attempting to connect to Supabase profiles");
        console.log(`Received the maximum id: ${maxId}`);

        const { error } = await _supabase
            .from('profiles')
            .insert([{
                id: maxId + 1,
                email: emailField,
                username: username,
                password: password,
                display_name: displayName,
                created_at: new Date().toISOString(),
                age: age,
                analytics_preference: analyticsPreference,
            }]);

        if (error) throw error;

        console.log("Cloud log successful; user structural row provisioned.");

        showSystemModal(
            "Account Created!",
            "Your profile setup is complete. Click 'acknowledge' to enter Summitra!.",
            "success",
            () => {
                window.location.href = "login.html";
            }
        );

    } catch (dbError) {
        console.error("Cloud Sync Failure:", dbError.message);

        showSystemModal(
            "Username Taken",
            `Registration failed: Choose another username`,
            "error"
        );
    }
}