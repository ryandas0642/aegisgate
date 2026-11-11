"""Build with pinned Boost, or explicitly supplied BOOST_ROOT headers."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
from bootstrap_proxy import bootstrap

ROOT = Path(__file__).resolve().parents[1]


def build():
    custom_boost = os.environ.get("BOOST_ROOT")
    boost = Path(custom_boost) if custom_boost else bootstrap()
    if not (boost / "boost" / "beast.hpp").exists() or not (boost / "boost" / "json" / "src.hpp").exists():
        raise RuntimeError("BOOST_ROOT must provide both Beast and Boost.JSON implementation headers")
    compiler = os.environ.get("CXX") or shutil.which("g++")
    if not compiler:
        raise RuntimeError("Install a C++20 g++ compiler and put it on PATH")
    output = ROOT / "build"
    output.mkdir(exist_ok=True)
    suffix = ".exe" if os.name == "nt" else ""
    flags = [compiler, "-std=c++20", "-O1", "-g0", "-Wall", "-Wextra", "-Wpedantic", "-DBOOST_ERROR_CODE_HEADER_ONLY", "-I" + str(ROOT / "proxy/include"), "-I" + str(boost)]
    libraries = ["-lws2_32", "-lmswsock"] if os.name == "nt" else ["-pthread"]
    if os.name == "nt":
        os.environ["PATH"] = str(Path(compiler).parent) + os.pathsep + os.environ["PATH"]
    if "--core" in sys.argv:
        sources = [ROOT / "proxy/src/ip.cpp", ROOT / "proxy/src/cidr.cpp", ROOT / "proxy/tests/core.cpp"]
        target = output / ("core-tests" + suffix)
    else:
        sources = sorted((ROOT / "proxy/src").glob("*.cpp"))
        target = output / ("aegis-proxy" + suffix)
    subprocess.run(flags + list(map(str, sources)) + libraries + ["-o", str(target)], check=True, cwd=ROOT)
    if "--core" in sys.argv:
        subprocess.run([str(target)], check=True, cwd=ROOT)
    print(target, flush=True)


if __name__ == "__main__":
    build()
