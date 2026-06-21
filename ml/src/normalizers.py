import numpy as np

def normalize_landmarks(landmarks):
    """
    Applies translational and scale normalization to landmarks.
    Input landmarks shape can be (543, 3) or (num_frames, 543, 3).
    
    Centering Reference (x_ref): Midpoint between left shoulder (pose 11) and right shoulder (pose 12).
    Scale Factor (D_scale): Euclidean distance between left shoulder (pose 11) and right shoulder (pose 12).
    """
    is_batched = len(landmarks.shape) == 3
    if not is_batched:
        # Add batch dimension to process uniformly
        landmarks = np.expand_dims(landmarks, axis=0)
        
    num_frames, num_landmarks, coords = landmarks.shape
    normalized = np.zeros_like(landmarks)
    
    for f in range(num_frames):
        frame = landmarks[f]
        
        # In MediaPipe, first 33 landmarks are Pose landmarks.
        # Left shoulder is index 11, Right shoulder is index 12.
        left_shoulder = frame[11]
        right_shoulder = frame[12]
        
        # Check if shoulders are detected (i.e. not padded zeros)
        has_left = not np.allclose(left_shoulder, 0.0)
        has_right = not np.allclose(right_shoulder, 0.0)
        
        if has_left and has_right:
            # Translation Reference Anchor: Torso midpoint
            ref_anchor = (left_shoulder + right_shoulder) / 2.0
            # Scale Factor: Clavicular distance
            scale_factor = np.linalg.norm(left_shoulder - right_shoulder)
        else:
            # Fallback to centroid of all non-zero points if shoulders are missing
            non_zero_lms = frame[~np.all(frame == 0.0, axis=1)]
            if len(non_zero_lms) > 0:
                ref_anchor = np.mean(non_zero_lms, axis=0)
                # Fallback scale based on bounding box
                min_pts = np.min(non_zero_lms, axis=0)
                max_pts = np.max(non_zero_lms, axis=0)
                scale_factor = np.linalg.norm(max_pts - min_pts)
            else:
                ref_anchor = np.zeros(3)
                scale_factor = 1.0
                
        # Handle division by zero
        if scale_factor < 1e-5:
            scale_factor = 1.0
            
        # Apply normalization to non-zero (detected) landmarks
        non_zero_mask = ~np.all(frame == 0.0, axis=1)
        
        # Centering relative to anchor and scale division
        frame_norm = np.zeros_like(frame)
        frame_norm[non_zero_mask] = (frame[non_zero_mask] - ref_anchor) / scale_factor
        
        # Clip to ensure points fit strictly within [-1.0, 1.0] range
        frame_norm[non_zero_mask] = np.clip(frame_norm[non_zero_mask], -1.0, 1.0)
        
        normalized[f] = frame_norm
        
    if not is_batched:
        return normalized[0]
        
    return normalized

def apply_gaussian_jitter(landmarks, sigma=0.02):
    """
    Adds Gaussian noise (jitter) to all non-zero coordinates.
    Input shape: (num_frames, 543, 3).
    """
    augmented = np.copy(landmarks)
    non_zero_mask = ~np.all(augmented == 0.0, axis=2)
    
    # Generate Gaussian noise
    noise = np.random.normal(0, sigma, size=augmented.shape)
    
    # Add noise only to non-zero (detected) landmarks to preserve zero padding
    augmented[non_zero_mask] += noise[non_zero_mask]
    
    # Re-clip values just in case
    augmented[non_zero_mask] = np.clip(augmented[non_zero_mask], -1.0, 1.0)
    return augmented

def apply_time_warping(landmarks, warp_factor=1.0):
    """
    Changes gesture duration dynamically (speeding up or slowing down frames)
    by linear interpolation. warp_factor of 1.15 is 15% slower, 0.85 is 15% faster.
    Input shape: (num_frames, 543, 3).
    """
    num_frames, num_landmarks, coords = landmarks.shape
    new_length = int(num_frames * warp_factor)
    if new_length < 2:
        new_length = 2 # Minimum length constraint
        
    if new_length == num_frames:
        return landmarks
        
    # Generate old and new temporal indices
    old_indices = np.arange(num_frames)
    new_indices = np.linspace(0, num_frames - 1, new_length)
    
    warped = np.zeros((new_length, num_landmarks, coords))
    
    # Perform 1D linear interpolation for each landmark coordinate index
    for lm_idx in range(num_landmarks):
        for c in range(coords):
            warped[:, lm_idx, c] = np.interp(new_indices, old_indices, landmarks[:, lm_idx, c])
            
    return warped

def apply_micro_scaling(landmarks, scale_range=(0.85, 1.15)):
    """
    Applies independent scaling shifts along X, Y, and Z axes.
    Input shape: (num_frames, 543, 3).
    """
    augmented = np.copy(landmarks)
    non_zero_mask = ~np.all(augmented == 0.0, axis=2)
    
    # Generate random scale factor for each axis
    scale_x = np.random.uniform(*scale_range)
    scale_y = np.random.uniform(*scale_range)
    scale_z = np.random.uniform(*scale_range)
    
    scale_factors = np.array([scale_x, scale_y, scale_z])
    
    # Multiply coordinates by scale factors
    augmented[non_zero_mask] *= scale_factors
    
    # Re-clip values to [-1.0, 1.0]
    augmented[non_zero_mask] = np.clip(augmented[non_zero_mask], -1.0, 1.0)
    return augmented
