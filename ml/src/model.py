import torch
import torch.nn as nn
import torch.nn.functional as F

class AnatomicalGraphAttention(nn.Module):
    """
    Anatomical Graph Attention Network (AGAN) layer.
    Computes self-attention over coordinates to focus on joint relations.
    """
    def __init__(self, in_features, out_features, num_heads=4):
        super(AnatomicalGraphAttention, self).__init__()
        self.num_heads = num_heads
        self.head_dim = out_features // num_heads
        
        self.q_proj = nn.Linear(in_features, out_features)
        self.k_proj = nn.Linear(in_features, out_features)
        self.v_proj = nn.Linear(in_features, out_features)
        self.out_proj = nn.Linear(out_features, out_features)
        
    def forward(self, x):
        # x shape: (batch, seq_len, in_features)
        batch_size, seq_len, in_features = x.size()
        
        # Project queries, keys, values
        q = self.q_proj(x).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(batch_size, seq_len, self.num_heads, self.head_dim).transpose(1, 2)
        
        # Scaled dot-product attention
        scores = torch.matmul(q, k.transpose(-2, -1)) / (self.head_dim ** 0.5)
        attn_weights = F.softmax(scores, dim=-1)
        
        context = torch.matmul(attn_weights, v)
        context = context.transpose(1, 2).contiguous().view(batch_size, seq_len, -1)
        
        return self.out_proj(context)

class PhonSSM(nn.Module):
    """
    Phonological State Space Model (PhonSSM).
    Processes MediaPipe landmarks sequence and projects them to orthogonal sign parameters.
    """
    def __init__(self, num_handshapes=64, num_locations=32, num_movements=32):
        super(PhonSSM, self).__init__()
        self.num_handshapes = num_handshapes
        self.num_locations = num_locations
        self.num_movements = num_movements
        
        # Landmark feature input dimension: 543 points * 3 coordinates = 1629
        self.input_dim = 543 * 3
        self.hidden_dim = 256
        
        # Input layer mapping landmarks to hidden space
        self.input_layer = nn.Linear(self.input_dim, self.hidden_dim)
        
        # Spatial Graph Attention (AGAN) Layer
        self.agan = AnatomicalGraphAttention(self.hidden_dim, self.hidden_dim)
        
        # Temporal processing layer (GRU)
        self.gru = nn.GRU(self.hidden_dim, self.hidden_dim, num_layers=2, 
                          batch_first=True, bidirectional=True)
        
        # Post-GRU dimensional reduction
        self.fc = nn.Linear(self.hidden_dim * 2, self.hidden_dim)
        
        # Orthogonal Parameter Classification Heads
        self.handshape_head = nn.Linear(self.hidden_dim, num_handshapes)
        self.location_head = nn.Linear(self.hidden_dim, num_locations)
        self.movement_head = nn.Linear(self.hidden_dim, num_movements)
        
    def forward(self, x):
        # Input x shape: (batch, seq_len, 543, 3) or (batch, seq_len, 1629)
        batch_size = x.size(0)
        
        # Flatten landmarks if needed
        if x.dim() == 4:
            x = x.view(batch_size, x.size(1), -1)
            
        # Map to features
        features = F.relu(self.input_layer(x))
        
        # Apply Anatomical Graph Attention
        features = self.agan(features) + features  # Residual connection
        
        # Temporal processing
        gru_out, _ = self.gru(features)
        
        # Sequence-level pooling (average over time dimension)
        pooled = torch.mean(gru_out, dim=1)
        
        # Dimensional reduction
        features_reduced = F.relu(self.fc(pooled))
        
        # Orthogonal projections
        handshape_logits = self.handshape_head(features_reduced)
        location_logits = self.location_head(features_reduced)
        movement_logits = self.movement_head(features_reduced)
        
        return {
            'handshape': handshape_logits,
            'location': location_logits,
            'movement': movement_logits
        }
