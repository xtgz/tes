import requests
from bs4 import BeautifulSoup
import re
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

proxies_collected = []

def log(msg):
    print(f"[INFO] {msg}")

# ─────────────────────────────────────────
# 1. https://free-proxy-list.net  (HTTP/HTTPS)
# ─────────────────────────────────────────
def scrape_free_proxy_list():
    log("Scraping free-proxy-list.net ...")
    try:
        r = requests.get("https://free-proxy-list.net/", headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        rows = soup.select("table tbody tr")
        count = 0
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 7:
                continue
            ip   = cols[0].text.strip()
            port = cols[1].text.strip()
            https = cols[6].text.strip().lower()
            scheme = "https" if https == "yes" else "http"
            proxies_collected.append(f"{scheme}://{ip}:{port}")
            count += 1
        log(f"  → {count} proxy ditemukan")
    except Exception as e:
        log(f"  ✗ Gagal: {e}")

# ─────────────────────────────────────────
# 2. https://sslproxies.org  (HTTPS)
# ─────────────────────────────────────────
def scrape_ssl_proxies():
    log("Scraping sslproxies.org ...")
    try:
        r = requests.get("https://www.sslproxies.org/", headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        rows = soup.select("table tbody tr")
        count = 0
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 2:
                continue
            ip   = cols[0].text.strip()
            port = cols[1].text.strip()
            proxies_collected.append(f"https://{ip}:{port}")
            count += 1
        log(f"  → {count} proxy ditemukan")
    except Exception as e:
        log(f"  ✗ Gagal: {e}")

# ─────────────────────────────────────────
# 3. https://www.socks-proxy.net  (SOCKS4/5)
# ─────────────────────────────────────────
def scrape_socks_proxy():
    log("Scraping socks-proxy.net ...")
    try:
        r = requests.get("https://www.socks-proxy.net/", headers=HEADERS, timeout=10)
        soup = BeautifulSoup(r.text, "html.parser")
        rows = soup.select("table tbody tr")
        count = 0
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 5:
                continue
            ip      = cols[0].text.strip()
            port    = cols[1].text.strip()
            version = cols[4].text.strip().lower()   # "socks4" or "socks5"
            scheme  = "socks5" if "5" in version else "socks4"
            proxies_collected.append(f"{scheme}://{ip}:{port}")
            count += 1
        log(f"  → {count} proxy ditemukan")
    except Exception as e:
        log(f"  ✗ Gagal: {e}")

# ─────────────────────────────────────────
# 4. https://proxyscrape.com  (HTTP/SOCKS4/SOCKS5 via API)
# ─────────────────────────────────────────
def scrape_proxyscrape():
    endpoints = {
        "http":   "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all",
        "socks4": "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=5000&country=all",
        "socks5": "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all",
    }
    for scheme, url in endpoints.items():
        log(f"Scraping proxyscrape.com ({scheme}) ...")
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            lines = r.text.strip().splitlines()
            count = 0
            for line in lines:
                line = line.strip()
                if re.match(r"^\d+\.\d+\.\d+\.\d+:\d+$", line):
                    proxies_collected.append(f"{scheme}://{line}")
                    count += 1
            log(f"  → {count} proxy ditemukan")
        except Exception as e:
            log(f"  ✗ Gagal: {e}")

# ─────────────────────────────────────────
# 5. https://raw.githubusercontent.com (TheSpeedX list)
# ─────────────────────────────────────────
def scrape_github_speedx():
    sources = {
        "http":   "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
        "socks4": "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt",
        "socks5": "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
    }
    for scheme, url in sources.items():
        log(f"Scraping TheSpeedX GitHub ({scheme}) ...")
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            lines = r.text.strip().splitlines()
            count = 0
            for line in lines:
                line = line.strip()
                if re.match(r"^\d+\.\d+\.\d+\.\d+:\d+$", line):
                    proxies_collected.append(f"{scheme}://{line}")
                    count += 1
            log(f"  → {count} proxy ditemukan")
        except Exception as e:
            log(f"  ✗ Gagal: {e}")

# ─────────────────────────────────────────
# 6. https://raw.githubusercontent.com (hookzof list)
# ─────────────────────────────────────────
def scrape_github_hookzof():
    sources = {
        "socks5": "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
    }
    for scheme, url in sources.items():
        log(f"Scraping hookzof GitHub ({scheme}) ...")
        try:
            r = requests.get(url, headers=HEADERS, timeout=10)
            lines = r.text.strip().splitlines()
            count = 0
            for line in lines:
                line = line.strip()
                if re.match(r"^\d+\.\d+\.\d+\.\d+:\d+$", line):
                    proxies_collected.append(f"{scheme}://{line}")
                    count += 1
            log(f"  → {count} proxy ditemukan")
        except Exception as e:
            log(f"  ✗ Gagal: {e}")

# ─────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────
def main():
    print("=" * 50)
    print("  FREE PROXY SCRAPER")
    print("=" * 50)

    scrape_free_proxy_list()
    scrape_ssl_proxies()
    scrape_socks_proxy()
    scrape_proxyscrape()
    scrape_github_speedx()
    scrape_github_hookzof()

    # Deduplikasi
    unique = sorted(set(proxies_collected))

    # Simpan ke proxy.txt
    output_file = "proxy.txt"
    with open(output_file, "w") as f:
        for proxy in unique:
            f.write(proxy + "\n")

    print("=" * 50)
    print(f"  Total proxy unik : {len(unique)}")
    print(f"  Disimpan di      : {output_file}")
    print("=" * 50)

    # Ringkasan per tipe
    for scheme in ["http", "https", "socks4", "socks5"]:
        count = sum(1 for p in unique if p.startswith(scheme + "://"))
        print(f"  {scheme + '://':<12} {count} proxy")

if __name__ == "__main__":
    main()
