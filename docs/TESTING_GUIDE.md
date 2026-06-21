# Testing Guide — ManoSpeak

## 1. Machine Learning Testing (`ml/`)
ML tests focus on landmark coordinate extraction, normalization logic, and model shape contracts. We use `pytest` as our testing framework.

### Mocking Landmark Coordinates
To test normalizers and coordinate transformers, we mock joint coordinates rather than loading full media files.
Example mock coordinate test in `ml/tests/test_normalizer.py`:
```python
import numpy as np
import pytest
from src.normalizers import PoseNormalizer

def test_translation_invariance():
    # Construct a dummy skeleton with shoulders and hands
    # Shoulder Left: [0.5, 0.5, 0.0], Shoulder Right: [-0.5, 0.5, 0.0]
    # Hand Left: [0.2, 0.2, 0.0]
    pose_landmarks = np.array([
        [0.5, 0.5, 0.0],   # Shoulder L (Idx 11)
        [-0.5, 0.5, 0.0],  # Shoulder R (Idx 12)
        [0.2, 0.2, 0.0]    # Hand L (Idx 15)
    ])
    
    normalizer = PoseNormalizer()
    normalized = normalizer.normalize(pose_landmarks)
    
    # torax center should be at [0.0, 0.5, 0.0] after translation centering
    assert np.allclose(normalized[0] + normalized[1], 0.0)
```

### Run ML Tests
```bash
cd ml
poetry run pytest
```

## 2. Mobile Testing (`mobile/`)
Mobile tests assert component layouts, translation state triggers, and the text-to-speech bridge. We use Jest and `@testing-library/react-native`.

### Testing Sliding Window Buffer
Example unit test for the coordinate frame buffer in `mobile/src/services/__tests__/FrameBuffer.test.ts`:
```typescript
import { FrameBuffer } from '../FrameBuffer';

describe('FrameBuffer Sliding Window', () => {
  it('should maintain a fixed size window and discard old frames', () => {
    const buffer = new FrameBuffer(30); // 30 frames window size
    
    // Fill buffer with 35 dummy coordinate vectors
    for (let i = 0; i < 35; i++) {
      buffer.push(new Float32Array(543 * 3).fill(i));
    }
    
    expect(buffer.length).toBe(30);
    expect(buffer.get(0)[0]).toBe(5); // Oldest frame in buffer should be index 5
  });
});
```

### Run Mobile Tests
```bash
cd mobile
npm test
```
