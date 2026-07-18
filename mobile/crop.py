from PIL import Image
import numpy as np

img = Image.open('assets/images/logo_definitivo.png').convert("RGBA")
data = np.array(img)

bg_color = data[0, 0, :3]
diff = np.abs(data[:, :, :3].astype(int) - bg_color.astype(int))
mask = np.any(diff > 30, axis=-1)

coords = np.argwhere(mask)
if len(coords) > 0:
    y0, x0 = coords.min(axis=0)
    y1, x1 = coords.max(axis=0)
    pad = int(min(x1-x0, y1-y0) * 0.01)
    y0 = max(0, y0 - pad)
    x0 = max(0, x0 - pad)
    y1 = min(data.shape[0], y1 + pad)
    x1 = min(data.shape[1], x1 + pad)
    
    cropped = img.crop((x0, y0, x1, y1))
    cropped = cropped.resize((512, 512), Image.Resampling.LANCZOS)
    cropped.save('assets/images/logo.png')
    print(f"Cropped from {img.size} to {cropped.size}")
else:
    print("Could not find bounding box")
