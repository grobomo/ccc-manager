#!/usr/bin/env python3
"""
CCC Dispatcher API — standalone task distribution server.

Exposes sharding, priority dispatch, and SQS integration as an HTTP API.
Designed for ep-incident-response: download from S3, run on dispatcher EC2.

Endpoints:
  POST /shard     — Split a task into work units across dimensions
  POST /dispatch  — Send sharded units to SQS task queue
  POST /collect   — Poll SQS result queue, aggregate results
  GET  /health    — Health check

Usage:
  python3 dispatcher-api.py [--port 8090] [--task-queue URL] [--result-queue URL]

Zero dependencies — uses only Python stdlib + AWS CLI.
"""

import json
import subprocess
import sys
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from itertools import product
from urllib.parse import urlparse, parse_qs

# --- Sharder ---

STRATEGIES = {"cartesian", "chunk", "round-robin"}


def expand_dimension(spec):
    """Expand a dimension spec into values."""
    if isinstance(spec, list):
        return spec
    if isinstance(spec, dict) and "start" in spec and "end" in spec:
        start, end, step = spec["start"], spec["end"], spec.get("step", 1)
        values = []
        v = start
        while v < end:
            chunk_end = min(v + step, end)
            values.append({"start": v, "end": chunk_end})
            v += step
        return values
    return [spec]


def shard_task(task, worker_count=1, strategy="cartesian", max_units=1000):
    """Split a task into work units across its dimensions."""
    dims = task.get("dimensions", {})
    task_id = task.get("id", f"task-{int(time.time())}")
    summary = task.get("summary", "")

    if not dims:
        return [{"unitId": f"{task_id}-U001", "taskId": task_id, "summary": summary,
                 "dimensions": {}, "workerIndex": 0}]

    expanded = {k: expand_dimension(v) for k, v in dims.items()}
    dim_names = list(expanded.keys())
    dim_values = [expanded[k] for k in dim_names]

    if strategy == "chunk" and len(dim_names) == 1:
        # Split single dimension into worker_count chunks
        vals = dim_values[0]
        chunk_size = max(1, -(-len(vals) // max(1, worker_count)))  # ceil division
        combos = []
        for i in range(0, len(vals), chunk_size):
            combos.append({dim_names[0]: vals[i:i + chunk_size]})
    else:
        # Cartesian product
        combos = [dict(zip(dim_names, combo)) for combo in product(*dim_values)]

    combos = combos[:max_units]

    return [
        {
            "unitId": f"{task_id}-U{str(i + 1).zfill(3)}",
            "taskId": task_id,
            "summary": summary,
            "dimensions": combo,
            "workerIndex": i % max(1, worker_count),
        }
        for i, combo in enumerate(combos)
    ]


# --- SQS helpers ---

def sqs_send(queue_url, body, region=None):
    """Send a message to SQS via AWS CLI."""
    args = ["aws", "sqs", "send-message",
            "--queue-url", queue_url,
            "--message-body", json.dumps(body),
            "--output", "json"]
    if region:
        args += ["--region", region]
    result = subprocess.run(args, capture_output=True, text=True, timeout=10)
    if result.returncode != 0:
        raise RuntimeError(f"SQS send failed: {result.stderr.strip()}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def sqs_receive(queue_url, max_messages=10, wait_time=5, region=None):
    """Receive messages from SQS via AWS CLI."""
    args = ["aws", "sqs", "receive-message",
            "--queue-url", queue_url,
            "--max-number-of-messages", str(max_messages),
            "--wait-time-seconds", str(wait_time),
            "--output", "json"]
    if region:
        args += ["--region", region]
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        return []
    data = json.loads(result.stdout) if result.stdout.strip() else {}
    return data.get("Messages", [])


def sqs_delete(queue_url, receipt_handle, region=None):
    """Delete a message from SQS."""
    args = ["aws", "sqs", "delete-message",
            "--queue-url", queue_url,
            "--receipt-handle", receipt_handle,
            "--output", "json"]
    if region:
        args += ["--region", region]
    subprocess.run(args, capture_output=True, text=True, timeout=10)


# --- Aggregation ---

PRIORITY_ORDER = {"critical": 0, "high": 1, "normal": 2, "low": 3}


def aggregate_results(results):
    """Aggregate work unit results into a summary."""
    succeeded = [r for r in results if r.get("success")]
    failed_list = [r for r in results if not r.get("success")]
    status = "completed" if not failed_list else ("partial" if succeeded else "failed")
    return {
        "total": len(results),
        "succeeded": len(succeeded),
        "failed": len(failed_list),
        "status": status,
        "results": results,
    }


# --- HTTP API ---

class DispatcherHandler(BaseHTTPRequestHandler):
    task_queue_url = None
    result_queue_url = None
    region = None

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length > 1048576:  # 1MB limit
            self._respond(413, {"error": "Body too large"})
            return None
        return json.loads(self.rfile.read(length)) if length > 0 else {}

    def _respond(self, code, data):
        body = json.dumps(data, default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {"status": "ok", "uptime": time.time()})
        else:
            self._respond(404, {"error": "Not found"})

    def do_POST(self):
        body = self._read_body()
        if body is None:
            return

        if self.path == "/shard":
            self._handle_shard(body)
        elif self.path == "/dispatch":
            self._handle_dispatch(body)
        elif self.path == "/collect":
            self._handle_collect(body)
        else:
            self._respond(404, {"error": "Not found"})

    def _handle_shard(self, body):
        task = body.get("task", body)
        worker_count = body.get("workerCount", 1)
        strategy = body.get("strategy", "cartesian")
        max_units = body.get("maxUnits", 1000)

        units = shard_task(task, worker_count, strategy, max_units)
        self._respond(200, {"units": units, "count": len(units)})

    def _handle_dispatch(self, body):
        queue_url = body.get("taskQueueUrl", self.task_queue_url)
        region = body.get("region", self.region)
        units = body.get("units", [])

        if not queue_url:
            self._respond(400, {"error": "taskQueueUrl required"})
            return

        sent = []
        errors = []
        for unit in units:
            try:
                sqs_send(queue_url, unit, region)
                sent.append(unit["unitId"])
            except Exception as e:
                errors.append({"unitId": unit.get("unitId"), "error": str(e)})

        self._respond(200, {"sent": len(sent), "errors": errors, "sentIds": sent})

    def _handle_collect(self, body):
        queue_url = body.get("resultQueueUrl", self.result_queue_url)
        region = body.get("region", self.region)
        expected_ids = set(body.get("unitIds", []))
        timeout_ms = body.get("timeout", 30000)

        if not queue_url:
            self._respond(400, {"error": "resultQueueUrl required"})
            return

        results = []
        collected = set()
        deadline = time.time() + timeout_ms / 1000

        while len(collected) < len(expected_ids) and time.time() < deadline:
            messages = sqs_receive(queue_url, 10, min(5, max(1, int(deadline - time.time()))), region)
            for msg in messages:
                try:
                    data = json.loads(msg["Body"])
                    uid = data.get("unitId")
                    if uid and uid in expected_ids and uid not in collected:
                        collected.add(uid)
                        results.append(data)
                        try:
                            sqs_delete(queue_url, msg["ReceiptHandle"], region)
                        except Exception:
                            pass
                except (json.JSONDecodeError, KeyError):
                    pass

        # Mark missing as failed
        for uid in expected_ids - collected:
            results.append({"unitId": uid, "success": False, "error": "Timeout"})

        self._respond(200, aggregate_results(results))

    def log_message(self, format, *args):
        # Suppress default logging
        pass


def main():
    port = 8090
    task_queue = None
    result_queue = None
    region = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--port" and i + 1 < len(args):
            port = int(args[i + 1]); i += 2
        elif args[i] == "--task-queue" and i + 1 < len(args):
            task_queue = args[i + 1]; i += 2
        elif args[i] == "--result-queue" and i + 1 < len(args):
            result_queue = args[i + 1]; i += 2
        elif args[i] == "--region" and i + 1 < len(args):
            region = args[i + 1]; i += 2
        elif args[i] in ("--help", "-h"):
            print(__doc__)
            sys.exit(0)
        else:
            i += 1

    DispatcherHandler.task_queue_url = task_queue
    DispatcherHandler.result_queue_url = result_queue
    DispatcherHandler.region = region

    server = HTTPServer(("0.0.0.0", port), DispatcherHandler)
    print(f"Dispatcher API listening on :{port}")
    if task_queue:
        print(f"  Task queue: {task_queue}")
    if result_queue:
        print(f"  Result queue: {result_queue}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.server_close()


if __name__ == "__main__":
    main()
