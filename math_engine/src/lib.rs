use wasm_bindgen::prelude::*;
use std::collections::VecDeque;
use std::sync::Mutex;
use once_cell::sync::Lazy;

static DEPTH_TREND: Lazy<Mutex<VecDeque<f32>>> = Lazy::new(|| {
    Mutex::new(VecDeque::with_capacity(30))
});

#[wasm_bindgen]
pub fn analyze_and_smooth(data: &[f32]) -> f32 {
    if data.is_empty()
    {
        return 0.0;
    }

    let current_avg: f32 = data.iter().sum::<f32>()/data.len() as f32;

    let mut window = DEPTH_TREND.lock().unwrap();

    if window.len()>=30
    {
        window.pop_front();
    }

    window.push_back(current_avg);

    let trend_sum: f32 = window.iter().sum();
    trend_sum/window.len() as f32
}


