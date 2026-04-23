
let latestFeedback = null;
let starting = false; // added startup lock

//THE JSON DATA ACCUMULATION LOGIC
const sessionData = 
{
	sessionStart : new Date().toISOString(),
	alerts : [],
	calibration : [],
	totalFrames : 0
};


import init, { process_tilt_data } from './pkg/math_engine.js';
const { FaceLandmarker, FilesetResolver } = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3");


// UI ELEMENTS
const welcomeModal = document.getElementById('welcome-modal');
const exitModal = document.getElementById('exit-modal');
const startBtn = document.getElementById('modal-start-btn');
const stopBtn = document.getElementById('stop-session-btn');
const confirmExitBtn = document.getElementById('confirm-exit-btn');
const cancelExitBtn = document.getElementById('cancel-exit-btn');


// STATE
let landmarker = null;
let running = false;
let animationFrameId = null;


/**
 * EXIT PREVENTION LOGIC
 */
window.addEventListener('beforeunload', (e) => {
    if (running) {
        e.preventDefault();
        e.returnValue = '';
    }
});


// MODAL CONTROL
startBtn.addEventListener('click', () => {

    startBtn.disabled = true; // added to prevent double start

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

    const summary =
        `Session complete. We recorded ${sessionData.alerts.length} posture alerts.`;

    document.querySelector('#exit-modal .modal-text').textContent = summary;

    window.location.href = 'dashboard.html';
});



async function startCoach() {

    // fixed startup race
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

        landmarker = await FaceLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath:
                    `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numFaces: 1
            }
        );


        logText.textContent = "Accessing Media Stream...";

        const stream =
            await navigator.mediaDevices.getUserMedia(
                { video: { width: 640, height: 480 } }
            );

        video.srcObject = stream;

        await new Promise(
            (resolve) => video.onloadedmetadata = resolve
        );

        await video.play();

        logText.textContent = "System Active";
        pulse.classList.add('active-pulse');


        // startup officially complete
        running = true;
        starting = false;


        const process = () => {

            if (!running) return;

            const results =
                landmarker.detectForVideo(
                    video,
                    performance.now()
                );

            if (results.faceLandmarks &&
                results.faceLandmarks.length > 0) {

                const l = results.faceLandmarks[0];

                const degrees =
                    Math.atan2(
                        l[263].y - l[33].y,
                        l[263].x - l[33].x
                    ) * (180 / Math.PI);

                const feedback =
                    process_tilt_data(degrees);

                sessionData.totalFrames++;

                display.innerHTML = feedback;

                rawText.innerHTML =
                    `Lateral Tilt: ${degrees.toFixed(2)}°`;

                display.style.color =
                    feedback === "Good!"
                        ? "#16A34A"
                        : feedback.includes("Lean")
                            ? "var(--error-state)"
                            : "var(--blue-primary)";


                const normalizedFeedback =
                    feedback.trim();


                if (
                    (feedback.includes("Lean") ||
                     feedback.includes("Alert")) &&
                    (normalizedFeedback !== latestFeedback)
                ) {

                    const newAlert = {
                        time : new Date().toLocaleTimeString(),
                        type : feedback,
                        angle: degrees.toFixed(2)
                    };

                    sessionData.alerts.push(newAlert);

                    latestFeedback = normalizedFeedback;

                    updateStatsInUI(newAlert);
                }

                else if (feedback.includes("Good")) {

                    latestFeedback = null;
                }

            }

            else {

                display.innerHTML =
                    "Get into the camera frame";

                display.style.color =
                    "var(--blue-300)";
            }


            setTimeout(() => {

                if (running)
                    animationFrameId =
                        requestAnimationFrame(process);

            }, 80);
        };


        // extra protection against orphan loops
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }

        process();

    }

    catch (error) {

        starting = false; // reset lock on failure
        running = false;

        logText.textContent =
            "Initialization Failed";

        logText.style.color =
            "#FF8A8A";

        console.error(error);
    }
}



// AUDIO
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


const alertSound =
    new Audio("alert.mp3");

const successSound =
    new Audio("success.mp3");


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



function updateStatsInUI(latestAlert)
{
    const tbody = document.getElementById('stats-body');

    const row = document.createElement('tr');

    row.innerHTML = `
        <td>${latestAlert.time}</td>
        <td>${latestAlert.type}</td>
        <td>${latestAlert.angle}°</td>
    `;

    tbody.prepend(row);
}

