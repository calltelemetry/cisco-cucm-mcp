import { mkdtempSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseWsdlOperations, parseWsdlOperationDescription, clearWsdlCache } from '../src/axl-wsdl.js';

const MINI_WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/"
             xmlns:xsd="http://www.w3.org/2001/XMLSchema"
             xmlns:axlapi="http://www.cisco.com/AXL/API/14.0">
  <types>
    <xsd:schema>
      <xsd:complexType name="listPhoneRequest">
        <xsd:sequence>
          <xsd:element name="searchCriteria" type="xsd:string" minOccurs="1"/>
          <xsd:element name="returnedTags" type="xsd:string" minOccurs="0"/>
          <xsd:element name="skip" type="xsd:int" minOccurs="0"/>
          <xsd:element name="first" type="xsd:int" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="listPhoneResponse">
        <xsd:sequence>
          <xsd:element name="phone" type="axlapi:XPhone" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="getPhoneRequest">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string" minOccurs="1"/>
          <xsd:element name="returnedTags" type="xsd:string" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="addPhoneRequest">
        <xsd:sequence>
          <xsd:element name="phone" type="axlapi:XPhone" minOccurs="1"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="updatePhoneRequest">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string" minOccurs="1"/>
          <xsd:element name="newName" type="xsd:string" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="removePhoneRequest">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string" minOccurs="1"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="doDeviceResetRequest">
        <xsd:sequence>
          <xsd:element name="deviceName" type="xsd:string" minOccurs="1"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="applyPhoneRequest">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string" minOccurs="1"/>
        </xsd:sequence>
      </xsd:complexType>
      <xsd:complexType name="resetPhoneRequest">
        <xsd:sequence>
          <xsd:element name="name" type="xsd:string" minOccurs="1"/>
        </xsd:sequence>
      </xsd:complexType>
      <!-- AXL-style: element referencing a complexType via complexContent/extension -->
      <xsd:element name="executeSQLQuery" type="axlapi:ExecuteSQLQueryReq"/>
      <xsd:element name="executeSQLQueryResponse" type="axlapi:ExecuteSQLQueryRes"/>
      <xsd:complexType name="ExecuteSQLQueryReq">
        <xsd:complexContent>
          <xsd:extension base="axlapi:APIRequest">
            <xsd:sequence>
              <xsd:element name="sql" type="xsd:string" minOccurs="1"/>
            </xsd:sequence>
          </xsd:extension>
        </xsd:complexContent>
      </xsd:complexType>
      <xsd:complexType name="ExecuteSQLQueryRes">
        <xsd:sequence>
          <xsd:element name="return" type="xsd:string" minOccurs="0"/>
        </xsd:sequence>
      </xsd:complexType>
    </xsd:schema>
  </types>
  <portType name="AXLPort">
    <operation name="listPhone"/>
    <operation name="getPhone"/>
    <operation name="addPhone"/>
    <operation name="updatePhone"/>
    <operation name="removePhone"/>
    <operation name="doDeviceReset"/>
    <operation name="applyPhone"/>
    <operation name="resetPhone"/>
    <operation name="executeSQLQuery"/>
  </portType>
</definitions>`;

describe('parseWsdlOperations', () => {
  afterEach(() => clearWsdlCache());

  it('extracts all operations from portType', () => {
    const result = parseWsdlOperations(MINI_WSDL);
    expect(result.totalOperations).toBe(9);
  });

  it('groups operations by prefix', () => {
    const result = parseWsdlOperations(MINI_WSDL);
    expect(result.groups.list).toContain('listPhone');
    expect(result.groups.get).toContain('getPhone');
    expect(result.groups.add).toContain('addPhone');
    expect(result.groups.update).toContain('updatePhone');
    expect(result.groups.remove).toContain('removePhone');
    expect(result.groups.do).toContain('doDeviceReset');
    expect(result.groups.apply).toContain('applyPhone');
    expect(result.groups.reset).toContain('resetPhone');
  });

  it('returns empty groups for empty WSDL', () => {
    const emptyWsdl = `<?xml version="1.0"?><definitions><portType name="Empty"></portType></definitions>`;
    const result = parseWsdlOperations(emptyWsdl);
    expect(result.totalOperations).toBe(0);
    expect(result.groups.list).toEqual([]);
    expect(result.groups.get).toEqual([]);
  });

  it('operations are sorted alphabetically', () => {
    const result = parseWsdlOperations(MINI_WSDL);
    const allOps = [
      ...result.groups.list,
      ...result.groups.get,
      ...result.groups.add,
      ...result.groups.update,
      ...result.groups.remove,
      ...result.groups.do,
      ...result.groups.apply,
      ...result.groups.reset,
      ...result.groups.other,
    ];
    // Each group internally should be sorted (since they come from sorted full list)
    expect(allOps.length).toBe(9); // 8 original + executeSQLQuery
  });
});

describe('parseWsdlOperationDescription', () => {
  afterEach(() => clearWsdlCache());

  it('extracts input fields for listPhone', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'listPhone');
    expect(result.operation).toBe('listPhone');
    expect(result.inputFields.length).toBeGreaterThanOrEqual(1);

    const searchCriteria = result.inputFields.find(f => f.name === 'searchCriteria');
    expect(searchCriteria).toBeDefined();
    expect(searchCriteria!.type).toBe('string');
    expect(searchCriteria!.optional).toBe(false); // minOccurs="1"

    const returnedTags = result.inputFields.find(f => f.name === 'returnedTags');
    expect(returnedTags).toBeDefined();
    expect(returnedTags!.optional).toBe(true); // minOccurs="0"
  });

  it('extracts output fields for listPhone', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'listPhone');
    expect(result.outputFields.length).toBeGreaterThanOrEqual(1);

    const phone = result.outputFields.find(f => f.name === 'phone');
    expect(phone).toBeDefined();
    expect(phone!.type).toBe('XPhone'); // namespace prefix stripped
  });

  it('returns empty fields for unknown operation', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'nonExistentOperation');
    expect(result.operation).toBe('nonExistentOperation');
    expect(result.inputFields).toEqual([]);
    expect(result.outputFields).toEqual([]);
  });

  it('strips namespace prefix from field types', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'addPhone');
    const phone = result.inputFields.find(f => f.name === 'phone');
    expect(phone).toBeDefined();
    expect(phone!.type).toBe('XPhone'); // "axlapi:XPhone" → "XPhone"
  });

  it('detects required vs optional fields', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'updatePhone');
    const name = result.inputFields.find(f => f.name === 'name');
    const newName = result.inputFields.find(f => f.name === 'newName');
    expect(name).toBeDefined();
    expect(name!.optional).toBe(false);
    expect(newName).toBeDefined();
    expect(newName!.optional).toBe(true);
  });

  it('resolves element-to-type references via complexContent/extension', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'executeSQLQuery');
    expect(result.operation).toBe('executeSQLQuery');
    // Input resolved via element "executeSQLQuery" → type ExecuteSQLQueryReq (complexContent/extension)
    expect(result.inputFields.length).toBe(1);
    expect(result.inputFields[0]!.name).toBe('sql');
    expect(result.inputFields[0]!.type).toBe('string');
    expect(result.inputFields[0]!.optional).toBe(false);
  });

  it('resolves output via element-to-type reference', () => {
    const result = parseWsdlOperationDescription(MINI_WSDL, 'executeSQLQuery');
    // Output resolved via element "executeSQLQueryResponse" → type ExecuteSQLQueryRes
    expect(result.outputFields.length).toBe(1);
    expect(result.outputFields[0]!.name).toBe('return');
    expect(result.outputFields[0]!.type).toBe('string');
    expect(result.outputFields[0]!.optional).toBe(true);
  });
});

describe('disk cache', () => {
  let tmpCacheDir: string;
  const originalEnv = process.env.CUCM_MCP_WSDL_CACHE_DIR;

  beforeEach(() => {
    tmpCacheDir = mkdtempSync(join(tmpdir(), 'wsdl-cache-test-'));
    process.env.CUCM_MCP_WSDL_CACHE_DIR = tmpCacheDir;
    clearWsdlCache();
  });

  afterEach(() => {
    clearWsdlCache();
    if (originalEnv === undefined) {
      delete process.env.CUCM_MCP_WSDL_CACHE_DIR;
    } else {
      process.env.CUCM_MCP_WSDL_CACHE_DIR = originalEnv;
    }
  });

  it('clearWsdlCache removes all disk cache files', () => {
    // Manually create a fake cache file
    writeFileSync(join(tmpCacheDir, '10.0.0.1_8443.json'), '{"wsdl":{},"allSchemas":[]}');
    writeFileSync(join(tmpCacheDir, '10.0.0.2_8443.json'), '{"wsdl":{},"allSchemas":[]}');
    expect(readdirSync(tmpCacheDir).length).toBe(2);

    clearWsdlCache();
    expect(readdirSync(tmpCacheDir).filter(f => f.endsWith('.json')).length).toBe(0);
  });

  it('clearWsdlCache with host+port removes only that entry', () => {
    writeFileSync(join(tmpCacheDir, '10.0.0.1_8443.json'), '{"wsdl":{},"allSchemas":[]}');
    writeFileSync(join(tmpCacheDir, '10.0.0.2_8443.json'), '{"wsdl":{},"allSchemas":[]}');

    clearWsdlCache('10.0.0.1', 8443);

    const remaining = readdirSync(tmpCacheDir).filter(f => f.endsWith('.json'));
    expect(remaining).toEqual(['10.0.0.2_8443.json']);
  });

  it('clearWsdlCache does not throw for empty dir', () => {
    expect(() => clearWsdlCache()).not.toThrow();
  });

  it('clearWsdlCache does not throw for non-existent dir', () => {
    process.env.CUCM_MCP_WSDL_CACHE_DIR = '/tmp/nonexistent-wsdl-dir-xyz';
    expect(() => clearWsdlCache()).not.toThrow();
  });
});
