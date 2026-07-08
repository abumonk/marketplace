#!/usr/bin/env python3
"""SubagentStop command hook: harvest REAL token usage from finished subagent
transcripts into a deterministic ledger (.agent/metrics-raw.jsonl).

Replaces the previous approach of having a prompt-hook LLM guess token usage
via `turns * 1500 / turns * 500` (prompt hooks never see real counts).

Design notes (see docs/plans for the full writeup):
  - Reads the SubagentStop hook stdin JSON defensively. Any failure to parse
    or missing expected fields results in a silent, successful exit (exit 0)
    so we never block or poison the pipeline.
  - The subagents directory is derived from `transcript_path` (strip the
    trailing `.jsonl`) plus a `subagents` component -- never assumed from cwd.
  - The ledger lives at `<cwd>/.agent/metrics-raw.jsonl`, where `cwd` comes
    from the hook's stdin JSON. If no `.agent/` directory exists there, the
    pipeline is not initialized for this project and we exit silently.
  - On every invocation we sweep ALL agent-*.jsonl transcripts in the
    subagents dir that are not yet represented in the ledger (by agent_id),
    not just "the one that just stopped". This makes the hook self-healing:
    any row missed because the hook was absent/broken/dropped an event gets
    picked up on the next SubagentStop firing for the same session.
  - Never writes to stdout: stdout of a command hook feeds back into the
    calling agent's context, and we have nothing useful to add there.
"""

import json
import os
import sys
import traceback
from datetime import datetime, timezone


def _read_stdin_json():
    try:
        raw = sys.stdin.read()
    except Exception:
        return {}
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _subagents_dir_from_transcript_path(transcript_path):
    if not transcript_path:
        return None
    # transcript_path looks like <session-dir>.jsonl for the MAIN session,
    # but this hook fires with the transcript_path of the session that
    # spawned the subagent (i.e. still the main/parent transcript). The
    # subagent transcripts live in a sibling "subagents" dir named after
    # the session file with ".jsonl" stripped.
    if transcript_path.endswith(".jsonl"):
        session_dir = transcript_path[: -len(".jsonl")]
    else:
        session_dir = transcript_path
    return os.path.join(session_dir, "subagents")


def _load_recorded_agent_ids(ledger_path):
    recorded = set()
    if not os.path.isfile(ledger_path):
        return recorded
    try:
        with open(ledger_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except Exception:
                    continue
                agent_id = row.get("agent_id")
                if agent_id:
                    recorded.add(agent_id)
    except Exception:
        pass
    return recorded


def _list_agent_transcripts(subagents_dir):
    agent_ids = []
    try:
        for name in os.listdir(subagents_dir):
            if name.startswith("agent-") and name.endswith(".jsonl"):
                agent_ids.append(name[len("agent-"): -len(".jsonl")])
    except Exception:
        return []
    return sorted(agent_ids)


def _read_meta(subagents_dir, agent_id):
    meta_path = os.path.join(subagents_dir, "agent-%s.meta.json" % agent_id)
    if not os.path.isfile(meta_path):
        return {}
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _summarize_transcript(subagents_dir, agent_id):
    """Sum usage fields over all assistant entries in the agent's transcript.

    Returns a dict of summed fields, or None if the transcript is missing,
    empty, or contains no usable assistant/usage entries (malformed).
    """
    transcript_path = os.path.join(subagents_dir, "agent-%s.jsonl" % agent_id)
    if not os.path.isfile(transcript_path):
        return None

    input_tokens = 0
    output_tokens = 0
    cache_read_input_tokens = 0
    cache_creation_input_tokens = 0
    turns = 0
    last_model = None
    first_ts = None
    last_ts = None

    try:
        with open(transcript_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue
                if not isinstance(entry, dict):
                    continue

                ts = entry.get("timestamp")
                if isinstance(ts, str) and ts:
                    if first_ts is None:
                        first_ts = ts
                    last_ts = ts

                message = entry.get("message")
                if entry.get("type") != "assistant" or not isinstance(message, dict):
                    continue

                usage = message.get("usage")
                if not isinstance(usage, dict):
                    continue

                turns += 1
                input_tokens += _safe_int(usage.get("input_tokens"))
                output_tokens += _safe_int(usage.get("output_tokens"))
                cache_read_input_tokens += _safe_int(usage.get("cache_read_input_tokens"))
                cache_creation_input_tokens += _safe_int(usage.get("cache_creation_input_tokens"))

                model = message.get("model")
                if model:
                    last_model = model
    except Exception:
        return None

    if turns == 0:
        # No usable assistant/usage entries -- treat as malformed/incomplete.
        return None

    duration_s = _duration_seconds(first_ts, last_ts)

    return {
        "model": last_model,
        "turns": turns,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_input_tokens": cache_read_input_tokens,
        "cache_creation_input_tokens": cache_creation_input_tokens,
        "duration_s": duration_s,
    }


def _safe_int(value):
    try:
        return int(value)
    except Exception:
        return 0


def _parse_iso(ts):
    if not isinstance(ts, str) or not ts:
        return None
    try:
        # Handle trailing "Z" which Python's fromisoformat historically
        # rejects on older versions.
        normalized = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
        return datetime.fromisoformat(normalized)
    except Exception:
        return None


def _duration_seconds(first_ts, last_ts):
    start = _parse_iso(first_ts)
    end = _parse_iso(last_ts)
    if start is None or end is None:
        return None
    try:
        return max(0.0, (end - start).total_seconds())
    except Exception:
        return None


def main():
    stdin_data = _read_stdin_json()

    cwd = stdin_data.get("cwd")
    session_id = stdin_data.get("session_id")
    transcript_path = stdin_data.get("transcript_path")

    if not cwd or not transcript_path:
        return 0

    agent_dir = os.path.join(cwd, ".agent")
    if not os.path.isdir(agent_dir):
        # Pipeline not initialized for this project -- nothing to record.
        return 0

    subagents_dir = _subagents_dir_from_transcript_path(transcript_path)
    if not subagents_dir or not os.path.isdir(subagents_dir):
        return 0

    ledger_path = os.path.join(agent_dir, "metrics-raw.jsonl")
    recorded_ids = _load_recorded_agent_ids(ledger_path)

    new_rows = []
    for agent_id in _list_agent_transcripts(subagents_dir):
        if agent_id in recorded_ids:
            continue

        summary = _summarize_transcript(subagents_dir, agent_id)
        if summary is None:
            # Malformed/empty transcript -- skip without crashing. Do not
            # mark as recorded, so a later, more complete transcript could
            # still be picked up.
            continue

        meta = _read_meta(subagents_dir, agent_id)

        row = {
            "agent_id": agent_id,
            "agent_type": meta.get("agentType"),
            "description": meta.get("description"),
            "model": summary.get("model"),
            "turns": summary.get("turns"),
            "input_tokens": summary.get("input_tokens"),
            "output_tokens": summary.get("output_tokens"),
            "cache_read_input_tokens": summary.get("cache_read_input_tokens"),
            "cache_creation_input_tokens": summary.get("cache_creation_input_tokens"),
            "duration_s": summary.get("duration_s"),
            "session_id": session_id,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }
        new_rows.append(row)

    if new_rows:
        try:
            with open(ledger_path, "a", encoding="utf-8") as f:
                for row in new_rows:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
        except Exception:
            return 0

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except Exception:
        # Never raise -- a broken metrics hook must not break the pipeline.
        try:
            traceback.print_exc(file=sys.stderr)
        except Exception:
            pass
        sys.exit(0)
