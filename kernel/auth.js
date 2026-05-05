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
    //localStorage.clear();//WE CAN CLEAN EVERYTHING ON LOGOUT, not doing it in this version
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

// --- PAGE-SPECIFIC DATA FETCHING ---
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
    // 1. Immediate UI hydration from LocalStorage
    const userEmail = localStorage.getItem('currentUser') || 'Guest';
    const displayName = localStorage.getItem('currentDisplayName') || userEmail.split('@')[0];
    const displayUser = document.getElementById('display-user'); 
    const userDetail = document.getElementById('user-detail');   
    
    if (displayUser) displayUser.textContent = displayName;
    if (userDetail) userDetail.textContent = userEmail;

    // 2. Click-away listener for dropdown closure
    window.addEventListener('click', (e) => {
        const container = document.querySelector('.profile-container');
        const menu = document.getElementById('profile-dropdown');
        if (container && menu && menu.classList.contains('active')) {
            if (!container.contains(e.target)) menu.classList.remove('active');
        }
    });

    syncProfileData();
});