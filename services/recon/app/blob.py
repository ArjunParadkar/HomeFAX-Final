"""Uploading the finished model to Vercel Blob.

The keyframes are already in Blob — the phone put them there — so the worker
only ever pushes the GLB back. Using the REST endpoint directly avoids pulling
a Node SDK into a Python image.
"""

from __future__ import annotations

import os

import requests

BLOB_API = "https://blob.vercel-storage.com"


class BlobError(RuntimeError):
    pass


def configured() -> bool:
    return bool(os.environ.get("BLOB_READ_WRITE_TOKEN"))


def upload(pathname: str, data: bytes, content_type: str) -> str:
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if not token:
        raise BlobError("BLOB_READ_WRITE_TOKEN is not set on the worker.")

    res = requests.put(
        f"{BLOB_API}/{pathname.lstrip('/')}",
        data=data,
        headers={
            "authorization": f"Bearer {token}",
            "x-api-version": "7",
            "x-content-type": content_type,
            "x-add-random-suffix": "1",
            "x-cache-control-max-age": "31536000",
        },
        timeout=300,
    )
    if res.status_code >= 300:
        raise BlobError(f"Blob upload failed ({res.status_code}): {res.text[:300]}")
    body = res.json()
    url = body.get("url")
    if not url:
        raise BlobError("Blob accepted the upload but returned no URL.")
    return url
