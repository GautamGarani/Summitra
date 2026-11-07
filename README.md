# 🧍 Summitra — Real-Time Posture Monitoring

<p align="center">
  <strong>Computer Vision • Rust • WebAssembly • Real-Time Analytics</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active-success?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Platform-Web-blue?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Processing-Client--Side-purple?style=for-the-badge" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white" />
  <img src="https://img.shields.io/badge/WebAssembly-654FF0?style=flat-square&logo=webassembly&logoColor=white" />
  <img src="https://img.shields.io/badge/MediaPipe-0097A7?style=flat-square&logo=google&logoColor=white" />
  <img src="https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white" />
  <img src="https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white" />
</p>

---

## 📌 Overview

**Summitra** is a browser-based, real-time posture monitoring system that leverages computer vision to identify postural deviations during prolonged screen-based activities.

Using webcam-based pose estimation and a Rust-powered WebAssembly computational engine, Summitra evaluates posture measurements, applies temporal filtering, and generates corrective audio-visual feedback.

## ✨ Features

- 🎥 **Real-Time Pose Estimation** — Webcam-based landmark detection using MediaPipe.
- 📐 **Posture Classification** — Rule-based evaluation of posture measurements.
- ⚡ **Temporal Filtering** — Sliding-window averaging and variance analysis for stable classification.
- 🔔 **Corrective Feedback** — Audio-visual alerts triggered by posture-state transitions.
- 📊 **Session Analytics** — Tracks alert timestamps, deviation types, and measured angles.
- 🔒 **Browser-Based Processing** — Processes webcam frames locally within the browser.

## 🏗️ Architecture

```mermaid
flowchart TD
    A[Webcam Input] --> B[MediaPipe Vision]
    B --> C[Landmark Extraction]
    C --> D[JavaScript]
    D --> E[Rust / WebAssembly]
    E --> F[Temporal Filtering]
    F --> G[Rule-Based Classification]
    G --> H[Posture State]
    H --> I[Audio-Visual Feedback]
    H --> J[Session Analytics]
```

## 🛠️ Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | HTML5, CSS3, JavaScript |
| Computer Vision | MediaPipe Tasks Vision |
| Computation | Rust |
| Runtime | WebAssembly (WASM) |
| Data Processing | Sliding Window, Statistical Filtering |
| Feedback | JavaScript Audio API |

## ⚙️ Core Implementation

**1. Landmark Processing**

MediaPipe extracts body landmarks from webcam frames to support posture evaluation.

**2. Temporal Analysis**

A sliding-window buffer implemented using Rust's `VecDeque` maintains recent tilt measurements. Mean and variance calculations help assess alignment and stability.

**3. State Classification**

Threshold-based rules classify posture into Good and Bad states, with state-transition detection controlling corrective feedback.

**4. Session Monitoring**

The dashboard presents real-time feedback, measured tilt angles, and timestamped posture events.

## 🖥️ Application Preview

<p align="center">
  <i>Live posture monitoring dashboard</i>
</p>

<!-- Add your dashboard screenshot here -->
<!-- ![Summitra Dashboard](screenshots/dashboard.png) -->

## 🚀 Getting Started

### Prerequisites

- Modern browser with webcam support
- Rust toolchain
- `wasm-pack`
- Local development server

### Installation

```bash
git clone <YOUR_REPOSITORY_URL>
cd Summitra
```

Build the Rust/WASM module using the project's WebAssembly build configuration, then launch the frontend using a local development server.

Grant webcam permissions when prompted.

## 🔐 Privacy

Summitra is designed for browser-based video processing. Webcam footage is processed locally in the browser; no video upload is required by the supplied posture-processing implementation.

## 🔮 Future Scope

- Personalized posture calibration
- Expanded multi-landmark classification
- Adaptive corrective feedback
- Longitudinal posture analytics
- Enhanced deviation detection

---

<p align="center">
  <strong>Summitra</strong><br/>
  <i>Reaching the epitome of wellness.</i>
</p>
