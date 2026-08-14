import pytest

from src.video_reference_recorder import safe_filename, validate_recording_request


def test_validate_recording_request_normalizes_sign_name() -> None:
    gloss, duration = validate_recording_request("  buenos   días ", 1.2)

    assert gloss == "BUENOS DÍAS"
    assert duration == 1.2


@pytest.mark.parametrize("duration", [0.4, 15.1])
def test_validate_recording_request_rejects_invalid_duration(duration: float) -> None:
    with pytest.raises(ValueError):
        validate_recording_request("HOLA", duration)


def test_safe_filename_removes_unsupported_characters() -> None:
    assert safe_filename("Buenos días") == "BUENOS_D_AS"
