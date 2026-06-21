import os
import argparse
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from model import PhonSSM
from normalizers import normalize_landmarks, apply_gaussian_jitter, apply_time_warping, apply_micro_scaling

class LSCDataset(Dataset):
    """
    Dataset to load LSC coordinate array datasets from data/landmarks/.
    """
    def __init__(self, landmarks_dir, augment=False):
        self.landmarks_dir = landmarks_dir
        self.augment = augment
        
        # List all .npy files
        self.file_paths = [os.path.join(landmarks_dir, f) for f in os.listdir(landmarks_dir) if f.endswith('.npy')]
        
        # Categorical maps (mock mapping for LSC70 letters to orthogonal classes)
        # In real-world INSOR, we map each sign word to its unique handshape/location/movement
        self.vocab = sorted(list(set([os.path.splitext(os.path.basename(f))[0].split('_')[-1] for f in self.file_paths])))
        self.vocab_map = {word: idx for idx, word in enumerate(self.vocab)}
        
    def __len__(self):
        return len(self.file_paths)
        
    def __getitem__(self, idx):
        file_path = self.file_paths[idx]
        landmarks = np.load(file_path)
        
        # Resolve target labels from filename
        file_name = os.path.splitext(os.path.basename(file_path))[0]
        word = file_name.split('_')[-1]
        
        # Assign targets
        word_idx = self.vocab_map.get(word, 0)
        handshape_target = word_idx % 64
        location_target = word_idx % 32
        movement_target = word_idx % 32
        
        # Step 1: Normalize coordinates
        landmarks = normalize_landmarks(landmarks)
        
        # Step 2: Apply Augmentations (Sim2Real) on the fly if training
        if self.augment:
            if np.random.rand() < 0.5:
                landmarks = apply_gaussian_jitter(landmarks, sigma=0.02)
            if np.random.rand() < 0.5:
                warp_factor = np.random.uniform(0.85, 1.15)
                landmarks = apply_time_warping(landmarks, warp_factor=warp_factor)
            if np.random.rand() < 0.5:
                landmarks = apply_micro_scaling(landmarks)
                
        return {
            'landmarks': torch.tensor(landmarks, dtype=torch.float32),
            'handshape': torch.tensor(handshape_target, dtype=torch.long),
            'location': torch.tensor(location_target, dtype=torch.long),
            'movement': torch.tensor(movement_target, dtype=torch.long)
        }

def collate_fn(batch):
    """
    Custom collate function to handle variable-length temporal sequences (padding them to max length).
    """
    landmarks_list = [item['landmarks'] for item in batch]
    handshape_list = [item['handshape'] for item in batch]
    location_list = [item['location'] for item in batch]
    movement_list = [item['movement'] for item in batch]
    
    # Pad sequences along temporal dimension
    max_len = max([lms.shape[0] for lms in landmarks_list])
    padded_lms = []
    for lms in landmarks_list:
        pad_size = max_len - lms.shape[0]
        if pad_size > 0:
            # Pad with zeros at the end
            pad = torch.zeros((pad_size, 543, 3))
            padded = torch.cat([lms, pad], dim=0)
        else:
            padded = lms
        padded_lms.append(padded)
        
    return {
        'landmarks': torch.stack(padded_lms, dim=0),
        'handshape': torch.stack(handshape_list, dim=0),
        'location': torch.stack(location_list, dim=0),
        'movement': torch.stack(movement_list, dim=0)
    }

def main():
    parser = argparse.ArgumentParser(description="Train PhonSSM on LSC Landmarks.")
    parser.add_argument("--data_dir", type=str, default="data/landmarks", help="Path to preprocessed landmarks")
    parser.add_argument("--epochs", type=int, default=5, help="Number of training epochs")
    parser.add_argument("--batch_size", type=int, default=4, help="Batch size")
    parser.add_argument("--checkpoint_dir", type=str, default="checkpoints", help="Directory to save weights")
    args = parser.parse_args()
    
    os.makedirs(args.checkpoint_dir, exist_ok=True)
    
    # Check if we have extracted data
    if not os.path.exists(args.data_dir) or len(os.listdir(args.data_dir)) == 0:
        print(f"Error: No preprocessed landmarks found in {args.data_dir}. Run preprocess.py first.")
        return
        
    print(f"Loading data from: {args.data_dir}")
    dataset = LSCDataset(args.data_dir, augment=True)
    loader = DataLoader(dataset, batch_size=args.batch_size, shuffle=True, collate_fn=collate_fn)
    
    print(f"Initializing PhonSSM model (Vocabulary size: {len(dataset.vocab)})...")
    model = PhonSSM()
    
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.CrossEntropyLoss()
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)
    
    print("Starting training loop...")
    for epoch in range(args.epochs):
        model.train()
        epoch_loss = 0.0
        
        for batch_idx, batch in enumerate(loader):
            landmarks = batch['landmarks'].to(device)
            target_h = batch['handshape'].to(device)
            target_l = batch['location'].to(device)
            target_m = batch['movement'].to(device)
            
            optimizer.zero_grad()
            
            # Forward pass
            outputs = model(landmarks)
            
            # Compute loss for the three orthogonal attributes
            loss_h = criterion(outputs['handshape'], target_h)
            loss_l = criterion(outputs['location'], target_l)
            loss_m = criterion(outputs['movement'], target_m)
            
            total_loss = loss_h + loss_l + loss_m
            total_loss.backward()
            optimizer.step()
            
            epoch_loss += total_loss.item()
            
        avg_loss = epoch_loss / len(loader)
        print(f"Epoch [{epoch+1}/{args.epochs}] - Average Loss: {avg_loss:.4f}")
        
    # Save the final checkpoint
    checkpoint_path = os.path.join(args.checkpoint_dir, "best_model.pt")
    torch.save(model.state_dict(), checkpoint_path)
    print(f"Saved checkpoint successfully to {checkpoint_path}")

if __name__ == "__main__":
    main()
