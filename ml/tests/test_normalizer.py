import numpy as np
from src.normalizers import (
    normalize_landmarks,
    apply_gaussian_jitter,
    apply_time_warping,
    apply_micro_scaling
)

def create_mock_landmarks(num_frames=10, has_shoulders=True):
    """
    Creates a mock landmarks array of shape (num_frames, 543, 3).
    Ensures shoulders (indices 11 and 12) are present if has_shoulders is True.
    Some landmarks are left as zero to simulate undetected joints (padding).
    """
    landmarks = np.random.uniform(-0.5, 0.5, size=(num_frames, 543, 3))
    
    if has_shoulders:
        # Set stable shoulders coordinates
        # Left shoulder at [0.2, 0.4, 0.1], Right shoulder at [-0.2, 0.4, 0.1]
        for f in range(num_frames):
            landmarks[f, 11] = [0.2, 0.4, 0.1]
            landmarks[f, 12] = [-0.2, 0.4, 0.1]
            
    # Simulate some un-detected landmarks by setting them to exactly 0
    # Let's say indices 100 to 110 are missing
    for f in range(num_frames):
        landmarks[f, 100:110] = 0.0
        
    return landmarks

def test_clipping_bounds():
    """
    Verify that normalize_landmarks clips all coordinates strictly inside [-1.0, 1.0].
    """
    # Create landmarks with extreme values
    landmarks = create_mock_landmarks()
    landmarks *= 10.0 # Make values very large
    
    norm_lms = normalize_landmarks(landmarks)
    assert np.all(norm_lms >= -1.0)
    assert np.all(norm_lms <= 1.0)

def test_translation_invariance():
    """
    Verifies that shifting the input coordinates by a fixed offset
    produces identical normalized coordinates (translation invariance).
    """
    original = create_mock_landmarks(num_frames=5)
    
    # Apply a translation shift of [0.5, -0.3, 0.2]
    shift = np.array([0.5, -0.3, 0.2])
    shifted = np.copy(original)
    
    # Add shift ONLY to non-zero elements to mimic real shifting of detected points
    for f in range(original.shape[0]):
        non_zero_mask = ~np.all(original[f] == 0.0, axis=1)
        shifted[f, non_zero_mask] += shift
        
    norm_orig = normalize_landmarks(original)
    norm_shift = normalize_landmarks(shifted)
    
    # Assert normalized values are identical within float tolerance
    np.testing.assert_allclose(norm_orig, norm_shift, atol=1e-5)

def test_scale_invariance():
    """
    Verifies that multiplying coordinates by a scale factor
    produces identical normalized coordinates (scale invariance).
    """
    original = create_mock_landmarks(num_frames=5)
    
    # Apply a scale factor of 1.5
    scale = 1.5
    scaled = np.copy(original)
    
    for f in range(original.shape[0]):
        non_zero_mask = ~np.all(original[f] == 0.0, axis=1)
        scaled[f, non_zero_mask] *= scale
        
    norm_orig = normalize_landmarks(original)
    norm_scaled = normalize_landmarks(scaled)
    
    np.testing.assert_allclose(norm_orig, norm_scaled, atol=1e-5)

def test_gaussian_jitter():
    """
    Checks that apply_gaussian_jitter:
    1. Alters non-zero coordinates.
    2. Strictly preserves zero-padded landmarks as [0, 0, 0].
    """
    original = create_mock_landmarks(num_frames=3)
    jittered = apply_gaussian_jitter(original, sigma=0.02)
    
    # Check that zero-padded landmarks remain exactly 0.0
    for f in range(original.shape[0]):
        zero_mask = np.all(original[f] == 0.0, axis=1)
        np.testing.assert_allclose(jittered[f, zero_mask], 0.0)
        
        # Check that non-zero landmarks have indeed changed
        non_zero_mask = ~zero_mask
        assert not np.allclose(original[f, non_zero_mask], jittered[f, non_zero_mask])

def test_time_warping():
    """
    Verifies that time warping correctly interpolates sequence length.
    """
    original = create_mock_landmarks(num_frames=10)
    
    # Warp slower (1.2x) -> 12 frames
    warped_slow = apply_time_warping(original, warp_factor=1.2)
    assert warped_slow.shape == (12, 543, 3)
    
    # Warp faster (0.8x) -> 8 frames
    warped_fast = apply_time_warping(original, warp_factor=0.8)
    assert warped_fast.shape == (8, 543, 3)
    
    # Check that coordinate boundaries are preserved
    assert np.all(warped_slow >= -1.0) and np.all(warped_slow <= 1.0)

def test_micro_scaling():
    """
    Checks that micro-scaling applies scaling factors to X, Y, Z coordinates.
    """
    original = create_mock_landmarks(num_frames=3)
    scaled = apply_micro_scaling(original, scale_range=(0.9, 1.1))
    
    # Verify zero-padded landmarks are preserved
    for f in range(original.shape[0]):
        zero_mask = np.all(original[f] == 0.0, axis=1)
        np.testing.assert_allclose(scaled[f, zero_mask], 0.0)
        
        # Verify non-zero values changed and fit standard bounds
        non_zero_mask = ~zero_mask
        assert not np.allclose(original[f, non_zero_mask], scaled[f, non_zero_mask])
        assert np.all(scaled[f, non_zero_mask] >= -1.0)
        assert np.all(scaled[f, non_zero_mask] <= 1.0)
