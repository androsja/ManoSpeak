import sys
import os

# Allow test files to do "from src.train import ..." which internally does
# "from model import PhonSSM" (bare import, as used when run as a script).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
