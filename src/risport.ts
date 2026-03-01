import { resolveAuth, resolveTarget, type DimeAuth } from "./dime.js";
import { escapeXml, fetchServiceabilitySoap, toArray } from "./soap.js";

const RIS_PATH = "/realtimeservice2/services/RISService70";

export type RisDevice = {
  name: string;
  ipAddress: string;
  description: string;
  dirNumber: string;
  status: string;
  statusReason: number;
  protocol: string;
  activeLoadId: string;
  timeStamp: number;
};

export type RisNode = {
  name: string;
  returnCode: string;
  devices: RisDevice[];
};

export type RisDeviceResult = {
  totalDevicesFound: number;
  cmNodes: RisNode[];
};

export type SelectCmDeviceArgs = {
  maxReturnedDevices?: number;
  deviceClass?: string;
  model?: number;
  status?: string;
  selectBy?: string;
  selectItems?: string[];
  protocol?: string;
  timeoutMs?: number;
};

function buildSelectCmDeviceEnvelope(args: SelectCmDeviceArgs): string {
  const maxDevices = args.maxReturnedDevices ?? 200;
  const deviceClass = args.deviceClass ?? "Phone";
  const model = args.model ?? 255;
  const status = args.status ?? "Any";
  const selectBy = args.selectBy ?? "Name";
  const protocol = args.protocol ?? "Any";
  const items = args.selectItems?.length ? args.selectItems : ["*"];

  const selectItemsXml = items
    .map((i) => `<soap:item><soap:Item>${escapeXml(i)}</soap:Item></soap:item>`)
    .join("");

  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://schemas.cisco.com/ast/soap">' +
    "<soapenv:Header/>" +
    "<soapenv:Body>" +
    "<soap:selectCmDevice>" +
    "<soap:StateInfo></soap:StateInfo>" +
    "<soap:CmSelectionCriteria>" +
    `<soap:MaxReturnedDevices>${maxDevices}</soap:MaxReturnedDevices>` +
    `<soap:DeviceClass>${escapeXml(deviceClass)}</soap:DeviceClass>` +
    `<soap:Model>${model}</soap:Model>` +
    `<soap:Status>${escapeXml(status)}</soap:Status>` +
    "<soap:NodeName></soap:NodeName>" +
    `<soap:SelectBy>${escapeXml(selectBy)}</soap:SelectBy>` +
    `<soap:SelectItems>${selectItemsXml}</soap:SelectItems>` +
    `<soap:Protocol>${escapeXml(protocol)}</soap:Protocol>` +
    "<soap:DownloadStatus>Any</soap:DownloadStatus>" +
    "</soap:CmSelectionCriteria>" +
    "</soap:selectCmDevice>" +
    "</soapenv:Body>" +
    "</soapenv:Envelope>"
  );
}

/** Extract IP string from CUCM's nested IPAddress structure.
 *  CUCM 15 returns: { item: { IP: "x.x.x.x", IPAddrType: "ipv4" } }
 *  or sometimes: { item: [{ IP: "x.x.x.x", ... }] }
 *  Older versions may return a flat string. */
function extractIpAddress(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const obj = raw as Record<string, unknown>;
  // Nested { item: { IP: "..." } } or { item: [{ IP: "..." }] }
  const item = obj.item ?? obj.Item;
  if (item) {
    const first = Array.isArray(item) ? item[0] : item;
    if (first && typeof first === "object") {
      return String((first as Record<string, unknown>).IP ?? "");
    }
    if (typeof first === "string") return first;
  }
  // Direct IP field
  if (obj.IP) return String(obj.IP);
  return "";
}

function parseDevice(d: Record<string, unknown>): RisDevice {
  return {
    name: String(d.Name ?? ""),
    ipAddress: extractIpAddress(d.IPAddress ?? d.IpAddress ?? ""),
    description: String(d.Description ?? ""),
    dirNumber: String(d.DirNumber ?? ""),
    status: String(d.Status ?? ""),
    statusReason: Number(d.StatusReason ?? 0),
    protocol: String(d.Protocol ?? ""),
    activeLoadId: String(d.ActiveLoadID ?? d.ActiveLoadId ?? ""),
    timeStamp: Number(d.TimeStamp ?? 0),
  };
}

export async function selectCmDevice(
  hostOrUrl: string,
  args: SelectCmDeviceArgs = {},
  auth?: DimeAuth,
  port?: number,
): Promise<RisDeviceResult> {
  const target = resolveTarget(hostOrUrl, port);
  const resolvedAuth = resolveAuth(auth);
  const envelope = buildSelectCmDeviceEnvelope(args);
  const timeout = args.timeoutMs ?? 60_000;

  const body = await fetchServiceabilitySoap(
    target.host,
    target.port!,
    resolvedAuth,
    RIS_PATH,
    "selectCmDevice",
    envelope,
    timeout,
  );

  const resp = body.selectCmDeviceResponse as Record<string, unknown> | undefined;
  // CUCM 15 wraps in selectCmDeviceReturn; older versions may not
  const ret = resp?.selectCmDeviceReturn as Record<string, unknown> | undefined;
  const result = (ret?.SelectCmDeviceResult ?? resp?.SelectCmDeviceResult) as Record<string, unknown> | undefined;
  if (!result) throw new Error("Unexpected selectCmDevice response shape");

  const totalDevicesFound = Number(result.TotalDevicesFound ?? 0);
  const nodesRaw = toArray((result.CmNodes as Record<string, unknown>)?.item) as Record<string, unknown>[];

  const cmNodes: RisNode[] = nodesRaw.map((node) => {
    const devicesRaw = toArray((node.CmDevices as Record<string, unknown>)?.item) as Record<string, unknown>[];
    return {
      name: String(node.Name ?? ""),
      returnCode: String(node.ReturnCode ?? ""),
      devices: devicesRaw.map((d) => parseDevice(d)),
    };
  });

  return { totalDevicesFound, cmNodes };
}

export async function selectCmDeviceByIp(
  hostOrUrl: string,
  ipAddress: string,
  opts?: {
    maxDevices?: number;
    status?: string;
    auth?: DimeAuth;
    port?: number;
    timeoutMs?: number;
  },
): Promise<RisDeviceResult> {
  return selectCmDevice(
    hostOrUrl,
    {
      maxReturnedDevices: opts?.maxDevices ?? 200,
      deviceClass: "Phone",
      selectBy: "IPV4Address",
      selectItems: [ipAddress],
      status: opts?.status ?? "Any",
      timeoutMs: opts?.timeoutMs,
    },
    opts?.auth,
    opts?.port,
  );
}
