
const FORM_ID = "1FAIpQLSdJo84it9DO_4TZKfFM3sFT7iV8NEpcOeu7CHmeeRtaYGO5lA";
const ENTRY_USERNAME = "entry.251959277";
const ENTRY_MSG = "entry.679347941";
const USER_BROWSER = "entry.1365845890";
const USER_OS = "entry.721529810";

const QUICK_FIXES = [
    "Clear your browser cache",
    "Do not use incognito mode",
    "Force reload the page (Ctrl+Shift+R)",
    "Check the broswer console and paste the message here",
    "Update your browser",
    "Try another browser with JS support"
];

document.addEventListener('DOMContentLoaded', () => {
    const root = document.getElementById('summitra-help-root');

    root.innerHTML = `
        <div id="summitra-launcher" class="primary-btn">
            <span class="material-symbols-rounded">support_agent</span>
        </div>
        
        <div id="help-box" class="card">
            <!-- Header Segment -->
            <div class="help-header">
                <div class="header-info">
                    <img src="logo.jpg" class="logo-watermark" alt="Summitra">
                    <strong>Stuck? We hear you!</strong>
                </div>
                <button id="close-help" class="delete-btn-danger">
                    <span class="material-symbols-rounded">close</span>
                </button>
            </div>

            <!-- Input Segment -->
<div class="help-body">
    <div class="input-group">
        <!-- The placeholder must be a space for the floating label logic -->
        <textarea id="help-msg" placeholder=" " required></textarea>
        <label>Describe your feedback in DETAIL. Which page are you on?</label>
    </div>
    <p class="label" style="margin-top:-10px; margin-bottom:20px;">We will capture your browser metadata and respond as fast as we can!</p>
    <button id="send-help" class="btn">
        <span class="material-symbols-rounded">send</span>
        Send Message
    </button>
</div>

            <!-- Suggestions Segment -->
            <div class="help-footer">
                <span class="label">Quick Summitra Fixes</span>
                <ul id="fix-list" class="manifest-light-table"></ul>
            </div>
        </div>
    `;

    setupListeners();
    populateFixes();
});

function populateFixes() {
    const list = document.getElementById('fix-list');
    QUICK_FIXES.forEach(fix => {
        const item = document.createElement('li');
        item.className = 'manifest-item';
        item.innerHTML = `
            <span class="material-symbols-rounded">build</span>
            <span class="manifest-label">${fix}</span>
        `;
        item.onclick = () => {
            
            document.getElementById('help-msg').focus();
        };
        list.appendChild(item);
    });
}

function setupListeners() {
    const launcher = document.getElementById('summitra-launcher');
    const helpBox = document.getElementById('help-box');
    const closeBtn = document.getElementById('close-help');
    const sendBtn = document.getElementById('send-help');

    const toggleBox = () => helpBox.classList.toggle('modal-active');

    launcher.onclick = toggleBox;
    closeBtn.onclick = toggleBox;

    sendBtn.onclick = async () => {
        const msg = document.getElementById('help-msg').value;
        if (!msg.trim()) return alert("The message body cannot be empty.");

        const storedBrowser = JSON.parse(localStorage.getItem('browser_data')) || { name: "Unknown", version: "N/A" };
        const storedOS = localStorage.getItem('os_data') || "Unknown OS";
        const browserString = `${storedBrowser.name} ${storedBrowser.version}`;
        const osString = storedOS;
        const userEmail = localStorage.getItem('currentUser') || "guest_user";
        sendBtn.innerHTML = `<span class="material-symbols-rounded pulse">sync</span> Sending...`;
        await submitToGoogle(userEmail, msg, browserString, osString);
        alert("Your feedback has been transmitted! We are grateful for your feedback and time.");
        document.getElementById('help-msg').value = "";
        sendBtn.innerHTML = `<span class="material-symbols-rounded">send</span> Send Message`;
        toggleBox();
    };
}

async function submitToGoogle(email, message, browserInfo, osInfo) {
    const url = `https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`;
    const formData = new URLSearchParams();
    formData.append(ENTRY_USERNAME, email);
    formData.append(ENTRY_MSG, message);
    formData.append(USER_BROWSER, browserInfo);
    formData.append(USER_OS, osInfo);


    try {
        await fetch(url, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
        });
    } catch (e) { console.error("API Error:", e); }
}