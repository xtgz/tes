import requests
import threading
import time
from queue import Queue

INPUT_FILE  = "proxyscrap.txt"
OUTPUT_FILE = "proxy.txt"
TEST_URL    = "http://httpbin.org/ip"
TIMEOUT     = 8       # detik
THREADS     = 100     # makin besar makin cepat (tapi makan RAM)

live_proxies = []
lock = threading.Lock()
stats = {"total": 0, "live": 0, "dead": 0}

def log(msg):
    print(msg, flush=True)

def test_proxy(proxy: str) -> bool:
    scheme = proxy.split("://")[0]

    if scheme in ("socks4", "socks5"):
        proxy_dict = {"http": proxy, "https": proxy}
    else:
        proxy_dict = {"http": proxy, "https": proxy}

    try:
        r = requests.get(TEST_URL, proxies=proxy_dict, timeout=TIMEOUT)
        return r.status_code == 200
    except:
        return False

def worker(queue: Queue):
    while not queue.empty():
        proxy = queue.get()
        alive = test_proxy(proxy)

        with lock:
            stats["total"] += 1
            done  = stats["total"]
            total = stats["_total"]

            if alive:
                stats["live"] += 1
                live_proxies.append(proxy)
                status = f"\033[92m✔ LIVE\033[0m"
            else:
                stats["dead"] += 1
                status = f"\033[91m✘ DEAD\033[0m"

            pct = done / total * 100
            print(f"  [{done}/{total}] {pct:5.1f}%  {status}  {proxy}")

        queue.task_done()

def main():
    print("=" * 55)
    print("  PROXY TESTER")
    print("=" * 55)

    # Baca proxy.txt
    try:
        with open(INPUT_FILE, "r") as f:
            proxies = [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        log(f"[ERROR] File '{INPUT_FILE}' tidak ditemukan. Jalankan proxy_scraper.py dulu.")
        return

    if not proxies:
        log("[ERROR] proxy.txt kosong.")
        return

    total = len(proxies)
    stats["_total"] = total
    log(f"  Total proxy  : {total}")
    log(f"  Threads      : {THREADS}")
    log(f"  Timeout      : {TIMEOUT}s")
    log(f"  Test URL     : {TEST_URL}")
    print("=" * 55)

    start = time.time()

    # Masukkan ke queue
    q = Queue()
    for p in proxies:
        q.put(p)

    # Spawn threads
    threads = []
    for _ in range(min(THREADS, total)):
        t = threading.Thread(target=worker, args=(q,), daemon=True)
        t.start()
        threads.append(t)

    q.join()

    elapsed = time.time() - start

    # Simpan proxy live
    with open(OUTPUT_FILE, "w") as f:
        for p in sorted(set(live_proxies)):
            f.write(p + "\n")

    # Ringkasan
    print("=" * 55)
    print(f"  Selesai dalam  : {elapsed:.1f} detik")
    print(f"  Total ditest   : {stats['total']}")
    print(f"  \033[92mLIVE\033[0m           : {stats['live']}")
    print(f"  \033[91mDEAD\033[0m           : {stats['dead']}")
    print(f"  Disimpan di    : {OUTPUT_FILE}")
    print("=" * 55)

    # Ringkasan per tipe
    for scheme in ["http", "https", "socks4", "socks5"]:
        count = sum(1 for p in live_proxies if p.startswith(scheme + "://"))
        if count:
            print(f"  {scheme+'://':<12} {count} live")

if __name__ == "__main__":
    main()
