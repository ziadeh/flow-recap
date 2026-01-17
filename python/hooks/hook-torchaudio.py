# PyInstaller hook for torchaudio
# Fixes circular import issues with torchaudio.backend module

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Collect all torchaudio submodules EXCEPT sox backends to avoid circular imports
hiddenimports = [m for m in collect_submodules('torchaudio')
                 if 'sox' not in m.lower()]

# Explicitly include backend modules that we DO want (soundfile backend only)
hiddenimports.extend([
    'torchaudio.backend',
    'torchaudio.backend.soundfile_backend',
    'torchaudio.backend.common',
    'torchaudio.backend.utils',
    # Do NOT include sox backends (they're excluded intentionally to avoid circular imports)
    # 'torchaudio.backend.sox_io_backend',  # EXCLUDED
    # 'torchaudio.backend.sox_backend',     # EXCLUDED
])

# Remove any duplicate imports
hiddenimports = list(set(hiddenimports))

# Collect data files (model configs, etc.)
datas = collect_data_files('torchaudio')

# Debug output
print(f"[hook-torchaudio] Collected {len(hiddenimports)} hidden imports (SoX backends excluded)")
print(f"[hook-torchaudio] Collected {len(datas)} data files")
