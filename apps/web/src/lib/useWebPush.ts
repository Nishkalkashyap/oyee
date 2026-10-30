import { useEffect, useState } from "react";
import type { Device } from "@oyee/schema";
import { errorMessage } from "./api";
import { isMockMode } from "./env";
import {
  browserDeviceName,
  getExistingSubscription,
  getWebDeviceId,
  isPushSupported,
  rememberWebDeviceId,
  subscribeToPush,
  unsubscribeFromPush,
} from "./push";
import { useConfig, useRegisterWebDevice, useRemoveDevice } from "./queries";

/**
 * This browser as a push target:
 * - `on`: subscribed and registered as a device
 * - `off`: could be turned on with one click
 * - `blocked`: the user denied notifications for the site
 * - `unsupported`: this browser can't do Web Push here (no Push API or not HTTPS; on iPhone, until added to the Home Screen)
 * - `unconfigured`: the server has no VAPID keys
 * - `unavailable`: mock mode
 */
export type WebPushState = "loading" | "on" | "off" | "blocked" | "unsupported" | "unconfigured" | "unavailable";

export function useWebPush(devices: Device[] | undefined) {
  const config = useConfig();
  const register = useRegisterWebDevice();
  const remove = useRemoveDevice();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supported = isPushSupported();
  const deviceId = getWebDeviceId();
  const registered = !!deviceId && !!devices?.some((d) => d.id === deviceId);

  useEffect(() => {
    void getExistingSubscription().then((s) => setSubscribed(!!s));
  }, []);

  let state: WebPushState;
  if (isMockMode()) state = "unavailable";
  else if (!supported) state = "unsupported";
  else if (config.isPending || subscribed === null || !devices) state = "loading";
  else if (!config.data?.vapidPublicKey) state = "unconfigured";
  else if (Notification.permission === "denied") state = "blocked";
  else state = subscribed && registered ? "on" : "off";

  const enable = async (): Promise<Device | null> => {
    if (!config.data?.vapidPublicKey) return null;
    setBusy(true);
    setError(null);
    try {
      const subscription = await subscribeToPush(config.data.vapidPublicKey);
      const device = await register.mutateAsync({ name: browserDeviceName(), subscription });
      rememberWebDeviceId(device.id);
      setSubscribed(true);
      return device;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Unsubscribes this browser and removes its device. */
  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await unsubscribeFromPush();
      if (deviceId) await remove.mutateAsync(deviceId).catch(() => undefined);
      rememberWebDeviceId(null);
      setSubscribed(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return { state, deviceId, busy, error, enable, disable };
}
