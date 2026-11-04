# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting (the **Security** tab of this repository, then **Report a vulnerability**), or email info@daatphoenix.com.

Include what you found, where (file and line, or resource), and how to reproduce it. We aim to acknowledge reports within 3 business days and will keep you updated until the issue is resolved.

## Scope

This repository holds infrastructure-as-code. In scope: misconfigurations in the Pulumi program (for example overly broad role assignments, public network exposure, or missing encryption) and any credential or sensitive identifier committed by mistake. Out of scope: findings against ProBonoLaw's live services, which should go through the same contact above and not be probed.

## Secrets

No secrets belong in this repository. Stack secrets are encrypted with a passphrase held in GitHub Environment secrets, and Azure access uses OIDC federation. If you find a committed credential, report it privately so it can be rotated.
