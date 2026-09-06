# Deploying rishabhkushwaha.com

Static build, rsynced to the Oracle Ampere box, served by Caddy. Same box and
same Caddy that already serve `sarathi.`, using the existing one-file-per-project
layout — `/etc/caddy/sites.d/<project>.caddy`. Nothing here touches the main
Caddyfile and nothing here can disturb Sarathi.

Do it in this order. Steps 1–5 get the site live on the origin; only then does
the orange cloud go on. Flipping the proxy before the certificate exists is the
one way to make this annoying.

---

## 1. Build locally

```bash
npm ci
npm run build          # -> dist/
```

Output is hashed assets plus `index.html`. Nothing is generated at request time.

## 2. Make the directories on the box

Two of them, and the split is load-bearing:

```bash
ssh oracle 'sudo mkdir -p /srv/portfolio/site /srv/portfolio/files \
            && sudo chown -R $USER:$USER /srv/portfolio'
```

| Path | What it holds | Survives a deploy? |
|---|---|---|
| `/srv/portfolio/site` | the rsync target | no — wiped and rewritten |
| `/srv/portfolio/files` | `resume.pdf` | yes — deploys never touch it |

## 3. Put the resume where deploys cannot reach it

```bash
scp Rishabh_Singh_Kushwaha_Resume.pdf oracle:/srv/portfolio/files/resume.pdf
```

This is why the resume is not in `public/`: it would land inside `dist/`, and
step 5 uses `rsync --delete`. Updating the CV later is this one command — no
build, no restart, no upload endpoint to defend.

## 4. Write the site file

`/etc/caddy/sites.d/portfolio.caddy` — one file, named after the project, per
the convention in `deploy/caddy/README.txt` on the Sarathi side:

```caddy
rishabhkushwaha.com, www.rishabhkushwaha.com {
	encode zstd gzip

	# Served from outside the rsync target, so a deploy cannot wipe it.
	handle /resume.pdf {
		root * /srv/portfolio/files
		file_server
	}

	handle {
		root * /srv/portfolio/site
		try_files {path} {path}/
		file_server

		# Filenames are content-hashed, so these can be cached hard.
		@immutable path /assets/*
		header @immutable Cache-Control "public, max-age=31536000, immutable"

		# HTML is not, and must not be, or a deploy goes unnoticed for a year.
		header /*.html Cache-Control "public, max-age=0, must-revalidate"
	}

	# A missing page must ANSWER 404, not 200 carrying the 404 page's body.
	# Putting /404.html in try_files above does the latter: every typo and
	# every dead link returns "success", and a crawler indexes them all as
	# real pages. handle_errors serves the same page with the real status.
	handle_errors {
		root * /srv/portfolio/site
		rewrite * /404.html
		file_server
	}
}
```

Validate before reloading — a reload keeps the old config if the new one is bad:

```bash
ssh oracle 'caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy'
```

## 5. Ship

```bash
rsync -az --delete dist/ oracle:/srv/portfolio/site/
```

## 6. DNS — grey first

Add both records **grey (DNS only)** to begin with:

```
rishabhkushwaha.com.      A   <box IP>    DNS only
www.rishabhkushwaha.com.  A   <box IP>    DNS only
```

Then wait for Caddy to get its certificate and confirm the origin really works:

```bash
curl -sSI https://rishabhkushwaha.com | head -3
curl -sSI https://rishabhkushwaha.com/resume.pdf | head -3
curl -sSI https://rishabhkushwaha.com/nope | head -3     # must say 404
```

The first two must be `200` and the third `404` before going further. A
`404` on `/resume.pdf` with an empty body means Caddy's `handle` block is
matching but the file is not in `/srv/portfolio/files` — step 3 was skipped.
A *styled* page there instead means the block is missing from the site file. Caddy obtains the certificate over
HTTP-01, so the name has to resolve to the box first — that is the whole reason
this step comes before the proxy.

## 7. Now turn the orange cloud on

Flip both records to **Proxied**, and set **SSL/TLS → Full (strict)**.

Why bother: the origin sits in Oracle's **UK** region and the people you want
reading this are in **India** — roughly 120–150 ms per round trip, and a page
with a 3D hero makes a lot of them. Proxied, Cloudflare serves the hashed assets
from its Indian edge and most requests never reach Oracle at all. It also hides
the origin IP.

Leave `sarathi.` **grey**. Its telemetry socket should go straight to the box.

**The one gotcha:** Cloudflare terminates TLS on 443, so Caddy's TLS-ALPN-01
challenge can no longer succeed for the proxied hostname. HTTP-01 still works,
because Cloudflare proxies port 80 through and deliberately exempts
`/.well-known/acme-challenge/` from Always Use HTTPS. Renewal therefore keeps
working — but if you ever see a renewal failure in `journalctl -u caddy`, that
is where to look first, and the fix is a Cloudflare Origin Certificate pinned
with a `tls` directive rather than fighting ACME.

## 8. Analytics

Cloudflare Web Analytics: aggregate, cookieless, no consent banner, free, and
already in the account that holds the domain.

Two ways, pick one:

- **Zero code.** With the hostname proxied, Cloudflare can inject the beacon
  itself: dashboard → Web Analytics → add `rishabhkushwaha.com` → enable
  automatic setup. Nothing to build, nothing to redeploy.
- **Explicit.** Copy the beacon token and build with it:
  ```bash
  PUBLIC_CF_BEACON=<token> npm run build
  ```
  `Base.astro` emits the tag only when that variable is set, so an ordinary
  build stays clean.

What it will and will not tell you, since you asked: it will **not** identify
anyone. What is actually worth reading is (a) the referrer, which tells you
whether the LinkedIn outreach converts to visits, (b) which sections hold
attention, which tells you what to lead with, and (c) clicks on `/resume.pdf` —
a visit that ends in a download is the strongest signal on the page.

---

## Redeploying later

```bash
npm run build && rsync -az --delete dist/ oracle:/srv/portfolio/site/
```

No cache purge needed: asset filenames are hashed, and the HTML is sent
`must-revalidate` so Cloudflare re-checks it every time.

## Capacity

`sarathi.` runs one simulated world at 20 Hz, which costs most of one core
permanently; spectators are ~128 KiB/s each and no CPU. The free tier is 2 OCPU,
so one core runs the world and one runs the OS, Caddy and this site — which is
now almost entirely edge-cached and barely touches the box. Fine for many
concurrent viewers of the same world; not fine for a world per visitor, so never
link Sarathi in a way that implies a private session.
