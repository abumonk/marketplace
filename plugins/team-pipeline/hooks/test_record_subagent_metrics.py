"""Unit tests for hooks/record_subagent_metrics.py.

Run via:
    python -m unittest discover -s plugins/team-pipeline/hooks
"""

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import importlib.util


_MODULE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "record_subagent_metrics.py")


def _load_module():
    spec = importlib.util.spec_from_file_location("record_subagent_metrics", _MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rsm = _load_module()


def _assistant_entry(timestamp, input_tokens, output_tokens, cache_read=0, cache_creation=0, model="claude-x"):
    return {
        "type": "assistant",
        "timestamp": timestamp,
        "message": {
            "model": model,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_read_input_tokens": cache_read,
                "cache_creation_input_tokens": cache_creation,
            },
        },
    }


class RecordSubagentMetricsTest(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp(prefix="rsm_test_")
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

        # cwd fixture WITH .agent dir (pipeline initialized).
        self.cwd_with_agent = os.path.join(self.tmp_dir, "project_with_agent")
        os.makedirs(os.path.join(self.cwd_with_agent, ".agent"))

        # cwd fixture WITHOUT .agent dir (pipeline not initialized).
        self.cwd_without_agent = os.path.join(self.tmp_dir, "project_without_agent")
        os.makedirs(self.cwd_without_agent)

        # Fake session transcript path + sibling subagents dir.
        self.session_id = "fake-session-id"
        self.transcript_path = os.path.join(self.tmp_dir, "session_root", self.session_id + ".jsonl")
        self.session_dir = os.path.join(self.tmp_dir, "session_root", self.session_id)
        self.subagents_dir = os.path.join(self.session_dir, "subagents")
        os.makedirs(self.subagents_dir)

        self.ledger_path = os.path.join(self.cwd_with_agent, ".agent", "metrics-raw.jsonl")

        self._write_good_agent()
        self._write_malformed_agent()

    def _write_good_agent(self):
        self.good_agent_id = "good1"
        lines = [
            _assistant_entry("2026-07-08T08:00:00.000Z", 10, 5, cache_read=100, cache_creation=50),
            _assistant_entry("2026-07-08T08:00:10.000Z", 20, 8, cache_read=200, cache_creation=0, model="claude-y"),
        ]
        transcript = os.path.join(self.subagents_dir, "agent-%s.jsonl" % self.good_agent_id)
        with open(transcript, "w", encoding="utf-8") as f:
            for entry in lines:
                f.write(json.dumps(entry) + "\n")

        meta = {
            "agentType": "team-pipeline:implementer",
            "description": "test agent",
            "toolUseId": "toolu_test",
            "spawnDepth": 1,
        }
        meta_path = os.path.join(self.subagents_dir, "agent-%s.meta.json" % self.good_agent_id)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f)

        # Hand-computed expected sums for TC-3-style verification.
        self.expected_good_sums = {
            "input_tokens": 30,
            "output_tokens": 13,
            "cache_read_input_tokens": 300,
            "cache_creation_input_tokens": 50,
            "turns": 2,
            "model": "claude-y",
        }

    def _write_malformed_agent(self):
        self.bad_agent_id = "bad1"
        transcript = os.path.join(self.subagents_dir, "agent-%s.jsonl" % self.bad_agent_id)
        with open(transcript, "w", encoding="utf-8") as f:
            f.write("not valid json at all\n")
            f.write("{ also not valid\n")
        # No meta.json for the malformed agent -- exercise missing-meta path too.

    def _run_main(self, stdin_obj):
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(json.dumps(stdin_obj) if stdin_obj is not None else "")
        try:
            return rsm.main()
        finally:
            sys.stdin = old_stdin

    def test_valid_row_appended_with_correct_sums(self):
        rc = self._run_main({
            "cwd": self.cwd_with_agent,
            "session_id": self.session_id,
            "transcript_path": self.transcript_path,
        })
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.isfile(self.ledger_path))

        with open(self.ledger_path, "r", encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]

        # Only the good agent should produce a row (malformed one is skipped).
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["agent_id"], self.good_agent_id)
        self.assertEqual(row["agent_type"], "team-pipeline:implementer")
        self.assertEqual(row["input_tokens"], self.expected_good_sums["input_tokens"])
        self.assertEqual(row["output_tokens"], self.expected_good_sums["output_tokens"])
        self.assertEqual(row["cache_read_input_tokens"], self.expected_good_sums["cache_read_input_tokens"])
        self.assertEqual(row["cache_creation_input_tokens"], self.expected_good_sums["cache_creation_input_tokens"])
        self.assertEqual(row["turns"], self.expected_good_sums["turns"])
        self.assertEqual(row["model"], self.expected_good_sums["model"])
        self.assertEqual(row["session_id"], self.session_id)
        self.assertIsNotNone(row["duration_s"])
        self.assertAlmostEqual(row["duration_s"], 10.0, places=3)

    def test_malformed_transcript_skipped_without_crash(self):
        # Should not raise even though agent-bad1.jsonl has no valid JSON lines.
        rc = self._run_main({
            "cwd": self.cwd_with_agent,
            "session_id": self.session_id,
            "transcript_path": self.transcript_path,
        })
        self.assertEqual(rc, 0)
        with open(self.ledger_path, "r", encoding="utf-8") as f:
            rows = [json.loads(line) for line in f if line.strip()]
        agent_ids = {row["agent_id"] for row in rows}
        self.assertNotIn(self.bad_agent_id, agent_ids)

    def test_rerun_appends_nothing_dedupe(self):
        self._run_main({
            "cwd": self.cwd_with_agent,
            "session_id": self.session_id,
            "transcript_path": self.transcript_path,
        })
        with open(self.ledger_path, "r", encoding="utf-8") as f:
            first_run_lines = f.readlines()

        # Run again -- the good agent is already recorded, nothing new to add.
        self._run_main({
            "cwd": self.cwd_with_agent,
            "session_id": self.session_id,
            "transcript_path": self.transcript_path,
        })
        with open(self.ledger_path, "r", encoding="utf-8") as f:
            second_run_lines = f.readlines()

        self.assertEqual(first_run_lines, second_run_lines)
        self.assertEqual(len(second_run_lines), 1)

    def test_missing_agent_dir_no_ledger_created(self):
        rc = self._run_main({
            "cwd": self.cwd_without_agent,
            "session_id": self.session_id,
            "transcript_path": self.transcript_path,
        })
        self.assertEqual(rc, 0)
        ledger_path = os.path.join(self.cwd_without_agent, ".agent", "metrics-raw.jsonl")
        self.assertFalse(os.path.exists(ledger_path))
        self.assertFalse(os.path.isdir(os.path.join(self.cwd_without_agent, ".agent")))

    def test_empty_stdin_exits_cleanly(self):
        rc = self._run_main(None)
        self.assertEqual(rc, 0)
        # Nothing should have been written anywhere since cwd is unknown.
        self.assertFalse(os.path.exists(self.ledger_path))


if __name__ == "__main__":
    unittest.main()
