const _supabase = window._supabase;

let latestFeedback = null;
let starting = false;

// ----------------------------
// CALIBRATION
// ----------------------------
const CALIBRATION_FRAMES = 112;

// ----------------------------
// SESSION DATA
// ----------------------------
const sessionData = {
    owner: localStorage.getItem('currentUser'),
    user_id: localStorage.getItem('currentUserId'),
    sessionStart: new Date().toISOString(),
    sessionEnd: null,
    durationSeconds: 0,
    logs: [],
    alerts: [],
    calibration: [],
    totalFrames: 0,
    goodFrames: 0,
    badFrames: 0,
    lateralAlerts: 0,
    forwardAlerts: 0,
    slouchAlerts: 0,
    multipleAlerts: 0,
    environment: {
        userAgent: navigator.userAgent,
        resolution: `${window.innerWidth}x${window.innerHeight}`,
        browser: getBrowserInfo()
    },
    errors: []
};
// ----------------------------
//ADVANCED TELEMETRY COLLECTION
//-----------------------------

// --- Advanced Telemetry Collection ---
function getExtendedTelemetry() {
    return {
        // Hardware performance
        cpuCores: navigator.hardwareConcurrency || "Unknown",
        ram: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Unknown",

        // Network environment
        connection: navigator.connection ? {
            type: navigator.connection.effectiveType.toUpperCase(),
            downlink: `${navigator.connection.downlink} Mbps`
        } : { type: "N/A", downlink: "N/A" },

        // Locale & Time
        language: navigator.language.toUpperCase(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
}


sessionData.environment.telemetry = getExtendedTelemetry();

// ----------------------------
// BROWSER INFO
// ----------------------------
function getBrowserInfo() {
    const ua = navigator.userAgent;

    let name = "Unknown";
    let version = "Unknown";

    if (ua.includes("Chrome") && !ua.includes("Edg")) {
        name = "Chrome";
        version = ua.match(/Chrome\/([\d.]+)/)?.[1];
    } else if (ua.includes("Edg")) {
        name = "Edge";
        version = ua.match(/Edg\/([\d.]+)/)?.[1];
    } else if (ua.includes("Firefox")) {
        name = "Firefox";
        version = ua.match(/Firefox\/([\d.]+)/)?.[1];
    } else if (ua.includes("Safari") && !ua.includes("Chrome")) {
        name = "Safari";
        version = ua.match(/Version\/([\d.]+)/)?.[1];
    }

    return { name, version };
}

// ----------------------------
// ERROR
// ----------------------------
function storeError(errorObj) {
    try {
        let errors = JSON.parse(localStorage.getItem("errorLogs")) || [];

        const enrichedError = {
            type: errorObj.type || "UNKNOWN",
            message: errorObj.message || "No message",
            stack: errorObj.stack || null,
            time: new Date().toISOString(),
            context: {
                frame: sessionData?.totalFrames || 0,
                goodFrames: sessionData?.goodFrames || 0,
                badFrames: sessionData?.badFrames || 0,
                lastFeedback: latestFeedback || null
            }
        };

        errors.push(enrichedError);
        if (errors.length > 50) errors = errors.slice(-50);

        localStorage.setItem("errorLogs", JSON.stringify(errors));

        sessionData.errors.push(enrichedError);

    } catch (e) {
        console.warn("Error logging failed", e);
    }
}

// Global error capture
window.onerror = function (message, source, lineno, colno, error) {
    storeError({
        type: "JS_ERROR",
        message,
        stack: error?.stack
    });
};

// Promise errors
window.addEventListener("unhandledrejection", function (event) {
    storeError({
        type: "PROMISE_ERROR",
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack
    });
});

// Console errors
const originalConsoleError = console.error;
console.error = function (...args) {
    storeError({
        type: "CONSOLE_ERROR",
        message: args.map(a => typeof a === "object" ? JSON.stringify(a) : a).join(" ")
    });
    originalConsoleError.apply(console, args);
};

//-------------------
//OS DATA-----------
//==================

function getOS() {
    const userAgent = window.navigator.userAgent;
    const platform = window.navigator.platform;
    const macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'];
    const windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'];
    const iosPlatforms = ['iPhone', 'iPad', 'iPod'];
    let os = 'Unknown OS';

    if (macosPlatforms.indexOf(platform) !== -1) {
        os = 'macOS';
    } else if (iosPlatforms.indexOf(platform) !== -1) {
        os = 'iOS';
    } else if (windowsPlatforms.indexOf(platform) !== -1) {
        os = 'Windows';
    } else if (/Android/.test(userAgent)) {
        os = 'Android';
    } else if (/Linux/.test(platform)) {
        os = 'Linux';
    }

    return os;
}

sessionData.environment.os = getOS();
localStorage.setItem('browser_data', JSON.stringify(sessionData.environment.browser));
localStorage.setItem('os_data', sessionData.environment.os);


//-------------------------------
//BATTERY TRACKING--------------
//-------------------------------

async function trackBatteryMetrics() {
    if ('getBattery' in navigator) {
        const battery = await navigator.getBattery();

        const updateBatteryStats = () => {
            sessionData.environment.telemetry.power = {
                level: (battery.level * 100).toFixed(0) + '%',
                charging: battery.charging,
                dischargingTime: battery.dischargingTime === Infinity ? 'N/A' : battery.dischargingTime + 's'
            };
        };

        battery.addEventListener('levelchange', updateBatteryStats);
        battery.addEventListener('chargingchange', updateBatteryStats);
        updateBatteryStats();
    }
}

//THERMAL OR FPS DEGRADATION TRACKING

let lastFrameTime = performance.now();
const fpsHistory = [];

function monitorPerformance(currentTime) {
    const delta = currentTime - lastFrameTime;
    lastFrameTime = currentTime;

    const currentFPS = 1000 / delta;
    fpsHistory.push(currentFPS);

    // Maintain a rolling window of 50 frames
    if (fpsHistory.length > 50) fpsHistory.shift();

    const avgFPS = fpsHistory.reduce((a, b) => a + b) / fpsHistory.length;

    // Detect significant drops (e.g., >30% below baseline)
    if (avgFPS < 3.5) { // Assuming ~5.5 FPS is baseline for 180ms loop
        storeError({
            type: "THERMAL_THROTTLE_WARNING",
            message: `Degraded performance detected: ${avgFPS.toFixed(1)} FPS`,
            context: { avgFPS, delta }
        });
    }
}



import init, { process_feedback } from './pkg/math_engine.js';

const {
    FaceLandmarker,
    PoseLandmarker,
    FilesetResolver
} = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3");

if (window.summitraAuthReady) await window.summitraAuthReady;
sessionData.owner = localStorage.getItem('currentUser');
sessionData.user_id = localStorage.getItem('currentUserId');

const welcomeModal = document.getElementById('welcome-modal');
const exitModal = document.getElementById('exit-modal');
const startBtn = document.getElementById('modal-start-btn');
const stopBtn = document.getElementById('stop-session-btn');
const stopPurgeBtn = document.getElementById('stop-session-purge-btn');
const confirmExitPurgeBtn = document.getElementById('confirm-exit-purge-btn');
const confirmExitBtn = document.getElementById('confirm-exit-btn');
const cancelExitBtn = document.getElementById('cancel-exit-btn');

let landmarker = null;
let poseLandmarker = null;
let running = false;

window.addEventListener('beforeunload', e => {
    if (running) {
        e.preventDefault();
        e.returnValue = '';
    }
});

startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    welcomeModal.classList.add('modal-hidden');
    unlockAudio();
    startCoach();
});

stopBtn.addEventListener('click', () => {
    exitModal.classList.remove('modal-hidden');
});

stopPurgeBtn.addEventListener('click', () => {
    // Update the modal text dynamically to reflect the destructive action
    const modalText = exitModal.querySelector('.modal-text');
    if (modalText) {
        modalText.innerHTML = `
            <b style="color: var(--error-state);">WARNING:</b> 
            This will end your session.
        `;
    }
    exitModal.classList.remove('modal-hidden');
});

cancelExitBtn.addEventListener('click', () => {
    exitModal.classList.add('modal-hidden');
});



//-------------------------------------
//VERY IMPORTANT SECTION, DO NOT TAMPER
//-------------------------------------


function getSessionPct(session) {
    if (!session) return 0;

    const good = session.goodFrames || 0;
    const bad = session.badFrames || 0;

    // Only count evaluated frames
    const validFrames = good + bad;

    if (validFrames <= 0) {
        return 0;
    }

    const score = (good / validFrames) * 100;

    return Math.min(100, Math.max(0, Number(score.toFixed(2))));
}


confirmExitBtn.addEventListener('click', async () => {
    running = false;

    sessionData.sessionEnd = new Date().toISOString();
    const start = new Date(sessionData.sessionStart);
    const end = new Date(sessionData.sessionEnd);
    sessionData.durationSeconds = Math.floor((end - start) / 1000);

    const video = document.getElementById('webcam');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
    }


    const complianceScore = getSessionPct(sessionData);


    const sumBad = sessionData.badFrames || 0;
    const debtMinutes = Math.ceil((sumBad * 0.181) / 60);


    let totalRecoveryTime = 0;
    let recoveryCount = 0;
    const logsRes = sessionData.logs || [];

    for (let i = 0; i < logsRes.length; i++) {
        if (logsRes[i].status === "ALERT") {
            const alertTime = new Date(logsRes[i].timestamp);

            for (let j = i + 1; j < logsRes.length; j++) {
                if (logsRes[j].status === "GOOD") {
                    const recoverTime = new Date(logsRes[j].timestamp);
                    const delta = (recoverTime - alertTime) / 1000;

                    if (delta > 0 && delta < 600) {
                        totalRecoveryTime += delta;
                        recoveryCount++;
                    }
                    break;
                }
            }
        }
    }
    const resilienceScore = recoveryCount > 0 ? parseFloat((totalRecoveryTime / recoveryCount).toFixed(1)) : null;
    const baseDebtScore = Math.max(0, 100 - (debtMinutes * 3.3));
    const calculatedProprioScore = parseFloat((0.6 * complianceScore + 0.4 * baseDebtScore).toFixed(1));

    // ATTEMPT CLOUD STORAGE 
    try {
        console.log("Syncing comprehensive session telemetry to cloud...");
        const { data: authData, error: authError } = await _supabase.auth.getSession();
        if (authError || !authData.session) {
            throw new Error(authError?.message || 'Not signed in');
        }

        sessionData.user_id = authData.session.user.id;
        sessionData.owner = localStorage.getItem('currentUser') || sessionData.owner;

        const { error } = await _supabase
            .from('sessions')
            .insert([{
                user_id: sessionData.user_id,
                owner: sessionData.owner,
                session_id: `${sessionData.user_id}-${Date.now()}`,
                duration: sessionData.durationSeconds,
                lateral_alerts: sessionData.lateralAlerts,
                slouch_alerts: sessionData.slouchAlerts,
                forward_alerts: sessionData.forwardAlerts,
                good_frames: sessionData.goodFrames,
                bad_frames: sessionData.badFrames,
                total_frames: sessionData.totalFrames,
                multiple_alerts: sessionData.multipleAlerts,
                session_end: sessionData.sessionEnd,
                browser_data: `${sessionData.environment.browser.name}-${sessionData.environment.browser.version}`,
                compliance: complianceScore,
                ergonomic_debt: debtMinutes,
                resilience: resilienceScore,
                proprio_score: calculatedProprioScore
            }]);

        if (error) throw error;
        console.log("Cloud normalization sync successful.");

    } catch (dbError) {
        console.error("Cloud Sync Failure, payload preserved locally:", dbError.message);
    }

    sessionData.compliance = complianceScore;
    sessionData.ergonomicDebt = debtMinutes;
    sessionData.resilience = resilienceScore;
    sessionData.proprioScore = calculatedProprioScore; 

    let sessions = JSON.parse(localStorage.getItem('sessions')) || [];
    sessions.push(sessionData);
    if (sessions.length > 20) sessions = sessions.slice(-20);
    localStorage.setItem('sessions', JSON.stringify(sessions));
    window.location.href = 'analytics.html';
});

confirmExitPurgeBtn.addEventListener('click', () => {
    running = false;
    const video = document.getElementById('webcam');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }
    sessionData.logs = [];
    sessionData.alerts = [];
    console.log("Redirecting to dashboard.html...");
    window.location.href = 'dashboard.html';
});

// ----------------------------
// TOGGLES
// ----------------------------

const controlsContainer = document.querySelector('.viewport-controls');
const master = document.getElementById('toggle-master');
const subs = [
    document.getElementById('toggle-tilt'),
    document.getElementById('toggle-forward'),
    document.getElementById('toggle-slouch')
];

master.addEventListener('change', () => {
    if (master.checked) {
        controlsContainer.classList.add('is-muted-all');
        subs.forEach(s => s.checked = false);
    } else {
        controlsContainer.classList.remove('is-muted-all');
        subs.forEach(s => s.checked = true);
    }
});

subs.forEach(s => {
    s.addEventListener('change', () => {
        if (s.checked) {
            master.checked = false;
            controlsContainer.classList.remove('is-muted-all');
        } else {
            const allOff = !subs.some(t => t.checked);
            if (allOff) {
                master.checked = true;
                controlsContainer.classList.add('is-muted-all');
            }
        }
    });
});


// ----------------------------
// MAIN
// ----------------------------


async function startCoach() {
    if (running || starting) return;
    starting = true;

    console.log("Starting the engine...");

    const display = document.getElementById('feedback-value');
    const rawText = document.getElementById('raw-angle');
    const logText = document.getElementById('log-text');
    const pulse = document.getElementById('log-pulse');
    const video = document.getElementById('webcam');
    const overlay = document.getElementById('calibration-overlay');

    try {
        console.log("Syncing rust wasm module...");
        logText.textContent = 'Syncing Rust Module...';
        await init();

        console.log("Loading vision model...");
        logText.textContent = 'Loading Vision Models...';
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );

        console.log("initialising Face Landmarker...");

        landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numFaces: 1
        });

        console.log("Face Landmarker Success...");
        console.log("initialising Pose Landmarker...");


        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numPoses: 1
        });

        console.log("Pose Landmarker Success...");
        console.log("Accessing video stream...");

        logText.textContent = 'Accessing Media Stream...';
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
        });

        video.srcObject = stream;
        await new Promise(r => video.onloadedmetadata = r);
        await video.play();

        console.log("System running...");
        logText.textContent = 'System Active';
        pulse.classList.add('active-pulse');
        running = true;
        starting = false;

        function process() {
            if (!running) return;

            const faceResults = landmarker.detectForVideo(video, performance.now());
            const poseResults = poseLandmarker.detectForVideo(video, performance.now());

            sessionData.totalFrames++;

            if (faceResults.faceLandmarks?.length > 0 && poseResults.landmarks?.length > 0) {
                const l = faceResults.faceLandmarks[0];
                const p = poseResults.landmarks[0];

                const eyeAngle = Math.atan2(l[263].y - l[33].y, l[263].x - l[33].x) * 180 / Math.PI;
                const shoulderAngle = Math.atan2(p[12].y - p[11].y, p[12].x - p[11].x) * 180 / Math.PI;

                let rawTilt = (eyeAngle - shoulderAngle);

                let tilt = rawTilt + 180;

                if (tilt > 180) tilt -= 360;
                if (tilt < -180) tilt += 360;

                const degrees = tilt;

                const dxL = Math.abs(l[454].x - p[12].x);
                const dyL = p[12].y - l[454].y;
                const angleL = Math.abs(Math.atan2(dyL, dxL) * 180 / Math.PI);

                const dxR = Math.abs(l[234].x - p[11].x);
                const dyR = p[11].y - l[234].y;
                const angleR = Math.abs(Math.atan2(dyR, dxR) * 180 / Math.PI);

                let neckAngle = (angleL + angleR) / 2;

                const sWidth = Math.sqrt(Math.pow(p[11].x - p[12].x, 2) + Math.pow(p[11].y - p[12].y, 2));
                const vGapL = p[11].y - l[454].y;
                const vGapR = p[12].y - l[234].y;
                const verticalRatio = 10 * ((vGapL + vGapR) / 2) / sWidth;

                const isMasterMuted = master.checked;
                const tiltOn = subs[0].checked;
                const forwardOn = subs[1].checked;
                const slouchOn = subs[2].checked;
                const successOn = !isMasterMuted;

                if (sessionData.totalFrames < CALIBRATION_FRAMES) {
                    overlay.style.display = 'block';
                    if (sessionData.totalFrames < 28) {
                        overlay.className = 'calibration-card cal-blue';
                        overlay.innerHTML = `<div class="cal-step">Step 1 of 4</div>Rotate head gently left and right by <b>few degrees</b> in your comfort range`;
                    } else if (sessionData.totalFrames < 56) {
                        overlay.className = 'calibration-card cal-amber';
                        overlay.innerHTML = `<div class="cal-step">Step 2 of 4</div>Keep your neck straight`;
                    } else if (sessionData.totalFrames < 84) {
                        overlay.className = 'calibration-card cal-purple';
                        overlay.innerHTML = `<div class="cal-step">Step 3 of 4</div>Straighten your back and shoulders`;
                    } else {
                        overlay.className = 'calibration-card cal-green';
                        overlay.innerHTML = `<div class="cal-step">Step 4 of 4</div>Hang tight; We are setting your baseline!`;
                    }

                    display.innerHTML = 'Calibration in progress';
                    display.style.color = 'var(--blue-primary)';
                    rawText.innerHTML = `Tilt: ${degrees.toFixed(1)}° | Neck: ${neckAngle.toFixed(1)}° | Slouch: ${verticalRatio.toFixed(2)}`;

                    if (sessionData.totalFrames % 3 === 0) {
                        process_feedback(degrees, neckAngle, verticalRatio, tiltOn, forwardOn, slouchOn, false);
                    }
                } else {
                    overlay.style.display = 'none';

                    let feedback = process_feedback(degrees, neckAngle, verticalRatio, tiltOn, forwardOn, slouchOn, successOn);

                    display.innerHTML = feedback;
                    rawText.innerHTML = `Tilt: ${degrees.toFixed(1)}° | Neck: ${neckAngle.toFixed(1)}° | Slouch: ${verticalRatio.toFixed(2)}`;

                    display.style.color = feedback.includes('Alert') ? 'var(--error-state)' :
                        (feedback.includes('Good') || feedback.includes('Optimal')) ? '#16A34A' : 'var(--blue-primary)';

                    const posture = (feedback.includes('Good') || feedback.includes('Optimal')) ? 'good' : 'bad';

                    if (posture === 'good') {
                        sessionData.goodFrames++;
                    } else {
                        sessionData.badFrames++;
                    }

                    const normalized = feedback.trim();

                    if (feedback.includes('Alert') && normalized !== latestFeedback) {
                        if (feedback.includes('Lateral')) { sessionData.lateralAlerts++; }
                        else if (feedback.includes('Forward')) { sessionData.forwardAlerts++; }
                        else if (feedback.includes('Slouch')) { sessionData.slouchAlerts++; }
                        else if (feedback.includes('Multiple')) { sessionData.multipleAlerts++; }

                        let logAngle = '';
                        if (feedback.includes('Multiple')) { logAngle = `T ${degrees.toFixed(1)} / N ${neckAngle.toFixed(1)} /N ${verticalRatio.toFixed(1)}`; }
                        else if (feedback.includes('Lateral')) { logAngle = `${degrees.toFixed(1)}°`; }
                        else if (feedback.includes('Slouching')) { logAngle = `S ${verticalRatio.toFixed(2)}`; }
                        else { logAngle = `${neckAngle.toFixed(1)}°`; }

                        const newAlert = {
                            time: new Date().toLocaleTimeString('en-GB'),
                            timestamp: new Date().toISOString(), // For delta calculations
                            type: feedback.split('<br>')[0].replace('Alert: ', '').toUpperCase(),
                            angle: logAngle,
                            status: 'ALERT'
                        };

                        sessionData.alerts.push(newAlert);
                        sessionData.logs.push(newAlert); // Timeline log
                        latestFeedback = normalized;
                        updateStatsInUI(newAlert);

                    } else if ((feedback.includes('Good') || feedback.includes('Optimal')) && latestFeedback !== 'GOOD') {
                        // Log entry into Good state
                        const healthyState = {
                            time: new Date().toLocaleTimeString('en-GB'),
                            timestamp: new Date().toISOString(),
                            type: 'OPTIMAL',
                            angle: '0.0°',
                            status: 'GOOD'
                        };
                        sessionData.logs.push(healthyState);
                        latestFeedback = 'GOOD';
                    }
                }
            } else {
                display.innerHTML = 'Get into the camera frame';
                display.style.color = 'var(--blue-300)';
            }

            setTimeout(process, 180);
        }

        process();

    } catch (error) {
        starting = false;
        running = false;

        storeError({
            type: "SYSTEM_CRASH",
            message: error.message,
            stack: error.stack
        });

        console.error(error);
    }
}

// ----------------------------
// AUDIO
// ----------------------------

let audioCtx = null;
let audioUnlocked = false;

function unlockAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    audioUnlocked = true;
}

const alertSound = new Audio('alert.mp3');
const successSound = new Audio('success.mp3');

window.play_alert = function () {
    if (!audioUnlocked) return;
    alertSound.currentTime = 0;
    alertSound.play().catch(() => { });
};

window.play_success = function () {
    if (!audioUnlocked) return;
    successSound.currentTime = 0;
    successSound.play().catch(() => { });
};

window.addEventListener('load', () => {
    welcomeModal.classList.remove('modal-hidden');
});

function updateStatsInUI(latestAlert) {
    const tbody = document.getElementById('stats-body');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td>${latestAlert.time}</td>
        <td>${latestAlert.type}</td>
        <td>${latestAlert.angle}</td>
    `;
    tbody.prepend(row);
}


const diagOverlay = document.getElementById('diagnostic-overlay');
const manifestContent = document.getElementById('manifest-content');

document.getElementById('view-manifest-btn').addEventListener('click', () => {
    const env = sessionData.environment;
    const tel = env.telemetry;
    const thermalStatus = (tel.lastDelta > 250) ? "Throttled (High Latency)" : "Optimal (Stable)";
    const batteryString = tel.power ?
        `${tel.power.level}% (${tel.power.charging ? 'Charging' : 'Discharging'})` :
        "N/A";
    manifestContent.innerHTML = `
        <!-- EXISTING ENTRIES (Browser, OS, Resolution) -->
        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">browser_updated</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Engine / Browser</span>
                <span class="manifest-value">${env.browser.name} v${env.browser.version}</span>
            </div>
        </div>
        
        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">memory</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Your OS</span>
                <span class="manifest-value">${env.os}</span>
            </div>
        </div>

        <!-- NEW: HARDWARE SECTION[cite: 11, 12] -->
        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">memory</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Hardware (Cores / RAM)</span>
                <span class="manifest-value">${tel.cpuCores} Cores / ${tel.ram}</span>
            </div>
        </div>

        <!-- NEW: NETWORK SECTION[cite: 11, 12] -->
        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">speed</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Network Bandwidth</span>
                <span class="manifest-value">${tel.connection.type} (${tel.connection.downlink})</span>
            </div>
        </div>

        <!-- NEW: LOCALE SECTION[cite: 11, 12] -->
        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">language</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Locale & Region</span>
                <span class="manifest-value">${tel.language} / ${tel.timezone}</span>
            </div>
        </div>
        
        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">battery_charging_full</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Power Efficiency</span>
                <span class="manifest-value">${batteryString}</span>
            </div>
        </div>

        <div class="manifest-item">
            <div class="manifest-icon-box"><span class="material-symbols-rounded">thermostat</span></div>
            <div class="manifest-info">
                <span class="manifest-label">Thermal Profile</span>
                <span class="manifest-value" style="color: ${tel.lastDelta > 250 ? 'var(--danger)' : 'inherit'}">
                    ${thermalStatus}
                </span>
            </div>
        </div>
        
    `;

    diagOverlay.classList.remove('modal-hidden');
});

document.getElementById('close-diagnostic-btn').addEventListener('click', () => {
    diagOverlay.classList.add('modal-hidden');
});
