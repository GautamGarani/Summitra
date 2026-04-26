use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// =========================================================
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

// =========================================================
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

// =========================================================
// DRIFT MEMORY (Constants tailored for 180ms loop)
// =========================================================
static DRIFT_ACCUM: Lazy<Mutex<f32>> =
    Lazy::new(|| Mutex::new(0.0));

const CUMULATIVE_ALERT_THRESHOLD: f32 = 20.0;
const DRIFT_DECAY: f32 = 0.85; 
const INSTABILITY_THRESHOLD: f32 = 8.0; 

// =========================================================
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

// =========================================================
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

// =========================================================
// DECISION LOGIC: 10% Buffer Range & Speed Check
// =========================================================
fn calculate_deviation_score(tilt: f32, forward: f32, vertical: f32) -> (f32, bool, bool, bool) {
    let c = CALIBRATION.lock().unwrap();
    if !c.complete { return (0.0, false, false, false); }

    // Dynamic Safe Zones with 10% Buffer
    let t_low = c.min_tilt - (c.min_tilt.abs() * 0.1).max(1.0);
    let t_high = c.max_tilt + (c.max_tilt.abs() * 0.1).max(1.0);
    let f_low = c.min_forward - (c.min_forward.abs() * 0.1).max(1.0);
    let f_high = c.max_forward + (c.max_forward.abs() * 0.1).max(1.0);
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
    success_on: bool
) -> String {

    update_calibration(tilt_degrees, forward_degrees, vertical_ratio);

    // Speed Calculation (Instability)
    let mut tbuf = TILT_BUFFER.lock().unwrap();
    if tbuf.len() >= BUFFER_SIZE { tbuf.pop_front(); }
    tbuf.push_back(tilt_degrees);
    let mean = tbuf.iter().sum::<f32>() / tbuf.len() as f32;
    let instability = (tbuf.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / tbuf.len() as f32).sqrt();
    drop(tbuf);

    // Deviation & Classification based on Calibration Range
    let (deviation, bad_t, bad_f, bad_v) = calculate_deviation_score(tilt_degrees, forward_degrees, vertical_ratio);

    // Time Filter (Cumulative Drift)
    let mut acc = DRIFT_ACCUM.lock().unwrap();
    if deviation > 0.0 {
        *acc += deviation * 0.1; // Multiplier helps reach 20.0 in ~3s
    } else {
        *acc *= DRIFT_DECAY;
    }
    let cumulative = *acc;

    // Out of range AND Moving Slow AND Persistent
    let gate = deviation > 0.0 && instability < INSTABILITY_THRESHOLD && cumulative > CUMULATIVE_ALERT_THRESHOLD;

    let is_tilt_bad = bad_t && tilt_on && gate;
    let is_forward_bad = bad_f && forward_on && gate;
    let is_slouch_bad = bad_v && slouch_on && gate;

    // Determine current state including Slouching
    let current_state = match (is_tilt_bad, is_forward_bad, is_slouch_bad) {
        (false, false, false) => PostureState::Good,
        (true, false, false) => PostureState::BadTilt,
        (false, true, false) => PostureState::BadForward,
        (false, false, true) => PostureState::BadSlouch,
        _ => PostureState::MultipleBad
    };

    let mut last_state = LAST_STATE.lock().unwrap();
    let prev = *last_state;
    *last_state = current_state;

    match (prev, current_state) {
        (PostureState::Good, s) if s != PostureState::Good => {
            play_alert();
            match_state_text(current_state)
        }
        (s, PostureState::Good) if s != PostureState::Good => {
            if success_on { play_success(); }
            match_state_text(current_state)
        }
        _ => match_state_text(current_state)
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
