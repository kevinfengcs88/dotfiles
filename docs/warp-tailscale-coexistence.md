# Running Cloudflare WARP + Tailscale together on macOS

Goal: keep **Cloudflare WARP** in full "Traffic and DNS (HTTPS)" mode (encrypts all
traffic + DNS to Cloudflare on untrusted Wi-Fi) **while Tailscale stays connected** so I
can SSH to the home Linux desktop (`pop-os`).

Out of the box the two can't coexist: both are system VPNs, and WARP swallows the
connections Tailscale needs (control plane + DERP relays), which logs Tailscale out.
The fix is to enroll WARP in Cloudflare Zero Trust and carve Tailscale's IP ranges out
of WARP's tunnel via Split Tunnels.

> Do NOT enable a Tailscale **exit node** on this Mac. That turns Tailscale into a
> full-traffic VPN, overrides the split tunnel, and breaks coexistence. SSH-only is the
> supported lane.

## Root cause and the corrected mechanism

- WARP (Gateway with WARP / MASQUE) tunnels 100% of traffic + DNS to Cloudflare.
- Tailscale needs to reach `controlplane.tailscale.com:443` to stay authenticated, and
  **DERP relays** when a direct peer connection isn't available (i.e. on any foreign
  network — café, hotel, phone hotspot — where `pop-os` isn't on the local LAN).
- **The mechanism:** Tailscale binds its sockets to the **physical interface source
  IP**. If a Tailscale destination is routed *through WARP*, the physical source IP no
  longer matches the tunnel's path, and long-lived/streaming connections silently break
  — control plane fails with `write: broken pipe`; a DERP relay shows `tx … rx 0`
  ("could not connect to relay"). Short one-shot requests (a `curl` GET) may still
  return 200, which is misleading — the *relay session* is what breaks.
- **Therefore every Tailscale control/DERP range must be EXCLUDED so it routes direct
  over the physical interface, not through WARP.** This applies to **both IPv4 and
  IPv6**.
- A **domain-based** exclude (`tailscale.com`) does NOT work: WARP learns domain→IP by
  snooping system DNS, but Tailscale resolves these via its own **bootstrap DNS**, so
  WARP never sees the lookup. Exclude by **IP range**.
- An exclude can never *break* reachability or normal browsing — it only reroutes those
  specific Tailscale IPs to go direct. So home and phone-hotspot usage stay safe.

## The working setup

### 1. Create a free Cloudflare Zero Trust org

- dash.cloudflare.com → **Zero Trust** → team name `kevinfeng` → **Zero Trust Free**
  plan (asks for a card but charges $0).

### 2. Allow this device to enroll

Fresh orgs reject all enrollment ("Enrollment request is invalid") until a policy exists.

- **Team & Resources → Devices → Device enrollment permissions → Manage**
- Policies/Rules tab → **Add a rule**: Include → Emails → `kevinfeng.cs88@gmail.com`.
- Login method One-time PIN is on by default (no IdP needed).

### 3. Enroll the WARP app into the org

- WARP app → one app, two modes. Choose **Cloudflare One Client** (not "Private
  browsing") → **Continue** → enter team name `kevinfeng` → verify via emailed PIN.
- Confirm: **Connectivity** tab shows `WARP tunnel protocol: MASQUE (HTTPS via UDP)` +
  `DNS over HTTPS`, status **Connected**.

### 4. Split Tunnels — exclude Tailscale (the core fix)

**Team & Resources → Devices → Device profiles → (Default profile) Configure →
Split Tunnels → Exclude IPs and domains → Manage.** Add these IP destinations:

| Value                  | Covers                                              |
| ---------------------- | --------------------------------------------------- |
| `100.64.0.0/10`        | Tailnet IPv4 (CGNAT) — peer addresses               |
| `fd7a:115c:a1e0::/48`  | Tailnet IPv6 (ULA)                                  |
| `2606:b740::/32`       | Control plane + logging (IPv6)                      |
| `192.200.0.0/24`       | Control plane (IPv4)                                |
| `199.165.136.0/24`     | Logging (IPv4)                                      |
| `2607:f740::/32`       | Tailscale-hosted DERP over IPv6 (NOT third-party DERP — see gap)  |
| `199.38.181.0/24`      | NYC DERP (IPv4)                                      |
| `209.177.145.0/24`     | NYC DERP (IPv4)                                      |
| `162.248.221.0/24`     | Toronto DERP (IPv4)                                 |

### 5. Local Domain Fallback — keep MagicDNS working

DNS flows through WARP now, so hand `.ts.net` back to Tailscale.

- Same device profile → **Local Domain Fallback → Manage**
- Add `ts.net` → DNS server `100.100.100.100`.

### 6. Propagate

Split-tunnel changes take **up to ~10 minutes** to reach the device. Force a re-pull by
Disconnecting/Connecting WARP. Don't conclude it's broken before propagation.

### 7. macOS: expose the Tailscale CLI

The GUI app keeps the binary in its bundle. In `home/.zshrc` (Darwin branch only):

```sh
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
```

## DERP relays: the travel-coverage gap

DERP picks the **geographically nearest** relay. The IPv4 DERP excludes above cover
**NYC + Toronto** only — enough for home and the NYC area (including phone hotspot that
egresses there). On a network in another region, Tailscale picks a different DERP whose range isn't
excluded, and SSH breaks *there* (same `rx 0` symptom). Note the manual `2607:f740::/32`
rule only covers **Tailscale-hosted** DERP over IPv6 — DERP servers are actually spread
across ~13 provider blocks (Vultr, Hetzner, Linode, …), so it is **not** full v6
coverage.

Full coverage = every DERP relay IP (~47 IPv4 `/24`s + ~37 IPv6 `/64`s), and the set
**drifts over time** as Tailscale adds/moves relays. Hand-maintaining that isn't
durable. The sync script (`scripts/sync-warp-tailscale-excludes.py`) solves it: it pulls
the live DERP map and sets the WARP Split Tunnel exclude list via the Cloudflare API,
keeping prefixes tight (/24, /64) so no whole provider block leaks outside WARP. Once it
runs, the Tailscale/DERP excludes are managed by the script — no manual UI editing.

## Verification

```sh
# WARP is tunneling everything (note: NO trailing slash on the URL)
curl https://www.cloudflare.com/cdn-cgi/trace | grep warp=        # -> warp=on

# Tailscale is up and sees the desktop; relay path is healthy (rx > 0)
tailscale status                                                  # pop-os present
tailscale ping pop-os                                             # pong via DERP(...)

# The real test (uses ~/.zshrc alias `kevin` = ssh kevin@pop-os)
ssh kevin@pop-os
```

`UDP: false` / "direct connection not established" in `tailscale netcheck` is expected
here — relaying through DERP over TCP is fine for SSH. Inspect what WARP actually has
live on the device with `warp-cli settings` (shows the Exclude-mode list + Fallback
domains).

## Reference: get current DERP relay IPs

```sh
curl -s https://login.tailscale.com/derpmap/default | python3 -c "
import json,sys
d=json.load(sys.stdin)
for c,r in d['Regions'].items():
    for n in r.get('Nodes',[]): print(c, n.get('HostName'), n.get('IPv4'), n.get('IPv6'))
"
```

## Sources

- Tailscale, "Can I use Tailscale alongside other VPNs?" — https://tailscale.com/docs/reference/faq/other-vpns
- Tailscale, "What firewall ports should I open?" (static control/log ranges) — https://tailscale.com/docs/reference/faq/firewall-ports
- Cloudflare One, "Split Tunnels" — https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/warp/configure-warp/route-traffic/split-tunnels/
- mxin, "Running Tailscale and Cloudflare WARP Together on macOS" — https://mxcao.me/posts/tailscale-cloudflare-warp-coexistence/
