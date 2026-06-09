#!/usr/bin/env python3
"""
parse_cv.py — zero-LLM document → Markdown sidecar for CareerOS.

A thin wrapper over Microsoft markitdown (https://github.com/microsoft/markitdown)
that turns an uploaded CV / cover letter (PDF, Word, RTF, HTML, PPTX, …) into
clean Markdown deterministically, so the onboard flow no longer depends on the
agent eyeballing a binary file. It reads a JSON config from --config <file> or
stdin: { "path": "<file>" }, and prints the extracted Markdown on stdout.

Design rules (match scripts/jobspy_fetch.py):
  • stdout carries ONLY the extracted text — clean, captured by the Node wrapper.
  • stderr carries diagnostics as JSON ({"chars": N} on success, {"fatal": ...}
    with an install hint on failure), so Node can surface them without corrupting
    the text stream.
  • this file NEVER writes under data/ — the Node side / agent owns persistence.
  • it never fabricates content; on failure it prints nothing to stdout and a
    fatal on stderr.
"""
import sys
import json
import argparse


def eprint(obj):
    sys.stderr.write(json.dumps(obj) + "\n")
    sys.stderr.flush()


def main():
    ap = argparse.ArgumentParser(description="CareerOS markitdown CV parser sidecar")
    ap.add_argument("--config", help="path to a JSON config file; omit to read stdin")
    args = ap.parse_args()

    try:
        raw = open(args.config, "r", encoding="utf-8").read() if args.config else sys.stdin.read()
        cfg = json.loads(raw) if raw.strip() else {}
    except Exception as e:
        eprint({"fatal": "could not read/parse config", "detail": str(e)})
        return 1

    path = (cfg.get("path") or "").strip()
    if not path:
        eprint({"fatal": "no input path", "hint": "pass {\"path\": \"<file>\"}"})
        return 1

    try:
        from markitdown import MarkItDown
    except Exception as e:
        eprint({
            "fatal": "markitdown not installed",
            "detail": str(e),
            "hint": "run: npm run jobspy:install   (installs markitdown into ./.venv)",
        })
        return 1

    try:
        md = MarkItDown()
        result = md.convert(path)
        text = result.text_content or ""
    except Exception as e:
        eprint({"fatal": "markitdown failed to convert the file", "detail": str(e)[:300]})
        return 1

    eprint({"chars": len(text)})
    sys.stdout.write(text)
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
