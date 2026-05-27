"""
pol_refresh.py — Daily orchestrator for political + insider trade ingestion
Usage:
  python pol_refresh.py            # incremental update (default)
  python pol_refresh.py --full     # full refresh from scratch
  python pol_refresh.py --senate   # senate only
  python pol_refresh.py --edgar    # insider trades only
  python pol_refresh.py --committees # committee data only
"""
import sys, time
from datetime import datetime

FULL     = "--full"      in sys.argv
SENATE   = "--senate"    in sys.argv
CONGRESS = "--congress"  in sys.argv
EDGAR    = "--edgar"     in sys.argv
COMS     = "--committees" in sys.argv
ALL      = not any([SENATE, CONGRESS, EDGAR, COMS])

DIV = "=" * 58

def log(msg):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}")


def run_step(name, fn, *args, **kwargs):
    log(f"▶  Starting {name}…")
    t0 = time.time()
    try:
        fn(*args, **kwargs)
        log(f"✅ {name} completed in {round(time.time()-t0,1)}s")
        return True
    except Exception as e:
        log(f"❌ {name} failed: {e}")
        return False


def main():
    log(DIV)
    log("  Political Data Refresh")
    log(f"  Mode: {'full' if FULL else 'incremental'}")
    log(DIV)

    results = {}

    if ALL or COMS:
        from ingest_committees import ingest as ingest_committees
        results["committees"] = run_step("committees", ingest_committees)

    if ALL or CONGRESS:
        from ingest_congress import ingest as ingest_congress
        results["congress"] = run_step("congress", ingest_congress, full_refresh=FULL)

    if SENATE:   # only when explicitly requested — legacy fallback source
        from ingest_senate import ingest as ingest_senate
        results["senate"] = run_step("senate", ingest_senate, full_refresh=FULL)

    if ALL or EDGAR:
        from ingest_edgar import ingest as ingest_edgar
        results["edgar"] = run_step("edgar", ingest_edgar, full_refresh=FULL)

    log(DIV)
    for step, ok in results.items():
        log(f"  {step:<20} {'✅ OK' if ok else '❌ FAILED'}")
    log(DIV)

    failed = [s for s, ok in results.items() if not ok]
    if failed:
        log(f"⚠  {len(failed)} step(s) failed.")
        sys.exit(1)
    else:
        log("🎉 Political data refresh complete.")
        sys.exit(0)


if __name__ == "__main__":
    main()
