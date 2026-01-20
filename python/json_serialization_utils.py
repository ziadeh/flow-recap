#!/usr/bin/env python3
"""
json_serialization_utils.py - Utilities for safe JSON serialization of ML model outputs

This module provides robust utilities for converting numpy arrays, PyTorch tensors,
and other ML-specific data types to JSON-serializable Python native types.

The primary use case is serializing speaker diarization pipeline outputs that may contain:
- numpy.float32, numpy.float64, numpy.int32, numpy.int64 scalar types
- numpy.ndarray objects
- PyTorch tensors (torch.Tensor)
- Special float values: NaN, Infinity, -Infinity

Key Functions:
- to_json_serializable(): Recursively convert any object to JSON-serializable types
- NumpyTorchJSONEncoder: Custom JSON encoder class for json.dumps()
- safe_json_dumps(): Safe wrapper around json.dumps() with automatic conversion

Usage:
    from json_serialization_utils import to_json_serializable, safe_json_dumps

    # Convert a dict with numpy/torch values
    data = {"score": np.float32(0.95), "embedding": torch.tensor([1.0, 2.0])}
    clean_data = to_json_serializable(data)

    # Or use safe_json_dumps directly
    json_str = safe_json_dumps(data)

This module directly fixes the error:
    'Object of type float32 is not JSON serializable'
"""

import json
import math
import sys
import warnings
from typing import Any, Dict, List, Optional, Union

# Import numpy (required)
import numpy as np

# Attempt to import PyTorch (optional)
TORCH_AVAILABLE = False
try:
    import torch
    TORCH_AVAILABLE = True
except ImportError:
    pass


def _handle_special_float(value: float, warn: bool = True) -> Union[float, None]:
    """
    Handle special float values (NaN, Infinity) for JSON serialization.

    JSON specification does not support NaN or Infinity values.
    This function converts them to JSON-safe representations.

    Args:
        value: A float value that may be NaN or Infinity
        warn: Whether to emit a warning for special values

    Returns:
        - None for NaN values (converts to JSON null)
        - sys.float_info.max for positive Infinity
        - -sys.float_info.max for negative Infinity
        - The original value if it's a normal float
    """
    if math.isnan(value):
        if warn:
            warnings.warn(
                "NaN value encountered during JSON serialization, converting to null",
                RuntimeWarning,
                stacklevel=3
            )
        return None
    elif math.isinf(value):
        if warn:
            sign = "positive" if value > 0 else "negative"
            warnings.warn(
                f"{sign.capitalize()} Infinity encountered during JSON serialization, "
                f"converting to {'max' if value > 0 else 'min'} float value",
                RuntimeWarning,
                stacklevel=3
            )
        # Return max/min float as a large but valid number
        return sys.float_info.max if value > 0 else -sys.float_info.max
    return value


def to_json_serializable(obj: Any, warn_special_floats: bool = True) -> Any:
    """
    Recursively convert numpy arrays, PyTorch tensors, and other ML types
    to JSON-serializable Python native types.

    This function handles:
    1. numpy scalar types (float32, float64, int32, int64, bool_)
    2. numpy arrays (using .tolist() method)
    3. PyTorch tensors (using .cpu().numpy().tolist())
    4. Special float values: NaN -> null, Infinity -> large number
    5. Nested dictionaries and lists (recursive conversion)
    6. Native Python types (preserved without modification)

    Args:
        obj: Any Python object that may contain numpy/torch types
        warn_special_floats: Whether to emit warnings for NaN/Infinity values

    Returns:
        Object with all values converted to JSON-serializable types

    Examples:
        >>> to_json_serializable(np.float32(0.5))
        0.5

        >>> to_json_serializable({"score": np.array([1, 2, 3])})
        {'score': [1, 2, 3]}

        >>> to_json_serializable(np.float64('nan'))
        None
    """
    # Handle None
    if obj is None:
        return None

    # Handle PyTorch tensors (must check before numpy since tensors have .numpy())
    if TORCH_AVAILABLE and isinstance(obj, torch.Tensor):
        # Move to CPU if on GPU, convert to numpy, then to list
        try:
            # Handle scalar tensors
            if obj.dim() == 0:
                value = float(obj.cpu().item())
                return _handle_special_float(value, warn_special_floats)
            # Handle array tensors
            numpy_array = obj.detach().cpu().numpy()
            return to_json_serializable(numpy_array.tolist(), warn_special_floats)
        except Exception as e:
            # Fallback: try to convert to string
            warnings.warn(f"Failed to convert torch.Tensor to JSON-serializable: {e}")
            return str(obj)

    # Handle numpy floating point scalars (float32, float64, etc.)
    if isinstance(obj, np.floating):
        value = float(obj)
        return _handle_special_float(value, warn_special_floats)

    # Handle numpy integer scalars (int32, int64, etc.)
    if isinstance(obj, np.integer):
        return int(obj)

    # Handle numpy boolean
    if isinstance(obj, np.bool_):
        return bool(obj)

    # Handle numpy arrays
    if isinstance(obj, np.ndarray):
        # Convert to list first, then recursively process each element
        # This handles nested arrays and special float values
        return [to_json_serializable(item, warn_special_floats) for item in obj.tolist()]

    # Handle Python floats (check for NaN/Infinity)
    if isinstance(obj, float):
        return _handle_special_float(obj, warn_special_floats)

    # Handle native Python types that are already JSON-serializable
    if isinstance(obj, (str, int, bool)):
        return obj

    # Handle dictionaries (recursive)
    if isinstance(obj, dict):
        return {
            key: to_json_serializable(value, warn_special_floats)
            for key, value in obj.items()
        }

    # Handle lists and tuples (recursive)
    if isinstance(obj, (list, tuple)):
        return [to_json_serializable(item, warn_special_floats) for item in obj]

    # Handle sets (convert to list)
    if isinstance(obj, set):
        return [to_json_serializable(item, warn_special_floats) for item in obj]

    # Handle bytes (decode to string)
    if isinstance(obj, bytes):
        try:
            return obj.decode('utf-8')
        except UnicodeDecodeError:
            return obj.decode('latin-1')

    # For unknown types, try common conversions
    # First try to get numeric value
    if hasattr(obj, 'item'):
        # Many numpy-like objects have .item() method
        try:
            return to_json_serializable(obj.item(), warn_special_floats)
        except Exception:
            pass

    # Last resort: convert to string
    try:
        return str(obj)
    except Exception:
        return None


class NumpyTorchJSONEncoder(json.JSONEncoder):
    """
    Custom JSON encoder that handles numpy types and PyTorch tensors.

    This encoder extends json.JSONEncoder to handle:
    - numpy.floating (float32, float64) -> Python float
    - numpy.integer (int32, int64) -> Python int
    - numpy.ndarray -> Python list
    - numpy.bool_ -> Python bool
    - torch.Tensor -> Python list (via .cpu().numpy().tolist())
    - NaN -> null
    - Infinity -> max float value

    Usage:
        import json
        data = {"score": np.float32(0.5)}
        json_str = json.dumps(data, cls=NumpyTorchJSONEncoder)
    """

    def __init__(self, *args, warn_special_floats: bool = True, **kwargs):
        super().__init__(*args, **kwargs)
        self.warn_special_floats = warn_special_floats

    def default(self, obj):
        """Handle non-serializable objects."""
        # PyTorch tensors
        if TORCH_AVAILABLE and isinstance(obj, torch.Tensor):
            try:
                if obj.dim() == 0:
                    value = float(obj.cpu().item())
                    return _handle_special_float(value, self.warn_special_floats)
                return obj.detach().cpu().numpy().tolist()
            except Exception:
                return str(obj)

        # Numpy floating types
        if isinstance(obj, np.floating):
            value = float(obj)
            return _handle_special_float(value, self.warn_special_floats)

        # Numpy integer types
        if isinstance(obj, np.integer):
            return int(obj)

        # Numpy arrays
        if isinstance(obj, np.ndarray):
            return obj.tolist()

        # Numpy boolean
        if isinstance(obj, np.bool_):
            return bool(obj)

        # Bytes
        if isinstance(obj, bytes):
            try:
                return obj.decode('utf-8')
            except UnicodeDecodeError:
                return obj.decode('latin-1')

        # Sets
        if isinstance(obj, set):
            return list(obj)

        # Fallback to parent's default behavior
        return super().default(obj)

    def encode(self, obj):
        """Override encode to handle special float values in nested structures."""
        # Pre-process the object to handle NaN/Infinity in nested dicts/lists
        processed = self._preprocess_floats(obj)
        return super().encode(processed)

    def _preprocess_floats(self, obj):
        """Recursively process floats to handle NaN/Infinity."""
        if isinstance(obj, float):
            return _handle_special_float(obj, self.warn_special_floats)
        elif isinstance(obj, dict):
            return {k: self._preprocess_floats(v) for k, v in obj.items()}
        elif isinstance(obj, (list, tuple)):
            return [self._preprocess_floats(item) for item in obj]
        return obj


def safe_json_dumps(
    obj: Any,
    warn_special_floats: bool = True,
    ensure_ascii: bool = False,
    **kwargs
) -> str:
    """
    Safely serialize an object to JSON string, handling numpy/torch types.

    This function first converts all numpy/torch types to native Python types,
    then serializes to JSON. It provides robust error handling and recovery.

    Args:
        obj: Object to serialize
        warn_special_floats: Whether to emit warnings for NaN/Infinity
        ensure_ascii: Whether to escape non-ASCII characters
        **kwargs: Additional arguments passed to json.dumps()

    Returns:
        JSON string representation of the object

    Raises:
        TypeError: If object cannot be serialized even after conversion
    """
    try:
        # First try with the custom encoder (handles most cases efficiently)
        encoder = NumpyTorchJSONEncoder(
            warn_special_floats=warn_special_floats,
            ensure_ascii=ensure_ascii,
            **kwargs
        )
        return encoder.encode(obj)
    except TypeError as e:
        # If encoding fails, try converting all values first
        try:
            converted = to_json_serializable(obj, warn_special_floats)
            return json.dumps(converted, ensure_ascii=ensure_ascii, **kwargs)
        except Exception as recovery_error:
            # Last resort: provide error info
            raise TypeError(
                f"Failed to serialize object to JSON: {e}. "
                f"Recovery also failed: {recovery_error}"
            ) from e


def safe_output_json(obj: Dict[str, Any], warn_special_floats: bool = False) -> None:
    """
    Safely output a JSON object as a line to stdout.

    This is a convenience function for streaming JSON output (JSON lines format).
    It handles numpy/torch types and provides error recovery.

    Args:
        obj: Dictionary to output as JSON
        warn_special_floats: Whether to emit warnings for NaN/Infinity
    """
    try:
        # Try with custom encoder first
        print(
            json.dumps(obj, ensure_ascii=False, cls=NumpyTorchJSONEncoder),
            flush=True
        )
    except TypeError as e:
        # Recovery: convert all values to native types
        try:
            converted = to_json_serializable(obj, warn_special_floats)
            print(json.dumps(converted, ensure_ascii=False), flush=True)
        except Exception as recovery_error:
            # Log error to stderr but don't crash
            print(
                f"[JSON ERROR] Serialization failed: {e}, recovery failed: {recovery_error}",
                file=sys.stderr,
                flush=True
            )
            # Output minimal error marker
            error_obj = {
                "type": "serialization_error",
                "error": str(e),
                "original_type": obj.get("type", "unknown") if isinstance(obj, dict) else "unknown"
            }
            print(json.dumps(error_obj, ensure_ascii=False), flush=True)


# ============================================================================
# Convenience type aliases for documentation
# ============================================================================

JSONSerializable = Union[None, bool, int, float, str, List[Any], Dict[str, Any]]


# ============================================================================
# Module self-test
# ============================================================================

if __name__ == "__main__":
    # Run basic self-tests
    print("Running json_serialization_utils self-tests...")

    # Test numpy types
    assert to_json_serializable(np.float32(0.5)) == 0.5
    assert to_json_serializable(np.float64(0.5)) == 0.5
    assert to_json_serializable(np.int32(42)) == 42
    assert to_json_serializable(np.int64(42)) == 42
    assert to_json_serializable(np.bool_(True)) == True
    assert to_json_serializable(np.array([1, 2, 3])) == [1, 2, 3]
    print("  numpy types: OK")

    # Test special floats
    assert to_json_serializable(float('nan'), warn_special_floats=False) is None
    assert to_json_serializable(float('inf'), warn_special_floats=False) == sys.float_info.max
    assert to_json_serializable(float('-inf'), warn_special_floats=False) == -sys.float_info.max
    print("  special floats: OK")

    # Test nested structures
    nested = {
        "scores": np.array([0.1, 0.2]),
        "confidence": np.float32(0.95),
        "count": np.int64(10),
        "nested": {
            "value": np.float64(1.5)
        }
    }
    result = to_json_serializable(nested)
    assert result["scores"] == [0.1, 0.2]
    # Note: float32 has limited precision, so we compare with tolerance
    assert abs(result["confidence"] - 0.95) < 0.0001, f"confidence={result['confidence']}"
    assert result["count"] == 10
    assert result["nested"]["value"] == 1.5
    print("  nested structures: OK")

    # Test PyTorch tensors (if available)
    if TORCH_AVAILABLE:
        tensor = torch.tensor([1.0, 2.0, 3.0])
        assert to_json_serializable(tensor) == [1.0, 2.0, 3.0]

        scalar_tensor = torch.tensor(0.5)
        assert to_json_serializable(scalar_tensor) == 0.5
        print("  PyTorch tensors: OK")
    else:
        print("  PyTorch tensors: SKIPPED (torch not installed)")

    # Test safe_json_dumps
    json_str = safe_json_dumps(nested)
    assert '"scores": [0.1, 0.2]' in json_str or '"scores":[0.1,0.2]' in json_str
    print("  safe_json_dumps: OK")

    print("\nAll self-tests passed!")
