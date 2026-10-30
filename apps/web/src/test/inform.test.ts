/** The inform card's view model, read from the shared protocol v2 fixtures. */
import { Notification } from "@oyee/schema";
import { describe, expect, it } from "vitest";
import raw from "../../../../packages/schema/fixtures/notifications.v2.json";
import { informView, type InformNotification } from "../lib/inform";

const fixtures = raw as Record<string, unknown>;
const inform = (name: string) => {
  const n = Notification.parse(fixtures[name]);
  if (n.intent !== "inform") throw new Error(`${name} is not an inform`);
  return n;
};

describe("informView", () => {
  it("a title-only inform is just its title and severity", () => {
    expect(informView(inform("inform-minimal"))).toEqual({
      severity: "info",
      severityLabel: "Info",
      resolved: false,
      icon: null,
      title: "Backup done",
      body: null,
      image: null,
      rows: [],
      links: [],
      open: null,
    });
  });

  it("a full inform shows its body, rows, image, icon, link buttons and where a tap goes", () => {
    expect(informView(inform("inform-full"))).toEqual({
      severity: "critical",
      severityLabel: "Critical",
      resolved: false,
      icon: { kind: "emoji", text: "💾" },
      title: "Disk 95% full on db-1",
      body: "Free space is **below 5%**. See the `/var` breakdown.\nNext check in 5 minutes.",
      image: "https://grafana.example.com/render/disk.png",
      rows: [
        { label: "Host", value: "db-1" },
        { label: "Used", value: "95%" },
      ],
      links: [
        { label: "Dashboard", url: "https://grafana.example.com/d/disk" },
        { label: "Runbook", url: "https://wiki.example.com/runbooks/disk" },
      ],
      open: { url: "https://grafana.example.com/d/disk", host: "grafana.example.com" },
    });
  });

  it("tells a resolved inform and each severity apart", () => {
    expect(informView(inform("inform-resolved"))).toMatchObject({ resolved: true, severity: "success", severityLabel: "Success" });
    expect(informView(inform("inform-warning"))).toMatchObject({ resolved: false, severity: "warning", severityLabel: "Warning" });
  });

  it("draws an https icon as an image, an empty row value as a dash, and drops unsafe links", () => {
    const base = inform("inform-minimal");
    const n: InformNotification = {
      ...base,
      url: "javascript:alert(1)",
      inform: {
        ...base.inform,
        icon: "https://example.com/logo.png",
        fields: [{ label: "Commit", value: "" }],
        links: [
          { label: "PR", url: "https://github.com/acme/api/pull/7" },
          { label: "Bad", url: "javascript:alert(1)" },
        ],
      },
    };
    expect(informView(n)).toMatchObject({
      icon: { kind: "image", src: "https://example.com/logo.png" },
      rows: [{ label: "Commit", value: "—" }],
      links: [{ label: "PR", url: "https://github.com/acme/api/pull/7" }],
      open: null,
    });
  });

  it("shows at most three link buttons", () => {
    const base = inform("inform-minimal");
    const link = (i: number) => ({ label: `L${i}`, url: `https://example.com/${i}` });
    const n = { ...base, inform: { ...base.inform, links: [1, 2, 3, 4].map(link) } } as InformNotification;
    expect(informView(n).links.map((l) => l.label)).toEqual(["L1", "L2", "L3"]);
  });
});
