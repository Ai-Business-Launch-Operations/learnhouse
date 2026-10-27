# Deploying this fork on Railway

This fork deploys `main` (LearnHouse 1.4.3) to Railway as one all-in-one container
plus Railway Postgres and Redis. The infrastructure is defined in
[`.railway/railway.ts`](.railway/railway.ts) (Railway Infrastructure as Code). That
file is the source of truth for services, variables and the volume; change it there,
not in the dashboard, or the next `railway config apply` will revert the dashboard edit.

## First deploy

Needs Railway CLI 5.42.1 or newer (`brew upgrade railway`) and the Railway GitHub app
installed on the `Ai-Business-Launch-Operations` org.

```bash
railway init --name learnhouse          # creates an empty project and links this folder
(cd .railway && npm ci)                 # SDK the CLI uses to read railway.ts
railway config plan                     # review: 1 service, Postgres, Redis, 1 volume
railway config apply
railway domain --service learnhouse --port 80
.railway/set-secrets.sh you@yourdomain.com
```

`config apply` starts a deploy straight away. That first deploy fails on purpose: the
API refuses to boot without its secrets and writes nothing to the database.
`set-secrets.sh` generates the JWT secret, the collab key and an admin password, stores
them on the service, triggers the real deploy and prints the first sign-in. The build
takes several minutes; the deploy is healthy once `/api/v1/health` answers.

## How it is wired

- One container runs nginx on :80 in front of Next.js (:8000), the API (:9000) and the
  collab websocket server (:4000). `PORT=80` points Railway's routing and healthcheck
  at nginx, and the start command gives Next.js back port 8000.
- Uploads live on the `learnhouse-content` volume at `/app/api/content`. A volume
  attaches to one replica, so the service stays at one replica and each deploy has a
  short gap.
- Postgres is Railway's image, which includes pgvector for the AI course chatbot. Tables
  and the admin are created on first boot; there is no separate migration step.
- Secrets are `preserve()` in `railway.ts` so they never land in this public repo.

## Known traps

- **Bad admin email on first boot.** The first boot creates the organization before
  the admin, and later boots skip install once an organization exists. If the admin
  insert fails, the site comes up healthy with nobody able to sign in. `set-secrets.sh`
  rejects malformed and reserved-domain emails; if it happens anyway, fix the variable,
  empty the Postgres database (it holds nothing else yet) and redeploy.
- **No domain before the secrets.** URLs are built from `RAILWAY_PUBLIC_DOMAIN`. Run
  `railway domain` before `set-secrets.sh`.
- **Variables added in the dashboard** are deleted by the next `config apply`. Add them
  to `railway.ts`: a literal for config, `preserve()` for a secret set with
  `railway variable set`.

## Custom domain

In `railway.ts`, set `HOST` to the bare hostname, add
`domains: [{ domain: HOST, port: 80 }]` to the service (the SDK defaults custom domains
to port 8080), then `railway config apply` and add the DNS records Railway prints.

## Optional features

Email (password reset, invites), AI and S3 storage are off. Their variables are listed
in [`docs/content/self-hosting/configuration/environment-variables.mdx`](docs/content/self-hosting/configuration/environment-variables.mdx);
add them to `railway.ts` the same way.

## Upstream updates

`upstream` is `learnhouse/learnhouse`. Merge a release tag into `main`
(`git fetch upstream --tags && git merge <tag>`). This fork only adds files
(`.railway/`, this file), so merges do not conflict. Upstream's `build-community`,
`notify-infra`, `release`, `cli-publish` and `e2e` workflows only work in LearnHouse's
own repo and fail here; disable them in this fork's Actions tab.
