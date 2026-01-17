# PyInstaller hook for ctranslate2
# This ensures all ctranslate2 submodules and native libs are properly bundled

from PyInstaller.utils.hooks import collect_submodules, collect_data_files, collect_dynamic_libs

# Collect all submodules
hiddenimports = collect_submodules('ctranslate2')

# Collect data files
datas = collect_data_files('ctranslate2')

# CRITICAL: Explicitly collect binary libraries (shared objects)
# These include libctranslate2.so/.dylib/.dll and dependencies
binaries = collect_dynamic_libs('ctranslate2')

# Debug output
print(f"[hook-ctranslate2] Collected {len(hiddenimports)} hidden imports")
print(f"[hook-ctranslate2] Collected {len(datas)} data files")
print(f"[hook-ctranslate2] Collected {len(binaries)} binary files")
