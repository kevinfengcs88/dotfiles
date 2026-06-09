#!/usr/bin/env python3
"""
sync-warp-tailscale-excludes.py

Keep Cloudflare WARP (Zero Trust) and Tailscale coexisting on a foreign network
by syncing the WARP Split Tunnel *exclude* list to the live set of Tailscale
ranges — static control/logging/tailnet ranges plus every DERP relay, pulled
fresh from Tailscale's DERP map.

Why this exists: Tailscale binds to the physical interface, so its control-plane
and DERP-relay traffic must bypass WARP (be "excluded") or long-lived connections
break. The DERP relay set drifts over time and varies by region (travel), so
hand-maintaining ~47 IPv4 /24s in the dashboard isn't durable. This script makes
the exclude list self-maintaining.

It is SAFE to run repeatedly:
  - It only manages entries it owns (tagged with MARKER in the description).
  - All other excludes — WARP's built-in private/multicast defaults and any rules
    you added by hand — are read back and preserved verbatim.
  - Addresses already present are not duplicated.

Requirements (environment variables):
  CLOUDFLARE_API_TOKEN   API token with permission: Account > Zero Trust > Edit
  CF_ACCOUNT_ID          Your Cloudflare account ID
                         (dash.cloudflare.com -> Zero Trust -> account id in URL,
                          or Account Home -> right sidebar "Account ID")

Usage:
  export CLOUDFLARE_API_TOKEN=...   # keep this secret, never commit it
  export CF_ACCOUNT_ID=...
  python3 sync-warp-tailscale-excludes.py            # apply
  python3 sync-warp-tailscale-excludes.py --dry-run  # show the plan, change nothing

Notes:
  - Targets the DEFAULT device profile's exclude list (/devices/policy/exclude).
  - Stdlib only; no pip installs.
"""

import json
import os
import sys
import ipaddress
import urllib.request
import urllib.error

MARKER = "[ts-sync]"  # tags entries this script owns; do not edit tagged rows by hand
DERPMAP_URL = "https://login.tailscale.com/derpmap/default"
CF_API = "https://api.cloudflare.com/client/v4"

# Static Tailscale ranges that must always be excluded (direct, not through WARP).
# Kept here so the script is self-sufficient even if the manual dashboard rows are
# later deleted.
STATIC = [
    ("100.64.0.0/10",       "Tailnet IPv4 (CGNAT) peer addresses"),
    ("fd7a:115c:a1e0::/48", "Tailnet IPv6 (ULA)"),
    ("2606:b740::/32",      "Tailscale control plane + logging (IPv6)"),
    ("192.200.0.0/24",      "Tailscale control plane (IPv4)"),
    ("199.165.136.0/24",    "Tailscale logging (IPv4)"),
]


def http_json(method, url, token=None, body=None):
    """Minimal JSON HTTP helper using urllib."""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        sys.exit(f"HTTP {e.code} on {method} {url}\n{detail}")
    except urllib.error.URLError as e:
        sys.exit(f"Network error on {method} {url}: {e}")


def fetch_derp_ranges():
    """Pull the live DERP map and collapse relay IPs to tight networks.

    DERP servers are scattered across many cloud providers, so we deliberately
    keep the prefixes SMALL to avoid excluding whole provider blocks from WARP
    (which would leak unrelated traffic outside the tunnel):
      IPv4 -> /24  (a little headroom; modest collateral)
      IPv6 -> /64  (a single host subnet; negligible collateral)
    The script re-syncs to catch any IP drift, so we don't need wide prefixes.
    Returns a list of (cidr_str, description).
    """
    doc = http_json("GET", DERPMAP_URL)  # public, no auth
    v4_nets, v6_nets = set(), set()
    for code, region in doc.get("Regions", {}).items():
        for node in region.get("Nodes", []):
            ip4 = node.get("IPv4")
            ip6 = node.get("IPv6")
            if ip4:
                v4_nets.add(ipaddress.ip_network(f"{ip4}/24", strict=False))
            if ip6:
                v6_nets.add(ipaddress.ip_network(f"{ip6}/64", strict=False))
    out = []
    for n in sorted(v4_nets, key=lambda x: int(x.network_address)):
        out.append((str(n), "Tailscale DERP relay (IPv4)"))
    for n in sorted(v6_nets, key=lambda x: int(x.network_address)):
        out.append((str(n), "Tailscale DERP relay (IPv6)"))
    return out


def norm(addr):
    """Normalize a CIDR/IP for dedup comparison."""
    try:
        return str(ipaddress.ip_network(addr, strict=False))
    except ValueError:
        return addr


def main():
    dry = "--dry-run" in sys.argv
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    account = os.environ.get("CF_ACCOUNT_ID")
    if not token or not account:
        sys.exit("Set CLOUDFLARE_API_TOKEN and CF_ACCOUNT_ID environment variables.")

    exclude_url = f"{CF_API}/accounts/{account}/devices/policy/exclude"

    # 1. Read the current exclude list.
    current = http_json("GET", exclude_url, token).get("result", []) or []

    # 2. Preserve everything we don't own (WARP defaults + your manual rules).
    preserved = [e for e in current if not str(e.get("description", "")).startswith(MARKER)]
    preserved_addrs = {norm(e["address"]) for e in preserved if e.get("address")}

    # 3. Build the managed set: static Tailscale ranges + live DERP ranges.
    managed_src = STATIC + fetch_derp_ranges()
    managed = []
    seen = set()
    for cidr, desc in managed_src:
        key = norm(cidr)
        if key in seen or key in preserved_addrs:
            continue  # skip dupes and anything already present manually
        seen.add(key)
        managed.append({"address": cidr, "description": f"{MARKER} {desc}"})

    new_list = preserved + managed

    # 4. Report the plan.
    old_managed = [e for e in current if str(e.get("description", "")).startswith(MARKER)]
    print(f"Current excludes: {len(current)} "
          f"({len(old_managed)} {MARKER}-managed, {len(preserved)} preserved)")
    print(f"New managed set:  {len(managed)} entries "
          f"({sum(1 for c,_ in managed_src)} sources, dupes/preserved skipped)")
    print(f"Total after sync: {len(new_list)}")
    if dry:
        print("\n--dry-run: managed entries that WOULD be set:")
        for e in managed:
            print(f"  {e['address']:<22} {e['description']}")
        print("\nNo changes made.")
        return

    # 5. Apply.
    http_json("PUT", exclude_url, token, body=new_list)
    print("\nApplied. (Allow up to ~10 min for devices to pull the new policy;"
          " Disconnect/Connect WARP to force it.)")


if __name__ == "__main__":
    main()
