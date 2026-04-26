"""Facial verification utilities for registration and exams.

Uses OpenCV's built-in face/eye/smile detectors so the verification service can
run locally without external model downloads.
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import math
import os
from dataclasses import dataclass
from typing import Iterable, List, Sequence

from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageStat

cv2 = None
np = None
_CV_IMPORT_ATTEMPTED = False

EMBEDDING_DIMENSION = 64
DEFAULT_THRESHOLD = 0.65
ANGLE_SAMPLE_LIMIT = 6

_FACE_CASCADE = None
_PROFILE_CASCADE = None
_EYE_CASCADE = None
_SMILE_CASCADE = None
_YUNET_DETECTOR = None
_SFACE_RECOGNIZER = None
DETECTION_TARGET_WIDTH = 640
_MODEL_DIR = os.path.join(os.path.dirname(__file__), "models_cache")
_YUNET_MODEL = os.path.join(_MODEL_DIR, "face_detection_yunet_2023mar.onnx")
_SFACE_MODEL = os.path.join(_MODEL_DIR, "face_recognition_sface_2021dec.onnx")


class FaceVerificationError(ValueError):
    """Raised when an uploaded or captured image cannot be processed."""


@dataclass
class VerificationResult:
    score: float
    threshold: float
    verified: bool
    engine: str = "privacy_signature_v1"


def _load_cv_stack():
    global cv2, np, _CV_IMPORT_ATTEMPTED
    if _CV_IMPORT_ATTEMPTED:
        return cv2, np
    _CV_IMPORT_ATTEMPTED = True
    try:
        import cv2 as _cv2
        import numpy as _np
    except Exception:  # pragma: no cover
        _cv2 = None
        _np = None
    cv2 = _cv2
    np = _np
    return cv2, np


def _engine_name():
    _load_cv_stack()
    return "opencv_faceprint_v4" if cv2 is not None and np is not None else "privacy_signature_v1"


def _coerce_bytes(raw_image: object) -> bytes:
    if raw_image is None:
        raise FaceVerificationError("Face image is required.")
    if isinstance(raw_image, (bytes, bytearray)):
        payload = bytes(raw_image)
    elif isinstance(raw_image, str):
        if raw_image.startswith("data:image/"):
            try:
                payload = base64.b64decode(raw_image.split(",", 1)[1], validate=True)
            except Exception as exc:
                raise FaceVerificationError("Invalid live face capture payload.") from exc
        else:
            raise FaceVerificationError("Unsupported face capture format.")
    elif hasattr(raw_image, "read"):
        payload = raw_image.read()
    else:
        raise FaceVerificationError("Unsupported face payload.")
    if not payload:
        raise FaceVerificationError("Empty face image payload.")
    return payload


def _load_image(raw_image: object) -> Image.Image:
    payload = _coerce_bytes(raw_image)
    try:
        image = Image.open(io.BytesIO(payload))
        image = ImageOps.exif_transpose(image)
        image.load()
        return image
    except Exception as exc:
        raise FaceVerificationError("Unable to decode the provided face image.") from exc


def _image_to_bytes(image: Image.Image, format_name: str = "JPEG") -> bytes:
    buffer = io.BytesIO()
    save_image = image.convert("RGB") if image.mode not in {"RGB", "L"} else image
    save_image.save(buffer, format=format_name, quality=95)
    return buffer.getvalue()


def _load_cv_image(raw_image: object):
    _load_cv_stack()
    if cv2 is None or np is None:
        return None
    payload = _coerce_bytes(raw_image)
    image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise FaceVerificationError("Unable to decode the provided face image.")
    return image


def _get_cascades():
    global _FACE_CASCADE, _PROFILE_CASCADE, _EYE_CASCADE, _SMILE_CASCADE
    _load_cv_stack()
    if cv2 is None:
        return None
    if _FACE_CASCADE is None:
        base = cv2.data.haarcascades
        _FACE_CASCADE = cv2.CascadeClassifier(base + "haarcascade_frontalface_default.xml")
        _PROFILE_CASCADE = cv2.CascadeClassifier(base + "haarcascade_profileface.xml")
        _EYE_CASCADE = cv2.CascadeClassifier(base + "haarcascade_eye.xml")
        _SMILE_CASCADE = cv2.CascadeClassifier(base + "haarcascade_smile.xml")
    return _FACE_CASCADE, _PROFILE_CASCADE, _EYE_CASCADE, _SMILE_CASCADE


def _get_dnn_models():
    global _YUNET_DETECTOR, _SFACE_RECOGNIZER
    _load_cv_stack()
    if cv2 is None:
        return None, None
    if not (os.path.exists(_YUNET_MODEL) and os.path.exists(_SFACE_MODEL)):
        return None, None
    if _YUNET_DETECTOR is None:
        _YUNET_DETECTOR = cv2.FaceDetectorYN.create(_YUNET_MODEL, "", (320, 320), 0.82, 0.3, 5000)
    if _SFACE_RECOGNIZER is None:
        _SFACE_RECOGNIZER = cv2.FaceRecognizerSF.create(_SFACE_MODEL, "")
    return _YUNET_DETECTOR, _SFACE_RECOGNIZER


def _normalize_embedding(values: Sequence[float]) -> List[float]:
    if not values:
        raise FaceVerificationError("Unable to build a facial signature.")
    mean = sum(values) / len(values)
    centered = [value - mean for value in values]
    magnitude = math.sqrt(sum(value * value for value in centered))
    if magnitude < 1e-6:
        raise FaceVerificationError("Face image is too uniform. Capture a clearer photo.")
    return [round(value / magnitude, 8) for value in centered]


def _largest_box(boxes):
    if boxes is None or len(boxes) == 0:
        return None
    return max(boxes, key=lambda item: item[2] * item[3])


def _normalize_gray_for_detection(gray):
    base = cv2.equalizeHist(gray)
    variants = [base]
    
    # Enhanced lighting normalization with multiple approaches
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    variants.append(clahe.apply(gray))
    
    mean_brightness = float(base.mean())
    std_brightness = float(base.std())
    
    # Adaptive lighting correction based on brightness and contrast
    if mean_brightness < 80:  # Very dark
        variants.append(cv2.convertScaleAbs(base, alpha=1.4, beta=15))
        variants.append(cv2.GaussianBlur(cv2.convertScaleAbs(base, alpha=1.3, beta=12), (3, 3), 0))
    elif mean_brightness < 120:  # Dark
        variants.append(cv2.convertScaleAbs(base, alpha=1.2, beta=8))
        variants.append(cv2.GaussianBlur(cv2.convertScaleAbs(base, alpha=1.15, beta=6), (3, 3), 0))
    elif mean_brightness > 180:  # Very bright
        variants.append(cv2.convertScaleAbs(base, alpha=0.85, beta=-5))
        variants.append(cv2.GaussianBlur(cv2.convertScaleAbs(base, alpha=0.9, beta=-3), (3, 3), 0))
    else:  # Normal lighting
        variants.append(cv2.GaussianBlur(base, (3, 3), 0))
    
    # Add contrast-stretched variant for low contrast images
    if std_brightness < 40:
        stretched = cv2.normalize(base, None, 0, 255, cv2.NORM_MINMAX)
        variants.append(stretched)
    
    return variants


def _score_box(box, shape):
    height, width = shape[:2]
    x, y, w, h = [float(value) for value in box]
    area_ratio = (w * h) / max(float(width * height), 1.0)
    center_x = x + (w / 2.0)
    center_y = y + (h / 2.0)
    center_penalty = abs(center_x - (width / 2.0)) / max(width, 1.0)
    vertical_penalty = abs(center_y - (height * 0.46)) / max(height, 1.0)
    aspect_penalty = abs((w / max(h, 1.0)) - 0.82)
    return (area_ratio * 3.1) - (center_penalty * 0.95) - (vertical_penalty * 0.4) - (aspect_penalty * 0.2)


def _detect_face_yunet(image):
    detector, _ = _get_dnn_models()
    if detector is None:
        return None, "frontal", 0
    source = image
    scale = 1.0
    if image.shape[1] > DETECTION_TARGET_WIDTH:
        scale = DETECTION_TARGET_WIDTH / float(image.shape[1])
        source = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    detector.setInputSize((int(source.shape[1]), int(source.shape[0])))
    _, faces = detector.detect(source)
    if faces is None or len(faces) == 0:
        return None, "frontal", 0
    best_face = max(faces, key=lambda face: _score_box(face[:4], source.shape) + (float(face[-1]) * 0.45))
    face_count = int(len(faces))
    x, y, w, h = [float(value) for value in best_face[:4]]
    if scale != 1.0:
        x /= scale
        y /= scale
        w /= scale
        h /= scale
        scaled = best_face.astype("float32").copy()
        scaled[:14] = scaled[:14] / scale
        best_face = scaled
    eye_balance = 0.0
    if len(best_face) >= 8:
        right_eye_x = float(best_face[4])
        left_eye_x = float(best_face[6])
        eye_balance = (((right_eye_x + left_eye_x) / 2.0) - (x + (w / 2.0))) / max(w, 1.0)
    yaw_degrees = float(max(-22.0, min(22.0, eye_balance * 120.0)))
    mode = "frontal"
    if yaw_degrees <= -8:
        mode = "left_profile"
    elif yaw_degrees >= 8:
        mode = "right_profile"
    return best_face.astype("float32"), mode, face_count


def _point_payload(x_value: float, y_value: float, frame_width: int, frame_height: int):
    return {
        "x": round(float(x_value), 2),
        "y": round(float(y_value), 2),
        "x_ratio": round(float(x_value) / max(frame_width, 1), 6),
        "y_ratio": round(float(y_value) / max(frame_height, 1), 6),
    }


def _build_landmark_payload(face, box, frame_width: int, frame_height: int):
    if face is None or len(face) < 14:
        return {}
    x, y, w, h = [float(value) for value in box]
    right_eye = (float(face[4]), float(face[5]))
    left_eye = (float(face[6]), float(face[7]))
    nose = (float(face[8]), float(face[9]))
    mouth_right = (float(face[10]), float(face[11]))
    mouth_left = (float(face[12]), float(face[13]))
    eyebrow_offset = h * 0.12
    cheek_y = y + (h * 0.56)
    ear_y = y + (h * 0.48)
    return {
        "right_eye": _point_payload(*right_eye, frame_width, frame_height),
        "left_eye": _point_payload(*left_eye, frame_width, frame_height),
        "nose": _point_payload(*nose, frame_width, frame_height),
        "mouth_right": _point_payload(*mouth_right, frame_width, frame_height),
        "mouth_left": _point_payload(*mouth_left, frame_width, frame_height),
        "right_brow": _point_payload(right_eye[0], right_eye[1] - eyebrow_offset, frame_width, frame_height),
        "left_brow": _point_payload(left_eye[0], left_eye[1] - eyebrow_offset, frame_width, frame_height),
        "chin": _point_payload(x + (w / 2.0), y + h + (h * 0.05), frame_width, frame_height),
        "right_cheek": _point_payload(x + (w * 0.2), cheek_y, frame_width, frame_height),
        "left_cheek": _point_payload(x + (w * 0.8), cheek_y, frame_width, frame_height),
        "right_ear": _point_payload(x - (w * 0.03), ear_y, frame_width, frame_height),
        "left_ear": _point_payload(x + w + (w * 0.03), ear_y, frame_width, frame_height),
    }


def _geometry_vector_from_face(face, box):
    if face is None or len(face) < 14:
        return [0.0] * 8
    x, y, w, h = [float(value) for value in box]
    right_eye = (float(face[4]), float(face[5]))
    left_eye = (float(face[6]), float(face[7]))
    nose = (float(face[8]), float(face[9]))
    mouth_right = (float(face[10]), float(face[11]))
    mouth_left = (float(face[12]), float(face[13]))
    eye_distance = abs(left_eye[0] - right_eye[0]) / max(w, 1.0)
    eye_height_delta = abs(left_eye[1] - right_eye[1]) / max(h, 1.0)
    nose_offset = ((nose[0] - (x + (w / 2.0))) / max(w, 1.0))
    nose_depth = (nose[1] - y) / max(h, 1.0)
    mouth_width = abs(mouth_left[0] - mouth_right[0]) / max(w, 1.0)
    mouth_height = ((mouth_left[1] + mouth_right[1]) / 2.0 - y) / max(h, 1.0)
    eye_to_mouth = (((mouth_left[1] + mouth_right[1]) / 2.0) - ((left_eye[1] + right_eye[1]) / 2.0)) / max(h, 1.0)
    face_aspect = h / max(w, 1.0)
    return [
        eye_distance,
        eye_height_delta,
        nose_offset,
        nose_depth,
        mouth_width,
        mouth_height,
        eye_to_mouth,
        face_aspect,
    ]


def _detect_face_box(gray):
    if cv2 is not None and np is not None:
        bgr = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        dnn_face, mode, face_count = _detect_face_yunet(bgr)
        if dnn_face is not None:
            return tuple(int(round(value)) for value in dnn_face[:4]), mode, face_count
    cascades = _get_cascades()
    if not cascades:
        return None, "frontal", 0
    face_cascade, profile_cascade, _, _ = cascades
    source_gray = gray
    scale = 1.0
    if gray.shape[1] > DETECTION_TARGET_WIDTH:
      scale = DETECTION_TARGET_WIDTH / float(gray.shape[1])
      source_gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)

    candidates = []
    face_count = 0
    min_size = (max(54, int(source_gray.shape[1] * 0.11)), max(54, int(source_gray.shape[0] * 0.11)))

    for variant in _normalize_gray_for_detection(source_gray):
        for min_neighbors in (5, 4):
            frontal = face_cascade.detectMultiScale(variant, scaleFactor=1.08, minNeighbors=min_neighbors, minSize=min_size)
            if len(frontal):
                face_count = max(face_count, int(len(frontal)))
                for item in frontal:
                    candidates.append((tuple(item), "frontal"))

        profile = profile_cascade.detectMultiScale(variant, scaleFactor=1.08, minNeighbors=4, minSize=min_size)
        if len(profile):
            face_count = max(face_count, int(len(profile)))
            for item in profile:
                candidates.append((tuple(item), "left_profile"))

        flipped = cv2.flip(variant, 1)
        profile_flipped = profile_cascade.detectMultiScale(flipped, scaleFactor=1.08, minNeighbors=4, minSize=min_size)
        if len(profile_flipped):
            face_count = max(face_count, int(len(profile_flipped)))
            for item in profile_flipped:
                x, y, w, h = [int(value) for value in item]
                corrected = (variant.shape[1] - x - w, y, w, h)
                candidates.append((corrected, "right_profile"))

    if not candidates:
        return None, "frontal", 0

    best_box, best_mode = max(candidates, key=lambda item: _score_box(item[0], source_gray.shape))
    if scale != 1.0:
        best_box = tuple(int(round(value / scale)) for value in best_box)
    return best_box, best_mode, face_count or 1


def _detect_eyes_and_smile(face_gray):
    _, _, eye_cascade, smile_cascade = _get_cascades()
    top_half = face_gray[: max(1, face_gray.shape[0] // 2), :]
    lower_half = face_gray[max(1, face_gray.shape[0] // 2):, :]
    eyes = eye_cascade.detectMultiScale(top_half, scaleFactor=1.08, minNeighbors=5, minSize=(18, 18))
    smile = smile_cascade.detectMultiScale(lower_half, scaleFactor=1.7, minNeighbors=18, minSize=(32, 16))
    return eyes, smile


def _prepare_gray(raw_image: object):
    image = _load_cv_image(raw_image)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    return image, gray


def analyze_face(raw_image: object) -> dict:
    _load_cv_stack()
    if cv2 is None or np is None:
        image = _load_image(raw_image)
        width, height = image.size
        return {
            "has_face": True,
            "face_count": 1,
            "brightness": round(ImageStat.Stat(image.convert("L")).mean[0], 2),
            "yaw_degrees": 0.0,
            "pitch_degrees": 0.0,
            "roll_degrees": 0.0,
            "smile_score": 0.0,
            "bbox": {"x": 0, "y": 0, "width": width, "height": height, "x_ratio": 0.0, "y_ratio": 0.0, "width_ratio": 1.0, "height_ratio": 1.0},
            "landmarks": {},
            "facial_features": {
                "eyes_detected": None,
                "eyebrows_estimated": None,
                "nose_landmark": None,
                "mouth_tracked": None,
                "ears_estimated": None,
                "cheeks_estimated": None,
                "chin_estimated": None,
                "teeth_visible_likely": None,
                "mouth_open_estimate": None,
            },
            "engine": _engine_name(),
        }

    image, gray = _prepare_gray(raw_image)
    dnn_face, mode, face_count = _detect_face_yunet(image)
    if dnn_face is not None:
        x, y, w, h = [int(round(value)) for value in dnn_face[:4]]
    else:
        box, mode, face_count = _detect_face_box(gray)
        if box is None:
            raise FaceVerificationError("No face detected. Look straight at the camera and retry.")
        x, y, w, h = [int(value) for value in box]

    if w <= 0 or h <= 0:
        raise FaceVerificationError("No face detected. Look straight at the camera and retry.")
    face_gray = gray[y:y + h, x:x + w]
    if face_gray.size == 0:
        raise FaceVerificationError("Unable to isolate the face. Adjust framing and retry.")
    landmarks = _build_landmark_payload(dnn_face, (x, y, w, h), gray.shape[1], gray.shape[0]) if dnn_face is not None else {}

    brightness = float(face_gray.mean())
    eyes, smiles = _detect_eyes_and_smile(face_gray)
    eye_balance = 0.0
    if dnn_face is not None and len(dnn_face) >= 14:
        right_eye_x = float(dnn_face[4]) - x
        left_eye_x = float(dnn_face[6]) - x
        eye_balance = (((right_eye_x + left_eye_x) / 2.0) - (w / 2.0)) / max(w, 1.0)
    elif len(eyes) >= 2:
        eyes_sorted = sorted(eyes, key=lambda item: item[0])[:2]
        centers = [item[0] + (item[2] / 2.0) for item in eyes_sorted]
        eye_balance = ((centers[0] + centers[1]) / 2.0 - (w / 2.0)) / max(w, 1.0)

    if mode == "left_profile":
        yaw_degrees = -18.0
    elif mode == "right_profile":
        yaw_degrees = 18.0
    else:
        yaw_degrees = float(max(-18.0, min(18.0, eye_balance * 80.0)))

    smile_score = 0.0
    if dnn_face is not None and len(dnn_face) >= 14:
        mouth_right = (float(dnn_face[10]) - x, float(dnn_face[11]) - y)
        mouth_left = (float(dnn_face[12]) - x, float(dnn_face[13]) - y)
        mouth_width = abs(mouth_left[0] - mouth_right[0]) / max(w, 1.0)
        mouth_height = ((mouth_left[1] + mouth_right[1]) / 2.0) / max(h, 1.0)
        smile_score = round(max(0.0, (mouth_width * 1.8) - 0.42 + ((mouth_height - 0.68) * 0.2)), 4)
    if len(smiles):
        largest_smile = _largest_box(smiles)
        if largest_smile is not None:
            smile_score = round((largest_smile[2] / max(w, 1.0)) * 3.0, 4)

    mouth_width_ratio = 0.0
    if dnn_face is not None and len(dnn_face) >= 14:
        mouth_right = (float(dnn_face[10]) - x, float(dnn_face[11]) - y)
        mouth_left = (float(dnn_face[12]) - x, float(dnn_face[13]) - y)
        mouth_width_ratio = abs(mouth_left[0] - mouth_right[0]) / max(w, 1.0)
    mouth_open_estimate = round(min(1.0, max(0.0, smile_score * 0.85 + mouth_width_ratio * 0.35)), 4)
    teeth_visible_likely = bool(
        mouth_width_ratio > 0.38 and smile_score > 0.18
    ) or bool(len(smiles) >= 1 and smile_score > 0.32)

    facial_features = {
        "eyes_detected": len(eyes) >= 2,
        "eyebrows_estimated": bool(landmarks.get("right_brow") and landmarks.get("left_brow")),
        "nose_landmark": bool(landmarks.get("nose")),
        "mouth_tracked": bool(landmarks.get("mouth_right") and landmarks.get("mouth_left")),
        "ears_estimated": bool(landmarks.get("right_ear") and landmarks.get("left_ear")),
        "cheeks_estimated": bool(landmarks.get("right_cheek") and landmarks.get("left_cheek")),
        "chin_estimated": bool(landmarks.get("chin")),
        "teeth_visible_likely": teeth_visible_likely,
        "mouth_open_estimate": mouth_open_estimate,
        "smile_score": smile_score,
        "eye_count_haar": int(len(eyes)),
        "smile_regions_haar": int(len(smiles)),
    }

    return {
        "has_face": True,
        "face_count": face_count or 1,
        "brightness": round(brightness, 2),
        "yaw_degrees": round(yaw_degrees, 2),
        "pitch_degrees": 0.0,
        "roll_degrees": 0.0,
        "smile_score": smile_score,
        "bbox": {
            "x": x,
            "y": y,
            "width": w,
            "height": h,
            "x_ratio": round(x / gray.shape[1], 6),
            "y_ratio": round(y / gray.shape[0], 6),
            "width_ratio": round(w / gray.shape[1], 6),
            "height_ratio": round(h / gray.shape[0], 6),
        },
        "landmarks": landmarks,
        "facial_features": facial_features,
        "engine": _engine_name(),
    }


def _crop_face_region(raw_image: object):
    image, gray = _prepare_gray(raw_image)
    box, _, _ = _detect_face_box(gray)
    if box is None:
        raise FaceVerificationError("No face detected. Look straight at the camera and retry.")
    x, y, w, h = [int(value) for value in box]
    pad_x = int(w * 0.18)
    pad_y = int(h * 0.22)
    left = max(0, x - pad_x)
    top = max(0, y - pad_y)
    right = min(image.shape[1], x + w + pad_x)
    bottom = min(image.shape[0], y + h + pad_y)
    crop = image[top:bottom, left:right]
    if crop.size == 0:
        raise FaceVerificationError("Unable to isolate the face. Adjust framing and retry.")
    return crop


def _crop_face_region_safe(raw_image: object):
    """Like _crop_face_region but never raises — falls back to center-square crop.
    Ensures profile photos with unusual framing still produce a valid embedding."""
    try:
        return _crop_face_region(raw_image)
    except FaceVerificationError:
        image = _load_cv_image(raw_image)
        h, w = image.shape[:2]
        size = min(w, h)
        left = (w - size) // 2
        top = (h - size) // 2
        crop = image[top:top + size, left:left + size]
        if crop.size == 0:
            return image
        return crop


def _encode_cv_image(image, quality: int = 95) -> bytes:
    success, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), int(quality)])
    if not success:
        raise FaceVerificationError("Unable to prepare a facial verification variant.")
    return encoded.tobytes()


def _compute_lbp_histogram(gray, bins: int = 8):
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return [0.0] * bins
    center = gray[1:-1, 1:-1]
    lbp = np.zeros_like(center, dtype=np.uint8)
    neighbors = [
        (gray[:-2, :-2], 7),
        (gray[:-2, 1:-1], 6),
        (gray[:-2, 2:], 5),
        (gray[1:-1, 2:], 4),
        (gray[2:, 2:], 3),
        (gray[2:, 1:-1], 2),
        (gray[2:, :-2], 1),
        (gray[1:-1, :-2], 0),
    ]
    for neighbor, bit in neighbors:
        lbp |= ((neighbor >= center).astype(np.uint8) << bit)
    histogram, _ = np.histogram(lbp.flatten(), bins=bins, range=(0, 256))
    total = float(histogram.sum()) or 1.0
    return [float(value) / total for value in histogram.tolist()]


def _region_means(gray, rows: int, cols: int):
    resized = cv2.resize(gray, (cols, rows), interpolation=cv2.INTER_AREA)
    return [float(value) / 255.0 for value in resized.flatten().tolist()]


def _gradient_features(gray):
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(grad_x, grad_y)
    if float(magnitude.max()) > 1e-6:
        magnitude = magnitude / float(magnitude.max())
    resized = cv2.resize(magnitude, (4, 4), interpolation=cv2.INTER_AREA)
    return [float(value) for value in resized.flatten().tolist()]


def _quadrant_structure(gray):
    height, width = gray.shape[:2]
    mid_x = max(1, width // 2)
    mid_y = max(1, height // 2)
    quadrants = [
        gray[:mid_y, :mid_x],
        gray[:mid_y, mid_x:],
        gray[mid_y:, :mid_x],
        gray[mid_y:, mid_x:],
    ]
    means = [float(region.mean()) / 255.0 if region.size else 0.0 for region in quadrants]
    top = (means[0] + means[1]) / 2.0
    bottom = (means[2] + means[3]) / 2.0
    left = (means[0] + means[2]) / 2.0
    right = (means[1] + means[3]) / 2.0
    center_strip = gray[:, width // 3 : max((2 * width) // 3, (width // 3) + 1)]
    center_brightness = float(center_strip.mean()) / 255.0 if center_strip.size else 0.0
    return means + [
        abs(left - right),
        abs(top - bottom),
        center_brightness,
        float(gray.std()) / 128.0,
    ]


def _color_features(face_bgr):
    hsv = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2HSV)
    ycrcb = cv2.cvtColor(face_bgr, cv2.COLOR_BGR2YCrCb)
    channels = [
        hsv[:, :, 0],
        hsv[:, :, 1],
        hsv[:, :, 2],
        ycrcb[:, :, 1],
        ycrcb[:, :, 2],
    ]
    means = [float(channel.mean()) for channel in channels]
    stds = [float(channel.std()) for channel in channels[:3]]
    return [
        means[0] / 180.0,
        means[1] / 255.0,
        means[2] / 255.0,
        stds[0] / 90.0,
        stds[1] / 128.0,
        stds[2] / 128.0,
        means[3] / 255.0,
        means[4] / 255.0,
    ]


def _geometry_features(face_gray):
    eyes, smiles = _detect_eyes_and_smile(face_gray)
    height, width = face_gray.shape[:2]
    eye_count = min(len(eyes), 2)
    eye_spacing = 0.0
    eye_level_delta = 0.0
    eye_width_ratio = 0.0
    eye_y_ratio = 0.0
    if eye_count >= 2:
        eyes_sorted = sorted(eyes, key=lambda item: item[0])[:2]
        left_eye, right_eye = eyes_sorted
        left_center = (left_eye[0] + (left_eye[2] / 2.0), left_eye[1] + (left_eye[3] / 2.0))
        right_center = (right_eye[0] + (right_eye[2] / 2.0), right_eye[1] + (right_eye[3] / 2.0))
        eye_spacing = abs(right_center[0] - left_center[0]) / max(width, 1.0)
        eye_level_delta = abs(right_center[1] - left_center[1]) / max(height, 1.0)
        eye_width_ratio = ((left_eye[2] + right_eye[2]) / 2.0) / max(width, 1.0)
        eye_y_ratio = ((left_center[1] + right_center[1]) / 2.0) / max(height, 1.0)
    elif eye_count == 1:
        eye = eyes[0]
        eye_width_ratio = eye[2] / max(width, 1.0)
        eye_y_ratio = (eye[1] + (eye[3] / 2.0)) / max(height, 1.0)

    smile_width = 0.0
    smile_y_ratio = 0.72
    smile_height = 0.0
    if len(smiles):
        smile = _largest_box(smiles)
        if smile is not None:
            smile_width = smile[2] / max(width, 1.0)
            smile_height = smile[3] / max(height, 1.0)
            smile_y_ratio = (0.5 + ((smile[1] + (smile[3] / 2.0)) / max(height, 1.0))) / 1.5

    return [
        float(height) / max(width, 1.0),
        eye_count / 2.0,
        eye_spacing,
        eye_level_delta,
        eye_width_ratio,
        eye_y_ratio,
        smile_width,
        smile_height + smile_y_ratio,
    ]


def extract_embedding_set(raw_image: object, limit: int = 4) -> List[List[float]]:
    embeddings = []
    variants = [raw_image]
    _load_cv_stack()
    if cv2 is not None and np is not None:
        base = _load_cv_image(raw_image)
        variants.extend(
            [
                _encode_cv_image(cv2.convertScaleAbs(base, alpha=1.08, beta=10)),
                _encode_cv_image(cv2.convertScaleAbs(base, alpha=0.96, beta=-8)),
                _encode_cv_image(cv2.GaussianBlur(base, (0, 0), 0.6)),
            ]
        )
    else:
        image = _load_image(raw_image)
        variants.extend(
            [
                _image_to_bytes(ImageEnhance.Brightness(image).enhance(1.08)),
                _image_to_bytes(ImageEnhance.Contrast(image).enhance(1.06)),
                _image_to_bytes(image.filter(ImageFilter.GaussianBlur(radius=0.45))),
            ]
        )

    seen = set()
    for variant in variants:
        try:
            embedding = extract_embedding(variant)
        except FaceVerificationError:
            continue
        serialized = tuple(round(float(value), 6) for value in embedding)
        if serialized in seen:
            continue
        seen.add(serialized)
        embeddings.append(embedding)
        if len(embeddings) >= max(1, int(limit)):
            break
    if not embeddings:
        raise FaceVerificationError("Unable to build a valid facial reference signature.")
    return embeddings


def extract_embedding(raw_image: object) -> List[float]:
    _load_cv_stack()
    if cv2 is None or np is None:
        image = _load_image(raw_image)
        side = min(image.size)
        left = int((image.size[0] - side) / 2)
        top = int((image.size[1] - side) / 2)
        crop = image.crop((left, top, left + side, top + side)).convert("L")
        brightness = ImageStat.Stat(crop).mean[0]
        if brightness < 78:
            crop = ImageEnhance.Brightness(crop).enhance(min(1.45, 95 / max(brightness, 1)))
        crop = ImageOps.equalize(crop)
        crop = ImageOps.autocontrast(crop, cutoff=2)
        crop = crop.filter(ImageFilter.UnsharpMask(radius=1.1, percent=115, threshold=2))
        crop = crop.filter(ImageFilter.GaussianBlur(radius=0.5))
        crop = crop.resize((8, 8), Image.Resampling.LANCZOS)
        return _normalize_embedding([pixel / 255.0 for pixel in crop.getdata()])

    detector, recognizer = _get_dnn_models()
    if detector is not None and recognizer is not None:
        image = _load_cv_image(raw_image)
        face, _, _ = _detect_face_yunet(image)
        if face is not None:
            aligned = recognizer.alignCrop(image, face)
            feature = recognizer.feature(aligned)
            if feature is not None:
                vector = feature.flatten().astype("float32").tolist()
                if len(vector) >= 112:
                    pooled = []
                    step = max(1, len(vector) // 56)
                    for index in range(0, min(len(vector), step * 56), step):
                        bucket = vector[index:index + step]
                        pooled.append(sum(bucket) / float(len(bucket)))
                    geometry = _geometry_vector_from_face(face, face[:4])
                    if len(pooled) >= 56:
                        return _normalize_embedding((pooled[:56] + geometry)[:64])

    crop = _crop_face_region_safe(raw_image)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    brightness = float(gray.mean())
    if brightness < 78:
        factor = min(1.52, 102 / max(brightness, 1))
        gray = cv2.convertScaleAbs(gray, alpha=factor, beta=3)

    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    gray = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(6, 6)).apply(gray)

    tone_features = _region_means(gray, 4, 4)
    gradient_features = _gradient_features(gray)
    lbp_features = _compute_lbp_histogram(gray, bins=8)
    color_features = _color_features(crop)
    geometry_features = _geometry_features(gray)
    structure_features = _quadrant_structure(gray)

    features = (
        tone_features
        + gradient_features
        + lbp_features
        + color_features
        + geometry_features
        + structure_features
    )
    if len(features) != EMBEDDING_DIMENSION:
        raise FaceVerificationError("Unexpected facial signature dimension.")
    return _normalize_embedding(features)


def hash_image(raw_image: object) -> str:
    return hashlib.sha256(_coerce_bytes(raw_image)).hexdigest()


def serialize_embedding(embedding: Iterable[float]) -> str:
    payload = [round(float(value), 8) for value in embedding]
    if len(payload) != EMBEDDING_DIMENSION:
        raise FaceVerificationError("Unexpected facial signature dimension.")
    return json.dumps(payload, separators=(",", ":"))


def deserialize_embedding(raw_embedding: object) -> List[float]:
    if raw_embedding is None:
        raise FaceVerificationError("Stored facial signature is missing.")
    try:
        payload = json.loads(raw_embedding) if isinstance(raw_embedding, str) else list(raw_embedding)
    except Exception as exc:
        raise FaceVerificationError("Stored facial signature is invalid.") from exc
    if not isinstance(payload, list) or len(payload) != EMBEDDING_DIMENSION:
        raise FaceVerificationError("Stored facial signature is incomplete.")
    return [float(value) for value in payload]


def serialize_embedding_set(embeddings: Sequence[Sequence[float]]) -> str:
    items = [json.loads(serialize_embedding(item)) for item in list(embeddings)[:ANGLE_SAMPLE_LIMIT]]
    return json.dumps(items, separators=(",", ":"))


def deserialize_embedding_set(raw_payload: object) -> List[List[float]]:
    if not raw_payload:
        return []
    try:
        payload = json.loads(raw_payload) if isinstance(raw_payload, str) else list(raw_payload)
    except Exception as exc:
        raise FaceVerificationError("Stored angle signatures are invalid.") from exc
    result = []
    for item in payload[:ANGLE_SAMPLE_LIMIT]:
        if isinstance(item, list) and len(item) == EMBEDDING_DIMENSION:
            result.append([float(value) for value in item])
    return result


def compare_embeddings(reference: Sequence[float], candidate: Sequence[float], threshold: float = DEFAULT_THRESHOLD) -> VerificationResult:
    if len(reference) != len(candidate):
        raise FaceVerificationError("Facial signatures are incompatible.")
    dot_product = sum(float(a) * float(b) for a, b in zip(reference, candidate))
    score = round((dot_product + 1) / 2, 4)
    return VerificationResult(score=score, threshold=float(threshold), verified=score >= float(threshold), engine=_engine_name())


def verify_live_capture(reference_embedding: Sequence[float], live_capture: object, threshold: float = DEFAULT_THRESHOLD) -> VerificationResult:
    return compare_embeddings(reference_embedding, extract_embedding(live_capture), threshold=threshold)


def verify_live_capture_against_set(reference_embeddings: Sequence[Sequence[float]], live_capture: object, threshold: float = DEFAULT_THRESHOLD) -> VerificationResult:
    if not reference_embeddings:
        raise FaceVerificationError("No face signatures available for verification.")
    candidate = extract_embedding(live_capture)
    best = None
    for reference in reference_embeddings:
        result = compare_embeddings(reference, candidate, threshold=threshold)
        if best is None or result.score > best.score:
            best = result
    return best
