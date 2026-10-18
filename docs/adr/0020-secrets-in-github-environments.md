# ADR 0020: Secrets in GitHub Environments

- Status: accepted
- Date: 2026-10-13
- Owner: Alexis Zazueta

## Context

ADR 0009 made Infisical the source of every secret, with one OIDC machine identity per environment so a deploy to `dev`, which runs any branch's code, could never read `stage` or `prod` secrets. Infisical's free plan does not allow that isolation: it has 5 identities (people and machines together), 3 projects for the whole organisation and 3 environments per project, and access limited to one environment or folder needs the paid plans (folder access is on Pro, priced per identity; custom roles on Enterprise). One project per environment would need four projects, and the projects are shared with Condominia and the rest of Urekz. The organisation also allows only GitHub-owned actions, so Infisical's action is unavailable.

GitHub Environments give each environment its own secrets, released only to jobs that declare that environment and run from the refs its deployment rules allow, and GitHub masks their values in the logs. Wrangler uploads a Worker's secrets together with its code (`wrangler deploy --secrets-file`) and fails a deploy when a secret listed in `secrets.required` is missing.

## Decision

Every secret of enmirumbo lives in the GitHub Environments `dev`, `stage` and `prod` of `urekz-dev/enmirumbo`, plus `backup` for the nightly backup (ADR 0016, amended on 2026-10-13). Their deployment rules are: `prod` only from tags `v*`, `stage` and `backup` only from `main`, `dev` from any branch. A workflow step receives only the secrets it needs, through its own `env:`.

- CI secrets: `CLOUDFLARE_API_TOKEN` (a token per environment, with the Editor role on that environment's Worker only), `CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL` (the direct connection string of that environment's Neon branch, `sslmode=verify-full`) in each environment; `NEON_API_KEY` and `NEON_PROJECT_ID` only in `dev`, to reset its branch.
- Worker secrets: declared by name in `secrets.required` of each Wrangler environment and uploaded with the deploy through `--secrets-file`, written to the runner's temporary directory and removed after the step. There are none yet. (Amended on 2026-10-18, EMR-42: the first is `TURNSTILE_SECRET_KEY`, and `scripts/deploy/deploy-worker.sh` uploads them.)
- Local development needs no real secrets: it uses the Docker database, Turnstile's test keys and email written to the console. A `.dev.vars` file, never committed, holds any local value.

The originals stay in each provider's dashboard and in the custodian's password manager; GitHub never shows a stored value again. Infisical is not used by this project. This decision supersedes ADR 0009 and the credentials sentence of ADR 0016.

## Consequences

One place per environment holds every secret, isolation costs nothing, and the logs are masked without our code doing it. Changing a secret takes a new deploy of that environment (one manual run), because Worker secrets travel with the deploy. The secrets are long-lived values stored in GitHub, so each one carries only the permission its environment needs, and rotating one means updating the provider, the GitHub Environment and the password manager. The Infisical identities and the `/ci` folders created for ADR 0009 are deleted.
