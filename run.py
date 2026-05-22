"""
run.py — Manual pipeline runner
================================
Runs scripts in the correct order with timing and logging.

Usage:
  python3 run.py                       # full pipeline
  python3 run.py --skip-universe       # skip universe.py
  python3 run.py --only-sheets         # sheets.py only (instant)
  python3 run.py --only-deepdive       # deepdive.py only
  python3 run.py --from fundamentals   # start from fundamentals onwards
  python3 run.py --from model          # start from model onwards
  python3 run.py --from sheets         # sheets + deepdive

Log: run.log (appended each run)
"""

import argparse, subprocess, sys, os, time
from datetime import datetime

LOG_FILE = "run.log"
SCRIPTS  = ["universe.py", "fundamentals.py", "model.py", "sheets.py", "deepdive.py"]
DIV      = "=" * 58


def log(msg):
    ts   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f: f.write(line + "\n")


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

def run_script(script):
    path = os.path.join(SCRIPT_DIR, script)
    if not os.path.exists(path):
        log(f"❌ {script} not found at {path}"); return False

    log(f"▶  Starting {script} …")
    start = time.time()
    try:
        # cwd=SCRIPT_DIR ensures scripts save Excel/JSON to the Stock Tracker
        # folder regardless of where the terminal was when run.py was launched.
        result  = subprocess.run([sys.executable, path], cwd=SCRIPT_DIR)
        elapsed = round(time.time() - start, 1)
        if result.returncode == 0:
            log(f"✅ {script} completed in {elapsed}s"); return True
        else:
            log(f"❌ {script} exited code {result.returncode} after {elapsed}s"); return False
    except Exception as e:
        log(f"❌ {script} crashed: {e}"); return False


def parse_args():
    p = argparse.ArgumentParser(description="Stock Tracker pipeline runner")
    p.add_argument("--skip-universe",  action="store_true")
    p.add_argument("--only-sheets",    action="store_true")
    p.add_argument("--only-deepdive",  action="store_true")
    p.add_argument("--from", dest="from_script", metavar="SCRIPT",
                   choices=["universe", "fundamentals", "model", "sheets", "deepdive"])
    return p.parse_args()


def main():
    args    = parse_args()
    scripts = list(SCRIPTS)

    if   args.only_sheets:    scripts = ["sheets.py"]
    elif args.only_deepdive:  scripts = ["deepdive.py"]
    elif args.skip_universe:  scripts = [s for s in scripts if s != "universe.py"]
    elif args.from_script:
        idx     = [s.replace(".py", "") for s in scripts].index(args.from_script)
        scripts = scripts[idx:]

    # Skip deepdive silently if no tickers saved (don't block the pipeline)
    if "deepdive.py" in scripts:
        dd_list = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "deepdive_tickers.json")
        if not os.path.exists(dd_list):
            scripts = [s for s in scripts if s != "deepdive.py"]
            # Will silently skip — user hasn't added any tickers yet

    log(DIV)
    log(f"  Stock Tracker — Pipeline Run")
    log(f"  Scripts: {', '.join(scripts)}")
    log(DIV)

    t0      = time.time()
    results = {}

    for script in scripts:
        log(DIV)
        ok              = run_script(script)
        results[script] = ok
        if not ok: log(f"⚠️  {script} failed — continuing")
        log("")

    log(DIV)
    log(f"  Complete — {round(time.time() - t0, 1)}s total")
    log(DIV)
    for script, ok in results.items():
        log(f"  {script:<22}  {'✅ OK' if ok else '❌ FAILED'}")
    log(DIV)

    failed = [s for s, ok in results.items() if not ok]
    if failed:
        log(f"\n⚠️  {len(failed)} script(s) failed. Check run.log.")
        sys.exit(1)
    else:
        log("\n🎉 All scripts completed successfully.")
        sys.exit(0)


if __name__ == "__main__":
    main()
