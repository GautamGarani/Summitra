use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;


//STATE DESCRIPTORS
#[derive(PartialEq, Clone, Copy)]
enum PostureState {
    GoodTilt,
    BadTilt,
    GoodForward,
    BadForward, 
    Good, 
    Bad
}
const BUFFER_SIZE: usize = 6;

static TILT_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static FORWARD_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static LAST_STATE: Lazy<Mutex<PostureState>> =
    Lazy::new(|| Mutex::new(PostureState::Good));

/*static LAST_NECK_STATE: Lazy<Mutex<PostureState>> =
    Lazy::new(|| Mutex::new(PostureState::Good));*/

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

pub fn process_feedback(tilt_degrees: f32, forward_degrees: f32) -> String{

    let mut buffer_tilt = TILT_BUFFER.lock().unwrap();
    let mut buffer_forward = FORWARD_BUFFER.lock().unwrap();

    let mut a = buffer_tilt.len() >= BUFFER_SIZE;
    let mut b = buffer_forward.len() >= BUFFER_SIZE;

if a {
   buffer_tilt.pop_front();
}

if b {
   buffer_forward.pop_front();
}

    buffer_tilt.push_back(tilt_degrees);
    buffer_forward.push_back(forward_degrees);

    let len_tilt = buffer_tilt.len() as f32;
    let len_forward = buffer_forward.len() as f32;

    let mean_tilt = buffer_tilt.iter().sum::<f32>()/len_tilt;
    let mean_forward = buffer_forward.iter().sum::<f32>()/len_forward;

    let variance_tilt = 
    buffer_tilt.iter()
    .map(|&x| (x - mean_tilt).powi(2))
    .sum::<f32>()/len_tilt;

    let variance_forward = 
    buffer_forward.iter()
    .map(|&x| (x - mean_forward).powi(2))
    .sum::<f32>()/len_forward;

    let is_tilt_level = mean_tilt.abs() < 25.0;
    let is_tilt_stable = variance_tilt < 40.0;

    let is_forward_level = mean_forward.abs() > 25.0;
    let is_forward_stable = variance_forward < 40.0;

    let mut current_state;

    if( is_tilt_level && is_tilt_stable){
        current_state = PostureState::GoodTilt;
        if(is_forward_level && is_forward_stable){
            current_state = PostureState::Good;
        }
        else{
            current_state = PostureState::BadForward;
        }
    }
    else
    {
        if(is_forward_level&&is_forward_stable){
            current_state = PostureState::BadTilt;
        }
        else{
            current_state = PostureState::Bad;
        }
    }

    let mut last_state = LAST_STATE.lock().unwrap();

let result = match (*last_state, current_state) {

    // ---- Alerts on deterioration ----

    (PostureState::Good, PostureState::BadTilt)
    | (PostureState::GoodTilt, PostureState::BadTilt) => {
        play_alert();
        "Alert: LATERAL Lean".to_string()
    }

    (PostureState::Good, PostureState::BadForward)
    | (PostureState::GoodForward, PostureState::BadForward) => {
        play_alert();
        "Alert: TRANSVERSE Lean".to_string()
    }

    (PostureState::Good, PostureState::Bad)
    | (PostureState::BadTilt, PostureState::Bad)
    | (PostureState::BadForward, PostureState::Bad) => {
        play_alert();
        "Alert".to_string()
    }


    // ---- Recovery transitions ----

    (PostureState::Bad, PostureState::Good)
    | (PostureState::BadTilt, PostureState::Good)
    | (PostureState::BadForward, PostureState::Good) => {
        play_success();
        "Good!".to_string()
    }


    (_, PostureState::BadTilt) => {
        "Alert: LATERAL Lean".to_string()
    }

    (_, PostureState::BadForward) => {
        "Alert: TRANSVERSE Lean".to_string()
    }

    (_, PostureState::Bad) => {
        "Alert".to_string()
    }

    (_, PostureState::Good)
    | (_, PostureState::GoodTilt)
    | (_, PostureState::GoodForward) => {
        "Optimal Posture".to_string()
    }
};

    *last_state = current_state;

    result

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