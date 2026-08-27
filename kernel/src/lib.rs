use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// ========================================================= [v1.0]
// STATE DESCRIPTORS
// =========================================================
#[derive(PartialEq, Clone, Copy)]
enum PostureState {
    Good,
    BadTilt,
    BadForward,
    BadSlouch,
    MultipleBad
}

const BUFFER_SIZE: usize = 20;

// ========================================================= [v1.0]
// BUFFERS
// =========================================================
static TILT_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static FORWARD_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static VERTICAL_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static LAST_STATE: Lazy<Mutex<PostureState>> =
    Lazy::new(|| Mutex::new(PostureState::Good));

// ========================================================= [v1.0]
// DRIFT MEMORY (Constants tailored for 180ms loop)
// =========================================================
static DRIFT_ACCUM: Lazy<Mutex<f32>> =
    Lazy::new(|| Mutex::new(0.0));

const CUMULATIVE_ALERT_THRESHOLD: f32 = 20.0;
const DRIFT_DECAY: f32 = 0.85; 
const INSTABILITY_THRESHOLD: f32 = 8.0; 

// ========================================================= [v1.0]
// CALIBRATION (DYNAMIC BOUNDARIES)
// =========================================================
struct CalibrationState {
    complete: bool,
    frames: usize,
    min_tilt: f32,
    max_tilt: f32,
    min_forward: f32,
    max_forward: f32,
    min_vertical: f32,
    max_vertical: f32,
}

static CALIBRATION: Lazy<Mutex<CalibrationState>> = Lazy::new(|| {
    Mutex::new(CalibrationState {
        complete: false,
        frames: 0,
        min_tilt: f32::MAX,
        max_tilt: f32::MIN,
        min_forward: f32::MAX,
        max_forward: f32::MIN,
        min_vertical: f32::MAX,
        max_vertical: f32::MIN,
    })
});

#[wasm_bindgen]
extern "C" {
    fn play_alert();
    fn play_success();
}

// ========================================================= [v1.0]
// CALIBRATION: Recording User's Proprioceptive Range
// =========================================================
fn update_calibration(tilt: f32, forward: f32, vertical: f32) {
    let mut c = CALIBRATION.lock().unwrap();
    if c.complete { return; }

    c.frames += 1;

    if tilt < c.min_tilt { c.min_tilt = tilt; }
    if tilt > c.max_tilt { c.max_tilt = tilt; }
    if forward < c.min_forward { c.min_forward = forward; }
    if forward > c.max_forward { c.max_forward = forward; }
    if vertical < c.min_vertical { c.min_vertical = vertical; }
    if vertical > c.max_vertical { c.max_vertical = vertical; }

    if c.frames >= 28 { // ~5 seconds at 180ms
        c.complete = true;
    }
}

// ========================================================= [v1.0]
// DECISION LOGIC: 10% Buffer Range & Speed Check
// =========================================================
fn calculate_deviation_score(tilt: f32, forward: f32, vertical: f32) -> (f32, bool, bool, bool) {
    let c = CALIBRATION.lock().unwrap();
    if !c.complete { return (0.0, false, false, false); }

    // Dynamic Safe Zones with 10% Buffer
    let t_low = c.min_tilt - (c.min_tilt.abs() * 0.1).max(1.0);
    let t_high = c.max_tilt + (c.max_tilt.abs() * 0.1).max(1.0);
    let f_low = c.min_forward - (c.min_forward.abs() * 0.05).max(1.0);
    let f_high = c.max_forward + (c.max_forward.abs() * 0.05).max(1.0);
    // Vertical is ratio (slouch), buffer is tighter
    let v_low = c.min_vertical - (c.min_vertical * 0.05); 
    let v_high = c.max_vertical + (c.max_vertical * 0.05);

    let mut score = 0.0;
    let mut is_tilt_bad = false;
    let mut is_forward_bad = false;
    let mut is_slouch_bad = false;

    if tilt < t_low { score += t_low - tilt; is_tilt_bad = true; }
    else if tilt > t_high { score += tilt - t_high; is_tilt_bad = true; }

    if forward < f_low { score += f_low - forward; is_forward_bad = true; }
    else if forward > f_high { score += forward - f_high; is_forward_bad = true; }

    if vertical < v_low { score += (v_low - vertical) * 100.0; is_slouch_bad = true; }
    else if vertical > v_high { score += (vertical - v_high) * 100.0; is_slouch_bad = true; }

    (score, is_tilt_bad, is_forward_bad, is_slouch_bad)
}

#[wasm_bindgen]
pub fn process_feedback(
    tilt_degrees: f32,
    forward_degrees: f32,
    vertical_ratio: f32,
    tilt_on: bool,
    forward_on: bool,
    slouch_on: bool,
    success_on: bool,
    elapsed_seconds: f32 // [v3.0] Pass real time to prevent JS frame drifting
) -> String {

    // ========================================================= [v3.0]
    // SECURE SESSION TERMINATION LIMIT
    // Edit this variable to change the maximum session length.
    // Enforced in Rust to prevent tampering via browser console.
    // =========================================================
    let max_session_seconds: f32 = 900.0; // 15 minutes
    
    if elapsed_seconds >= max_session_seconds {
        return "TERMINATE_SESSION".to_string();
    }

    update_calibration(tilt_degrees, forward_degrees, vertical_ratio);

    // Speed Calculation (Instability) [v1.0]
    let mut tbuf = TILT_BUFFER.lock().unwrap();
    if tbuf.len() >= BUFFER_SIZE { tbuf.pop_front(); }
    tbuf.push_back(tilt_degrees);
    let mean = tbuf.iter().sum::<f32>() / tbuf.len() as f32;
    let tilt_instability = (tbuf.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / tbuf.len() as f32).sqrt();
    drop(tbuf);

    // Per-Dimension Instability: Forward & Vertical [v2.0]
    let mut fbuf = FORWARD_BUFFER.lock().unwrap();
    if fbuf.len() >= BUFFER_SIZE { fbuf.pop_front(); }
    fbuf.push_back(forward_degrees);
    let fmean = fbuf.iter().sum::<f32>() / fbuf.len() as f32;
    let forward_instability = (fbuf.iter().map(|x| (x - fmean).powi(2)).sum::<f32>() / fbuf.len() as f32).sqrt();
    drop(fbuf);

    let mut vbuf = VERTICAL_BUFFER.lock().unwrap();
    if vbuf.len() >= BUFFER_SIZE { vbuf.pop_front(); }
    vbuf.push_back(vertical_ratio);
    let vmean = vbuf.iter().sum::<f32>() / vbuf.len() as f32;
    let slouch_instability = (vbuf.iter().map(|x| (x - vmean).powi(2)).sum::<f32>() / vbuf.len() as f32).sqrt();
    drop(vbuf);

    // Deviation & Classification based on Calibration Range
    let (deviation, bad_t, bad_f, bad_v) = calculate_deviation_score(tilt_degrees, forward_degrees, vertical_ratio);

    // Time Filter (Cumulative Drift) [v3.0]
    // We cap the increment so even extreme deviations take a few seconds (~2.5s min) to trigger.
    let mut acc = DRIFT_ACCUM.lock().unwrap();
    if deviation > 0.0 {
        let increment = (deviation * 0.1).min(1.5); 
        *acc += increment;
    } else {
        *acc *= DRIFT_DECAY;
        if *acc < 0.1 { *acc = 0.0; } // Prevent lingering accumulation
    }
    let cumulative = *acc;

    // Out of range AND Moving Slow AND Persistent [v1.0]
    let global_instability = tilt_instability.max(forward_instability).max(slouch_instability);
    let base_gate = deviation > 0.0 && cumulative > CUMULATIVE_ALERT_THRESHOLD && global_instability < INSTABILITY_THRESHOLD;
    
    let is_tilt_bad = bad_t && tilt_on && base_gate;
    let is_forward_bad = bad_f && forward_on && base_gate;
    let mut is_slouch_bad = bad_v && slouch_on && base_gate;

    // [v3.0] Separation of Forward and Slouch
    // If both trigger simultaneously, prioritize Forward Lean since the neck deviation
    // physically causes the vertical ratio to drop. This prevents duplicate alerts.
    if is_forward_bad && is_slouch_bad {
        is_slouch_bad = false;
    }

    // Determine current state including Slouching
    let current_state = match (is_tilt_bad, is_forward_bad, is_slouch_bad) {
        (false, false, false) => PostureState::Good,
        (true, false, false) => PostureState::BadTilt,
        (false, true, false) => PostureState::BadForward,
        (false, false, true) => PostureState::BadSlouch,
        _ => PostureState::MultipleBad
    };

    // Build descriptive text for current state [v2.0]
    // MultipleBad now lists specific axes so the user knows exactly what to fix.
    // Keywords chosen to avoid "Lateral", "Forward", "Slouch" so live.js multiple_alerts DB count is preserved.
    let state_text: String = match current_state {
        PostureState::MultipleBad => {
            let mut parts: Vec<&str> = Vec::new();
            if is_tilt_bad    { parts.push("Head Tilt"); }
            if is_forward_bad { parts.push("Neck Lean"); }
            if is_slouch_bad  { parts.push("Back Posture"); }
            format!("Alert: Multiple Issues - {}", parts.join(" + "))
        }
        _ => match_state_text(current_state),
    };

    let mut last_state = LAST_STATE.lock().unwrap();
    let prev = *last_state;
    *last_state = current_state;

    match (prev, current_state) {
        (PostureState::Good, s) if s != PostureState::Good => {
            play_alert();
            state_text
        }
        // Bad→DifferentBad: alert fires when posture shifts between bad types [v2.0]
        (p, s) if p != PostureState::Good && s != PostureState::Good && p != s => {
            play_alert();
            state_text
        }
        (s, PostureState::Good) if s != PostureState::Good => {
            if success_on { play_success(); }
            state_text
        }
        _ => state_text
    }
}

fn match_state_text(state: PostureState) -> String {
    match state {
        PostureState::BadTilt => "Alert: Lateral Tilt".to_string(),
        PostureState::BadForward => "Alert: Forward Lean".to_string(),
        PostureState::BadSlouch => "Alert: Slouching".to_string(),
        PostureState::MultipleBad => "Alert: Multiple Issues".to_string(),
        PostureState::Good => "Optimal Posture".to_string()
    }
}
