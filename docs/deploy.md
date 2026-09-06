# Deploying

Static build, rsynced to the Oracle Ampere box, served by Caddy. Same box and
same Caddy as `sarathi.`, one site file each.

```bash
npm run build          # -> dist/
```

## Ship it

```bash
rsync -az --delete dist/ oracle:/srv/portfolio/site/
```

`--delete` is what keeps the server from accumulating orphaned assets across
builds. It is also why the resume must not live in `dist/`.

## The resume

The requirement was to update the CV without redeploying the site, so it is
**not** in `public/` and never enters the build. It lives in its own directory
and Caddy serves it at `/resume.pdf`:

```
/srv/portfolio/site/      <- rsync target, wiped and rewritten every deploy
/srv/portfolio/files/     <- resume.pdf lives here, untouched by deploys
```

Updating it is one command, no build, no restart:

```bash
scp Rishabh_Singh_Kushwaha_Resume.pdf oracle:/srv/portfolio/files/resume.pdf
```

There is no upload endpoint and no multer. Serving a static file needs neither,
and an authenticated upload form would be a login surface on a box that
currently has none.

Local `npm run dev` will 404 on `/resume.pdf`. That is the correct tradeoff —
drop a copy in `files/` locally if you want to check the link.

## Caddyfile

`/etc/caddy/sites/rishabhkushwaha.com.caddy`:

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
		try_files {path} {path}/ /404.html
		file_server

		# Hashed filenames — safe to cache hard.
		@immutable path /assets/*
		header @immutable Cache-Control "public, max-age=31536000, immutable"
		header /*.html Cache-Control "public, max-age=0, must-revalidate"
	}
}
```

## DNS

| Record | Proxy | Why |
|---|---|---|
| `rishabhkushwaha.com` → box IP | **orange** | Origin is in Oracle's UK region; recruiters are in India. Cloudflare caches the static build at the Indian edge and hides the origin IP. |
| `www` → box IP | **orange** | Same. |
| `sarathi` → box IP | **grey** | Leave as-is. The telemetry socket goes straight to the box. |

The apex being cacheable is the whole reason to proxy it — nothing here is
dynamic, so Cloudflare can serve almost every request without touching Oracle.

## Capacity note

`sarathi.` runs one simulated world at 20 Hz, which costs most of one core
permanently; spectators are ~128 KiB/s each and no CPU. The free tier is 2
OCPU, so one core runs the world and one runs the OS, Caddy and this site.
That is fine for many concurrent viewers of the same world and not fine for a
world per visitor — so never link it in a way that implies a private session.
