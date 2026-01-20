#!/usr/bin/env python3
"""
test_json_serialization_utils.py - Unit tests for JSON serialization utilities

Tests the json_serialization_utils module which handles conversion of:
- numpy scalar types (float32, float64, int32, int64, bool_)
- numpy arrays
- PyTorch tensors
- Special float values (NaN, Infinity)
- Nested data structures

These tests use sample pyannote.audio-like output to verify that
speaker diarization data can be correctly serialized to JSON.
"""

import json
import math
import sys
import unittest
import warnings
from io import StringIO

import numpy as np

# Import the module under test
from json_serialization_utils import (
    to_json_serializable,
    NumpyTorchJSONEncoder,
    safe_json_dumps,
    safe_output_json,
    _handle_special_float,
    TORCH_AVAILABLE
)

# Try to import PyTorch for optional tests
try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


class TestHandleSpecialFloat(unittest.TestCase):
    """Tests for the _handle_special_float helper function."""

    def test_normal_float_unchanged(self):
        """Normal float values should pass through unchanged."""
        self.assertEqual(_handle_special_float(0.5, warn=False), 0.5)
        self.assertEqual(_handle_special_float(-1.5, warn=False), -1.5)
        self.assertEqual(_handle_special_float(0.0, warn=False), 0.0)

    def test_nan_converts_to_none(self):
        """NaN values should convert to None (JSON null)."""
        result = _handle_special_float(float('nan'), warn=False)
        self.assertIsNone(result)

    def test_positive_infinity_converts_to_max_float(self):
        """Positive infinity should convert to max float."""
        result = _handle_special_float(float('inf'), warn=False)
        self.assertEqual(result, sys.float_info.max)

    def test_negative_infinity_converts_to_min_float(self):
        """Negative infinity should convert to negative max float."""
        result = _handle_special_float(float('-inf'), warn=False)
        self.assertEqual(result, -sys.float_info.max)

    def test_warnings_emitted_for_special_values(self):
        """Warnings should be emitted when warn=True."""
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("always")
            _handle_special_float(float('nan'), warn=True)
            self.assertEqual(len(w), 1)
            self.assertIn("NaN", str(w[0].message))


class TestNumpyScalarConversion(unittest.TestCase):
    """Tests for numpy scalar type conversion."""

    def test_float32_conversion(self):
        """numpy.float32 should convert to Python float."""
        value = np.float32(0.5)
        result = to_json_serializable(value)
        self.assertIsInstance(result, float)
        self.assertEqual(result, 0.5)

    def test_float64_conversion(self):
        """numpy.float64 should convert to Python float."""
        value = np.float64(0.123456789)
        result = to_json_serializable(value)
        self.assertIsInstance(result, float)
        self.assertAlmostEqual(result, 0.123456789)

    def test_int32_conversion(self):
        """numpy.int32 should convert to Python int."""
        value = np.int32(42)
        result = to_json_serializable(value)
        self.assertIsInstance(result, int)
        self.assertEqual(result, 42)

    def test_int64_conversion(self):
        """numpy.int64 should convert to Python int."""
        value = np.int64(-1000000)
        result = to_json_serializable(value)
        self.assertIsInstance(result, int)
        self.assertEqual(result, -1000000)

    def test_bool_conversion(self):
        """numpy.bool_ should convert to Python bool."""
        true_value = np.bool_(True)
        false_value = np.bool_(False)
        self.assertIsInstance(to_json_serializable(true_value), bool)
        self.assertIsInstance(to_json_serializable(false_value), bool)
        self.assertTrue(to_json_serializable(true_value))
        self.assertFalse(to_json_serializable(false_value))


class TestNumpyArrayConversion(unittest.TestCase):
    """Tests for numpy array conversion."""

    def test_1d_array_conversion(self):
        """1D numpy arrays should convert to Python lists."""
        arr = np.array([1, 2, 3])
        result = to_json_serializable(arr)
        self.assertEqual(result, [1, 2, 3])

    def test_float_array_conversion(self):
        """Float arrays should convert to lists of floats."""
        arr = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        result = to_json_serializable(arr)
        # Note: float32 has limited precision, compare with tolerance
        self.assertEqual(len(result), 3)
        self.assertAlmostEqual(result[0], 0.1, places=5)
        self.assertAlmostEqual(result[1], 0.2, places=5)
        self.assertAlmostEqual(result[2], 0.3, places=5)

    def test_2d_array_conversion(self):
        """2D numpy arrays should convert to nested lists."""
        arr = np.array([[1, 2], [3, 4]])
        result = to_json_serializable(arr)
        self.assertEqual(result, [[1, 2], [3, 4]])

    def test_array_with_special_floats(self):
        """Arrays with NaN/Inf should have those values converted."""
        arr = np.array([1.0, float('nan'), float('inf')])
        result = to_json_serializable(arr, warn_special_floats=False)
        self.assertEqual(result[0], 1.0)
        self.assertIsNone(result[1])
        self.assertEqual(result[2], sys.float_info.max)


class TestNestedStructureConversion(unittest.TestCase):
    """Tests for nested data structure conversion."""

    def test_dict_with_numpy_values(self):
        """Dictionaries with numpy values should be fully converted."""
        data = {
            "score": np.float32(0.95),
            "count": np.int64(10),
            "active": np.bool_(True)
        }
        result = to_json_serializable(data)
        # Note: float32 has limited precision, so we use assertAlmostEqual
        self.assertAlmostEqual(result["score"], 0.95, places=5)
        self.assertEqual(result["count"], 10)
        self.assertTrue(result["active"])
        # Verify JSON-serializable
        json.dumps(result)  # Should not raise

    def test_nested_dict_conversion(self):
        """Nested dictionaries should be recursively converted."""
        data = {
            "speaker": {
                "id": np.int32(1),
                "confidence": np.float64(0.92)
            },
            "timestamps": {
                "start": np.float32(1.5),
                "end": np.float32(3.2)
            }
        }
        result = to_json_serializable(data)
        self.assertEqual(result["speaker"]["id"], 1)
        self.assertAlmostEqual(result["speaker"]["confidence"], 0.92)
        json.dumps(result)  # Should not raise

    def test_list_with_numpy_values(self):
        """Lists with numpy values should be converted."""
        data = [np.float32(0.1), np.float32(0.2), np.float32(0.3)]
        result = to_json_serializable(data)
        # Note: float32 has limited precision, compare with tolerance
        self.assertEqual(len(result), 3)
        self.assertAlmostEqual(result[0], 0.1, places=5)
        self.assertAlmostEqual(result[1], 0.2, places=5)
        self.assertAlmostEqual(result[2], 0.3, places=5)

    def test_complex_nested_structure(self):
        """Complex nested structures should be fully converted."""
        data = {
            "segments": [
                {
                    "speaker": "Speaker_0",
                    "start": np.float32(0.0),
                    "end": np.float32(2.5),
                    "confidence": np.float64(0.95),
                    "words": np.array([0.0, 0.5, 1.0, 1.5, 2.0])
                },
                {
                    "speaker": "Speaker_1",
                    "start": np.float32(2.5),
                    "end": np.float32(5.0),
                    "confidence": np.float64(0.88),
                    "words": np.array([2.5, 3.0, 3.5, 4.0, 4.5])
                }
            ],
            "num_speakers": np.int32(2),
            "total_duration": np.float64(5.0)
        }
        result = to_json_serializable(data)

        # Verify structure
        self.assertEqual(len(result["segments"]), 2)
        self.assertEqual(result["num_speakers"], 2)
        self.assertEqual(result["total_duration"], 5.0)

        # Verify first segment
        seg0 = result["segments"][0]
        self.assertEqual(seg0["speaker"], "Speaker_0")
        self.assertEqual(seg0["start"], 0.0)
        self.assertEqual(seg0["end"], 2.5)
        self.assertEqual(seg0["words"], [0.0, 0.5, 1.0, 1.5, 2.0])

        # Verify JSON-serializable
        json_str = json.dumps(result)
        self.assertIn("Speaker_0", json_str)


class TestPyannoteOutputSimulation(unittest.TestCase):
    """Tests using simulated pyannote.audio output structures."""

    def test_speaker_segment_output(self):
        """Test conversion of speaker segment as would come from pyannote."""
        # Simulated pyannote speaker segment output
        segment = {
            "type": "speaker_segment",
            "speaker": "SPEAKER_00",
            "start": np.float32(10.245),
            "end": np.float32(15.789),
            "confidence": np.float64(0.9234567)
        }
        result = to_json_serializable(segment)

        self.assertEqual(result["type"], "speaker_segment")
        self.assertEqual(result["speaker"], "SPEAKER_00")
        self.assertIsInstance(result["start"], float)
        self.assertIsInstance(result["end"], float)
        self.assertIsInstance(result["confidence"], float)

        # Verify JSON serialization
        json_str = json.dumps(result)
        parsed = json.loads(json_str)
        self.assertAlmostEqual(parsed["start"], 10.245, places=2)

    def test_diarization_stats_output(self):
        """Test conversion of diarization statistics output."""
        stats = {
            "num_speakers": np.int32(3),
            "total_duration": np.float64(300.5),
            "speaker_stats": {
                "Speaker_0": {
                    "duration": np.float64(120.3),
                    "segments": np.int32(15),
                    "percentage": np.float64(40.0)
                },
                "Speaker_1": {
                    "duration": np.float64(100.2),
                    "segments": np.int32(12),
                    "percentage": np.float64(33.3)
                },
                "Speaker_2": {
                    "duration": np.float64(80.0),
                    "segments": np.int32(10),
                    "percentage": np.float64(26.7)
                }
            }
        }
        result = to_json_serializable(stats)

        self.assertEqual(result["num_speakers"], 3)
        self.assertEqual(result["speaker_stats"]["Speaker_0"]["segments"], 15)

        # Verify JSON serialization
        json.dumps(result)  # Should not raise

    def test_embedding_output(self):
        """Test conversion of speaker embedding arrays."""
        # Simulated embedding output (typically 192 or 256 dimensions)
        embedding = {
            "speaker_id": "Speaker_0",
            "embedding": np.random.randn(192).astype(np.float32),
            "norm": np.float32(1.0)
        }
        result = to_json_serializable(embedding)

        self.assertEqual(len(result["embedding"]), 192)
        self.assertIsInstance(result["embedding"][0], float)

        # Verify JSON serialization
        json.dumps(result)


@unittest.skipUnless(HAS_TORCH, "PyTorch not installed")
class TestPyTorchTensorConversion(unittest.TestCase):
    """Tests for PyTorch tensor conversion (requires torch)."""

    def test_scalar_tensor_conversion(self):
        """Scalar PyTorch tensors should convert to Python floats."""
        tensor = torch.tensor(0.5)
        result = to_json_serializable(tensor)
        self.assertIsInstance(result, float)
        self.assertEqual(result, 0.5)

    def test_1d_tensor_conversion(self):
        """1D PyTorch tensors should convert to Python lists."""
        tensor = torch.tensor([1.0, 2.0, 3.0])
        result = to_json_serializable(tensor)
        self.assertEqual(result, [1.0, 2.0, 3.0])

    def test_2d_tensor_conversion(self):
        """2D PyTorch tensors should convert to nested lists."""
        tensor = torch.tensor([[1, 2], [3, 4]])
        result = to_json_serializable(tensor)
        self.assertEqual(result, [[1, 2], [3, 4]])

    def test_gpu_tensor_conversion(self):
        """GPU tensors should be moved to CPU and converted."""
        if not torch.cuda.is_available():
            self.skipTest("CUDA not available")
        tensor = torch.tensor([1.0, 2.0]).cuda()
        result = to_json_serializable(tensor)
        self.assertEqual(result, [1.0, 2.0])

    def test_dict_with_tensor_values(self):
        """Dictionaries with tensor values should be converted."""
        data = {
            "embedding": torch.randn(10),
            "score": torch.tensor(0.95),
            "name": "test"
        }
        result = to_json_serializable(data)
        self.assertEqual(len(result["embedding"]), 10)
        self.assertIsInstance(result["score"], float)
        self.assertEqual(result["name"], "test")
        json.dumps(result)  # Should not raise


class TestNumpyTorchJSONEncoder(unittest.TestCase):
    """Tests for the custom JSON encoder class."""

    def test_encoder_with_numpy_float(self):
        """Encoder should handle numpy floats."""
        data = {"value": np.float32(0.5)}
        result = json.dumps(data, cls=NumpyTorchJSONEncoder)
        parsed = json.loads(result)
        self.assertEqual(parsed["value"], 0.5)

    def test_encoder_with_numpy_array(self):
        """Encoder should handle numpy arrays."""
        data = {"values": np.array([1, 2, 3])}
        result = json.dumps(data, cls=NumpyTorchJSONEncoder)
        parsed = json.loads(result)
        self.assertEqual(parsed["values"], [1, 2, 3])

    def test_encoder_with_special_floats(self):
        """Encoder should handle NaN and Infinity."""
        data = {"nan": float('nan'), "inf": float('inf')}
        result = json.dumps(data, cls=NumpyTorchJSONEncoder)
        parsed = json.loads(result)
        self.assertIsNone(parsed["nan"])
        self.assertEqual(parsed["inf"], sys.float_info.max)


class TestSafeJsonDumps(unittest.TestCase):
    """Tests for the safe_json_dumps function."""

    def test_basic_serialization(self):
        """Basic objects should serialize correctly."""
        data = {"key": "value", "number": 42}
        result = safe_json_dumps(data)
        parsed = json.loads(result)
        self.assertEqual(parsed, data)

    def test_numpy_serialization(self):
        """Numpy types should serialize correctly."""
        data = {"score": np.float32(0.5), "count": np.int64(10)}
        result = safe_json_dumps(data)
        parsed = json.loads(result)
        self.assertEqual(parsed["score"], 0.5)
        self.assertEqual(parsed["count"], 10)

    def test_error_recovery(self):
        """Function should attempt recovery on serialization errors."""
        # Create a complex nested structure
        data = {
            "nested": {
                "value": np.float32(0.5),
                "array": np.array([1, 2, 3])
            }
        }
        result = safe_json_dumps(data)
        parsed = json.loads(result)
        self.assertEqual(parsed["nested"]["value"], 0.5)


class TestNativeTypePreservation(unittest.TestCase):
    """Tests that native Python types are preserved."""

    def test_string_preserved(self):
        """Strings should pass through unchanged."""
        self.assertEqual(to_json_serializable("hello"), "hello")

    def test_int_preserved(self):
        """Python ints should pass through unchanged."""
        self.assertEqual(to_json_serializable(42), 42)

    def test_float_preserved(self):
        """Python floats should pass through unchanged (unless special)."""
        self.assertEqual(to_json_serializable(3.14), 3.14)

    def test_bool_preserved(self):
        """Python bools should pass through unchanged."""
        self.assertTrue(to_json_serializable(True))
        self.assertFalse(to_json_serializable(False))

    def test_none_preserved(self):
        """None should pass through unchanged."""
        self.assertIsNone(to_json_serializable(None))


class TestEdgeCases(unittest.TestCase):
    """Tests for edge cases and error handling."""

    def test_empty_dict(self):
        """Empty dictionaries should be handled."""
        self.assertEqual(to_json_serializable({}), {})

    def test_empty_list(self):
        """Empty lists should be handled."""
        self.assertEqual(to_json_serializable([]), [])

    def test_empty_array(self):
        """Empty numpy arrays should be handled."""
        arr = np.array([])
        self.assertEqual(to_json_serializable(arr), [])

    def test_tuple_conversion(self):
        """Tuples should be converted to lists."""
        data = (np.float32(1), np.float32(2))
        result = to_json_serializable(data)
        self.assertEqual(result, [1.0, 2.0])

    def test_set_conversion(self):
        """Sets should be converted to lists."""
        data = {np.int32(1), np.int32(2), np.int32(3)}
        result = to_json_serializable(data)
        self.assertEqual(sorted(result), [1, 2, 3])

    def test_bytes_conversion(self):
        """Bytes should be decoded to strings."""
        data = b"hello"
        result = to_json_serializable(data)
        self.assertEqual(result, "hello")

    def test_unknown_type_string_fallback(self):
        """Unknown types should be converted to strings."""

        class CustomClass:
            def __str__(self):
                return "custom_value"

        obj = CustomClass()
        result = to_json_serializable(obj)
        self.assertEqual(result, "custom_value")


class TestIntegration(unittest.TestCase):
    """Integration tests simulating real usage scenarios."""

    def test_full_transcription_segment(self):
        """Test a complete transcription segment with speaker."""
        segment = {
            "type": "segment",
            "text": "Hello, how are you?",
            "start": np.float32(0.0),
            "end": np.float32(2.5),
            "confidence": np.float64(0.95),
            "speaker": "Speaker_0",
            "speaker_confidence": np.float32(0.88),
            "words": [
                {"word": "Hello", "start": np.float32(0.0), "end": np.float32(0.5), "score": np.float32(0.96)},
                {"word": "how", "start": np.float32(0.6), "end": np.float32(0.9), "score": np.float32(0.94)},
                {"word": "are", "start": np.float32(1.0), "end": np.float32(1.3), "score": np.float32(0.95)},
                {"word": "you", "start": np.float32(1.4), "end": np.float32(1.7), "score": np.float32(0.93)}
            ]
        }

        result = to_json_serializable(segment)

        # Verify all fields
        self.assertEqual(result["type"], "segment")
        self.assertEqual(result["text"], "Hello, how are you?")
        self.assertIsInstance(result["start"], float)
        self.assertIsInstance(result["end"], float)
        self.assertEqual(result["speaker"], "Speaker_0")
        self.assertEqual(len(result["words"]), 4)
        self.assertIsInstance(result["words"][0]["score"], float)

        # Verify complete JSON serialization
        json_str = json.dumps(result)
        parsed = json.loads(json_str)
        self.assertEqual(parsed["type"], "segment")

    def test_diarization_complete_output(self):
        """Test complete diarization output structure."""
        output = {
            "type": "complete",
            "total_duration": np.float64(300.5),
            "num_speakers": np.int32(3),
            "speaker_stats": {
                "Speaker_0": {
                    "duration": np.float64(120.3),
                    "segments": np.int32(15),
                    "percentage": np.float64(40.0)
                }
            },
            "segments": [
                {
                    "speaker": "Speaker_0",
                    "start": np.float32(0.0),
                    "end": np.float32(10.5),
                    "confidence": np.float64(0.92)
                }
            ]
        }

        json_str = safe_json_dumps(output)
        parsed = json.loads(json_str)

        self.assertEqual(parsed["type"], "complete")
        self.assertEqual(parsed["num_speakers"], 3)
        self.assertIn("Speaker_0", parsed["speaker_stats"])


if __name__ == "__main__":
    # Run tests with verbosity
    unittest.main(verbosity=2)
