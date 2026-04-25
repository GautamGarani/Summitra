use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;


//STATE DESCRIPTORS
#[derive(PartialEq, Clone, Copy)]
enum PostureState {
    Good,
    BadTilt,
    BadForward,
    BothBad,
    Slouch
}
const BUFFER_SIZE: usize = 6;

static TILT_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static FORWARD_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static VERTICAL_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static LAST_STATE: Lazy<Mutex<PostureState>> =
    Lazy::new(|| Mutex::new(PostureState::Good));

//------------------------------------------------

// JS AUDIO HOOKS
#[wasm_bindgen]
extern "C" {
    fn play_alert();
    fn play_success();
}


//PROCESS THE FEEDBACK FOR HEAD AND NECK TILTS
//-------------------------------------------------
#[wasm_bindgen]

pub fn process_feedback(
    tilt_degrees: f32, 
    forward_degrees: f32, 
    vertical_ratio: f32,
    tilt_on: bool,
    forward_on: bool,
    slouch_on: bool,
    success_on: bool
) -> String{

    let mut buffer_tilt = TILT_BUFFER.lock().unwrap();
    let mut buffer_forward = FORWARD_BUFFER.lock().unwrap();
    let mut buffer_vertical = VERTICAL_BUFFER.lock().unwrap();

    if buffer_tilt.len() >= BUFFER_SIZE { buffer_tilt.pop_front(); }
    if buffer_forward.len() >= BUFFER_SIZE { buffer_forward.pop_front(); }
    if buffer_vertical.len() >= BUFFER_SIZE { buffer_vertical.pop_front(); }

    buffer_tilt.push_back(tilt_degrees);
    buffer_forward.push_back(forward_degrees);
    buffer_vertical.push_back(vertical_ratio);

    let len = buffer_tilt.len() as f32;

    let mean_tilt = buffer_tilt.iter().sum::<f32>()/len;
    let mean_forward = buffer_forward.iter().sum::<f32>()/len;
    let mean_vertical = buffer_vertical.iter().sum::<f32>()/len;

    let var_tilt = buffer_tilt.iter().map(|&x| (x - mean_tilt).powi(2)).sum::<f32>()/len;
    let var_forward = buffer_forward.iter().map(|&x| (x - mean_forward).powi(2)).sum::<f32>()/len;
    let var_vertical = buffer_vertical.iter().map(|&x| (x - mean_vertical).powi(2)).sum::<f32>()/len;

    // THRESHOLDS (Always active for visual feedback)
    let is_tilt_good = mean_tilt.abs() < 25.0 && var_tilt < 40.0;
    let is_forward_good = mean_forward >= 44.0 && var_forward < 40.0;
    let is_vertical_good = mean_vertical >= 0.71 && var_vertical < 0.1; 

    // STATE LOGIC
    let current_state = if !is_vertical_good {
        PostureState::Slouch
    } else {
        match (is_tilt_good, is_forward_good) {
            (true, true) => PostureState::Good,
            (false, true) => PostureState::BadTilt,
            (true, false) => PostureState::BadForward,
            (false, false) => PostureState::BothBad,
        }
    };

    let mut last_state_lock = LAST_STATE.lock().unwrap();
    let last_state = *last_state_lock;

    let result = match (last_state, current_state) {
        // Case 1: Deterioration from Optimal to any Bad state
        (PostureState::Good, s) if s != PostureState::Good => {
            let should_play = match s {
                PostureState::BadTilt => tilt_on,
                PostureState::BadForward => forward_on,
                PostureState::Slouch => slouch_on,
                PostureState::BothBad => tilt_on || forward_on,
                _ => false
            };
            if should_play { play_alert(); }
            match_state_text(current_state)
        }
        
        // Case 2: Deterioration: Adding a second bad posture issue or Slouching
        (s, PostureState::Slouch) if s != PostureState::Slouch => {
            if slouch_on { play_alert(); }
            match_state_text(current_state)
        }
        (PostureState::BadTilt, PostureState::BothBad) | 
        (PostureState::BadForward, PostureState::BothBad) => {
            let should_play = if current_state == PostureState::BothBad {
                tilt_on || forward_on
            } else { false };
            if should_play { play_alert(); }
            match_state_text(current_state)
        }

        // Case 3: Recovery: Only play success when reaching Optimal
        (s, PostureState::Good) if s != PostureState::Good => {
            if success_on { play_success(); }
            match_state_text(current_state)
        }

        _ => match_state_text(current_state),
    };

    *last_state_lock = current_state;
    result
}

fn match_state_text(state: PostureState) -> String {
    match state {
        PostureState::BadTilt => "Alert: Lateral Tilt<br>".to_string(),
        PostureState::BadForward => "Alert: Forward Lean<br>".to_string(),
        PostureState::BothBad => "Alert: Lateral Tilt + Forward Lean<br>".to_string(),
        PostureState::Slouch => "Alert: Slouching<br>".to_string(),
        PostureState::Good => "Optimal Posture".to_string(),
    }
}

//----------------------------------------------
//ANGLE CALCULATION

//RESIDUAL CODE FOR REVIVAL
//----------------------------------------------
/*

#[wasm_bindgen]
pub fn process_tilt_data(current_tilt: f32) -> String {

    let mut buffer =
        TILT_BUFFER.lock().unwrap();

    if buffer.len() >= 12 {
        buffer.pop_front();
    }

    buffer.push_back(current_tilt);

    let len = buffer.len() as f32;

    let mean_tilt =
        buffer.iter().sum::<f32>() / len;

    let variance =
        buffer.iter()
        .map(|&x| (x - mean_tilt).powi(2))
        .sum::<f32>() / len;

    let is_level = mean_tilt.abs() < 25.0;
    let is_stable = variance < 20.0;

    let current_state =
        if is_level && is_stable {
            PostureState::Good
        } else {
            PostureState::Bad
        };

    let mut last_state =
        LAST_STATE.lock().unwrap();

    let result = match (*last_state, current_state) {

        (PostureState::Good, PostureState::Bad) => {
            play_alert();
            "Alert: LATERAL Lean".to_string()
        }

        (PostureState::Bad, PostureState::Good) => {
            play_success();
            "Good!".to_string()
        }

        (_, PostureState::Bad) => {
            "Alert: LATERAL Lean".to_string()
        }

        (_, PostureState::Good) => {
            "Optimal Posture".to_string()
        }
    };

    *last_state = current_state;

    result
}

// ======================================================
// NEW FORWARD NECK LOGIC
// ======================================================
#[wasm_bindgen]
pub fn process_neck_data(current_angle: f32) -> String {

    let mut buffer =
        NECK_BUFFER.lock().unwrap();

    if buffer.len() >= 12 {
        buffer.pop_front();
    }

    buffer.push_back(current_angle);

    let len = buffer.len() as f32;

    let mean_angle =
        buffer.iter().sum::<f32>() / len;

    let variance =
        buffer.iter()
        .map(|&x| (x - mean_angle).powi(2))
        .sum::<f32>() / len;

    let is_good_angle = mean_angle > 50.0;
    let is_stable = variance < 20.0;

    let current_state =
        if is_good_angle && is_stable {
            PostureState::Good
        } else {
            PostureState::Bad
        };

    let mut last_state =
        LAST_NECK_STATE.lock().unwrap();

    let result = match (*last_state, current_state) {

        (PostureState::Good, PostureState::Bad) => {
            play_alert();
            "Alert: Forward Neck Bend".to_string()
        }

        (PostureState::Bad, PostureState::Good) => {
            play_success();
            "Good!".to_string()
        }

        (_, PostureState::Bad) => {
            "Alert: Forward Neck Bend".to_string()
        }

        (_, PostureState::Good) => {
            "Optimal Posture".to_string()
        }
    };

    *last_state = current_state;

    result
}
    */