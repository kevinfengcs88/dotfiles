#!/usr/bin/env python3
"""Claude Code Playtime Tracker — RuneScape-style "hours played".

Counts wall-clock time you have Claude Code open, AFK included, measured as the
UNION of all open intervals (never a sum). Five CLIs idling for 24h = 24h.

Layers:
  * Hooks      — SessionStart opens an interval, SessionEnd finalizes it.
  * Backfill   — reconstructs history from ~/.claude/history.jsonl (idempotent),
                 so a late dotfiles install on a new machine still catches up.
  * Union      — merges every interval (all machines, all sessions, live ones)
                 and measures the union.

Storage:
  * <script_dir>/data/sessions-<host>.jsonl  — synced via dotfiles, append-only.
  * ~/.claude/playtime/{open,heartbeats}/    — local, ephemeral runtime state.
  * ~/.claude/playtime/total.cache           — short string for the statusline.

Subcommands:
  report (default) | --by-day [N] | --by-week [N]
  session-start | session-end | sweep | backfill | refresh-cache
Hook entry points read Claude Code's hook JSON on stdin (session_id, cwd).
"""

import sys
import os
import json
import glob
import time
import socket
import datetime as dt

# --- Paths -------------------------------------------------------------------

SCRIPT_DIR = os.path.dirname(os.path.realpath(__file__))
# PLAYTIME_DATA_DIR lets you point at a custom synced location (or isolate tests).
DATA_DIR = os.environ.get("PLAYTIME_DATA_DIR", os.path.join(SCRIPT_DIR, "data"))
HOME = os.path.expanduser("~")
LOCAL_DIR = os.environ.get(
    "PLAYTIME_LOCAL_DIR", os.path.join(HOME, ".claude", "playtime"))
OPEN_DIR = os.path.join(LOCAL_DIR, "open")
HB_DIR = os.path.join(LOCAL_DIR, "heartbeats")
CACHE_FILE = os.path.join(LOCAL_DIR, "total.cache")
HISTORY_FILE = os.path.join(HOME, ".claude", "history.jsonl")

HOST = socket.gethostname()

# --- Tunables ----------------------------------------------------------------

# A live (open) session is counted up to "now" only if it's been seen recently;
# otherwise it's bounded by its last heartbeat (guards against crashed sessions
# left in open/ inflating the total before the next sweep).
LIVE_FRESH_SEC = 180

# In sweep, an open marker whose last heartbeat is older than this is treated as
# dangling (crashed terminal, no SessionEnd) and finalized at that heartbeat.
SWEEP_STALE_SEC = 1800

# Backfill only — history.jsonl has prompt timestamps, not open/close events, so
# we can't know if the app stayed open during a long gap (real AFK) or was
# closed (you were asleep). We split a session into activity bursts wherever two
# consecutive prompts are more than BACKFILL_GAP_SEC apart, and pad each burst by
# BACKFILL_PAD_SEC to credit reading time / a lone prompt. Forward hook tracking
# is exact and ignores these. Tune BACKFILL_GAP_SEC up if you want big AFK gaps
# counted as playtime.
BACKFILL_GAP_SEC = 1800
BACKFILL_PAD_SEC = 300


def now() -> int:
    return int(time.time())


def ensure_dirs():
    for d in (DATA_DIR, LOCAL_DIR, OPEN_DIR, HB_DIR):
        os.makedirs(d, exist_ok=True)


# --- Interval IO -------------------------------------------------------------

def host_log(host: str = None) -> str:
    return os.path.join(DATA_DIR, f"sessions-{host or HOST}.jsonl")


def append_interval(start, end, session_id, source, host=None):
    """Append one finalized interval to this host's log (atomic-ish append)."""
    if end < start:
        start, end = end, start
    rec = {
        "start": int(start),
        "end": int(end),
        "session_id": session_id,
        "host": host or HOST,
        "source": source,
    }
    line = json.dumps(rec) + "\n"
    # O_APPEND single write keeps concurrent CLIs from interleaving lines.
    fd = os.open(host_log(host), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, line.encode())
    finally:
        os.close(fd)


def read_all_intervals():
    """Every finalized interval across every machine's log."""
    out = []
    for fn in glob.glob(os.path.join(DATA_DIR, "sessions-*.jsonl")):
        try:
            with open(fn) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                        out.append((int(r["start"]), int(r["end"])))
                    except Exception:
                        continue
        except OSError:
            continue
    return out


def known_session_ids(host: str = None):
    """Session ids already recorded in this host's log (any source)."""
    ids = set()
    try:
        with open(host_log(host)) as f:
            for line in f:
                try:
                    r = json.loads(line)
                    if r.get("session_id"):
                        ids.add(r["session_id"])
                except Exception:
                    continue
    except OSError:
        pass
    return ids


def live_intervals():
    """Open (in-progress) sessions on this machine, bounded safely."""
    out = []
    n = now()
    for marker in glob.glob(os.path.join(OPEN_DIR, "*")):
        sid = os.path.basename(marker)
        try:
            with open(marker) as f:
                m = json.load(f)
            start = int(m["start"])
        except Exception:
            continue
        hb = read_heartbeat(sid)
        last = hb if hb else start
        # Recently alive (or just started) → count to now; else bound by heartbeat.
        end = n if (n - last) < LIVE_FRESH_SEC else last
        out.append((start, end))
    return out


def read_heartbeat(sid):
    try:
        with open(os.path.join(HB_DIR, sid)) as f:
            return int(f.read().strip())
    except Exception:
        return None


# --- Union math --------------------------------------------------------------

def merge(intervals):
    """Merge overlapping/touching intervals → disjoint sorted list."""
    iv = sorted((a, b) for a, b in intervals if b > a)
    if not iv:
        return []
    merged = [list(iv[0])]
    for a, b in iv[1:]:
        if a <= merged[-1][1]:          # overlap or touch
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [(a, b) for a, b in merged]


def union_total(intervals) -> int:
    return sum(b - a for a, b in merge(intervals))


def clip_total(merged, lo, hi) -> int:
    """Seconds of `merged` (already disjoint) falling inside [lo, hi)."""
    t = 0
    for a, b in merged:
        s, e = max(a, lo), min(b, hi)
        if e > s:
            t += e - s
    return t


# --- Formatting --------------------------------------------------------------

def fmt_hm(seconds: int) -> str:
    seconds = max(0, int(seconds))
    h, m = seconds // 3600, (seconds % 3600) // 60
    if h and m:
        return f"{h}h {m}m"
    if h:
        return f"{h}h"
    return f"{m}m"


def fmt_short(seconds: int) -> str:
    """Compact form for the statusline, e.g. '143h'."""
    h = max(0, int(seconds)) // 3600
    return f"{h}h"


def day_bounds(d: dt.date):
    start = dt.datetime(d.year, d.month, d.day)
    lo = int(start.timestamp())
    hi = int((start + dt.timedelta(days=1)).timestamp())
    return lo, hi


# --- Commands ----------------------------------------------------------------

def read_hook_stdin():
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def cmd_session_start():
    ensure_dirs()
    data = read_hook_stdin()
    sid = data.get("session_id") or f"unknown-{now()}"
    n = now()
    with open(os.path.join(OPEN_DIR, sid), "w") as f:
        json.dump({"start": n, "host": HOST, "cwd": data.get("cwd", "")}, f)
    with open(os.path.join(HB_DIR, sid), "w") as f:
        f.write(str(n))
    sweep(exclude=sid)        # reclaim any crashed sessions
    backfill()                # idempotent — catches up late installs
    refresh_cache()


def cmd_session_end():
    ensure_dirs()
    data = read_hook_stdin()
    sid = data.get("session_id")
    marker = os.path.join(OPEN_DIR, sid) if sid else None
    start = None
    if marker and os.path.exists(marker):
        try:
            with open(marker) as f:
                start = int(json.load(f)["start"])
        except Exception:
            start = None
    if start is None:
        # No open marker (e.g. installed mid-session). Fall back to heartbeat.
        start = read_heartbeat(sid) if sid else None
    if start is not None:
        end = now()
        append_interval(start, end, sid, "hook")
        session_secs = end - start
        if marker and os.path.exists(marker):
            os.remove(marker)
        hb = os.path.join(HB_DIR, sid) if sid else None
        if hb and os.path.exists(hb):
            os.remove(hb)
        refresh_cache()
        lifetime = union_total(read_all_intervals())
        print(f"⏱  This session: {fmt_hm(session_secs)}  ·  "
              f"Lifetime: {fmt_hm(lifetime)}")
    else:
        refresh_cache()


def sweep(exclude: str = None):
    """Finalize dangling open markers from crashed sessions."""
    ensure_dirs()
    n = now()
    for marker in glob.glob(os.path.join(OPEN_DIR, "*")):
        sid = os.path.basename(marker)
        if sid == exclude:
            continue
        try:
            with open(marker) as f:
                start = int(json.load(f)["start"])
        except Exception:
            os.remove(marker)
            continue
        hb = read_heartbeat(sid)
        last = hb if hb else start
        if (n - last) > SWEEP_STALE_SEC:
            append_interval(start, last, sid, "hook-crash")
            os.remove(marker)
            hbf = os.path.join(HB_DIR, sid)
            if os.path.exists(hbf):
                os.remove(hbf)


def backfill():
    """Reconstruct intervals from history.jsonl. Idempotent (dedupe by sid)."""
    ensure_dirs()
    if not os.path.exists(HISTORY_FILE):
        return 0
    stamps = {}  # session_id -> [prompt_ts_seconds, ...]
    try:
        with open(HISTORY_FILE) as f:
            for line in f:
                try:
                    d = json.loads(line)
                    sid = d.get("sessionId")
                    ts = d.get("timestamp")
                    if not sid or ts is None:
                        continue
                    stamps.setdefault(sid, []).append(int(ts) // 1000)
                except Exception:
                    continue
    except OSError:
        return 0
    have = known_session_ids()
    added = 0
    for sid, ts_list in stamps.items():
        if sid in have:
            continue
        for lo, hi in burst_intervals(ts_list):
            append_interval(lo, hi, sid, "backfill")
        added += 1
    return added


def burst_intervals(ts_list):
    """Split prompt timestamps into activity bursts (gap-aware), with a pad.

    A run of prompts becomes one interval [first, last + pad]; a gap larger than
    BACKFILL_GAP_SEC starts a new burst. A lone prompt becomes [t, t + pad].
    """
    ts = sorted(set(ts_list))
    if not ts:
        return []
    bursts = []
    start = prev = ts[0]
    for t in ts[1:]:
        if t - prev > BACKFILL_GAP_SEC:
            bursts.append((start, prev + BACKFILL_PAD_SEC))
            start = t
        prev = t
    bursts.append((start, prev + BACKFILL_PAD_SEC))
    return bursts


def refresh_cache():
    ensure_dirs()
    intervals = read_all_intervals() + live_intervals()
    total = union_total(intervals)
    try:
        with open(CACHE_FILE, "w") as f:
            f.write(f"⏱ {fmt_short(total)}")
    except OSError:
        pass
    return total


def cmd_report():
    intervals = read_all_intervals() + live_intervals()
    merged = merge(intervals)
    total = sum(b - a for a, b in merged)

    today = dt.date.today()
    d_lo, d_hi = day_bounds(today)
    today_secs = clip_total(merged, d_lo, d_hi)

    monday = today - dt.timedelta(days=today.weekday())
    w_lo, _ = day_bounds(monday)
    week_secs = clip_total(merged, w_lo, d_hi)

    hosts = sorted({
        os.path.basename(fn)[len("sessions-"):-len(".jsonl")]
        for fn in glob.glob(os.path.join(DATA_DIR, "sessions-*.jsonl"))
    })
    n_sessions = 0
    for fn in glob.glob(os.path.join(DATA_DIR, "sessions-*.jsonl")):
        try:
            with open(fn) as f:
                n_sessions += sum(1 for _ in f if _.strip())
        except OSError:
            pass

    since = ""
    if merged:
        since = dt.datetime.fromtimestamp(merged[0][0]).strftime("%Y-%m-%d")

    print("⚔️  Claude Code Playtime")
    print(f"   Total:      {fmt_hm(total):<12}" + (f"(since {since})" if since else ""))
    print(f"   Today:      {fmt_hm(today_secs)}")
    print(f"   This week:  {fmt_hm(week_secs)}")
    hostline = f"{len(hosts)} ({', '.join(hosts)})" if hosts else "0"
    print(f"   Sessions:   {n_sessions}   ·   Machines: {hostline}")


def cmd_by_day(n=14):
    intervals = read_all_intervals() + live_intervals()
    merged = merge(intervals)
    if not merged:
        print("No playtime recorded yet.")
        return
    today = dt.date.today()
    rows = []
    for i in range(n - 1, -1, -1):
        d = today - dt.timedelta(days=i)
        lo, hi = day_bounds(d)
        rows.append((d, clip_total(merged, lo, hi)))
    peak = max((s for _, s in rows), default=0) or 1
    print(f"⚔️  Playtime — last {n} days")
    for d, s in rows:
        bar = "█" * int(round((s / peak) * 24))
        print(f"   {d.strftime('%a %m-%d')}  {bar:<24} {fmt_hm(s)}")


def cmd_by_week(n=8):
    intervals = read_all_intervals() + live_intervals()
    merged = merge(intervals)
    if not merged:
        print("No playtime recorded yet.")
        return
    today = dt.date.today()
    this_monday = today - dt.timedelta(days=today.weekday())
    rows = []
    for i in range(n - 1, -1, -1):
        wk_start = this_monday - dt.timedelta(weeks=i)
        lo, _ = day_bounds(wk_start)
        _, hi = day_bounds(wk_start + dt.timedelta(days=6))
        rows.append((wk_start, clip_total(merged, lo, hi)))
    peak = max((s for _, s in rows), default=0) or 1
    print(f"⚔️  Playtime — last {n} weeks")
    for wk, s in rows:
        bar = "█" * int(round((s / peak) * 24))
        print(f"   wk {wk.strftime('%m-%d')}  {bar:<24} {fmt_hm(s)}")


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "report"
    if cmd == "session-start":
        cmd_session_start()
    elif cmd == "session-end":
        cmd_session_end()
    elif cmd == "sweep":
        sweep()
    elif cmd == "backfill":
        added = backfill()
        print(f"Backfilled {added} new session(s) from history.jsonl")
    elif cmd == "refresh-cache":
        refresh_cache()
    elif cmd in ("--by-day", "by-day", "day"):
        n = int(args[1]) if len(args) > 1 and args[1].isdigit() else 14
        cmd_by_day(n)
    elif cmd in ("--by-week", "by-week", "week"):
        n = int(args[1]) if len(args) > 1 and args[1].isdigit() else 8
        cmd_by_week(n)
    elif cmd in ("report", "--report"):
        cmd_report()
    else:
        cmd_report()


if __name__ == "__main__":
    main()
