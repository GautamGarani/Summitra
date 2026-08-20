/* help-system.js - Reusable Usage Splash & Help Utilities */

const defaultUsageSlides = [
    { icon: 'help', title: 'How to Use Summitra', text: 'Follow these core steps to maintain ergonomic alignment and optimize posture session tracking.' },
    { icon: 'videocam', title: '1. Position Your Camera', text: 'Ensure your webcam has a clear, unobstructed view of your upper body, neck, and shoulders in well-lit surroundings.' },
    { icon: 'center_focus_strong', title: '2. Calibrate Baseline', text: 'Launch the live monitor and follow the instructions given there' },
    { icon: 'notifications_active', title: '3. Real-time Micro-Alerts', text: 'Work naturally. The engine delivers gentle visual and audio cues whenever posture drift exceeds safe thresholds.' },
    { icon: 'insights', title: '4. Review Trends', text: 'End your session to automatically record metrics, analyze compliance scores, and review fatigue distributions.' }
];

let helpSlideIdx = 0;
let helpInterval = null;

function renderHelpSlide(slides, index) {
    const container = document.getElementById('usage-splash-content');
    if (!container) return;

    const activeSlide = container.querySelector('.splash-slide.active');
    if (activeSlide) {
        activeSlide.classList.remove('active');
        activeSlide.classList.add('exit');
        setTimeout(() => activeSlide.remove(), 800);
    }

    if (index >= slides.length) {
        helpSlideIdx = 0;
    }
    const data = slides[helpSlideIdx];

    const slide = document.createElement('div');
    slide.className = 'splash-slide';
    slide.innerHTML = `
        <div class="material-symbols-rounded icon">${data.icon}</div>
        <h1>${data.title}</h1>
        <p>${data.text}</p>
    `;

    container.appendChild(slide);

    setTimeout(() => {
        slide.classList.add('active');
    }, 50);
}

function openUsageSplash(customSlides) {
    const slides = customSlides || defaultUsageSlides;
    let overlay = document.getElementById('usage-splash');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'usage-splash';
        overlay.className = 'splash-overlay';
        overlay.innerHTML = `
            <div class="splash-content" id="usage-splash-content"></div>
            <div class="enter-btn-container">
                <button class="enter-btn" onclick="closeUsageSplash()">
                    GOT IT <span class="material-symbols-rounded">check</span>
                </button>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    overlay.classList.add('active');
    helpSlideIdx = 0;
    document.getElementById('usage-splash-content').innerHTML = '';
    renderHelpSlide(slides, helpSlideIdx);

    clearInterval(helpInterval);
    helpInterval = setInterval(() => {
        helpSlideIdx++;
        if (helpSlideIdx >= slides.length) helpSlideIdx = 0;
        renderHelpSlide(slides, helpSlideIdx);
    }, 4500);
}

function closeUsageSplash() {
    const overlay = document.getElementById('usage-splash');
    if (overlay) {
        overlay.classList.remove('active');
    }
    clearInterval(helpInterval);
}