#!/usr/bin/env python3
"""
The AAXorcist: Whisper transcription worker.

Runs inside the app-managed virtualenv (see src/main/transcribe.js) and uses
faster-whisper. It talks to the app with one JSON event per line on stdout,
each prefixed with "@@EVT ". Everything else (library warnings, model download
progress) goes to stderr.

Design notes
- The audio is split into blocks: one per chapter, and chapters longer than
  MAX_BLOCK_SEC are split further at the quietest nearby moment. Blocks keep
  Whisper from drifting over hours of narration, give natural resume points,
  and avoid cutting words in half.
- Each finished block is appended to a checkpoint file (--partial). If the run
  is cancelled or crashes, the same command picks up after the last block.
- A names/terms list is passed as Whisper hotwords, which stay active for the
  whole run (initial_prompt alone only affects the first 30 seconds of a block).
"""

import argparse
import hashlib
import inspect
import json
import os
import sys
import time

EVT = "@@EVT "
SR = 16000
MAX_BLOCK_SEC = 30 * 60        # split anything longer than this
TARGET_BLOCK_SEC = 20 * 60     # ...into pieces of roughly this length
SNAP_RADIUS_SEC = 20           # look this far either side for a quiet spot
MIN_BLOCK_SEC = 1.0            # ignore chapters shorter than this


def emit(**kw):
    sys.stdout.write(EVT + json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


def parse_args():
    p = argparse.ArgumentParser(description="AAXorcist Whisper worker")
    p.add_argument("--audio", help="raw 16 kHz mono s16le PCM (.pcm), or any audio file")
    p.add_argument("--model", default="large-v3")
    p.add_argument("--model-dir", required=True, help="where models are cached")
    p.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    p.add_argument("--compute-type", default="auto")
    p.add_argument("--language", default="en", help="ISO code, or 'auto'")
    p.add_argument("--beam-size", type=int, default=5)
    p.add_argument("--threads", type=int, default=0, help="CPU threads (0 = auto)")
    p.add_argument("--glossary", default="", help="names/terms to favour")
    p.add_argument("--carry-context", action="store_true",
                   help="feed each window the previous text (better punctuation, "
                        "but one mistake can propagate)")
    p.add_argument("--no-vad", action="store_true")
    p.add_argument("--chapters-json", help='JSON list of {"title","start","end"}')
    p.add_argument("--partial", help="checkpoint file (JSON lines)")
    p.add_argument("--out-json", help="where to write the final result")
    p.add_argument("--local-only", action="store_true",
                   help="never contact the network for the model")
    p.add_argument("--download-only", action="store_true",
                   help="download the model and exit")
    return p.parse_args()


# ── audio ────────────────────────────────────────────────────────────────────

def load_audio(path):
    """Float32 mono samples at 16 kHz.

    The app hands over raw PCM made by ffmpeg, so no audio library is needed.
    (faster-whisper's own decoder uses PyAV, and a fresh install can pull a PyAV
    release that faster-whisper does not support yet.) Anything else falls back
    to faster-whisper's decoder, for running this script by hand.
    """
    import numpy as np
    if path.lower().endswith(".pcm"):
        pcm = np.fromfile(path, dtype="<i2")
        return pcm.astype(np.float32) / 32768.0
    from faster_whisper import decode_audio
    return decode_audio(path, sampling_rate=SR)


# ── model ────────────────────────────────────────────────────────────────────

def resolve_device(device):
    if device != "auto":
        return device
    try:
        import ctranslate2
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass
    return "cpu"


def resolve_compute(device, compute):
    if compute == "auto":
        return "float16" if device == "cuda" else "int8"
    if device == "cpu" and compute in ("float16", "int8_float16"):
        log("[worker] %s is not supported on CPU, using float32 instead" % compute)
        return "float32"
    return compute


def default_threads():
    n = os.cpu_count() or 8
    # CTranslate2 defaults to 4 threads, which leaves most CPUs idle.
    return max(4, min(24, n // 2 if n >= 16 else n))


def download_model(args):
    from faster_whisper.utils import download_model as dl
    log("[worker] downloading model %s into %s" % (args.model, args.model_dir))
    path = dl(args.model, cache_dir=args.model_dir)
    emit(event="model_ready", model=args.model, path=str(path))


def load_model(args):
    from faster_whisper import WhisperModel
    device = resolve_device(args.device)
    compute = resolve_compute(device, args.compute_type)
    threads = args.threads or default_threads()
    log("[worker] loading %s on %s (%s, %d threads)" % (args.model, device, compute, threads))
    emit(event="loading", model=args.model, device=device, compute_type=compute)
    kw = dict(device=device, compute_type=compute, download_root=args.model_dir,
              local_files_only=args.local_only)
    if device == "cpu":
        kw["cpu_threads"] = threads
    model = WhisperModel(args.model, **kw)
    return model, device, compute


# ── blocks ───────────────────────────────────────────────────────────────────

def snap_to_quiet(audio, t, total, radius=SNAP_RADIUS_SEC, win=0.4):
    """Return the time near t with the lowest short-term energy."""
    import numpy as np
    lo = max(0.0, t - radius)
    hi = min(total, t + radius)
    a, b = int(lo * SR), int(hi * SR)
    seg = audio[a:b]
    step = int(0.1 * SR)
    w = int(win * SR)
    if len(seg) < w + step:
        return t
    n = (len(seg) - w) // step
    best_i, best_e = 0, None
    for i in range(n):
        chunk = seg[i * step: i * step + w]
        e = float(np.mean(chunk * chunk))
        if best_e is None or e < best_e:
            best_e, best_i = e, i
    return lo + (best_i * step + w / 2) / SR


def chapter_spans(chapters, total):
    """Contiguous (index, title, start, end) spans covering the whole audio."""
    spans = []
    clean = []
    for c in chapters or []:
        try:
            s = float(c.get("start", 0))
        except (TypeError, ValueError):
            continue
        clean.append({"title": (c.get("title") or "").strip(), "start": max(0.0, min(s, total))})
    clean.sort(key=lambda c: c["start"])
    if not clean:
        return [(0, "", 0.0, total)]
    if clean[0]["start"] > 5.0:
        clean.insert(0, {"title": "Opening", "start": 0.0})
    else:
        clean[0]["start"] = 0.0
    for i, c in enumerate(clean):
        end = clean[i + 1]["start"] if i + 1 < len(clean) else total
        spans.append((i, c["title"], c["start"], end))
    return spans


def build_blocks(audio, total, chapters):
    """Split chapters into blocks of at most MAX_BLOCK_SEC."""
    blocks = []
    for idx, title, start, end in chapter_spans(chapters, total):
        if end - start < MIN_BLOCK_SEC:
            continue
        if end - start <= MAX_BLOCK_SEC:
            blocks.append({"chapter": idx, "start": start, "end": end})
            continue
        cur = start
        while end - cur > MAX_BLOCK_SEC:
            cut = snap_to_quiet(audio, cur + TARGET_BLOCK_SEC, total)
            cut = max(cur + 60.0, min(cut, end - 60.0))
            blocks.append({"chapter": idx, "start": cur, "end": cut})
            cur = cut
        blocks.append({"chapter": idx, "start": cur, "end": end})
    return blocks


# ── checkpoint ───────────────────────────────────────────────────────────────

def signature(args, total, n_chapters, glossary):
    raw = json.dumps({
        "dur": round(total, 1), "chapters": n_chapters, "model": args.model,
        "language": args.language, "glossary": glossary, "carry": args.carry_context,
        "vad": not args.no_vad, "beam": args.beam_size,
    }, sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()


def load_partial(path, sig):
    done = {}
    if not path or not os.path.exists(path):
        return done
    try:
        with open(path, encoding="utf-8") as f:
            lines = [json.loads(l) for l in f if l.strip()]
        if not lines or lines[0].get("type") != "header" or lines[0].get("sig") != sig:
            return {}
        for rec in lines[1:]:
            if rec.get("type") == "block":
                done[rec["i"]] = rec["segments"]
    except Exception as e:  # corrupt checkpoint: start over
        log("[worker] ignoring unreadable checkpoint: %s" % e)
        return {}
    return done


def start_partial(path, sig, done):
    if not path:
        return None
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    f = open(path, "w", encoding="utf-8")
    f.write(json.dumps({"type": "header", "sig": sig}) + "\n")
    for i in sorted(done):
        f.write(json.dumps({"type": "block", "i": i, "segments": done[i]}, ensure_ascii=False) + "\n")
    f.flush()
    return f


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()

    if args.download_only:
        download_model(args)
        return 0

    if not args.audio or not args.out_json:
        log("--audio and --out-json are required")
        return 2

    t0 = time.time()
    model, device, compute = load_model(args)

    emit(event="decoding")
    audio = load_audio(args.audio)
    total = len(audio) / SR
    if total < 1.0:
        raise RuntimeError("The audio is empty or too short to transcribe.")

    chapters = []
    if args.chapters_json and os.path.exists(args.chapters_json):
        with open(args.chapters_json, encoding="utf-8") as f:
            chapters = json.load(f)
    spans = chapter_spans(chapters, total)
    blocks = build_blocks(audio, total, chapters)

    glossary = " ".join(args.glossary.split())
    sig = signature(args, total, len(spans), glossary)
    done = load_partial(args.partial, sig)
    pf = start_partial(args.partial, sig, done)
    if done:
        log("[worker] resuming: %d of %d blocks already done" % (len(done), len(blocks)))

    params = inspect.signature(model.transcribe).parameters
    kwargs = dict(
        language=None if args.language == "auto" else args.language,
        beam_size=args.beam_size,
        temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
        compression_ratio_threshold=2.4,
        log_prob_threshold=-1.0,
        no_speech_threshold=0.6,
        condition_on_previous_text=args.carry_context,
        vad_filter=not args.no_vad,
        vad_parameters=dict(min_silence_duration_ms=500),
    )
    if glossary:
        kwargs["initial_prompt"] = glossary
        if "hotwords" in params:
            kwargs["hotwords"] = glossary
        else:
            log("[worker] this faster-whisper has no hotwords option; glossary only "
                "applies to the start of each block. Upgrade faster-whisper.")

    emit(event="start", duration=total, blocks=len(blocks), chapters=len(spans),
         resumed=len(done), device=device, compute_type=compute)

    detected_language = None
    audio_done_this_run = 0.0
    run_t0 = time.time()
    last_emit = 0.0
    last_text = None
    repeats = 0

    # audio already covered by resumed blocks
    base_done = sum(b["end"] - b["start"] for i, b in enumerate(blocks) if i in done)

    for bi, b in enumerate(blocks):
        if bi in done:
            continue
        clip = audio[int(b["start"] * SR): int(b["end"] * SR)]
        seg_iter, info = model.transcribe(clip, **kwargs)
        if detected_language is None:
            detected_language = info.language
        segs = []
        for seg in seg_iter:
            text = seg.text.strip()
            if not text:
                continue
            norm = text.lower()
            if norm == last_text:
                repeats += 1
                if repeats >= 2:      # third identical line in a row: a loop
                    continue
            else:
                repeats = 0
            last_text = norm
            segs.append({
                "start": round(b["start"] + seg.start, 2),
                "end": round(b["start"] + seg.end, 2),
                "text": text,
            })
            now = time.time()
            if now - last_emit >= 0.5:
                last_emit = now
                covered = base_done + audio_done_this_run + seg.end
                wall = now - run_t0
                rate = (audio_done_this_run + seg.end) / wall if wall > 0 else 0
                remaining = max(0.0, total - covered)
                emit(event="progress", pct=round(min(99.9, covered / total * 100), 1),
                     block=bi + 1, blocks=len(blocks), chapter=b["chapter"] + 1,
                     chapters=len(spans), heard=text[:160],
                     rate=round(rate, 2), eta=round(remaining / rate) if rate > 0 else None)
        audio_done_this_run += b["end"] - b["start"]
        done[bi] = segs
        covered = base_done + audio_done_this_run
        wall = time.time() - run_t0
        rate = audio_done_this_run / wall if wall > 0 else 0
        emit(event="progress", pct=round(min(99.9, covered / total * 100), 1),
             block=bi + 1, blocks=len(blocks), chapter=b["chapter"] + 1,
             chapters=len(spans), heard=None, rate=round(rate, 2),
             eta=round(max(0.0, total - covered) / rate) if rate > 0 else None)
        if pf:
            pf.write(json.dumps({"type": "block", "i": bi, "segments": segs},
                                ensure_ascii=False) + "\n")
            pf.flush()
            os.fsync(pf.fileno())

    if pf:
        pf.close()

    by_chapter = {i: [] for i, _, _, _ in spans}
    for bi, b in enumerate(blocks):
        by_chapter[b["chapter"]].extend(done.get(bi, []))

    result = {
        "model": args.model,
        "language": detected_language or ("en" if args.language == "auto" else args.language),
        "duration": round(total, 2),
        "chapters": [
            {"index": i, "title": title, "start": round(s, 2), "end": round(e, 2),
             "segments": by_chapter[i]}
            for i, title, s, e in spans
        ],
    }
    tmp = args.out_json + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    os.replace(tmp, args.out_json)

    n = sum(len(c["segments"]) for c in result["chapters"])
    emit(event="done", segments=n, duration=total, elapsed=round(time.time() - t0, 1))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as exc:  # report to the app, then fail
        import traceback
        traceback.print_exc(file=sys.stderr)
        emit(event="error", message=str(exc))
        sys.exit(1)
