# PyInstaller hook for faster_whisper
# This ensures all faster_whisper submodules and dependencies are properly bundled

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Collect all faster_whisper submodules
hiddenimports = collect_submodules('faster_whisper')

# Also need ctranslate2
hiddenimports += collect_submodules('ctranslate2')

# Collect data files (assets, etc) - note: datas format is [(src, dest)]
datas = collect_data_files('faster_whisper')
datas += collect_data_files('ctranslate2')

# Debug output
print(f"[hook-faster_whisper] Collected {len(hiddenimports)} hidden imports")
print(f"[hook-faster_whisper] Collected {len(datas)} data files")
