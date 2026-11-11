"""Fetch pinned, hash-verified C++ headers into the ignored .deps directory."""
from pathlib import Path
import hashlib
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1_90_0"
SHA256 = "5e93d582aff26868d581a52ae78c7d8edf3f3064742c6e77901a1f18a437eea9"


def bootstrap():
    destination = ROOT / ".deps"
    marker = destination / f"boost_{VERSION}" / "boost" / "beast.hpp"
    if marker.exists():
        return marker.parent.parent
    destination.mkdir(exist_ok=True)
    archive = destination / f"boost_{VERSION}.tar.gz"
    if not archive.exists():
        print("Downloading pinned Boost headers...", flush=True)
        urllib.request.urlretrieve(f"https://archives.boost.io/release/1.90.0/source/{archive.name}", archive)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != SHA256:
        raise RuntimeError("Boost archive checksum mismatch; remove the archive and retry")
    with tarfile.open(archive) as source:
        prefix = f"boost_{VERSION}/boost/"
        members = [m for m in source.getmembers() if m.name.startswith(prefix) or m.name == f"boost_{VERSION}/LICENSE_1_0.txt"]
        source.extractall(destination, members=members, filter="data")
    return marker.parent.parent


if __name__ == "__main__":
    print(bootstrap())
