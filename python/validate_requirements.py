#!/usr/bin/env python3
"""
validate_requirements.py - Requirements Validation Script

This script validates the split requirements files for Meeting Notes,
checking for version conflicts, incompatibilities, and potential issues.

Usage:
    python validate_requirements.py [options]

Options:
    --check-updates     Check for available package updates
    --strict            Treat warnings as errors
    --json              Output results in JSON format
    --quiet             Only output errors
    --help              Show this help message

Exit codes:
    0 - All validations passed
    1 - Validation errors found
    2 - Warnings found (with --strict)
    3 - File not found or parse error
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ANSI color codes
COLORS = {
    "red": "\033[0;31m",
    "green": "\033[0;32m",
    "yellow": "\033[1;33m",
    "blue": "\033[0;34m",
    "cyan": "\033[0;36m",
    "reset": "\033[0m",
}


@dataclass
class Requirement:
    """Represents a parsed requirement line."""

    name: str
    version_spec: str = ""
    extras: list = field(default_factory=list)
    original_line: str = ""
    line_number: int = 0

    @property
    def pinned_version(self) -> Optional[str]:
        """Extract pinned version if using == specifier."""
        match = re.match(r"==(.+)", self.version_spec)
        return match.group(1) if match else None

    @property
    def min_version(self) -> Optional[str]:
        """Extract minimum version if using >= specifier."""
        match = re.match(r">=(.+)", self.version_spec)
        return match.group(1) if match else None


@dataclass
class ValidationResult:
    """Result of a validation check."""

    level: str  # "error", "warning", "info"
    message: str
    file: str = ""
    line: int = 0
    package: str = ""

    def to_dict(self) -> dict:
        return {
            "level": self.level,
            "message": self.message,
            "file": self.file,
            "line": self.line,
            "package": self.package,
        }


class RequirementsValidator:
    """Validates requirements files for conflicts and issues."""

    # Known conflicting packages and their constraints
    KNOWN_CONFLICTS = {
        ("torch", "whisperx"): {
            "description": "WhisperX requires torch 2.8.0, Pyannote requires torch 2.5.1",
            "resolution": "Use separate virtual environments (venv-whisperx, venv-pyannote)",
        },
        ("numpy", "whisperx"): {
            "description": "WhisperX/librosa incompatible with NumPy 2.0+",
            "resolution": "Pin numpy<2.0 in whisperx environment",
        },
    }

    # Expected versions for critical packages
    EXPECTED_VERSIONS = {
        "requirements-whisperx.txt": {
            "torch": "2.8.0",
            "torchaudio": "2.5.0",
        },
        "requirements-pyannote.txt": {
            "torch": "2.5.1",
            "torchaudio": "2.5.1",
            "pyannote.audio": "3.4.0",
            "pytorch-lightning": "2.6.0",
        },
    }

    # Packages that should NOT be in certain environments
    FORBIDDEN_PACKAGES = {
        "requirements-whisperx.txt": [
            "pyannote.audio",  # Should only be in pyannote env
        ],
        "requirements-pyannote.txt": [
            "whisperx",  # Should only be in whisperx env
        ],
    }

    def __init__(self, base_path: Path, quiet: bool = False, json_output: bool = False):
        self.base_path = base_path
        self.quiet = quiet
        self.json_output = json_output
        self.results: list[ValidationResult] = []

    def log(self, message: str, color: str = "reset") -> None:
        """Log a message with optional color."""
        if self.quiet or self.json_output:
            return
        color_code = COLORS.get(color, COLORS["reset"])
        print(f"{color_code}{message}{COLORS['reset']}")

    def add_result(
        self,
        level: str,
        message: str,
        file: str = "",
        line: int = 0,
        package: str = "",
    ) -> None:
        """Add a validation result."""
        self.results.append(
            ValidationResult(
                level=level, message=message, file=file, line=line, package=package
            )
        )

    def parse_requirements_file(self, filename: str) -> list[Requirement]:
        """Parse a requirements file into a list of Requirement objects."""
        filepath = self.base_path / filename
        requirements = []

        if not filepath.exists():
            self.add_result("error", f"File not found: {filename}", file=filename)
            return requirements

        with open(filepath, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()

                # Skip empty lines and comments
                if not line or line.startswith("#"):
                    continue

                # Skip -r references to other files
                if line.startswith("-r"):
                    continue

                # Parse the requirement
                req = self._parse_requirement_line(line, line_num)
                if req:
                    requirements.append(req)

        return requirements

    def _parse_requirement_line(
        self, line: str, line_num: int
    ) -> Optional[Requirement]:
        """Parse a single requirement line."""
        # Handle extras like package[extra1,extra2]
        extras_match = re.match(r"([a-zA-Z0-9_.-]+)\[([^\]]+)\](.*)$", line)
        if extras_match:
            name = extras_match.group(1).lower()
            extras = [e.strip() for e in extras_match.group(2).split(",")]
            version_spec = extras_match.group(3).strip()
        else:
            # Standard package name
            match = re.match(r"([a-zA-Z0-9_.-]+)(.*)$", line)
            if not match:
                return None
            name = match.group(1).lower()
            extras = []
            version_spec = match.group(2).strip()

        return Requirement(
            name=name,
            version_spec=version_spec,
            extras=extras,
            original_line=line,
            line_number=line_num,
        )

    def validate_file_exists(self, filename: str) -> bool:
        """Check if a requirements file exists."""
        filepath = self.base_path / filename
        if not filepath.exists():
            self.add_result("error", f"Required file missing: {filename}", file=filename)
            return False
        return True

    def validate_expected_versions(
        self, filename: str, requirements: list[Requirement]
    ) -> None:
        """Validate that critical packages have expected versions."""
        expected = self.EXPECTED_VERSIONS.get(filename, {})
        req_dict = {req.name: req for req in requirements}

        for package, expected_version in expected.items():
            package_lower = package.lower()
            if package_lower not in req_dict:
                self.add_result(
                    "error",
                    f"Missing required package: {package}",
                    file=filename,
                    package=package,
                )
                continue

            req = req_dict[package_lower]
            pinned = req.pinned_version

            if pinned and pinned != expected_version:
                self.add_result(
                    "error",
                    f"Version mismatch: {package} is {pinned}, expected {expected_version}",
                    file=filename,
                    line=req.line_number,
                    package=package,
                )
            elif not pinned and "==" in req.version_spec:
                # Has some version spec but couldn't parse
                self.add_result(
                    "warning",
                    f"Could not parse version for {package}: {req.version_spec}",
                    file=filename,
                    line=req.line_number,
                    package=package,
                )

    def validate_no_forbidden_packages(
        self, filename: str, requirements: list[Requirement]
    ) -> None:
        """Ensure certain packages don't appear in wrong environments."""
        forbidden = self.FORBIDDEN_PACKAGES.get(filename, [])
        req_names = {req.name for req in requirements}

        for package in forbidden:
            if package.lower() in req_names:
                self.add_result(
                    "error",
                    f"Forbidden package in {filename}: {package}",
                    file=filename,
                    package=package,
                )

    def validate_duplicate_packages(
        self, filename: str, requirements: list[Requirement]
    ) -> None:
        """Check for duplicate package entries."""
        seen = {}
        for req in requirements:
            if req.name in seen:
                self.add_result(
                    "warning",
                    f"Duplicate package entry: {req.name} (lines {seen[req.name]} and {req.line_number})",
                    file=filename,
                    line=req.line_number,
                    package=req.name,
                )
            else:
                seen[req.name] = req.line_number

    def validate_version_specifiers(
        self, filename: str, requirements: list[Requirement]
    ) -> None:
        """Validate version specifier syntax."""
        valid_operators = ["==", ">=", "<=", ">", "<", "~=", "!="]

        for req in requirements:
            if not req.version_spec:
                self.add_result(
                    "warning",
                    f"No version constraint for: {req.name}",
                    file=filename,
                    line=req.line_number,
                    package=req.name,
                )
                continue

            # Check for valid operator
            has_valid_op = any(
                req.version_spec.startswith(op) for op in valid_operators
            )
            if not has_valid_op:
                self.add_result(
                    "error",
                    f"Invalid version specifier: {req.original_line}",
                    file=filename,
                    line=req.line_number,
                    package=req.name,
                )

    def validate_cross_file_conflicts(
        self, whisperx_reqs: list[Requirement], pyannote_reqs: list[Requirement]
    ) -> None:
        """Check for known conflicts between environments."""
        whisperx_dict = {req.name: req for req in whisperx_reqs}
        pyannote_dict = {req.name: req for req in pyannote_reqs}

        # Check torch versions
        if "torch" in whisperx_dict and "torch" in pyannote_dict:
            wx_torch = whisperx_dict["torch"].pinned_version
            py_torch = pyannote_dict["torch"].pinned_version

            if wx_torch and py_torch and wx_torch == py_torch:
                self.add_result(
                    "warning",
                    f"torch versions are the same ({wx_torch}). If this is intentional, environments can be merged.",
                    package="torch",
                )
            elif wx_torch and py_torch:
                self.add_result(
                    "info",
                    f"torch version conflict detected (whisperx: {wx_torch}, pyannote: {py_torch}). This is expected and handled by dual environments.",
                    package="torch",
                )

        # Check for packages that should be shared but have different versions
        common_packages = set(whisperx_dict.keys()) & set(pyannote_dict.keys())
        for pkg in common_packages:
            if pkg in ["torch", "torchaudio"]:
                continue  # Known differences

            wx_ver = whisperx_dict[pkg].version_spec
            py_ver = pyannote_dict[pkg].version_spec

            if wx_ver != py_ver:
                self.add_result(
                    "warning",
                    f"Package {pkg} has different versions: whisperx({wx_ver}) vs pyannote({py_ver})",
                    package=pkg,
                )

    def validate_common_file(
        self,
        common_reqs: list[Requirement],
        whisperx_reqs: list[Requirement],
        pyannote_reqs: list[Requirement],
    ) -> None:
        """Validate that common packages are compatible with both environments."""
        common_names = {req.name for req in common_reqs}
        whisperx_names = {req.name for req in whisperx_reqs}
        pyannote_names = {req.name for req in pyannote_reqs}

        # Packages in common should not conflict with environment-specific packages
        for name in common_names:
            if name in whisperx_names:
                self.add_result(
                    "info",
                    f"Package {name} in requirements-common.txt is also in requirements-whisperx.txt",
                    file="requirements-common.txt",
                    package=name,
                )
            if name in pyannote_names:
                self.add_result(
                    "info",
                    f"Package {name} in requirements-common.txt is also in requirements-pyannote.txt",
                    file="requirements-common.txt",
                    package=name,
                )

    def run_validation(self) -> bool:
        """Run all validation checks."""
        self.log("=" * 60, "blue")
        self.log("  Meeting Notes - Requirements Validation", "blue")
        self.log("=" * 60, "blue")
        self.log("")

        # Check required files exist
        files = [
            "requirements-whisperx.txt",
            "requirements-pyannote.txt",
            "requirements-common.txt",
        ]

        all_exist = all(self.validate_file_exists(f) for f in files)
        if not all_exist:
            return False

        # Parse all files
        self.log("Parsing requirements files...", "cyan")
        whisperx_reqs = self.parse_requirements_file("requirements-whisperx.txt")
        pyannote_reqs = self.parse_requirements_file("requirements-pyannote.txt")
        common_reqs = self.parse_requirements_file("requirements-common.txt")

        self.log(f"  - requirements-whisperx.txt: {len(whisperx_reqs)} packages", "green")
        self.log(f"  - requirements-pyannote.txt: {len(pyannote_reqs)} packages", "green")
        self.log(f"  - requirements-common.txt: {len(common_reqs)} packages", "green")
        self.log("")

        # Run validations
        self.log("Running validations...", "cyan")

        # Per-file validations
        for filename, reqs in [
            ("requirements-whisperx.txt", whisperx_reqs),
            ("requirements-pyannote.txt", pyannote_reqs),
            ("requirements-common.txt", common_reqs),
        ]:
            self.validate_expected_versions(filename, reqs)
            self.validate_no_forbidden_packages(filename, reqs)
            self.validate_duplicate_packages(filename, reqs)
            self.validate_version_specifiers(filename, reqs)

        # Cross-file validations
        self.validate_cross_file_conflicts(whisperx_reqs, pyannote_reqs)
        self.validate_common_file(common_reqs, whisperx_reqs, pyannote_reqs)

        return True

    def print_results(self) -> tuple[int, int, int]:
        """Print validation results and return counts."""
        errors = [r for r in self.results if r.level == "error"]
        warnings = [r for r in self.results if r.level == "warning"]
        infos = [r for r in self.results if r.level == "info"]

        if self.json_output:
            output = {
                "summary": {
                    "errors": len(errors),
                    "warnings": len(warnings),
                    "info": len(infos),
                },
                "results": [r.to_dict() for r in self.results],
            }
            print(json.dumps(output, indent=2))
            return len(errors), len(warnings), len(infos)

        self.log("")
        self.log("=" * 60, "blue")
        self.log("  Validation Results", "blue")
        self.log("=" * 60, "blue")
        self.log("")

        if errors:
            self.log("ERRORS:", "red")
            for r in errors:
                loc = f" ({r.file}:{r.line})" if r.file else ""
                self.log(f"  ✗ {r.message}{loc}", "red")
            self.log("")

        if warnings:
            self.log("WARNINGS:", "yellow")
            for r in warnings:
                loc = f" ({r.file}:{r.line})" if r.file else ""
                self.log(f"  ⚠ {r.message}{loc}", "yellow")
            self.log("")

        if infos and not self.quiet:
            self.log("INFO:", "cyan")
            for r in infos:
                self.log(f"  ℹ {r.message}", "cyan")
            self.log("")

        # Summary
        self.log("-" * 60)
        if errors:
            self.log(f"❌ Validation FAILED: {len(errors)} errors, {len(warnings)} warnings", "red")
        elif warnings:
            self.log(f"⚠️  Validation PASSED with {len(warnings)} warnings", "yellow")
        else:
            self.log("✅ Validation PASSED - All checks passed!", "green")
        self.log("")

        return len(errors), len(warnings), len(infos)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Validate Meeting Notes requirements files"
    )
    parser.add_argument(
        "--check-updates",
        action="store_true",
        help="Check for available package updates",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results in JSON format",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Only output errors",
    )
    parser.add_argument(
        "--path",
        type=str,
        default=None,
        help="Path to python directory (default: script directory)",
    )

    args = parser.parse_args()

    # Determine base path
    if args.path:
        base_path = Path(args.path)
    else:
        base_path = Path(__file__).parent

    # Create validator
    validator = RequirementsValidator(
        base_path=base_path,
        quiet=args.quiet,
        json_output=args.json,
    )

    # Run validation
    if not validator.run_validation():
        sys.exit(3)

    # Print results
    errors, warnings, _ = validator.print_results()

    # Determine exit code
    if errors > 0:
        sys.exit(1)
    elif warnings > 0 and args.strict:
        sys.exit(2)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
