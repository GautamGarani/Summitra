let latestFeedback = null;
let starting = false;

// ----------------------------
// CALIBRATION (FRAME-DRIVEN)
// ----------------------------
const CALIBRATION_FRAMES = 112;

// ----------------------------
// SESSION DATA
// ----------------------------
const sessionData = {
    sessionStart: new Date().toISOString(),
    logs: [], // Full timeline of state transitions (Good vs. Bad)
    alerts: [],
    calibration: [],
    totalFrames: 0,
    goodFrames: 0,
    badFrames: 0,
    lateralAlerts: 0,
    forwardAlerts: 0,
    slouchAlerts: 0
};

import init, { process_feedback } from './pkg/math_engine.js';

const {
    FaceLandmarker,
    PoseLandmarker,
    FilesetResolver
} = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3"
);

const welcomeModal = document.getElementById('welcome-modal');
const exitModal = document.getElementById('exit-modal');
const startBtn = document.getElementById('modal-start-btn');
const stopBtn = document.getElementById('stop-session-btn');
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

cancelExitBtn.addEventListener('click', () => {
    exitModal.classList.add('modal-hidden');
});

confirmExitBtn.addEventListener('click', () => {
    running = false;
    const video = document.getElementById('webcam');
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
    }

    let sessions = JSON.parse(localStorage.getItem('sessions')) || [];
    sessions.push(sessionData);

    if (sessions.length > 20) {
        sessions = sessions.slice(-20);
    }

    localStorage.setItem('sessions', JSON.stringify(sessions));
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

    const display = document.getElementById('feedback-value');
    const rawText = document.getElementById('raw-angle');
    const logText = document.getElementById('log-text');
    const pulse = document.getElementById('log-pulse');
    const video = document.getElementById('webcam');
    const overlay = document.getElementById('calibration-overlay');

    try {
        logText.textContent = 'Syncing Rust Module...';
        await init();

        logText.textContent = 'Loading Vision Models...';
        const vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );

        landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numFaces: 1
        });

        poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
                delegate: 'GPU'
            },
            runningMode: 'VIDEO',
            numPoses: 1
        });

        logText.textContent = 'Accessing Media Stream...';
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 }
        });

        video.srcObject = stream;
        await new Promise(r => video.onloadedmetadata = r);
        await video.play();

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

// 1. Shift the boundary so 180 becomes 0
let tilt = rawTilt + 180;

// 2. Wrap back to [-180, 180] range
if (tilt > 180) tilt -= 360;
if (tilt < -180) tilt += 360;

// 3. Remove Math.abs() to keep the sign
// Right tilt will be positive, Left will be negative.
// If signs are swapped for your specific camera, use: tilt = -tilt;
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
                const verticalRatio = 10*((vGapL + vGapR) / 2) / sWidth;

                const isMasterMuted = master.checked;
                const tiltOn = subs[0].checked;
                const forwardOn = subs[1].checked;
                const slouchOn = subs[2].checked;
                const successOn = !isMasterMuted;

                if (sessionData.totalFrames < CALIBRATION_FRAMES) {
                    overlay.style.display = 'block';
                    if (sessionData.totalFrames < 28) {
                        overlay.className = 'calibration-card cal-blue';
                        overlay.innerHTML = `<div class="cal-step">Step 1 of 4</div>Rotate head gently left and right`;
                    } else if (sessionData.totalFrames < 56) {
                        overlay.className = 'calibration-card cal-amber';
                        overlay.innerHTML = `<div class="cal-step">Step 2 of 4</div>Lean forward naturally`;
                    } else if (sessionData.totalFrames < 84) {
                        overlay.className = 'calibration-card cal-purple';
                        overlay.innerHTML = `<div class="cal-step">Step 3 of 4</div>Straighten and slouch slightly`;
                    } else {
                        overlay.className = 'calibration-card cal-green';
                        overlay.innerHTML = `<div class="cal-step">Step 4 of 4</div>Settling baseline...`;
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

                    // --- STATE CHANGE LOGGING (ENHANCED) ---
                    if (feedback.includes('Alert') && normalized !== latestFeedback) {
                        if (feedback.includes('Lateral')) { sessionData.lateralAlerts++; }
                        else if (feedback.includes('Forward')) { sessionData.forwardAlerts++; }
                        else if (feedback.includes('Slouch')) { sessionData.slouchAlerts++; }

                        let logAngle = '';
                        if (feedback.includes('+')) { logAngle = `T ${degrees.toFixed(1)} / N ${neckAngle.toFixed(1)}`; }
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
