import * as pulumi from "@pulumi/pulumi";
import { cdn, dns, network, resources } from "@pulumi/azure-native";

/** Public application and mail DNS, with optional records for a Test stack. */
export function createProductionPublicDnsZone(
  portalGroup: resources.ResourceGroup,
  endpoint: cdn.AFDEndpoint,
  customDomain: cdn.AFDCustomDomain,
  wwwCustomDomain: cdn.AFDCustomDomain,
  apiPublicIp: network.PublicIPAddress,
  suffix: pulumi.Output<string>,
  tags: { Environment: string },
  keepLegacyPortalWebApp: boolean,
) {
  const config = new pulumi.Config();
  const legacyApexIp = config.require("productionLegacyApexIp");
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(legacyApexIp)) {
    throw new Error("productionLegacyApexIp must be an IPv4 address");
  }
  const frontDoorApex = config.getBoolean("productionApexFrontDoor") ?? false;
  const manageTestPublicDns = config.getBoolean("manageTestPublicDns") ?? false;
  const zone = new dns.Zone("portal-production-public-dns-zone", {
    zoneName: "probono-law.com",
    resourceGroupName: portalGroup.name,
    zoneType: "Public",
    location: "global",
    tags,
  });
  const base = {
    zoneName: zone.name,
    resourceGroupName: portalGroup.name,
  };

  // The staged zone keeps the legacy portal live even if delegation moves
  // before Front Door is ready. Flip this record to an Azure alias at cutover.
  new dns.RecordSet("portal-production-apex", {
    ...base,
    relativeRecordSetName: "@",
    recordType: "A",
    ttl: 600,
    ...(frontDoorApex
      ? { targetResource: { id: endpoint.id } }
      : { aRecords: [{ ipv4Address: legacyApexIp }] }),
  });
  if (manageTestPublicDns)
    new dns.RecordSet("portal-production-test-api-origin", {
      ...base,
      relativeRecordSetName: "api-origin-testsuffix001",
      recordType: "A",
      ttl: 600,
      aRecords: [{ ipv4Address: "203.0.113.154" }],
    });
  new dns.RecordSet("portal-production-prod-api-origin", {
    ...base,
    relativeRecordSetName: pulumi.interpolate`api-origin-${suffix}`,
    recordType: "A",
    ttl: 600,
    aRecords: [{ ipv4Address: apiPublicIp.ipAddress }],
  });

  const cnames: ReadonlyArray<readonly [string, string, pulumi.Input<string>]> =
    [
      ...(keepLegacyPortalWebApp
        ? [["wildcard", "*", endpoint.hostName] as const]
        : []),
      ["autodiscover", "autodiscover", "autodiscover.outlook.com"],
      [
        "enterpriseenrollment",
        "enterpriseenrollment",
        "enterpriseenrollment-s.manage.microsoft.com",
      ],
      [
        "enterpriseregistration",
        "enterpriseregistration",
        "enterpriseregistration.windows.net",
      ],
      ["lyncdiscover", "lyncdiscover", "webdir.online.lync.com"],
      ["sip", "sip", "sipdir.online.lync.com"],
      ...(manageTestPublicDns
        ? [
            [
              "test",
              "test",
              "probonolaw-test-testsuffix001-c8e0avf5dyccc6a3.z01.azurefd.net",
            ] as const,
          ]
        : []),
      ["www", "www", endpoint.hostName],
      [
        "domainconnect",
        "_domainconnect",
        "_domainconnect.gd.domaincontrol.com",
      ],
    ];
  for (const [key, name, target] of cnames) {
    new dns.RecordSet(`portal-production-${key}-cname`, {
      ...base,
      relativeRecordSetName: name,
      recordType: "CNAME",
      ttl: 3600,
      cnameRecord: { cname: target },
    });
  }
  new dns.RecordSet("portal-production-mail-mx", {
    ...base,
    relativeRecordSetName: "@",
    recordType: "MX",
    ttl: 3600,
    mxRecords: [
      {
        preference: 0,
        exchange: "probonolaw-com01i.mail.protection.outlook.com",
      },
    ],
  });

  const verification =
    "17E98A8D99F79D40602D9C19675545A8FFE0BCC1E42C4737BE05BA4139EAED95";
  const txtRecords: [string, string, string[]][] = [
    [
      "apex",
      "@",
      ["MS=ms46028757", "v=spf1 include:spf.protection.outlook.com -all"],
    ],
    ["asuid", "asuid", [verification]],
    ...(manageTestPublicDns
      ? [
          [
            "asuid-test",
            "asuid.test",
            [
              "0731A41B0710D9DF32529BF19F02E92AAE3D08EBA90D63A776C710175501463C",
            ],
          ] as [string, string, string[]],
        ]
      : []),
    ["asuid-www", "asuid.www", [verification]],
    ...(manageTestPublicDns
      ? [
          [
            "test-front-door",
            "_dnsauth.test",
            ["_9rgp4hzlx6mwyznojg5umas2w2nt1jh"],
          ] as [string, string, string[]],
        ]
      : []),
  ];
  for (const [key, name, values] of txtRecords) {
    new dns.RecordSet(`portal-production-${key}-txt`, {
      ...base,
      relativeRecordSetName: name,
      recordType: "TXT",
      ttl: 3600,
      txtRecords: values.map((value) => ({ value: [value] })),
    });
  }
  new dns.RecordSet("portal-production-front-door-validation", {
    ...base,
    relativeRecordSetName: "_dnsauth",
    recordType: "TXT",
    ttl: 3600,
    txtRecords: [
      {
        value: [
          customDomain.validationProperties.apply((properties) => {
            if (!properties?.validationToken)
              throw new Error(
                "Production Front Door validation token is missing",
              );
            return properties.validationToken;
          }),
        ],
      },
    ],
  });
  new dns.RecordSet("portal-production-www-front-door-validation", {
    ...base,
    relativeRecordSetName: "_dnsauth.www",
    recordType: "TXT",
    ttl: 3600,
    txtRecords: [
      {
        value: [
          wwwCustomDomain.validationProperties.apply((properties) => {
            if (!properties?.validationToken)
              throw new Error("Production www validation token is missing");
            return properties.validationToken;
          }),
        ],
      },
    ],
  });

  const srvRecords = [
    ["sip-tls", "_sip._tls", "sipdir.online.lync.com", 443],
    [
      "sip-federation",
      "_sipfederationtls._tcp",
      "sipfed.online.lync.com",
      5061,
    ],
  ] as const;
  for (const [key, name, target, port] of srvRecords) {
    new dns.RecordSet(`portal-production-${key}-srv`, {
      ...base,
      relativeRecordSetName: name,
      recordType: "SRV",
      ttl: 3600,
      srvRecords: [{ priority: 100, weight: 1, port, target }],
    });
  }
  return zone;
}
