# Test portal TLS review — 30 October 2026

Target: `https://test.probono-law.com`, served through Azure Front Door Standard.
The custom domain's live policy was `TLS12_2022` with minimum TLS 1.2.

## Confirmed findings

Direct certificate-verified OpenSSL handshakes accepted both TLS 1.2 CBC suites:

- `ECDHE-RSA-AES128-SHA256` (`TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256`).
- `ECDHE-RSA-AES256-SHA384` (`TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384`).

TLS 1.2 `ECDHE-RSA-AES128-GCM-SHA256` and TLS 1.3
`TLS_AES_256_GCM_SHA384` also succeeded. A TLS 1.0 handshake was rejected.

The Test domain definition now explicitly selects `TLS12_2023`, Microsoft's
newer predefined policy. It retains TLS 1.2 and TLS 1.3 with GCM suites and
excludes both CBC suites. The resource-graph verification checks this setting.
Clients requiring the older CBC compatibility suites will no longer connect.
Production's apex and `www` domain definitions now select the same policy in code;
it takes effect when the Production workflow applies it, after which the CBC suites
are rejected there too.

## Live execution

The approved Test update was applied on 30 October 2026 through the custom
domain's ARM PATCH operation, preserving its existing managed certificate and
selecting `TLS12_2023`. The previous TLS settings were saved in the operator's
temporary directory for rollback. Production was not updated.

Fresh OpenSSL handshakes against the public hostname now reject both CBC suites
and TLS 1.0. TLS 1.2 with `ECDHE-RSA-AES128-GCM-SHA256` and
`ECDHE-RSA-AES256-GCM-SHA384`, plus TLS 1.3 with `TLS_AES_256_GCM_SHA384`, succeed
with certificate verification. Both `/` and `/api/health` return HTTP 200.

TypeScript and both resource graphs pass (389 Test / 437 Production resources).
The matching infrastructure change is recorded in
PR #86 (in the private deployment repository). Merge it to
retain the explicit policy in future Pulumi deployments. Rerun the original
scanner after Front Door's global rollout completes to refresh its finding.

## Information displayed by the scanner

| Item | Observation and meaning |
| --- | --- |
| Server software and technologies | The root page and `/api/health` responses contained no `Server` or `X-Powered-By` header. Azure CDN headers and Next.js `Vary` tokens on the API can still identify infrastructure/frameworks. Public JavaScript can also identify client technologies. No software version was exposed in the inspected headers. |
| TLS version | TLS 1.2 and TLS 1.3 are public negotiated connection properties. Their visibility is expected. |
| Email extractor | The root HTML's `LegalService` structured data contains the public customer-support address `support@probono-law.com`. An extractor finding alone is not evidence of leaked private email. |
| SSL DNS names | The leaf certificate contains only `test.probono-law.com` in its subject alternative names. This public name is required for browser hostname validation. |
| SSL certificate issuer | The certificate is issued by `GeoTrust TLS RSA CA G1` under DigiCert. Issuer information is public and expected. |

References: [Front Door TLS policies](https://learn.microsoft.com/en-us/azure/frontdoor/tls-policy)
and [Front Door TLS support](https://learn.microsoft.com/en-us/azure/frontdoor/end-to-end-tls).
