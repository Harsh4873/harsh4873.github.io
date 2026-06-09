#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import pickgrader_server

LATEST_JSON_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'model_cache', 'latest.json'))
CANNON_JSON_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data', 'cannon_mlb_daily.json'))

def grade_file(file_path):
    if not os.path.exists(file_path):
        print(f"File {file_path} not found.")
        return False

    with open(file_path, 'r') as f:
        data = json.load(f)

    # extract picks from different JSON shapes
    picks = []
    if isinstance(data, dict):
        if "picks" in data:
            picks = data["picks"]
        elif "results" in data:
            # model_cache format contains dicts inside dicts but actually data/model_cache/latest.json is just a list! Wait, let's look at the payload.
            pass
    elif isinstance(data, list):
        picks = data

    if not picks:
        print(f"No picks found in {file_path}.")
        return False

    pending_picks = [p for p in picks if p.get("result", "pending") == "pending"]
    if not pending_picks:
        print(f"No pending picks in {file_path}.")
        return False

    print(f"Found {len(pending_picks)} pending picks in {file_path}. Grading...")
    
    current_year = datetime.now().year
    grades_response = pickgrader_server.auto_grade(pending_picks, {}, current_year)
    grades = grades_response.get("grades", {})
    
    changed = 0
    for pick in picks:
        pid = str(pick.get("id", ""))
        if pid in grades and grades[pid] != "pending":
            pick["result"] = grades[pid]
            changed += 1

    if changed > 0:
        print(f"Graded {changed} picks in {file_path}.")
        with open(file_path, 'w') as f:
            json.dump(data, f, indent=2)
        return True
    else:
        print(f"No picks graded in {file_path}.")
        return False

if __name__ == "__main__":
    c1 = grade_file(LATEST_JSON_PATH)
    c2 = grade_file(CANNON_JSON_PATH)
    if c1 or c2:
        print("Updates made.")
    else:
        print("No updates made.")
