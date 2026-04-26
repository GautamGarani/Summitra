use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;

// =========================================================
// STATE DESCRIPTORS (existing, preserved)
// =========================================================
#[derive(PartialEq, Clone, Copy)]
enum PostureState {
    Good,
    BadTilt,
    BadForward,
    BothBad,
    Slouch
}

const BUFFER_SIZE: usize = 20;

// ---------------------------------------------------------
// EXISTING ROLLING BUFFERS (preserved)
// ---------------------------------------------------------
static TILT_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static FORWARD_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static VERTICAL_BUFFER: Lazy<Mutex<VecDeque<f32>>> =
    Lazy::new(|| Mutex::new(VecDeque::with_capacity(BUFFER_SIZE)));

static LAST_STATE: Lazy<Mutex<PostureState>> =
    Lazy::new(|| Mutex::new(PostureState::Good));


// =========================================================
// NEW: CUMULATIVE DRIFT MEMORY
// ---------------------------------------------------------
// Stores sustained deviation “load”.
// Large brief excursions don't instantly annoy user.
// Prolonged deterioration accumulates.
// =========================================================
static DRIFT_ACCUM: Lazy<Mutex<f32>> =
    Lazy::new(|| Mutex::new(0.0));

const DRIFT_ALERT_THRESHOLD: f32 = 8.0;
const CUMULATIVE_ALERT_THRESHOLD: f32 = 20.0;
const DRIFT_DECAY: f32 = 0.85;


// =========================================================
// NEW: PERSONALIZED CALIBRATION STATE
// ---------------------------------------------------------
// 0-5 sec : user explores max left-right tilt
// 5-10 sec: user explores forward bend range
//10-15 sec: user explores slouch/straighten
//15-20 sec: settle window before locking calibration
// =========================================================
struct CalibrationState {
    complete: bool,
    frames: usize,

    min_tilt:f32,
    max_tilt:f32,

    min_forward:f32,
    max_forward:f32,

    min_vertical:f32,
    max_vertical:f32,

    neutral_tilt:f32,
    neutral_forward:f32,
    neutral_vertical:f32,

    tilt_margin:f32,
    forward_margin:f32,
    vertical_margin:f32
}

static CALIBRATION: Lazy<Mutex<CalibrationState>>=
Lazy::new(||Mutex::new(
CalibrationState{
    complete:false,
    frames:0,

    min_tilt:999.0,
    max_tilt:-999.0,

    min_forward:999.0,
    max_forward:-999.0,

    min_vertical:999.0,
    max_vertical:-999.0,

    neutral_tilt:0.0,
    neutral_forward:0.0,
    neutral_vertical:0.0,

    tilt_margin:0.0,
    forward_margin:0.0,
    vertical_margin:0.0
}
));


// =========================================================
// JS AUDIO HOOKS (existing preserved)
// =========================================================
#[wasm_bindgen]
extern "C" {
    fn play_alert();
    fn play_success();
}


// =========================================================
// NEW: PERSONALIZED CALIBRATION LEARNING
// =========================================================
fn update_calibration(
    tilt:f32,
    forward:f32,
    vertical:f32
){
    let mut c=CALIBRATION.lock().unwrap();

    if c.complete {
        return;
    }

    c.frames +=1;

    // assuming ~180ms loop
    let sec=c.frames as f32 * 0.18;

    // ---------- phase 1 ----------
    if sec<=5.0{
        c.min_tilt=c.min_tilt.min(tilt);
        c.max_tilt=c.max_tilt.max(tilt);
    }
    // ---------- phase 2 ----------
    else if sec<=10.0{
        c.min_forward=c.min_forward.min(forward);
        c.max_forward=c.max_forward.max(forward);
    }
    // ---------- phase 3 ----------
    else if sec<=15.0{
        c.min_vertical=c.min_vertical.min(vertical);
        c.max_vertical=c.max_vertical.max(vertical);
    }

    if sec>=20.0{
        c.neutral_tilt=
            (c.min_tilt+c.max_tilt)/2.0;

        c.neutral_forward=
            (c.min_forward+c.max_forward)/2.0;

        c.neutral_vertical=
            (c.min_vertical+c.max_vertical)/2.0;

        // 10 percent tolerance window
        c.tilt_margin=
            (c.max_tilt-c.min_tilt)*0.10;

        c.forward_margin=
            (c.max_forward-c.min_forward)*0.10;

        c.vertical_margin=
            (c.max_vertical-c.min_vertical)*0.10;

        c.complete=true;
    }
}


// =========================================================
// NEW: CONTINUOUS DRIFT SCORE
// ---------------------------------------------------------
// Replaces binary deviation thinking with continuous error.
// =========================================================
fn drift_score(
    tilt:f32,
    forward:f32,
    vertical:f32
)->f32{

    let c=CALIBRATION.lock().unwrap();

    if !c.complete{
        return 0.0;
    }

    let d_t=(tilt-c.neutral_tilt).abs();
    let d_f=(forward-c.neutral_forward).abs();
    let d_v=(vertical-c.neutral_vertical).abs();

    0.4*d_t+
    0.4*d_f+
    0.2*d_v
}


// =========================================================
// NEW: CUMULATIVE DRIFT INTEGRATOR
// =========================================================
fn update_cumulative_drift(
    drift:f32
)->f32{

    let mut acc=
        DRIFT_ACCUM.lock().unwrap();

    if drift>DRIFT_ALERT_THRESHOLD{
        *acc += drift*0.2;
    }
    else{
        *acc *= DRIFT_DECAY;
    }

    if *acc<0.0{
        *acc=0.0;
    }

    *acc
}


// =========================================================
// NEW: MICRO INSTABILITY DETECTION
// ---------------------------------------------------------
// Detects wobble/fatigue-like microcorrections.
// =========================================================
fn instability_score()->f32{

    let b=TILT_BUFFER.lock().unwrap();

    if b.len()<5{
        return 0.0;
    }

    let n=b.len() as f32;

    let mean=
        b.iter().sum::<f32>()/n;

    (
        b.iter()
         .map(|x|(x-mean).powi(2))
         .sum::<f32>()/n
    ).sqrt()
}


// =========================================================
// MAIN FEEDBACK ENGINE
// =========================================================
#[wasm_bindgen]
pub fn process_feedback(
    tilt_degrees: f32,
    forward_degrees: f32,
    vertical_ratio: f32,

    tilt_on: bool,
    forward_on: bool,
    slouch_on: bool,
    success_on: bool
)->String{

    // NEW calibration learning always runs
    update_calibration(
        tilt_degrees,
        forward_degrees,
        vertical_ratio
    );


    // =====================================================
    // Existing rolling buffers preserved
    // =====================================================
    let mut buffer_tilt=TILT_BUFFER.lock().unwrap();
    let mut buffer_forward=FORWARD_BUFFER.lock().unwrap();
    let mut buffer_vertical=VERTICAL_BUFFER.lock().unwrap();

    if buffer_tilt.len()>=BUFFER_SIZE {
        buffer_tilt.pop_front();
    }

    if buffer_forward.len()>=BUFFER_SIZE {
        buffer_forward.pop_front();
    }

    if buffer_vertical.len()>=BUFFER_SIZE {
        buffer_vertical.pop_front();
    }

    buffer_tilt.push_back(tilt_degrees);
    buffer_forward.push_back(forward_degrees);
    buffer_vertical.push_back(vertical_ratio);


    let len=buffer_tilt.len() as f32;

    let mean_tilt=
        buffer_tilt.iter().sum::<f32>()/len;

    let mean_forward=
        buffer_forward.iter().sum::<f32>()/len;

    let mean_vertical=
        buffer_vertical.iter().sum::<f32>()/len;


    let var_tilt=
        buffer_tilt.iter()
        .map(|&x|(x-mean_tilt).powi(2))
        .sum::<f32>()/len;

    let var_forward=
        buffer_forward.iter()
        .map(|&x|(x-mean_forward).powi(2))
        .sum::<f32>()/len;

    let var_vertical=
        buffer_vertical.iter()
        .map(|&x|(x-mean_vertical).powi(2))
        .sum::<f32>()/len;


    // =====================================================
    // CHANGED:
    // personalized thresholds override hardcoded thresholds
    // fallback retained if calibration incomplete
    // =====================================================
    let cal=CALIBRATION.lock().unwrap();

    let is_tilt_good=
    if cal.complete{
        (mean_tilt-cal.neutral_tilt).abs()
            <=cal.tilt_margin
        &&
        var_tilt<40.0
    }
    else{
        mean_tilt.abs()<25.0
        &&
        var_tilt<40.0
    };


    let is_forward_good=
    if cal.complete{
        (mean_forward-cal.neutral_forward).abs()
            <=cal.forward_margin
        &&
        var_forward<40.0
    }
    else{
        mean_forward>=44.0
        &&
        var_forward<40.0
    };


    let is_vertical_good=
    if cal.complete{
        (mean_vertical-cal.neutral_vertical).abs()
            <=cal.vertical_margin
        &&
        var_vertical<0.1
    }
    else{
        mean_vertical>=0.71
        &&
        var_vertical<0.1
    };

    drop(cal);


    // =====================================================
    // NEW: DRIFT ACTIVE IN ALERTING
    // =====================================================
    let drift=
        drift_score(
            mean_tilt,
            mean_forward,
            mean_vertical
        );

    let cumulative_drift=
        update_cumulative_drift(drift);

    let instability=
        instability_score();


    // Alert only if meaningful sustained deviation exists.
    let drift_gate=
    (
      drift>DRIFT_ALERT_THRESHOLD
      ||
      cumulative_drift>
      CUMULATIVE_ALERT_THRESHOLD
    )
    &&
    instability<8.0;


    // =====================================================
    // ORIGINAL STATE LOGIC  
    // =====================================================
    let current_state=
        if !is_vertical_good {
            PostureState::Slouch
        }
        else{
            match (
                is_tilt_good,
                is_forward_good
            ) {
                (true,true)=>PostureState::Good,
                (false,true)=>PostureState::BadTilt,
                (true,false)=>PostureState::BadForward,
                (false,false)=>PostureState::BothBad
            }
        };


    let mut last_state_lock=
        LAST_STATE.lock().unwrap();

    let last_state=*last_state_lock;


    let result=match (last_state,current_state){

        // -------------------------------------------------
        // CHANGED:
        // alert only if drift gate permits
        // -------------------------------------------------
        (PostureState::Good,s)
        if s!=PostureState::Good=>{

            let should_play=match s{
                PostureState::BadTilt=>tilt_on,
                PostureState::BadForward=>forward_on,
                PostureState::Slouch=>slouch_on,
                PostureState::BothBad=>
                    tilt_on||forward_on,
                _=>false
            };

            if should_play && drift_gate {
                play_alert();
            }

            match_state_text(current_state)
        }


        (s,PostureState::Slouch)
        if s!=PostureState::Slouch=>{

            if slouch_on && drift_gate{
                play_alert();
            }

            match_state_text(current_state)
        }


        (PostureState::BadTilt,
         PostureState::BothBad)
        |
        (PostureState::BadForward,
         PostureState::BothBad)=>{

            if (tilt_on||forward_on)
               && drift_gate{
                play_alert();
            }

            match_state_text(current_state)
        }


        (s,PostureState::Good)
        if s!=PostureState::Good=>{

            if success_on{
                play_success();
            }

            match_state_text(current_state)
        }

        _=>match_state_text(current_state)
    };


    *last_state_lock=current_state;

    result
}


// =========================================================
// EXISTING UI FEEDBACK TEXT 
// =========================================================
fn match_state_text(
    state:PostureState
)->String{

    match state{

        PostureState::BadTilt=>
            "Alert: Lateral Tilt<br>".to_string(),

        PostureState::BadForward=>
            "Alert: Forward Lean<br>".to_string(),

        PostureState::BothBad=>
            "Alert: Lateral Tilt + Forward Lean<br>".to_string(),

        PostureState::Slouch=>
            "Alert: Slouching<br>".to_string(),

        PostureState::Good=>
            "Optimal Posture".to_string()
    }
}


