# Data Integrity AI dependencies — 28 October 2026

Document Intelligence remains an active dependency after storage retirement,
alongside Video Indexer and Content Understanding. Its accounts use Azure's
multi-service `CognitiveServices` kind and the older `cog-svc-*` names.

## Resource and configuration mapping

| Dependency | Test | Production | Pulumi definition |
| --- | --- | --- | --- |
| Document Intelligence (`DI_ENDPOINT`) | `cog-svc-testsuffix001` | `cog-svc-prodsuffix001` | `cognitive-service` in `src/foundry.ts` |
| Video Indexer (`VIDEO_INDEXER_ACCOUNT_NAME`) | `video-indexer-v2-testsuffix001` | `video-indexer-v2-prodsuffix001` | `video-indexer-v2-account` in `src/videoIndexer.ts` |
| Content Understanding / primary Foundry | `aimie3-testsuffix001` | `aimie3-prodsuffix001` | `aimie3-foundry` in `src/foundry.ts` |

Both Document Intelligence accounts are in `data-loader-foundry`, East US.
The North Central US `aks-nc-document-intelligence-pe` endpoint (Pulumi logical
name `cognitive-logic-pe`) and its Cognitive Services DNS zone
group are managed in `src/sharedEndpoints.ts`. Data Integrity reads `DI_ENDPOINT`
and `DI_KEY` from its Key Vault settings mounted through the Secrets Store CSI
driver. The key is never included in this record.

The separately named Document Ingress resource,
`document-integrity-cognitive-services` in `src/services/data-integrity-extractor/index.ts`,
also remains managed. The live `DI_ENDPOINT` settings identify the `cog-svc-*`
accounts above as Data Integrity's Document Intelligence service.

## Live checks

- Azure reports both Document Intelligence accounts as `Succeeded`.
- Both deployed Data Integrity configurations reference the expected `cog-svc-*`
  endpoint and contain their required Document Intelligence credential.
- A read of `documentintelligence/documentModels/prebuilt-layout` using API version
  `2024-11-30` returned HTTP 200 in both environments, with `modelId=prebuilt-layout`.
  DNS resolved privately inside each AKS cluster.
- The checks used short-lived diagnostic pods with the existing File Operations
  service account and CSI settings mount. Both pods were deleted afterward; no
  identities, role assignments, settings or production documents were changed.
- `scripts/verify-graph.js` now explicitly verifies that the Document Intelligence
  account and its private endpoint, the Content Understanding Foundry account,
  and the existing Video Indexer resources remain in both resource graphs.

## Current provider routing

Both environments deploy File Operations commit
`da85e96c4a73ba6799b909b0f28220b42534f2cb`.

| Media | Test | Production |
| --- | --- | --- |
| Documents | Content Understanding, with Document Intelligence routes below | Content Understanding, with Document Intelligence routes below |
| Audio | Content Understanding, with supported-format exceptions routed to Video Indexer | Content Understanding, with supported-format exceptions routed to Video Indexer |
| Video | Video Indexer | Video Indexer |

The application keeps Document Intelligence routes for positional exclusions,
high-resolution processing, PDFs above the configured Content Understanding page
limit, and encrypted PDFs. CSV and eligible spreadsheet handling also have local
processing paths. AIFF, AMR and WebM retain the Video Indexer route.

The initial inspection found CU configured in Test only. Later on 28 October,
the owner requested Production activation. Production now configures
`CONTENT_UNDERSTANDING_ENDPOINT` on `aimie3-prodsuffix001`, with document/audio
providers matching Test and video remaining on Video Indexer. Synthetic PDF and
spoken-audio checks passed through Data Integrity, verified the expected CU
extraction packages and Markdown, and cleaned up their Blob artifacts. All 27
File Operations pods were ready after the rollout. The Production settings and
execution record are tracked in the File Operations repository.

All three AI services' private endpoints now use the North Central US AKS VNet in
both environments. See the [network consolidation record](network-consolidation-2026-10-28.md)
for the endpoint/DNS migration and subsequent network retirement.
