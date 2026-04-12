import math
import json
from datetime import datetime
from dummy_dataset import dataset   # sample dataset file

# -------------------------------
# 1. NORMALIZATION
# -------------------------------
def normalize_keypoints(kp):
    left_shoulder = kp["left_shoulder"]
    right_shoulder = kp["right_shoulder"]

    shoulder_width = math.dist(left_shoulder, right_shoulder)

    normalized = {}
    for key, value in kp.items():
        normalized[key] = [value[0] / shoulder_width, value[1] / shoulder_width]

    return normalized


# -------------------------------
# 2. FEATURE CALCULATIONS
# -------------------------------

# Shoulder center
def get_shoulder_center(kp):
    lx, ly = kp["left_shoulder"]
    rx, ry = kp["right_shoulder"]
    return [(lx + rx) / 2, (ly + ry) / 2]


# Forward head distance
def head_forward_offset(kp):
    nose_x = kp["nose"][0]
    shoulder_center_x = get_shoulder_center(kp)[0]
    return abs(nose_x - shoulder_center_x)


# Shoulder slope
def shoulder_slope(kp):
    return abs(kp["left_shoulder"][1] - kp["right_shoulder"][1])


# Head tilt
def head_tilt(kp):
    return abs(kp["left_ear"][1] - kp["right_ear"][1])


# Approx neck angle using ear-shoulder-horizontal
def neck_angle(kp):
    ear = kp["left_ear"]
    shoulder = kp["left_shoulder"]

    dx = ear[0] - shoulder[0]
    dy = shoulder[1] - ear[1]   # inverted because screen coords

    angle = math.degrees(math.atan2(dy, dx))
    return abs(angle)


# -------------------------------
# 3. CLASSIFICATION
# -------------------------------
def classify_posture(features):
    # Thresholds (tune these if needed)
    if features["head_forward"] > 0.12:
        return "forward_slouch"

    if features["neck_angle"] < 50:
        return "neck_bending"

    if features["head_tilt"] > 0.05:
        return "head_tilt"

    if features["shoulder_slope"] > 0.05:
        return "uneven_shoulders"

    return "good"


# -------------------------------
# 4. FULL PIPELINE
# -------------------------------
def process_sample(sample):
    # Remove label before processing
    keypoints = {
        "nose": sample["nose"],
        "left_ear": sample["left_ear"],
        "right_ear": sample["right_ear"],
        "left_shoulder": sample["left_shoulder"],
        "right_shoulder": sample["right_shoulder"]
    }

    normalized = normalize_keypoints(keypoints)

    features = {
        "head_forward": head_forward_offset(normalized),
        "shoulder_slope": shoulder_slope(normalized),
        "head_tilt": head_tilt(normalized),
        "neck_angle/craniovertebral angle": neck_angle(normalized)
    }

    posture = classify_posture(features)

    return {   
        "features": features,
        "posture": posture
    }




# -------------------------------
# 5. RUN + SAVE JSON
# -------------------------------
results = []

for i, sample in enumerate(dataset):
    output = process_sample(sample)

    result_entry = {
        "sample_id": i + 1,
        "timestamp": datetime.now().isoformat(),
        "expected": sample["label"],
        "predicted": output["posture"],
        "features": output["features"]
    }

    results.append(result_entry)

    # still print for debugging in the console

    print(f"\nSample {i+1}")
    print("Expected:", sample["label"])
    print("Predicted:", output["posture"])
    print("Features:", output["features"])


# -------------------------------
# 6. WRITE TO JSON FILE
# -------------------------------
with open("posture_output.json", "w") as f:
    json.dump(results, f, indent=4)

print("\n Results saved to posture_output.json")
