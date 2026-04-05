#!/usr/bin/env python3
"""Test the dispatcher-api.py sharding + aggregation logic (no SQS needed)."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from importlib import import_module

# Import the module by path
import importlib.util
spec = importlib.util.spec_from_file_location("dispatcher_api",
    os.path.join(os.path.dirname(__file__), "..", "dispatcher-api.py"))
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

passed = failed = 0

def test(name, condition):
    global passed, failed
    if condition:
        print(f"  PASS: {name}")
        passed += 1
    else:
        print(f"  FAIL: {name}")
        failed += 1

# 1. Expand dimensions
print("1. Dimension expansion...")
test("Array passthrough", api.expand_dimension(["a", "b"]) == ["a", "b"])
test("Range expansion", len(api.expand_dimension({"start": 0, "end": 10, "step": 5})) == 2)
test("Range values", api.expand_dimension({"start": 0, "end": 10, "step": 5}) == [{"start": 0, "end": 5}, {"start": 5, "end": 10}])
test("Scalar wrapping", api.expand_dimension("single") == ["single"])

# 2. Shard — no dimensions
print("\n2. No dimensions...")
units = api.shard_task({"id": "T1", "summary": "test"})
test("Single unit", len(units) == 1)
test("Unit ID format", units[0]["unitId"] == "T1-U001")

# 3. Cartesian product
print("\n3. Cartesian product...")
units = api.shard_task({
    "id": "T2",
    "summary": "analyze",
    "dimensions": {
        "source": ["email", "endpoint"],
        "type": ["ioc", "lateral"]
    }
})
test("2x2 = 4 units", len(units) == 4)
test("First unit", units[0]["dimensions"] == {"source": "email", "type": "ioc"})
test("Last unit", units[3]["dimensions"] == {"source": "endpoint", "type": "lateral"})

# 4. Worker assignment
print("\n4. Worker assignment...")
units = api.shard_task({
    "id": "T3",
    "dimensions": {"item": ["a", "b", "c", "d", "e"]}
}, worker_count=3)
test("5 units", len(units) == 5)
test("Worker 0,1,2,0,1", [u["workerIndex"] for u in units] == [0, 1, 2, 0, 1])

# 5. Chunk strategy
print("\n5. Chunk strategy...")
units = api.shard_task({
    "id": "T4",
    "dimensions": {"item": ["a", "b", "c", "d", "e", "f"]}
}, worker_count=3, strategy="chunk")
test("3 chunks", len(units) == 3)
test("First chunk", units[0]["dimensions"]["item"] == ["a", "b"])
test("Last chunk", units[2]["dimensions"]["item"] == ["e", "f"])

# 6. Max units cap
print("\n6. Max units cap...")
units = api.shard_task({
    "id": "T5",
    "dimensions": {"a": list(range(100))}
}, max_units=10)
test("Capped at 10", len(units) == 10)

# 7. EP incident response use case
print("\n7. EP incident response...")
units = api.shard_task({
    "id": "incident-2026-001",
    "summary": "Analyze security incident",
    "dimensions": {
        "timeRange": {"start": 0, "end": 24, "step": 8},
        "dataSource": ["email", "endpoint", "network"],
        "analysisType": ["ioc-extraction", "lateral-movement", "data-exfil"]
    }
}, worker_count=4)
test("27 units (3x3x3)", len(units) == 27)
test("Worker wrapping", units[26]["workerIndex"] == 2)  # 26 % 4 = 2

# 8. Aggregation
print("\n8. Result aggregation...")
agg = api.aggregate_results([
    {"unitId": "U1", "success": True, "output": "ok"},
    {"unitId": "U2", "success": True, "output": "ok"},
])
test("All completed", agg["status"] == "completed")
test("Succeeded 2", agg["succeeded"] == 2)

agg = api.aggregate_results([
    {"unitId": "U1", "success": True},
    {"unitId": "U2", "success": False, "error": "fail"},
])
test("Partial", agg["status"] == "partial")

agg = api.aggregate_results([{"unitId": "U1", "success": False}])
test("All failed", agg["status"] == "failed")

# 9. Priority order
print("\n9. Priority order...")
test("Critical < high", api.PRIORITY_ORDER["critical"] < api.PRIORITY_ORDER["high"])
test("High < normal", api.PRIORITY_ORDER["high"] < api.PRIORITY_ORDER["normal"])
test("Normal < low", api.PRIORITY_ORDER["normal"] < api.PRIORITY_ORDER["low"])

print(f"\n=== Results: {passed} passed, {failed} failed ===")
sys.exit(1 if failed else 0)
