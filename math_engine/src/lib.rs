use wasm_bindgen::prelude::*; // Provides the bridge between Rust and JavaScript
use std::collections::VecDeque; // A double-ended queue for our temporal sliding window
use std::sync::Mutex; // Ensures thread-safe access to our global state
use once_cell::sync::Lazy; // Allows for the thread-safe initialization of global variables

// Define a global, persistent state for our sliding window of tilt data
// We wrap it in a Mutex so we can safely mutate it from the JS-invoked function
static TILT_BUFFER: Lazy<Mutex<VecDeque<f32>>> = Lazy::new(|| {
    Mutex::new(VecDeque::with_capacity(30)) // Capacity for ~7.5 seconds of data at 4 FPS
});

#[wasm_bindgen]
pub fn process_tilt_data(current_tilt: f32) -> String {
    // Acquire the lock to access the global buffer
    let mut buffer = TILT_BUFFER.lock().unwrap();

    // Maintain the sliding window size (max 30 samples)
    if buffer.len() >= 30 {
        buffer.pop_front();
    }
    buffer.push_back(current_tilt);

    // Calculate the Arithmetic Mean ($\mu$) of the window
    let mean_tilt: f32 = buffer.iter().sum::<f32>() / buffer.len() as f32;

    // Calculate the Variance ($\sigma^2$) to determine stability (how much the head wobbles)
    let variance: f32 = buffer.iter()
        .map(|&x| (x - mean_tilt).powi(2))
        .sum::<f32>() / buffer.len() as f32;

    // Logic: Define thresholds for posture and stability
    // 10 degrees is our threshold for a 'lateral lean'
    let is_level = mean_tilt.abs() < 10.0;
    let is_stable = variance < 5.0; // Low variance means the user is holding still

    // Return the formatted analysis string back to the JS frontend
    match (is_level, is_stable) {
        (true, true)   => "Optimal Posture".to_string(),
        (true, false)  => "Posture Level: Excessive Jitter".to_string(),
        (false, _)     => format!("Corrective Action: Lean is {:.1}°", mean_tilt),
    }
}
