// Top-level build file. Module configuration lives in app/build.gradle.kts.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    // Applied by :app only when app/google-services.json exists.
    alias(libs.plugins.google.services) apply false
}
