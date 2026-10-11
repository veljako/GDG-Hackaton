"""Read bounded JSON from streaming responses before allocating/decoding it."""
import json


def read_json_response(response, max_bytes: int = 1_048_576):
    length = response.headers.get("Content-Length")
    if isinstance(length, str) and length.isdigit() and int(length) > max_bytes:
        raise ValueError("Service response exceeds the supported size.")
    body = bytearray()
    for chunk in response.iter_content(chunk_size=16_384):
        if not isinstance(chunk, bytes):
            raise ValueError("Service response is not valid JSON bytes.")
        if len(body) + len(chunk) > max_bytes:
            raise ValueError("Service response exceeds the supported size.")
        body.extend(chunk)
    return json.loads(body.decode("utf-8"))
