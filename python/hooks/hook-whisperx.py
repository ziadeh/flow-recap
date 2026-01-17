# PyInstaller hook for whisperx
# This ensures all whisperx submodules and dependencies are properly bundled

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Collect all whisperx submodules
hiddenimports = collect_submodules('whisperx')

# Also need these core dependencies
hiddenimports += [
    'faster_whisper',
    'ctranslate2',
    'torch',
    'torchaudio',
    'pyannote',
    'pyannote.audio',
]

# Collect data files (config files, etc) - note: datas format is [(src, dest)]
datas = collect_data_files('whisperx')

# Debug output
print(f"[hook-whisperx] Collected {len(hiddenimports)} hidden imports")
print(f"[hook-whisperx] Collected {len(datas)} data files")
