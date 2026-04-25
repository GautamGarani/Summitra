let latestFeedback = null;
let starting = false;

// ----------------------------
// SESSION DATA
// ----------------------------
const sessionData = {
    sessionStart: new Date().toISOString(),
    alerts: [],
    calibration: [],
    totalFrames: 0
};

// ----------------------------
// IMPORTS
// ----------------------------
import init, { process_feedback } from './pkg/math_engine.js';

const {
    FaceLandmarker,
    PoseLandmarker,
    FilesetResolver
} = await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3"
);

// ----------------------------
// UI ELEMENTS
// ----------------------------
const welcomeModal = document.getElementById('welcome-modal');
const exitModal = document.getElementById('exit-modal');
const startBtn = document.getElementById('modal-start-btn');
const stopBtn = document.getElementById('stop-session-btn');
const confirmExitBtn = document.getElementById('confirm-exit-btn');
const cancelExitBtn = document.getElementById('cancel-exit-btn');

// ----------------------------
// STATE
// ----------------------------
let landmarker = null;
let poseLandmarker = null;
let running = false;

// ----------------------------
// EXIT PREVENTION
// ----------------------------
window.addEventListener('beforeunload', (e) => {
    if (running) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// ----------------------------
// MODALS
// ----------------------------
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

    const serverData = JSON.stringify(sessionData);
    localStorage.setItem('last_session_stats', serverData);

    window.location.href = 'dashboard.html';
});

// --- SMART MASTER MUTE LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    const master = document.getElementById('toggle-master');
    const tilt = document.getElementById('toggle-tilt');
    const forward = document.getElementById('toggle-forward');
    const slouch = document.getElementById('toggle-slouch');
    const subs = [tilt, forward, slouch];

    // Case 1: Master Mute clicked
    master.addEventListener('change', () => {
        if (master.checked) {
            // Mute All ON -> Alerts OFF
            subs.forEach(s => s.checked = false);
        } else {
            // Mute All OFF -> Alerts ON (Default)
            subs.forEach(s => s.checked = true);
        }
    });

    // Case 2: Individual alert toggled
    subs.forEach(s => {
        s.addEventListener('change', () => {
            if (s.checked) {
                // If any alert is turned ON, Master Mute must turn OFF
                master.checked = false;
            } else {
                // If every single alert is turned OFF, turn Master Mute ON
                const allOff = subs.every(toggle => !toggle.checked);
                if (allOff) master.checked = true;
            }
        });
    });
});

// ----------------------------
// MAIN START
// ----------------------------
async function startCoach() {

    if (running || starting) return;
    starting = true;

    const display = document.getElementById('feedback-value');
    const rawText = document.getElementById('raw-angle');
    const logText = document.getElementById('log-text');
    const pulse = document.getElementById('log-pulse');
    const video = document.getElementById('webcam');

    try {

        logText.textContent = "Syncing Rust Module...";
        await init();

        logText.textContent = "Loading Vision Models...";

        const vision =
            await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );

        landmarker =
            await FaceLandmarker.createFromOptions(
                vision,
                {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numFaces: 1
                }
            );

        poseLandmarker =
            await PoseLandmarker.createFromOptions(
                vision,
                {
                    baseOptions: {
                        modelAssetPath:
                            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                        delegate: "GPU"
                    },
                    runningMode: "VIDEO",
                    numPoses: 1
                }
            );

        logText.textContent = "Accessing Media Stream...";

        const stream =
            await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 }
            });

        video.srcObject = stream;

        await new Promise(
            resolve => video.onloadedmetadata = resolve
        );

        await video.play();

        logText.textContent = "System Active";
        pulse.classList.add('active-pulse');

        running = true;
        starting = false;

        // ----------------------------
        // LOOP
        // ----------------------------
        const process = () => {

            if (!running) return;

            const faceResults =
                landmarker.detectForVideo(
                    video,
                    performance.now()
                );

            const poseResults =
                poseLandmarker.detectForVideo(
                    video,
                    performance.now()
                );

            sessionData.totalFrames++;

            let feedback = "Awaiting calibration";
            let degrees = null;
            let neckAngle = null;

            if (
                faceResults.faceLandmarks?.length > 0 &&
                poseResults.landmarks?.length > 0
            ) {

                const l = faceResults.faceLandmarks[0];
                const p = poseResults.landmarks[0];

                const eyeAngle =
                    Math.atan2(
                        l[263].y - l[33].y,
                        l[263].x - l[33].x
                    ) * 180 / Math.PI;

                const shoulderAngle =
                    Math.atan2(
                        p[12].y - p[11].y,
                        p[12].x - p[11].x
                    ) * 180 / Math.PI;

                let value = null;

                value = Math.abs(eyeAngle - shoulderAngle); //to get the angle between the eyes and shoulders

                degrees = value < (180 - value) ? value : (180 - value);

                // --- Balanced Cross-Body Logic (Restores "Old" Angle Magnitude) ---
                // Side 1: Left Ear to RIGHT Shoulder
                const dxL = Math.abs(l[454].x - p[12].x); 
                const dyL = p[12].y - l[454].y;
                const angleL = Math.abs(Math.atan2(dyL, dxL) * 180 / Math.PI);

                // Side 2: Right Ear to LEFT Shoulder (Original code logic)
                const dxR = Math.abs(l[234].x - p[11].x);
                const dyR = p[11].y - l[234].y;
                const angleR = Math.abs(Math.atan2(dyR, dxR) * 180 / Math.PI);

                neckAngle = (angleL + angleR) / 2; 

                // --- Slouch Detection (Sinking Head Logic) ---
                const sWidth = Math.sqrt(
                    Math.pow(p[11].x - p[12].x, 2) +
                    Math.pow(p[11].y - p[12].y, 2)
                );
                const vGapL = p[11].y - l[454].y;
                const vGapR = p[12].y - l[234].y;
                const verticalRatio = ((vGapL + vGapR) / 2) / sWidth;

                // Get toggle states
                const isMasterMute = document.getElementById('toggle-master').checked;
                const tiltOn = !isMasterMute && document.getElementById('toggle-tilt').checked;
                const forwardOn = !isMasterMute && document.getElementById('toggle-forward').checked;
                const slouchOn = !isMasterMute && document.getElementById('toggle-slouch').checked;

                feedback = process_feedback(
                    degrees,
                    neckAngle,
                    verticalRatio,
                    tiltOn,
                    forwardOn,
                    slouchOn
                );

                display.innerHTML = feedback;

                rawText.innerHTML =
                    `Tilt: ${degrees.toFixed(1)}° | Neck: ${neckAngle.toFixed(1)}° | Slouch: ${verticalRatio.toFixed(2)}`;

                display.style.color =
                    feedback.includes("Alert")
                        ? "var(--error-state)"
                        : (feedback.includes("Good") || feedback.includes("Optimal"))
                            ? "#16A34A"
                            : "var(--blue-primary)";

                const normalizedFeedback =
                    feedback.trim();

                if (
                    feedback.includes("Alert") &&
                    normalizedFeedback !== latestFeedback
                ) {
                    // Determine which angles to log based on alert type
                    let logAngle = "";
                    if (feedback.includes("+")) {
                        logAngle = `T ${degrees.toFixed(1)} / N ${neckAngle.toFixed(1)}`;
                    } else if (feedback.includes("Lateral")) {
                        logAngle = `${degrees.toFixed(1)}°`;
                    } else if (feedback.includes("Slouching")) {
                        logAngle = `S ${verticalRatio.toFixed(2)}`;
                    } else {
                        logAngle = `${neckAngle.toFixed(1)}°`;
                    }

                    const newAlert = {
                        time: new Date().toLocaleTimeString('en-GB'),
                        type: feedback.split("<br>")[0].replace("Alert: ", "").toUpperCase(),
                        angle: logAngle
                    };

                    sessionData.alerts.push(newAlert);
                    latestFeedback = normalizedFeedback;
                    updateStatsInUI(newAlert);
                }
                else if (
                    feedback.includes("Good") || feedback.includes("Optimal")
                ) {
                    latestFeedback = null;
                }

            } else {

                display.innerHTML =
                    "Get into the camera frame";

                display.style.color =
                    "var(--blue-300)";
            }

            setTimeout(process, 180);
        };

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
        audioCtx =
            new (
                window.AudioContext ||
                window.webkitAudioContext
            )();
    }

    if (audioCtx.state === "suspended")
        audioCtx.resume();

    audioUnlocked = true;
}

const alertSound = new Audio("alert.mp3");
const successSound = new Audio("success.mp3");

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

    const tbody =
        document.getElementById('stats-body');

    const row =
        document.createElement('tr');

    row.innerHTML = `
        <td>${latestAlert.time}</td>
        <td>${latestAlert.type}</td>
        <td>${latestAlert.angle}</td>
    `;

    tbody.prepend(row);
}
