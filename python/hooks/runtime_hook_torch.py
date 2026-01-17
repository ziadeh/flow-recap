# PyInstaller runtime hook for torch and torchaudio
# This runs BEFORE any code in the bundled application
# It patches torch.load to use weights_only=False by default
# and fixes torchaudio backend initialization to avoid circular imports

import os
import sys

# Set environment variable to help identify bundled mode
os.environ['MEETING_NOTES_BUNDLED'] = '1'

# ============================================================================
# Fix 1: Patch torch.load to use weights_only=False
# ============================================================================
import functools
import torch
import torch.serialization

_original_torch_load = torch.load

@functools.wraps(_original_torch_load)
def _patched_torch_load(*args, **kwargs):
    if 'weights_only' not in kwargs:
        kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)

# Patch ALL references to torch.load
torch.load = _patched_torch_load
torch.serialization.load = _patched_torch_load

# Also patch via sys.modules to ensure all imports see the patched version
if 'torch' in sys.modules:
    sys.modules['torch'].load = _patched_torch_load
if 'torch.serialization' in sys.modules:
    sys.modules['torch.serialization'].load = _patched_torch_load

print("[Runtime Hook] torch.load patched to use weights_only=False by default", file=sys.stderr)

# ============================================================================
# Fix 2: Prevent torchaudio from trying to import SoX backend (circular import)
# ============================================================================
# Set environment variable BEFORE any torchaudio imports happen
# This tells torchaudio to use soundfile backend exclusively
os.environ['TORCHAUDIO_BACKEND'] = 'soundfile'
print("[Runtime Hook] Set TORCHAUDIO_BACKEND=soundfile to avoid SoX circular imports", file=sys.stderr)

# Create a fake module for sox_io_backend to prevent import errors
# This is a defensive measure in case something still tries to import it
import types
fake_sox_backend = types.ModuleType('sox_io_backend')
fake_sox_backend.__file__ = '<fake>'
fake_sox_backend.__package__ = 'torchaudio.backend'

# Add fake module to sys.modules to intercept any import attempts
sys.modules['torchaudio.backend.sox_io_backend'] = fake_sox_backend
sys.modules['torchaudio.backend.sox_backend'] = fake_sox_backend
print("[Runtime Hook] Created fake sox_io_backend module to prevent import errors", file=sys.stderr)
