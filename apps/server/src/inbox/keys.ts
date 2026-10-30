/**
 * Keys across intents (spec "Keys", GLOSSARY "Key"): a key refers to the latest notification a source sent with it.
 * While that notification is live (a running or stopped progress, an open ask) the key belongs to its intent, and a
 * send of another intent with the key fails with a message the sender can act on. Once it is no longer live (finished
 * progress, answered/expired/withdrawn ask, any inform) the next intent takes the key over. Pure: the InboxDO does the
 * lookup and calls this before an intent's own rules run.
 */
import { isLiveProgress, isOpenAsk, type Intent, type Notification } from "@oyee/schema";
import { conflict } from "../lib/errors";

/** Throws a conflict when `latest` is live and of an intent other than `intent`. */
export function assertKeyFree(latest: Notification | null | undefined, intent: Intent, now: number): void {
  if (!latest?.key || latest.intent === intent) return;
  const key = JSON.stringify(latest.key);
  const other = `Use a different key for this ${intent}`;
  if (isLiveProgress(latest)) {
    throw conflict(
      `key ${key} belongs to a ${latest.progress.state} progress (id ${latest.id}). ${other}, or first finish that ` +
        `progress by reporting it with key ${key} and status "done" or "failed".`,
    );
  }
  if (isOpenAsk(latest, now)) {
    throw conflict(
      `key ${key} belongs to an open ask still waiting for an answer (id ${latest.id}). ${other}, or first withdraw ` +
        `that ask with resolve (id ${latest.id}).`,
    );
  }
}
