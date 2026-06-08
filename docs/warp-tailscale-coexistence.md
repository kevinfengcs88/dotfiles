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

## Why it conflicts (root cause)

- WARP (Gateway with WARP / MASQUE) tunnels 100% of traffic + DNS to Cloudflare.
- Tailscale needs to reach `controlplane.tailscale.com:443` to stay authenticated, and
  DERP relays for fallback when a direct peer connection isn't available.
- WARP intercepts those connections → `write: broken pipe` on the control key fetch →
  Tailscale logs itself out (and can't even log back in, because login also needs the
  control plane).
- A **domain-based** WARP exclude (`tailscale.com`) does NOT fix this: WARP learns
  domain→IP by snooping system DNS, but Tailscale resolves the control plane via its own
  **bootstrap DNS**, so WARP never sees the lookup. Exclude by **IP range** instead.

## The working setup

### 1. Create a free Cloudflare Zero Trust org

- dash.cloudflare.com → **Zero Trust** → pick a team name (`kevinfeng`) → **Zero Trust
  Free** plan (asks for a card but charges $0).

### 2. Allow this device to enroll

Fresh orgs reject all enrollment ("Enrollment request is invalid") until a policy exists.

- **Team & Resources → Devices → Device enrollment permissions → Manage**
- Policies/Rules tab → **Add a rule**: Include → Emails → `kevinfeng.cs88@gmail.com`.
- Login method One-time PIN is on by default (no IdP needed).

### 3. Enroll the WARP app into the org

- WARP app → it's one app, two modes. Choose **Cloudflare One Client** (not "Private
  browsing") → **Continue** → enter team name `kevinfeng` → verify via emailed PIN.
- Confirm: **Connectivity** tab shows `WARP tunnel protocol: MASQUE (HTTPS via UDP)` +
  `DNS over HTTPS`, status **Connected**. That's the full Traffic+DNS tunnel.

### 4. Split Tunnels — exclude Tailscale (the core fix)

**Team & Resources → Devices → Device profiles → (Default profile) Configure →
Split Tunnels → Exclude IPs and domains → Manage.** Add these IP destinations:

| Value                  | Covers                                          |
| ---------------------- | ----------------------------------------------- |
| `100.64.0.0/10`        | Tailnet IPv4 (CGNAT) — peer addresses           |
| `fd7a:115c:a1e0::/48`  | Tailnet IPv6 (ULA)                              |
| `2606:b740::/32`       | Control plane + logging (all of it, IPv6)       |
| `2607:f740::/32`       | All DERP relays, every region (IPv6)            |
| `192.200.0.0/24`       | Control plane (IPv4)                            |
| `199.165.136.0/24`     | Logging (IPv4)                                  |

The two IPv6 `/32`s are the durable win: they cover control, logging, and every DERP
region permanently, surviving IP churn and travel. (A `tailscale.com` domain rule is
harmless but ineffective — see root cause.)

IPv4 DERP fallback (only if `tailscale ping pop-os` fails on the relay path after login;
NYC region example, get others from the DERP map command below):
`199.38.181.0/24`, `209.177.145.0/24`.

### 5. Local Domain Fallback — keep MagicDNS working

DNS flows through WARP now, so hand `.ts.net` back to Tailscale.

- Same device profile → **Local Domain Fallback → Manage**
- Add `ts.net` → DNS server `100.100.100.100` (Tailscale's MagicDNS resolver).

### 6. Propagate (important!)

Split-tunnel changes take **up to ~10 minutes** to reach the device. Don't conclude it's
broken before then. To force a re-pull: Disconnect/Connect WARP. Login worked here once
propagation completed.

### 7. macOS: expose the Tailscale CLI

The GUI app keeps the binary in its bundle. Added to `home/.zshrc` (Darwin branch only):

```sh
alias tailscale="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
```

## Verification

```sh
# WARP is tunneling everything (note: NO trailing slash on the URL)
curl https://www.cloudflare.com/cdn-cgi/trace | grep warp=        # -> warp=on
# or open https://1.1.1.1/help in a browser

# Tailscale is up and sees the desktop
tailscale status                                                  # pop-os present
tailscale ping pop-os

# The real test (uses ~/.zshrc alias `kevin` = ssh kevin@pop-os)
ssh kevin@pop-os
```

Inspect what WARP actually has live on the device (great for debugging "did it
propagate?"):

```sh
warp-cli settings        # shows Exclude-mode hosts/ips + Fallback domains
```

Done when `warp=on` AND `ssh kevin@pop-os` connects.

## Reference: get current DERP relay IPs

```sh
curl -s https://login.tailscale.com/derpmap/default | \
  python3 -c "import json,sys; d=json.load(sys.stdin); [print(c, [ (n.get('HostName'),n.get('IPv4'),n.get('IPv6')) for n in r.get('Nodes',[]) ]) for c,r in d['Regions'].items()]"
```

## Sources

- Tailscale, "Can I use Tailscale alongside other VPNs?" — https://tailscale.com/docs/reference/faq/other-vpns
- Tailscale, "What firewall ports should I open?" (static control/log ranges) — https://tailscale.com/docs/reference/faq/firewall-ports
- Cloudflare One, "Split Tunnels" — https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/warp/configure-warp/route-traffic/split-tunnels/
- mxin, "Running Tailscale and Cloudflare WARP Together on macOS" — https://mxcao.me/posts/tailscale-cloudflare-warp-coexistence/
