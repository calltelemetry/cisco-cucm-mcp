import { selectCmDeviceAll } from "./risport.js";
import { perfmonCollectCounterData } from "./perfmon.js";
import { getServiceStatus } from "./controlcenter.js";
import { type DimeAuth } from "./dime.js";
import { formatUnknownError } from "./errors.js";

const CRITICAL_SERVICES = [
  "Cisco CallManager",
  "Cisco CTIManager",
  "Cisco Tftp",
  "Cisco RIS Data Collector",
];

export type ClusterHealthResult = {
  devices: {
    totalFound: number;
    registered: number;
    unregistered: number;
    byNode: Array<{ name: string; devicesFound: number }>;
  } | null;
  counters: {
    callsActive: number;
    registeredHardwarePhones: number;
    registeredOtherStationDevices: number;
    raw: Array<{ name: string; value: number }>;
  } | null;
  services: {
    total: number;
    started: number;
    stopped: number;
    critical: Array<{ serviceName: string; serviceStatus: string; reasonCode: number }>;
  } | null;
  errors: string[];
};

export interface ClusterHealthOpts {
  auth?: DimeAuth;
  port?: number;
  timeoutMs?: number;
}

/**
 * Finds a counter value by case-insensitive substring match on the counter name.
 * Counter names from PerfMon are typically in the form:
 *   \\\\host\\Object\\CounterName
 */
function findCounterValue(
  counters: Array<{ name: string; value: number }>,
  substring: string,
): number {
  const lower = substring.toLowerCase();
  const match = counters.find((c) => c.name.toLowerCase().includes(lower));
  return match?.value ?? 0;
}

export async function clusterHealthCheck(
  host: string,
  opts?: ClusterHealthOpts,
): Promise<ClusterHealthResult> {
  const auth = opts?.auth;
  const port = opts?.port;
  const timeoutMs = opts?.timeoutMs;

  const errors: string[] = [];

  const [devicesResult, countersResult, servicesResult] = await Promise.allSettled([
    selectCmDeviceAll(host, { timeoutMs }, auth, port),
    perfmonCollectCounterData(host, host, "Cisco CallManager", auth, port, timeoutMs),
    getServiceStatus(host, undefined, auth, port, timeoutMs),
  ]);

  // --- Devices ---
  let devices: ClusterHealthResult["devices"] = null;
  if (devicesResult.status === "fulfilled") {
    const r = devicesResult.value;
    let registered = 0;
    let unregistered = 0;
    const byNode: Array<{ name: string; devicesFound: number }> = [];

    for (const node of r.cmNodes) {
      byNode.push({ name: node.name, devicesFound: node.devices.length });
      for (const dev of node.devices) {
        if (dev.status === "Registered") {
          registered++;
        } else {
          unregistered++;
        }
      }
    }

    devices = {
      totalFound: r.totalDevicesFound,
      registered,
      unregistered,
      byNode,
    };
  } else {
    errors.push(`devices: ${formatUnknownError(devicesResult.reason)}`);
  }

  // --- Counters ---
  let counters: ClusterHealthResult["counters"] = null;
  if (countersResult.status === "fulfilled") {
    const raw = countersResult.value.map((c) => ({ name: c.name, value: c.value }));
    counters = {
      callsActive: findCounterValue(raw, "CallsActive"),
      registeredHardwarePhones: findCounterValue(raw, "RegisteredHardwarePhones"),
      registeredOtherStationDevices: findCounterValue(raw, "RegisteredOtherStationDevices"),
      raw,
    };
  } else {
    errors.push(`counters: ${formatUnknownError(countersResult.reason)}`);
  }

  // --- Services ---
  let services: ClusterHealthResult["services"] = null;
  if (servicesResult.status === "fulfilled") {
    const allServices = servicesResult.value;
    const started = allServices.filter((s) => s.serviceStatus === "Started").length;
    const stopped = allServices.filter((s) => s.serviceStatus === "Stopped").length;

    const critical = allServices
      .filter((s) => CRITICAL_SERVICES.some((cs) => cs.toLowerCase() === s.serviceName.toLowerCase()))
      .map((s) => ({
        serviceName: s.serviceName,
        serviceStatus: s.serviceStatus,
        reasonCode: s.reasonCode,
      }));

    services = {
      total: allServices.length,
      started,
      stopped,
      critical,
    };
  } else {
    errors.push(`services: ${formatUnknownError(servicesResult.reason)}`);
  }

  return { devices, counters, services, errors };
}
