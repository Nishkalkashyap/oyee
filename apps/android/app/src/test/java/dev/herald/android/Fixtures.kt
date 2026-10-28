package dev.herald.android

object Fixtures {
    val FULL_NOTIFICATION = """
        {
          "id": "ntf_01JBX0000000000000000000",
          "source": "aws-monitor",
          "threadId": "run-42",
          "title": "prod-api CPU high",
          "body": "CPU above **90%** for 5m",
          "severity": "critical",
          "status": "active",
          "icon": "🔥",
          "image": "https://example.com/graph.png",
          "url": "https://console.aws.amazon.com",
          "fields": [{ "label": "Region", "value": "us-east-1" }],
          "progress": { "value": 3, "max": 7, "label": "3/7 checks", "indeterminate": false },
          "actions": [
            { "id": "ack", "label": "Acknowledge", "style": "primary", "resolves": true },
            { "id": "scale", "label": "Scale +2", "style": "default", "callback": { "url": "https://example.com/cb" } },
            { "id": "open", "label": "Open console", "url": "https://console.aws.amazon.com" }
          ],
          "reply": { "placeholder": "Tell the agent…", "buttonLabel": "Send" },
          "tags": ["prod", "aws"],
          "silent": false,
          "template": "aws-alarm",
          "version": 3,
          "createdAt": "2026-10-28T10:00:00.000Z",
          "updatedAt": "2026-10-28T10:05:00.000Z",
          "readAt": null,
          "resolvedAt": null,
          "responses": [
            { "actionId": "ack", "text": null, "deviceId": "dev_1", "deviceName": "Pixel 9", "at": "2026-10-28T10:04:00.000Z" }
          ]
        }
    """.trimIndent()
}
