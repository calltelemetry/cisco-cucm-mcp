import { parseCertListOutput, type CertificateInfo } from "../src/certificates.js";

describe("parseCertListOutput", () => {
  it("parses well-formed own certificate output", () => {
    const output = `Unit: tomcat
Type: own
Name: tomcat
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030`;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<CertificateInfo>({
      unit: "tomcat",
      type: "own",
      name: "tomcat",
      issuer: "CN=cucm-pub.lab.local",
      expires: "Thu Jan 30 00:53:07 UTC 2030",
    });
  });

  it("parses multiple certificate blocks", () => {
    const output = `Unit: tomcat
Type: own
Name: tomcat
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030

Unit: CallManager
Type: own
Name: CallManager
Issuer: CN=cucm-pub.lab.local
Expires: Fri Feb 14 12:00:00 UTC 2031

Unit: ipsec
Type: own
Name: ipsec
Issuer: CN=cucm-pub.lab.local
Expires: Sat Mar 01 08:30:00 UTC 2029`;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(3);
    expect(result[0]!.unit).toBe("tomcat");
    expect(result[0]!.name).toBe("tomcat");
    expect(result[1]!.unit).toBe("CallManager");
    expect(result[1]!.name).toBe("CallManager");
    expect(result[2]!.unit).toBe("ipsec");
    expect(result[2]!.expires).toBe("Sat Mar 01 08:30:00 UTC 2029");
  });

  it("parses trust certificate output", () => {
    const output = `Unit: CallManager-trust
Type: trust
Name: CAPF-trust
Issuer: CN=CAPF-ca5a1234
Expires: Tue Dec 31 23:59:59 UTC 2030`;

    const result = parseCertListOutput(output, "trust");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual<CertificateInfo>({
      unit: "CallManager-trust",
      type: "trust",
      name: "CAPF-trust",
      issuer: "CN=CAPF-ca5a1234",
      expires: "Tue Dec 31 23:59:59 UTC 2030",
    });
  });

  it("returns empty array for empty output", () => {
    expect(parseCertListOutput("", "own")).toEqual([]);
    expect(parseCertListOutput("   ", "trust")).toEqual([]);
    expect(parseCertListOutput("\n\n", "own")).toEqual([]);
  });

  it("skips malformed blocks missing required fields", () => {
    // Block missing Unit field
    const output = `Type: own
Name: orphan
Issuer: CN=somewhere
Expires: Thu Jan 30 00:53:07 UTC 2030

Unit: tomcat
Type: own
Name: tomcat
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030`;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(1);
    expect(result[0]!.unit).toBe("tomcat");
  });

  it("skips blocks missing Name field", () => {
    const output = `Unit: tomcat
Type: own
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030`;

    const result = parseCertListOutput(output, "own");
    expect(result).toEqual([]);
  });

  it("handles missing optional fields gracefully", () => {
    const output = `Unit: tomcat
Name: tomcat`;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(1);
    expect(result[0]!.issuer).toBe("");
    expect(result[0]!.expires).toBe("");
  });

  it("handles extra whitespace in field values", () => {
    const output = `Unit:   tomcat
Type:   own
Name:   tomcat
Issuer:   CN=cucm-pub.lab.local
Expires:   Thu Jan 30 00:53:07 UTC 2030  `;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(1);
    expect(result[0]!.unit).toBe("tomcat");
    expect(result[0]!.issuer).toBe("CN=cucm-pub.lab.local");
  });

  it("ignores non-certificate lines in output", () => {
    const output = `Some preamble text from CLI
Command: show cert list own

Unit: tomcat
Type: own
Name: tomcat
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030`;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(1);
    expect(result[0]!.unit).toBe("tomcat");
  });

  it("uses the type parameter, not the Type field from output", () => {
    // Even if the output says "Type: own", if we pass "trust" as the type param,
    // the result should use "trust"
    const output = `Unit: tomcat
Type: own
Name: tomcat
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030`;

    const result = parseCertListOutput(output, "trust");
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("trust");
  });

  it("handles blocks separated by multiple blank lines", () => {
    const output = `Unit: tomcat
Type: own
Name: tomcat
Issuer: CN=cucm-pub.lab.local
Expires: Thu Jan 30 00:53:07 UTC 2030



Unit: CallManager
Type: own
Name: CallManager
Issuer: CN=cucm-pub.lab.local
Expires: Fri Feb 14 12:00:00 UTC 2031`;

    const result = parseCertListOutput(output, "own");
    expect(result).toHaveLength(2);
  });
});
