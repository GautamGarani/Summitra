use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// ---------- Sliding Window ----------
static TILT_BUFFER: Lazy<Mutex<VecDeque<f32>>> = Lazy::new(|| {
    Mutex::new(VecDeque::with_capacity(20))
});

// ---------- Posture State ----------
#[derive(PartialEq, Clone, Copy)]
enum PostureState {
    Good,
    Bad,
}

static LAST_STATE: Lazy<Mutex<PostureState>> =
    Lazy::new(|| Mutex::new(PostureState::Good));

// ---------- JS Hook----------
#[wasm_bindgen]
extern "C" {
    fn play_alert();
    fn play_success();
}

// ---------- Main Logic just for the head tilt part (copy this for the others) ----------
#[wasm_bindgen]
pub fn process_tilt_data(current_tilt: f32) -> String {
    let mut buffer = TILT_BUFFER.lock().unwrap_or_else(|e| e.into_inner());

    // Maintain sliding window
    if buffer.len() >= 12 {
        buffer.pop_front();
    }
    buffer.push_back(current_tilt);

    let len = buffer.len() as f32;

    //We are using the mean mean tilt here over 12 frames.

    let mean_tilt = buffer.iter().sum::<f32>() / len;

    let variance = buffer.iter()
        .map(|&x| (x - mean_tilt).powi(2))
        .sum::<f32>() / len;

    // ---------- Thresholds ----------
    let is_level = mean_tilt.abs() < 25.0;
    let is_stable = variance < 25.0;

    let current_state = if is_level && is_stable {
        PostureState::Good
    } else {
        PostureState::Bad
    };

    let mut last_state = LAST_STATE.lock().unwrap_or_else(|e| e.into_inner());

    let result = match (*last_state, current_state) {

        // GOOD TO BAD TRANSITION
        (PostureState::Good, PostureState::Bad) => {
            play_alert();
            "Alert: LATERAL Lean".to_string()
        }

        // BAD TO GOOD TRANSITION 
        (PostureState::Bad, PostureState::Good) => {
            play_success();
            "Good!".to_string()
        }

        // No transition, but still bad posture
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
