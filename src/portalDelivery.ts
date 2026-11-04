import * as pulumi from "@pulumi/pulumi";
import { cdn, network, resources, web } from "@pulumi/azure-native";
import { assign, roleIds } from "./core/iam";
import { armUniqueString } from "./naming";
import { createAksPlatform } from "./aksPlatform";
import { createProductionPublicDnsZone } from "./portalProductionDns";

/** Validate a public DNS zone and leave room for the generated API label. */
export function validateApiOriginDnsZone(zone: string) {
  const labels = zone.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
    ) ||
    zone.length > 253 - ("api-origin-".length + 13 + 1)
  ) {
    throw new Error("apiOriginDnsZone must be a valid DNS zone name");
  }
  return zone;
}

/** Stage the static UI and public API path without moving the existing portal. */
export function createPortalDelivery(
  environmentName: string,
  subscriptionId: pulumi.Input<string>,
  portalGroup: resources.ResourceGroup,
  aks: NonNullable<ReturnType<typeof createAksPlatform>>,
  keepLegacyPortalWebApp: boolean,
) {
  const environment = environmentName === "Test" ? "test" : "prod";
  const originDnsZone = validateApiOriginDnsZone(
    new pulumi.Config().require("apiOriginDnsZone"),
  );
  const suffix = armUniqueString("portal-delivery", subscriptionId);
  const apiOriginHostName = suffix.apply((value) => {
    const hostname = `api-origin-${value}.${originDnsZone}`;
    if (hostname.length > 253 || hostname.split(".")[0].length > 63)
      throw new Error("Generated API origin hostname exceeds DNS limits");
    return hostname;
  });
  const tags = { Environment: environmentName };
  const staticSite = new web.StaticSite("portal-static-ui", {
    name: pulumi.interpolate`probonolaw-ui-${environment}-${suffix}`,
    resourceGroupName: portalGroup.name,
    location: "centralus",
    sku: { name: "Standard", tier: "Standard" },
    publicNetworkAccess: "Enabled",
    buildProperties: { skipGithubActionWorkflowGeneration: true },
    tags,
  });

  // The public application-routing controller's LoadBalancer Service binds to
  // this IP. The existing private controller remains in service for AIMIE.
  const apiPublicIp = new network.PublicIPAddress("portal-api-public-ip", {
    publicIpAddressName: pulumi.interpolate`probonolaw-api-${environment}-${suffix}`,
    resourceGroupName: aks.clusterGroup.name,
    location: "northcentralus",
    publicIPAllocationMethod: "Static",
    publicIPAddressVersion: "IPv4",
    sku: { name: "Standard", tier: "Regional" },
    tags,
  });
  assign(
    "portal-api-public-ip-network-contributor",
    apiPublicIp.id,
    aks.controlPlaneIdentity.principalId,
    pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.networkContributor}`,
  );
  if (environment === "prod") {
    // The Production deployment workflow installs cert-manager CRDs through
    // AKS Run Command. Azure Owner alone does not grant Kubernetes RBAC.
    assign(
      "portal-api-production-ci-cluster-admin",
      aks.cluster.id,
      "00000000-0000-4000-8000-000000000014",
      pulumi.interpolate`${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleIds.aksClusterAdmin}`,
    );
  }

  const profile = new cdn.Profile("portal-front-door", {
    profileName: pulumi.interpolate`probonolaw-delivery-${environment}-${suffix}`,
    resourceGroupName: portalGroup.name,
    location: "global",
    sku: { name: "Standard_AzureFrontDoor" },
    // QA generation can exceed the 30-second default. 240 seconds is the
    // maximum origin response timeout in Front Door Standard.
    originResponseTimeoutSeconds: 240,
    tags,
  });
  const endpoint = new cdn.AFDEndpoint("portal-front-door-endpoint", {
    endpointName: pulumi.interpolate`probonolaw-${environment}-${suffix}`,
    profileName: profile.name,
    resourceGroupName: portalGroup.name,
    location: "global",
    enabledState: "Enabled",
    tags,
  });

  // Stage the Test hostname while DNS still serves the legacy portal. The
  // existing domain was created during recovery from an early DNS cutover.
  const testCustomDomain =
    environment === "test"
      ? new cdn.AFDCustomDomain(
          "portal-test-custom-domain",
          {
            customDomainName: pulumi.interpolate`test-probono-law-com-${suffix}`,
            hostName: "test.probono-law.com",
            profileName: profile.name,
            resourceGroupName: portalGroup.name,
            tlsSettings: {
              certificateType: "ManagedCertificate",
              // The 2023 policy retains TLS 1.2/1.3 with GCM ciphers and excludes
              // the CBC compatibility suites accepted by TLS12_2022.
              cipherSuiteSetType: "TLS12_2023",
              minimumTlsVersion: "TLS12",
            },
          },
          {
            import:
              "/subscriptions/00000000-0000-4000-8000-000000000003/resourcegroups/probonolaw-portal/providers/Microsoft.Cdn/profiles/probonolaw-delivery-test-testsuffix001/customdomains/test-probono-law-com-testsuffix001",
          },
        )
      : undefined;

  const productionCustomDomain =
    environment === "prod"
      ? new cdn.AFDCustomDomain("portal-production-custom-domain", {
          customDomainName: pulumi.interpolate`probono-law-com-${suffix}`,
          hostName: "probono-law.com",
          profileName: profile.name,
          resourceGroupName: portalGroup.name,
          tlsSettings: {
            certificateType: "ManagedCertificate",
            // Same policy as Test: TLS 1.2/1.3 with GCM suites, no CBC suites.
            cipherSuiteSetType: "TLS12_2023",
            minimumTlsVersion: "TLS12",
          },
        })
      : undefined;
  const productionWwwCustomDomain =
    environment === "prod"
      ? new cdn.AFDCustomDomain("portal-production-www-custom-domain", {
          customDomainName: pulumi.interpolate`www-probono-law-com-${suffix}`,
          hostName: "www.probono-law.com",
          profileName: profile.name,
          resourceGroupName: portalGroup.name,
          tlsSettings: {
            certificateType: "ManagedCertificate",
            // Same policy as Test: TLS 1.2/1.3 with GCM suites, no CBC suites.
            cipherSuiteSetType: "TLS12_2023",
            minimumTlsVersion: "TLS12",
          },
        })
      : undefined;
  const routeCustomDomains = testCustomDomain
    ? [{ id: testCustomDomain.id }]
    : productionCustomDomain && productionWwwCustomDomain
      ? [
          { id: productionCustomDomain.id },
          { id: productionWwwCustomDomain.id },
        ]
      : undefined;

  const productionDnsZone =
    environment === "prod"
      ? createProductionPublicDnsZone(
          portalGroup,
          endpoint,
          productionCustomDomain!,
          productionWwwCustomDomain!,
          apiPublicIp,
          suffix,
          tags,
          keepLegacyPortalWebApp,
        )
      : undefined;

  const uiGroup = new cdn.AFDOriginGroup("portal-ui-origin-group", {
    originGroupName: "static-ui",
    profileName: profile.name,
    resourceGroupName: portalGroup.name,
    healthProbeSettings: {
      probePath: "/",
      probeProtocol: "Https",
      probeRequestType: "HEAD",
      probeIntervalInSeconds: 60,
    },
    loadBalancingSettings: {
      sampleSize: 4,
      successfulSamplesRequired: 3,
      additionalLatencyInMilliseconds: 50,
    },
  });
  const apiGroup = new cdn.AFDOriginGroup("portal-api-origin-group", {
    originGroupName: "aks-api",
    profileName: profile.name,
    resourceGroupName: portalGroup.name,
    healthProbeSettings: {
      probePath: "/api/health",
      probeProtocol: "Https",
      probeRequestType: "HEAD",
      probeIntervalInSeconds: 60,
    },
    loadBalancingSettings: {
      sampleSize: 4,
      successfulSamplesRequired: 3,
      additionalLatencyInMilliseconds: 50,
    },
  });
  const uiOrigin = new cdn.AFDOrigin("portal-static-ui-origin", {
    originName: "static-ui",
    originGroupName: uiGroup.name,
    profileName: profile.name,
    resourceGroupName: portalGroup.name,
    hostName: staticSite.defaultHostname,
    originHostHeader: staticSite.defaultHostname,
    httpsPort: 443,
    enforceCertificateNameCheck: true,
    enabledState: "Enabled",
  });
  const apiOrigin = new cdn.AFDOrigin("portal-aks-api-origin", {
    originName: "aks-api",
    originGroupName: apiGroup.name,
    profileName: profile.name,
    resourceGroupName: portalGroup.name,
    hostName: apiOriginHostName,
    originHostHeader: apiOriginHostName,
    httpsPort: 443,
    enforceCertificateNameCheck: true,
    enabledState: "Enabled",
  });
  new cdn.Route(
    "portal-api-route",
    {
      routeName: "api",
      endpointName: endpoint.name,
      profileName: profile.name,
      resourceGroupName: portalGroup.name,
      originGroup: { id: apiGroup.id },
      customDomains: routeCustomDomains,
      patternsToMatch: ["/api/*"],
      supportedProtocols: ["Http", "Https"],
      forwardingProtocol: "HttpsOnly",
      httpsRedirect: "Enabled",
      linkToDefaultDomain: "Enabled",
      enabledState: "Enabled",
    },
    { dependsOn: [apiOrigin] },
  );
  new cdn.Route(
    "portal-ui-route",
    {
      routeName: "ui",
      endpointName: endpoint.name,
      profileName: profile.name,
      resourceGroupName: portalGroup.name,
      originGroup: { id: uiGroup.id },
      customDomains: routeCustomDomains,
      patternsToMatch: ["/*"],
      supportedProtocols: ["Http", "Https"],
      forwardingProtocol: "HttpsOnly",
      httpsRedirect: "Enabled",
      linkToDefaultDomain: "Enabled",
      enabledState: "Enabled",
    },
    { dependsOn: [uiOrigin] },
  );
  return {
    staticSite,
    apiPublicIp,
    profile,
    endpoint,
    apiOriginHostName,
    testCustomDomain,
    productionCustomDomain,
    productionWwwCustomDomain,
    productionDnsZone,
  };
}
