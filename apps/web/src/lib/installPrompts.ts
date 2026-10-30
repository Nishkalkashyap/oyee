/**
 * Prompts that let a coding agent on the user's computer (Claude Code, Codex…) install the apps from the latest
 * GitHub release. README.md has the same text under "Install with an AI agent"; a test keeps the two in sync.
 */

export interface InstallPrompt {
  id: "macos" | "android";
  title: string;
  description: string;
  prompt: string;
}

const RELEASE = "https://github.com/Nishkalkashyap/oyee/releases/latest";
const RELEASE_API = "https://api.github.com/repos/Nishkalkashyap/oyee/releases/latest";

export const INSTALL_PROMPTS: InstallPrompt[] = [
  {
    id: "macos",
    title: "macOS",
    description: "Paste into Claude Code, Codex or another agent running on your Mac.",
    prompt: `Install the Oyee macOS app on this Mac from its latest GitHub release (${RELEASE}):
1. Find the Oyee-<version>-macOS.zip and SHA256SUMS.txt assets via ${RELEASE_API} and download both to a new temporary directory.
2. Check the zip's SHA-256 against SHA256SUMS.txt. Stop and tell me if it doesn't match.
3. Unzip it, quit Oyee if it's running, and move Oyee.app to /Applications, replacing any older copy.
4. The app is ad-hoc signed and not notarized, so clear its download flags so Gatekeeper doesn't block it: xattr -cr /Applications/Oyee.app
5. Open it with: open /Applications/Oyee.app (it lives in the menu bar).
Then tell me to pair it: on https://oyee.app go to Home → Connect a device and enter the code in the app.`,
  },
  {
    id: "android",
    title: "Android (USB)",
    description: "For an agent on a computer with adb, and your phone plugged in with USB debugging on.",
    prompt: `Install the Oyee Android app on my phone over USB from its latest GitHub release (${RELEASE}):
1. Check that adb is installed and that adb devices lists exactly one authorized phone. If not, explain how to turn on USB debugging and stop.
2. Find the Oyee-<version>.apk and SHA256SUMS.txt assets via ${RELEASE_API} and download both to a new temporary directory.
3. Check the APK's SHA-256 against SHA256SUMS.txt. Stop and tell me if it doesn't match.
4. Install it with: adb install -r <apk>. If that fails with INSTALL_FAILED_UPDATE_INCOMPATIBLE, a build signed with a different key is installed: ask me before uninstalling it (that deletes its data).
5. Start it with: adb shell monkey -p app.oyee.android 1
Then tell me to pair it: on https://oyee.app go to Home → Connect a device and enter the code in the app.`,
  },
];
