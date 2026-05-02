const supabaseUrl = 'https://gigpodszdjckhvpzmuuh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdpZ3BvZHN6ZGpja2h2cHptdXVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MTU2NzcsImV4cCI6MjA5MzI5MTY3N30.UjO4Fyw5nq9zpZim_9UFNEpHi-oceTWsQSLHGrkH6_c';
const _supabase = supabase.createClient(supabaseUrl, supabaseKey);

/*
function initializeUserDB() {
    const existingDB = localStorage.getItem('userDB');
    if (!existingDB) {
        // Updated schema: username -> { password, displayName }
        const initialUsers = {
            "admin@summitra": { 
                password: "password@123", 
                displayName: "System Admin" 
            },
            "tester@summitra": { 
                password: "password@234", 
                displayName: "Tester" 
            }
        };
        localStorage.setItem('userDB', JSON.stringify(initialUsers));
    }
}

initializeUserDB();
*/

async function attemptLogin() {
    
    const userField = document.getElementById("username").value;
    const passField = document.getElementById("password").value;

    const {data, error} = await _supabase
    .from('profiles')
    .select('id, username, password, display_name')
    .eq('username', userField)
    .eq('password', passField)
    .single();

    // Check if user exists and password matches the nested property
    if (data&&!error) {
        localStorage.setItem('currentUserId', data.id)
        localStorage.setItem('currentUser', data.username);
        localStorage.setItem('currentDisplayName', data.display_name); // Store new field
        localStorage.setItem('isLoggedIn', 'true');
        
        window.location.href = 'dashboard.html';
    } 
    else {
        alert("INVALID CREDENTIALS");
    }
}

function logout(){
    localStorage.removeItem('currentUserId');
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentDisplayName'); // Clear the new field
    window.location.href = "login.html";
}

/**
 * Toggles the profile dropdown menu visibility.
 */
function toggleDropdown() {
    const menu = document.getElementById('profile-dropdown');
    menu.classList.toggle('active');
}


document.addEventListener('DOMContentLoaded', () => {
    // 1. Data Retrieval
    const userEmail = localStorage.getItem('currentUser') || 'Guest';
    // Fallback: If no Display Name is set, default to the prefix of the email
    const displayName = localStorage.getItem('currentDisplayName') || userEmail.split('@')[0];
    
    // 2. UI Element Selection
    const displayUser = document.getElementById('display-user'); // The main button label
    const userDetail = document.getElementById('user-detail');   // The detail inside the dropdown
    
    // 3. UI Injection
    // displayUser now renders the high-fidelity Name (e.g., "System Administrator")
    if (displayUser) {
        displayUser.textContent = displayName;
    }
    
    // userDetail maintains the technical email for session reference
    if (userDetail) {
        userDetail.textContent = userEmail;
    }

    // 4. Interaction Logic: Close dropdown when clicking outside the profile container
    window.addEventListener('click', (e) => {
        const container = document.querySelector('.profile-container');
        const menu = document.getElementById('profile-dropdown');
        
        // Safety check to ensure elements exist before attempting manipulation
        if (container && menu && menu.classList.contains('active')) {
            if (!container.contains(e.target)) {
                menu.classList.remove('active');
            }
        }
    });
});