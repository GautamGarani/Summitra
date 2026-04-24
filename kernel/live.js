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
                
                value = Math.abs(eyeAngle - shoulderAngle);

                degrees = value<(180-value)?value:(180-value);

                const dx = l[234].x - p[11].x;
                const dy = p[11].y - l[234].y;

                neckAngle = Math.abs(
                    Math.atan2(dy, dx) *
                    180 / Math.PI
                );

                feedback = process_feedback(
                    degrees,
                    neckAngle
                );

                display.innerHTML = feedback;

                rawText.innerHTML =
                    `Lateral Tilt: ${degrees.toFixed(2)}° | Neck: ${neckAngle.toFixed(2)}°`;

                display.style.color =
                    feedback.includes("Alert")
                        ? "var(--error-state)"
                        : feedback.includes("Good")
                            ? "#16A34A"
                            : "var(--blue-primary)";

                const normalizedFeedback =
                    feedback.trim();

                if (
                    feedback.includes("Alert") &&
                    normalizedFeedback !== latestFeedback
                ) {
                    const newAlert = {
                        time: new Date().toLocaleTimeString(),
                        type: feedback,
                        angle: neckAngle.toFixed(2)
                    };

                    sessionData.alerts.push(newAlert);
                    latestFeedback = normalizedFeedback;
                    updateStatsInUI(newAlert);
                }
                else if (
                    feedback.includes("Good")
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
    alertSound.play().catch(() => {});
};

window.play_success = function () {
    if (!audioUnlocked) return;
    successSound.currentTime = 0;
    successSound.play().catch(() => {});
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
        <td>${latestAlert.angle}°</td>
    `;

    tbody.prepend(row);
}
