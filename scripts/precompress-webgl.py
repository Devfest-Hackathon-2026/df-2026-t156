#!/usr/bin/env python3
"""Add gzip representations to a release stage, keeping Unity's original files intact."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sys


def prepare(directory):
    root = Path(directory).resolve(strict=True)
    build = root / "Build"
    if not build.is_dir():
        raise ValueError("Expected a Unity WebGL stage containing Build/")
    records = []
    for source in sorted(build.iterdir()):
        if not source.is_file() or not source.name.endswith((".wasm", ".data", ".framework.js")):
            continue
        if source.stat().st_size < 65536:
            continue
        target = source.with_name(source.name + ".gz")
        temporary = source.with_name(source.name + ".gz.tmp")
        try:
            with source.open("rb") as raw, temporary.open("wb") as output:
                with gzip.GzipFile(filename="", mode="wb", fileobj=output, compresslevel=9, mtime=0) as encoded:
                    shutil.copyfileobj(raw, encoded, length=1024 * 1024)
            raw_size, gzip_size = source.stat().st_size, temporary.stat().st_size
            if gzip_size >= raw_size * .95:
                temporary.unlink()
                if target.exists():
                    target.unlink()
                continue
            temporary.replace(target)
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            with gzip.open(target, "rb") as decoded:
                decoded_hash = hashlib.sha256(decoded.read()).hexdigest()
            if source_hash != decoded_hash:
                raise ValueError("Decoded gzip differs from its original: " + source.name)
            records.append({"file": source.name, "rawBytes": raw_size, "gzipBytes": gzip_size,
                            "savedPercent": round((1 - gzip_size / raw_size) * 100, 1), "sha256": source_hash})
        finally:
            if temporary.exists():
                temporary.unlink()
    return records


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: precompress-webgl.py RELEASE_STAGE")
    print(json.dumps(prepare(sys.argv[1]), ensure_ascii=False))
