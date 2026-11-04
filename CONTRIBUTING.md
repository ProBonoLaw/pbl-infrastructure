# Contributing

Thanks for your interest in Pro Bono Law's infrastructure.

## Before you start

- Open an issue to discuss larger changes before writing code.
- This repository describes ProBonoLaw's own Azure environment, so changes that alter live resources are reviewed by the maintainers against that environment.
- Never commit secrets, real subscription or tenant IDs, IP addresses, or customer data. Use placeholders as described in the README.

## Development

```bash
npm ci
npm run verify
```

`npm run verify` compiles the TypeScript and checks the resource graph with mocks. It needs no Azure credentials. It must pass before a pull request can merge.

## Pull requests

- Keep each pull request focused, and describe what changes in the resource graph.
- Add or update the assertions in `scripts/verify-graph.js` for new or changed resources.
- Sign off your commits (`git commit -s`) to certify the [Developer Certificate of Origin](https://developercertificate.org/). Contributions are licensed under Apache-2.0.

## Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
