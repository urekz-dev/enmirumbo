# Security

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and select **Report a vulnerability**. Do not open a public issue, pull request or discussion about it.

Include what you found, where (a URL or a file and line), how to reproduce it and what an attacker could do with it. We answer within five working days and keep you informed until it is fixed.

## Scope

- This repository and the enmirumbo sites it deploys: production at `enmirumbo.com`, the `www.enmirumbo.com` redirect, and the dev and stage Custom Domains.
- Out of scope: the old Vercel prototype, denial of service, social engineering, and reports from automated scanners without a working proof.

Do not access, change or delete data that is not yours, and stop as soon as you can prove the problem.

## How this repository keeps secrets out

The repository is public. Secrets never live in it: they are kept in the repository's GitHub Environments, one per deployed environment plus one for the nightly backup, and reach the CI and the Workers only through the jobs of that environment. GitHub secret scanning with push protection, and a `secrets` job in the CI, check every push and pull request.
