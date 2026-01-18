@echo off
REM ============================================================================
REM setup_environments.bat - Automated Python Environment Setup Script (Windows)
REM
REM This script automatically creates and configures dual Python virtual environments
REM for WhisperX (transcription) and Pyannote (speaker diarization).
REM
REM Features:
REM   - Detects Python 3.12 installation
REM   - Creates separate venvs to avoid torch version conflicts
REM   - Installs all dependencies automatically
REM   - Downloads required ML models with HF_TOKEN
REM   - Verifies installation with import tests
REM   - Generates environment validation report
REM
REM Usage:
REM   setup_environments.bat [options]
REM
REM Options:
REM   --skip-models     Skip model download
REM   --force           Force recreate environments
REM   --quiet           Reduce output verbosity
REM   --json            Output progress in JSON format
REM   --help            Show help message
REM
REM Exit codes:
REM   0 - Success
REM   1 - Python not found
REM   2 - Failed to create venv
REM   3 - Failed to install dependencies
REM   4 - Verification failed
REM   5 - Model download failed
REM ============================================================================

setlocal EnableDelayedExpansion

REM Configuration
set "SCRIPT_DIR=%~dp0"
set "VENV_WHISPERX=%SCRIPT_DIR%venv-whisperx"
set "VENV_PYANNOTE=%SCRIPT_DIR%venv-pyannote"
set "ENV_METADATA_FILE=%SCRIPT_DIR%.env.json"
set "MIN_PYTHON_MAJOR=3"
set "MIN_PYTHON_MINOR=12"
set "PREFERRED_PYTHON_VERSION=3.12"

REM Options
set "SKIP_MODELS=false"
set "FORCE_RECREATE=false"
set "QUIET=false"
set "JSON_OUTPUT=false"

REM Parse arguments
:parse_args
if "%~1"=="" goto :detect_python
if /i "%~1"=="--skip-models" (
    set "SKIP_MODELS=true"
    shift
    goto :parse_args
)
if /i "%~1"=="--force" (
    set "FORCE_RECREATE=true"
    shift
    goto :parse_args
)
if /i "%~1"=="--quiet" (
    set "QUIET=true"
    shift
    goto :parse_args
)
if /i "%~1"=="--json" (
    set "JSON_OUTPUT=true"
    shift
    goto :parse_args
)
if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="-h" goto :show_help
shift
goto :parse_args

:show_help
echo Meeting Notes - Python Environment Setup
echo.
echo Usage: setup_environments.bat [options]
echo.
echo Options:
echo   --skip-models     Skip model download
echo   --force           Force recreate environments
echo   --quiet           Reduce output verbosity
echo   --json            Output progress in JSON format
echo   --help            Show this help message
exit /b 0

REM ============================================================================
REM Detect Python
REM ============================================================================
:detect_python
call :progress "detect_python" "5" "Detecting Python 3.12 installation..."

set "PYTHON_CMD="

REM Check for python3.12 explicitly (may exist via pyenv or similar)
where python3.12 >nul 2>&1
if %errorlevel% equ 0 (
    set "PYTHON_CMD=python3.12"
    goto :python_found
)

REM Check for py launcher with version specification
where py >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('py -3.12 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do (
        if "%%v"=="3.12" (
            set "PYTHON_CMD=py -3.12"
            goto :python_found
        )
    )
)

REM Check for python and verify version
where python >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2^>nul') do (
        if "%%v"=="3.12" (
            set "PYTHON_CMD=python"
            goto :python_found
        )
    )
)

REM Python not found
call :error "Python %PREFERRED_PYTHON_VERSION% not found. Please install Python %PREFERRED_PYTHON_VERSION%." "1"
echo.
echo Installation instructions:
echo   1. Download Python 3.12 from https://www.python.org/downloads/
echo   2. Run the installer and check "Add Python to PATH"
echo   3. Restart your command prompt
echo   4. Re-run this script
exit /b 1

:python_found
REM Get version info
for /f "tokens=*" %%v in ('%PYTHON_CMD% -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"') do (
    set "PYTHON_VERSION=%%v"
)

call :success "Found Python %PYTHON_VERSION%"
call :step_complete "detect_python"

REM ============================================================================
REM Check Dependencies
REM ============================================================================
:check_deps
call :progress "check_deps" "10" "Checking system dependencies..."

REM Check for ffmpeg
where ffmpeg >nul 2>&1
if %errorlevel% equ 0 (
    call :success "ffmpeg found"
) else (
    call :warning "ffmpeg not found. Audio processing may be limited."
    echo   Install ffmpeg from https://ffmpeg.org/download.html
)

REM Check for git
where git >nul 2>&1
if %errorlevel% equ 0 (
    call :success "git found"
) else (
    call :warning "git not found. Some packages may fail to install."
)

call :step_complete "check_deps"

REM ============================================================================
REM Create WhisperX Environment
REM ============================================================================
:create_whisperx
call :progress "create_venv-whisperx" "15" "Creating venv-whisperx environment..."

if exist "%VENV_WHISPERX%" (
    if "%FORCE_RECREATE%"=="true" (
        call :warning "Removing existing venv-whisperx environment..."
        rmdir /s /q "%VENV_WHISPERX%"
    ) else (
        call :success "venv-whisperx environment already exists"
        call :step_complete "create_venv-whisperx"
        goto :install_whisperx
    )
)

%PYTHON_CMD% -m venv "%VENV_WHISPERX%"
if %errorlevel% neq 0 (
    call :error "Failed to create venv-whisperx virtual environment" "2"
    exit /b 2
)

call :success "Created venv-whisperx at %VENV_WHISPERX%"
call :step_complete "create_venv-whisperx"

REM ============================================================================
REM Install WhisperX Dependencies
REM ============================================================================
:install_whisperx
call :progress "install_venv-whisperx" "25" "Installing venv-whisperx dependencies (5-10 min)..."

REM Upgrade pip
call :progress "upgrade_pip" "27" "Upgrading pip in venv-whisperx..."
"%VENV_WHISPERX%\Scripts\pip.exe" install --upgrade pip >nul 2>&1
if %errorlevel% neq 0 (
    call :error "Failed to upgrade pip in venv-whisperx" "3"
    exit /b 3
)

REM Install requirements
call :progress "pip_install" "30" "Installing packages from requirements-whisperx.txt..."
if "%QUIET%"=="true" (
    "%VENV_WHISPERX%\Scripts\pip.exe" install -r "%SCRIPT_DIR%requirements-whisperx.txt" >nul 2>&1
) else if "%JSON_OUTPUT%"=="true" (
    "%VENV_WHISPERX%\Scripts\pip.exe" install -r "%SCRIPT_DIR%requirements-whisperx.txt" >nul 2>&1
) else (
    "%VENV_WHISPERX%\Scripts\pip.exe" install -r "%SCRIPT_DIR%requirements-whisperx.txt"
)
if %errorlevel% neq 0 (
    call :error "Failed to install dependencies for venv-whisperx" "3"
    exit /b 3
)

call :success "Installed dependencies for venv-whisperx"
call :step_complete "install_venv-whisperx"

REM ============================================================================
REM Verify WhisperX Installation
REM ============================================================================
:verify_whisperx
call :progress "verify_venv-whisperx" "40" "Verifying venv-whisperx installation..."

set "ALL_PASSED=true"

REM Check whisperx
"%VENV_WHISPERX%\Scripts\python.exe" -c "import whisperx" >nul 2>&1
if %errorlevel% equ 0 (
    call :success "  whisperx: OK"
) else (
    call :error "  whisperx: FAILED"
    set "ALL_PASSED=false"
)

REM Check faster_whisper
"%VENV_WHISPERX%\Scripts\python.exe" -c "import faster_whisper" >nul 2>&1
if %errorlevel% equ 0 (
    call :success "  faster_whisper: OK"
) else (
    call :error "  faster_whisper: FAILED"
    set "ALL_PASSED=false"
)

REM Check torch
for /f "tokens=*" %%v in ('"%VENV_WHISPERX%\Scripts\python.exe" -c "import torch; print(torch.__version__)" 2^>nul') do (
    call :success "  torch version: %%v"
)

REM Check CUDA
for /f "tokens=*" %%v in ('"%VENV_WHISPERX%\Scripts\python.exe" -c "import torch; print(torch.cuda.is_available())" 2^>nul') do (
    if "%%v"=="True" (
        call :success "  CUDA: Available"
    ) else (
        call :warning "  CUDA: Not available (CPU mode will be used)"
    )
)

if "%ALL_PASSED%"=="false" (
    call :error "Verification failed for venv-whisperx" "4"
    exit /b 4
)

call :step_complete "verify_venv-whisperx"

REM ============================================================================
REM Create Pyannote Environment
REM ============================================================================
:create_pyannote
call :progress "create_venv-pyannote" "45" "Creating venv-pyannote environment..."

if exist "%VENV_PYANNOTE%" (
    if "%FORCE_RECREATE%"=="true" (
        call :warning "Removing existing venv-pyannote environment..."
        rmdir /s /q "%VENV_PYANNOTE%"
    ) else (
        call :success "venv-pyannote environment already exists"
        call :step_complete "create_venv-pyannote"
        goto :install_pyannote
    )
)

%PYTHON_CMD% -m venv "%VENV_PYANNOTE%"
if %errorlevel% neq 0 (
    call :error "Failed to create venv-pyannote virtual environment" "2"
    exit /b 2
)

call :success "Created venv-pyannote at %VENV_PYANNOTE%"
call :step_complete "create_venv-pyannote"

REM ============================================================================
REM Install Pyannote Dependencies
REM ============================================================================
:install_pyannote
call :progress "install_venv-pyannote" "50" "Installing venv-pyannote dependencies (5-10 min)..."

REM Upgrade pip
call :progress "upgrade_pip" "52" "Upgrading pip in venv-pyannote..."
"%VENV_PYANNOTE%\Scripts\pip.exe" install --upgrade pip >nul 2>&1
if %errorlevel% neq 0 (
    call :error "Failed to upgrade pip in venv-pyannote" "3"
    exit /b 3
)

REM Install requirements
call :progress "pip_install" "55" "Installing packages from requirements-pyannote.txt..."
if "%QUIET%"=="true" (
    "%VENV_PYANNOTE%\Scripts\pip.exe" install -r "%SCRIPT_DIR%requirements-pyannote.txt" >nul 2>&1
) else if "%JSON_OUTPUT%"=="true" (
    "%VENV_PYANNOTE%\Scripts\pip.exe" install -r "%SCRIPT_DIR%requirements-pyannote.txt" >nul 2>&1
) else (
    "%VENV_PYANNOTE%\Scripts\pip.exe" install -r "%SCRIPT_DIR%requirements-pyannote.txt"
)
if %errorlevel% neq 0 (
    call :error "Failed to install dependencies for venv-pyannote" "3"
    exit /b 3
)

call :success "Installed dependencies for venv-pyannote"
call :step_complete "install_venv-pyannote"

REM ============================================================================
REM Verify Pyannote Installation
REM ============================================================================
:verify_pyannote
call :progress "verify_venv-pyannote" "65" "Verifying venv-pyannote installation..."

set "ALL_PASSED=true"

REM Check pyannote.audio
"%VENV_PYANNOTE%\Scripts\python.exe" -c "from pyannote.audio import Pipeline" >nul 2>&1
if %errorlevel% equ 0 (
    call :success "  pyannote.audio: OK"
) else (
    call :error "  pyannote.audio: FAILED"
    set "ALL_PASSED=false"
)

REM Check speechbrain
"%VENV_PYANNOTE%\Scripts\python.exe" -c "import speechbrain" >nul 2>&1
if %errorlevel% equ 0 (
    call :success "  speechbrain: OK"
) else (
    call :error "  speechbrain: FAILED"
    set "ALL_PASSED=false"
)

REM Check torch
for /f "tokens=*" %%v in ('"%VENV_PYANNOTE%\Scripts\python.exe" -c "import torch; print(torch.__version__)" 2^>nul') do (
    call :success "  torch version: %%v"
)

REM Check CUDA
for /f "tokens=*" %%v in ('"%VENV_PYANNOTE%\Scripts\python.exe" -c "import torch; print(torch.cuda.is_available())" 2^>nul') do (
    if "%%v"=="True" (
        call :success "  CUDA: Available"
    ) else (
        call :warning "  CUDA: Not available (CPU mode will be used)"
    )
)

if "%ALL_PASSED%"=="false" (
    call :error "Verification failed for venv-pyannote" "4"
    exit /b 4
)

call :step_complete "verify_venv-pyannote"

REM ============================================================================
REM Download Models
REM ============================================================================
:download_models
if "%SKIP_MODELS%"=="true" (
    call :warning "Skipping model download (--skip-models flag)"
    goto :generate_metadata
)

call :progress "download_models" "75" "Downloading ML models..."

if not defined HF_TOKEN (
    call :warning "HF_TOKEN not set. Model download will be skipped."
    echo.
    echo To download models:
    echo   1. Create an account at https://huggingface.co
    echo   2. Accept model terms at https://huggingface.co/pyannote/speaker-diarization-3.1
    echo   3. Create an access token at https://huggingface.co/settings/tokens
    echo   4. Set HF_TOKEN: set HF_TOKEN=your_token_here
    echo   5. Re-run this script
    goto :generate_metadata
)

if exist "%SCRIPT_DIR%download_models.py" (
    call :progress "download_pyannote_models" "80" "Downloading Pyannote models (10-15 min)..."
    "%VENV_PYANNOTE%\Scripts\python.exe" "%SCRIPT_DIR%download_models.py"
    if %errorlevel% equ 0 (
        call :success "Pyannote models downloaded successfully"
    ) else (
        call :warning "Some models failed to download. You can retry later from Settings."
    )
) else (
    call :warning "download_models.py not found. Models will be downloaded on first use."
)

call :step_complete "download_models"

REM ============================================================================
REM Generate Metadata
REM ============================================================================
:generate_metadata
call :progress "generate_metadata" "95" "Generating environment metadata..."

REM Get package versions
for /f "tokens=*" %%v in ('"%VENV_WHISPERX%\Scripts\python.exe" -c "import torch; print(torch.__version__)" 2^>nul') do set "WHISPERX_TORCH_VERSION=%%v"
for /f "tokens=*" %%v in ('"%VENV_WHISPERX%\Scripts\python.exe" -c "import whisperx; print(getattr(whisperx, '__version__', 'unknown'))" 2^>nul') do set "WHISPERX_VERSION=%%v"
for /f "tokens=*" %%v in ('"%VENV_PYANNOTE%\Scripts\python.exe" -c "import torch; print(torch.__version__)" 2^>nul') do set "PYANNOTE_TORCH_VERSION=%%v"
for /f "tokens=*" %%v in ('"%VENV_PYANNOTE%\Scripts\python.exe" -c "import pyannote.audio; print(pyannote.audio.__version__)" 2^>nul') do set "PYANNOTE_VERSION=%%v"

REM Get timestamp
for /f "tokens=*" %%t in ('powershell -command "Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ'"') do set "TIMESTAMP=%%t"

REM Write JSON metadata
(
echo {
echo   "schemaVersion": 1,
echo   "createdAt": "%TIMESTAMP%",
echo   "updatedAt": "%TIMESTAMP%",
echo   "setupScript": "setup_environments.bat",
echo   "systemPython": {
echo     "version": "%PYTHON_VERSION%",
echo     "path": "%PYTHON_CMD%"
echo   },
echo   "environments": {
echo     "whisperx": {
echo       "path": "%VENV_WHISPERX%",
echo       "pythonVersion": "%PYTHON_VERSION%",
echo       "packages": {
echo         "torch": "%WHISPERX_TORCH_VERSION%",
echo         "whisperx": "%WHISPERX_VERSION%"
echo       },
echo       "purpose": "transcription",
echo       "status": "ready"
echo     },
echo     "pyannote": {
echo       "path": "%VENV_PYANNOTE%",
echo       "pythonVersion": "%PYTHON_VERSION%",
echo       "packages": {
echo         "torch": "%PYANNOTE_TORCH_VERSION%",
echo         "pyannote.audio": "%PYANNOTE_VERSION%"
echo       },
echo       "purpose": "diarization",
echo       "status": "ready"
echo     }
echo   },
echo   "models": {
echo     "downloaded": %SKIP_MODELS:true=false%,
echo     "hfTokenConfigured": %HF_TOKEN_SET:false=false%
echo   },
echo   "platform": {
echo     "os": "Windows",
echo     "arch": "%PROCESSOR_ARCHITECTURE%"
echo   }
echo }
) > "%ENV_METADATA_FILE%"

call :success "Generated environment metadata at %ENV_METADATA_FILE%"
call :step_complete "generate_metadata"

REM ============================================================================
REM Complete
REM ============================================================================
:complete
call :progress "complete" "100" "Setup completed successfully"

if "%JSON_OUTPUT%"=="true" (
    echo {"type":"complete","success":true,"message":"Setup completed successfully"}
) else (
    echo.
    echo ========================================
    echo   Setup Complete!
    echo ========================================
    echo.
    echo Environments created:
    echo   - venv-whisperx: For transcription (WhisperX + torch 2.5.0)
    echo   - venv-pyannote: For diarization (Pyannote + torch 2.5.1)
    echo.
    echo Next steps:
    echo   1. The app will automatically use these environments
    echo   2. Models will be downloaded when needed (requires HF_TOKEN)
    echo.
    if not defined HF_TOKEN (
        echo Note: HF_TOKEN not set. Configure it in Settings to enable speaker diarization.
        echo.
    )
    echo Metadata saved to: %ENV_METADATA_FILE%
    echo.
)

exit /b 0

REM ============================================================================
REM Helper Functions
REM ============================================================================

:progress
if "%JSON_OUTPUT%"=="true" (
    echo {"type":"progress","step":"%~1","percentage":%~2,"message":"%~3"}
) else if "%QUIET%"=="false" (
    echo [%~2%%] %~1: %~3
)
exit /b 0

:success
if "%JSON_OUTPUT%"=="true" (
    echo {"type":"success","message":"%~1"}
) else (
    echo [OK] %~1
)
exit /b 0

:error
if "%JSON_OUTPUT%"=="true" (
    echo {"type":"error","message":"%~1","code":%~2}
) else (
    echo [ERROR] %~1 1>&2
)
exit /b 0

:warning
if "%JSON_OUTPUT%"=="true" (
    echo {"type":"warning","message":"%~1"}
) else (
    echo [WARNING] %~1
)
exit /b 0

:step_complete
if "%JSON_OUTPUT%"=="true" (
    echo {"type":"step_complete","step":"%~1"}
)
exit /b 0
