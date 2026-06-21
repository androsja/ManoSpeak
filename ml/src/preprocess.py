import os
import argparse
import glob
import re
import numpy as np
import cv2
import mediapipe as mp  # type: ignore[import-untyped]

mp_holistic = mp.solutions.holistic

def extract_landmarks_from_frame(frame, holistic):
    """
    Extracts 543 holistic landmarks (33 pose, 21 left hand, 21 right hand, 468 face)
    from a single BGR image frame. Missing landmarks are padded with zeros.
    """
    # Convert BGR to RGB
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    results = holistic.process(rgb_frame)
    
    # 1. Pose landmarks (33 points)
    pose_pts = np.zeros((33, 3))
    if results.pose_landmarks:
        for idx, lm in enumerate(results.pose_landmarks.landmark):
            pose_pts[idx] = [lm.x, lm.y, lm.z]
            
    # 2. Left Hand landmarks (21 points)
    lh_pts = np.zeros((21, 3))
    if results.left_hand_landmarks:
        for idx, lm in enumerate(results.left_hand_landmarks.landmark):
            lh_pts[idx] = [lm.x, lm.y, lm.z]
            
    # 3. Right Hand landmarks (21 points)
    rh_pts = np.zeros((21, 3))
    if results.right_hand_landmarks:
        for idx, lm in enumerate(results.right_hand_landmarks.landmark):
            rh_pts[idx] = [lm.x, lm.y, lm.z]
            
    # 4. Face landmarks (468 points)
    face_pts = np.zeros((468, 3))
    if results.face_landmarks:
        # MediaPipe Face Mesh might output 478 points in newer versions,
        # but we strictly require the first 468 points.
        for idx, lm in enumerate(results.face_landmarks.landmark):
            if idx >= 468:
                break
            face_pts[idx] = [lm.x, lm.y, lm.z]
            
    # Concatenate all landmarks to shape (543, 3)
    # 33 (pose) + 21 (lh) + 21 (rh) + 468 (face) = 543
    landmarks = np.concatenate([pose_pts, lh_pts, rh_pts, face_pts], axis=0)
    return landmarks

def process_video(video_path, holistic):
    """
    Processes a video file frame-by-frame and extracts landmarks.
    """
    cap = cv2.VideoCapture(video_path)
    frame_landmarks = []
    
    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        lms = extract_landmarks_from_frame(frame, holistic)
        frame_landmarks.append(lms)
        
    cap.release()
    
    if not frame_landmarks:
        return None
        
    return np.array(frame_landmarks)  # Shape: (frames, 543, 3)

def natural_sort_key(s):
    """
    Sorts strings with numeric values in natural order (e.g. A_2.jpg before A_10.jpg).
    """
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

def process_image_sequence(dir_path, holistic):
    """
    Processes a directory containing an ordered sequence of images.
    """
    # Find all JPG and PNG files
    image_extensions = ('*.jpg', '*.jpeg', '*.png', '*.JPG', '*.JPEG', '*.PNG')
    image_paths = []
    for ext in image_extensions:
        image_paths.extend(glob.glob(os.path.join(dir_path, ext)))
        
    if not image_paths:
        return None
        
    # Sort files in natural order (e.g., frame_0, frame_1, ...)
    image_paths.sort(key=natural_sort_key)
    
    frame_landmarks = []
    for img_path in image_paths:
        frame = cv2.imread(img_path)
        if frame is None:
            continue
        lms = extract_landmarks_from_frame(frame, holistic)
        frame_landmarks.append(lms)
        
    if not frame_landmarks:
        return None
        
    return np.array(frame_landmarks)  # Shape: (frames, 543, 3)

def main():
    parser = argparse.ArgumentParser(description="Extract MediaPipe Holistic landmarks from LSC datasets.")
    parser.add_argument("--input_dir", type=str, required=True,
                        help="Path to raw videos directory or LSC70 dataset root.")
    parser.add_argument("--output_dir", type=str, default="data/landmarks",
                        help="Path to save the extracted NumPy landmarks.")
    args = parser.parse_args()
    
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Initialize MediaPipe Holistic
    with mp_holistic.Holistic(static_image_mode=False, model_complexity=1, 
                               smooth_landmarks=True, refine_face_landmarks=False) as holistic:
                               
        # Case 1: If input_dir contains subfolders like LSC70 (LSC70AN, LSC70W)
        # We look for leaf directories containing images
        print(f"Scanning input directory: {args.input_dir}")
        
        # Check if there are video files directly in the input directory
        video_extensions = ('*.mp4', '*.avi', '*.mov', '*.mkv')
        video_paths = []
        for ext in video_extensions:
            video_paths.extend(glob.glob(os.path.join(args.input_dir, "**", ext), recursive=True))
            video_paths.extend(glob.glob(os.path.join(args.input_dir, ext)))
            
        # Deduplicate
        video_paths = list(set(video_paths))
        
        if video_paths:
            print(f"Found {len(video_paths)} video file(s) to process.")
            for video_path in video_paths:
                # Resolve relative output name
                rel_path = os.path.relpath(video_path, args.input_dir)
                base_name = os.path.splitext(rel_path)[0].replace(os.sep, "_")
                out_path = os.path.join(args.output_dir, f"{base_name}.npy")
                
                print(f"Processing video: {video_path} -> {out_path}")
                landmarks = process_video(video_path, holistic)
                if landmarks is not None:
                    np.save(out_path, landmarks)
                    print(f"Saved {landmarks.shape} landmarks array.")
                else:
                    print(f"Warning: Failed to extract landmarks from {video_path}")
                    
        # Case 2: Process image sequences (like LSC70)
        # We walk the directories to find any directory containing image files
        image_dirs = []
        for root, dirs, files in os.walk(args.input_dir):
            # Check if any image files are present in the current root directory
            if any(f.lower().endswith(('.png', '.jpg', '.jpeg')) for f in files):
                image_dirs.append(root)
                
        if image_dirs:
            print(f"Found {len(image_dirs)} image sequence folder(s) to process.")
            for img_dir in image_dirs:
                # Resolve relative output name to preserve directory hierarchy context
                rel_path = os.path.relpath(img_dir, args.input_dir)
                if rel_path == ".":
                    continue
                # Replace slashes with underscores for flat output filenames
                base_name = rel_path.replace(os.sep, "_")
                out_path = os.path.join(args.output_dir, f"{base_name}.npy")
                
                print(f"Processing image sequence in: {img_dir} -> {out_path}")
                landmarks = process_image_sequence(img_dir, holistic)
                if landmarks is not None:
                    np.save(out_path, landmarks)
                    print(f"Saved {landmarks.shape} landmarks array.")
                else:
                    print(f"No landmarks extracted from {img_dir}")

if __name__ == "__main__":
    main()
